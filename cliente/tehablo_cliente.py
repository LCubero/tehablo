# /// script
# requires-python = ">=3.10"
# dependencies = ["sounddevice", "textual>=8,<9"]
# ///
"""Cliente de audio SSH de teHablo. Ejecutar con uv run --script este_archivo."""
import argparse
from array import array
import json
import hmac
import secrets
import shlex
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import platform
import struct
import sys
import threading
import time

ADDRESS = ('127.0.0.1', 18766)
FORWARD = 'RemoteForward 18766 127.0.0.1:18766'
DEFAULTS = dict(device='', volume=1.0, enabled=True, codes=[])
WAV_HEADER = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 0xFFFFFFFF, b'WAVE',
                         b'fmt ', 16, 1, 1, 24000, 48000, 2, 16, b'data', 0xFFFFFFFF)


def normalize_code(value):
    code = value.replace('-', '').replace(' ', '').lower()
    if not re.fullmatch(r'[0-9a-f]{32}', code):
        raise ValueError('Código no válido: copia el código completo de /tts codigo en el servidor.')
    return code


def pair(settings, code):
    code = normalize_code(code)
    settings['codes'] = list(dict.fromkeys([*settings.get('codes', []), code]))


def home_dir():
    return Path(os.environ.get('HOME') or os.environ.get('USERPROFILE') or Path.home())


def settings_path():
    return home_dir() / '.tehablo/cliente.json'


def load_settings(path=None):
    try:
        value = json.loads((path or settings_path()).read_text(encoding='utf-8'))
        if (not isinstance(value, dict) or not isinstance(value.get('device'), str)
                or type(value.get('volume')) not in (int, float)
                or not 0 <= value['volume'] <= 1 or type(value.get('enabled')) is not bool):
            return dict(DEFAULTS)
        codes = value.get('codes', [])
        if not isinstance(codes, list) or any(not isinstance(code, str) for code in codes):
            return dict(DEFAULTS)
        return dict(device=value['device'], volume=value['volume'], enabled=value['enabled'],
                    codes=[normalize_code(code) for code in codes])
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save_settings(settings, path=None):
    path = path or settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.json.tmp')
    # Pairing codes are bearer credentials, not ordinary public preferences.
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as file:
        file.write(json.dumps(settings, ensure_ascii=False))
    temp.replace(path)


def ssh_tokens(command):
    # Non-POSIX splitting preserves Windows identity paths; unquote each token.
    return [t[1:-1] if len(t) > 1 and t[0] == t[-1] and t[0] in '\"\'' else t
            for t in shlex.split(command, posix=False)]


def voice_argv(command):
    """Keep connection arguments only, without shell execution or remote commands."""
    tokens = ssh_tokens(command)
    executable = 'ssh'
    if tokens and tokens[0].replace('\\', '/').rsplit('/', 1)[-1] in ('ssh', 'ssh.exe'):
        executable = tokens.pop(0)
    kept, destination = [executable], None
    while tokens:
        token = tokens.pop(0)
        if token == '--':
            if destination is None and tokens:
                destination = tokens.pop(0)
            break
        if token.startswith('-'):
            flags = ''
            for index, option in enumerate(token[1:]):
                if option in 'BbcDEeFIiJLlmOopQRSWw':
                    value = token[index + 2:] or (tokens.pop(0) if tokens else '')
                    if not value:
                        raise ValueError('No se reconoce esa conexión SSH.')
                    if option not in 'LRDW' and not (option == 'o' and value.lower().startswith(
                            ('remoteforward', 'localforward', 'dynamicforward'))):
                        flags += option
                        kept.extend(['-' + flags, value])
                        flags = ''
                    break
                if option not in '46AaCfGgKkMNnqsTtVvXxYyf':
                    raise ValueError('No se reconoce esa conexión SSH.')
                if option not in 'ftNT':
                    flags += option
            if flags:
                kept.append('-' + flags)
            continue
        if destination is not None:
            break  # OpenSSH reads options after the host; the first other word starts a remote command.
        destination = token
    if destination is None or not re.fullmatch(r'[\w.@:%\[\]-]+', destination) or destination.startswith('-'):
        raise ValueError('No se reconoce esa conexión SSH.')
    return kept + ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
                   '-o', 'ServerAliveInterval=30', '-R', '18766:127.0.0.1:18766', destination]


class VoiceChannel:
    def __init__(self, process_factory=None):
        self.factory = process_factory or subprocess.Popen
        self.process = None
        self.host = ''

    @property
    def running(self):
        return self.process is not None and self.process.poll() is None

    def start(self, command):
        argv = voice_argv(command)
        self.stop()
        self.host = argv[-1].rsplit('@', 1)[-1]
        self.process = self.factory(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE,
                                    **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}))

    def reason(self):
        if self.process is None or self.running:
            return ''
        process, self.process = self.process, None
        error = process.stderr.read().decode('utf-8', errors='replace').strip()
        process.stderr.close()
        if re.search('permission denied|publickey|password', error, re.I):
            return 'Entras con contraseña: usa «Lo hago a mano»'
        if re.search('remote port forwarding failed|administratively prohibited', error, re.I):
            return 'El canal de voz ya está abierto en otra conexión'
        return error.splitlines()[-1] if error else f'Canal de voz cerrado (SSH {process.returncode}).'

    def stop(self):
        process, self.process = self.process, None
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        process.stderr.close()


def ssh_target(command):
    message = 'Pega tu conexión SSH completa, por ejemplo: ssh pepe@mi-servidor.'
    try:
        tokens = shlex.split(command)
    except ValueError:
        raise ValueError(message) from None
    if tokens and tokens[0] == 'ssh':
        tokens.pop(0)
    while tokens:
        token = tokens.pop(0)
        if token == '--':
            break
        if not token.startswith('-'):
            return token.rsplit('@', 1)[-1]
        # OpenSSH short options with arguments (attached or next token).
        options = token[1:]
        for index, option in enumerate(options):
            if option in 'BbcDEeFIiJLlmOopQRSWw':
                if index == len(options) - 1:
                    if not tokens:
                        raise ValueError(message)
                    tokens.pop(0)
                break
            if option not in '46AaCfGgKkMNnqsTtVvXxYyf':
                raise ValueError(message)
    if tokens:
        return tokens[0].rsplit('@', 1)[-1]
    raise ValueError(message)


def ssh_process(command):
    """Extract only interactive OpenSSH destinations, never remote commands."""
    try:
        tokens = ssh_tokens(command)
        if not tokens or tokens.pop(0).replace('\\', '/').rsplit('/', 1)[-1] not in ('ssh', 'ssh.exe'):
            return None
        for i in range(1, len(tokens) + 1):
            prefix = tokens[:i]
            if any(t.startswith('-F') for t in prefix):
                return None
            try:
                host = ssh_target('ssh ' + shlex.join(prefix))
            except ValueError:
                continue
            if i != len(tokens):
                return None
            active = bool(re.search(
                r'(?:^| )-(?:R ?|o ?RemoteForward[= ])(?:[^: ]+:)?18766[: ]',
                ' '.join(prefix[:-1])))
            return host, active
    except ValueError:
        pass
    return None


def open_ssh_sessions(runner=subprocess.run, system=None, commands=False):
    command = ['powershell', '-NoProfile', '-Command',
               'Get-CimInstance Win32_Process -Filter "Name=\'ssh.exe\'" | ForEach-Object { $_.CommandLine }'] if (system or platform.system()) == 'Windows' else ['ps', '-axo', 'command=']
    try:
        result = runner(command, capture_output=True, text=True, timeout=3)
        sessions = {}
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                parsed = ssh_process(line)
                if parsed:
                    host, active = parsed
                    previous = sessions.get(host)
                    if previous is None or active:
                        sessions[host] = (active, line)
        return [(host, *value) for host, value in sessions.items()] if commands else [
            (host, value[0]) for host, value in sessions.items()]
    except Exception:
        return []


def scale_pcm(data, volume):
    samples = array('h')
    samples.frombytes(data)
    if sys.byteorder != 'little':
        samples.byteswap()
    volume = max(0.0, min(1.0, volume))
    for i, sample in enumerate(samples):
        samples[i] = int(sample * volume)
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples.tobytes()


def sound_device():
    import sounddevice
    return sounddevice


def output_devices(sd=None):
    sd = sd or sound_device()
    hostapi = sd.query_devices(kind='output')['hostapi']
    indices = sd.query_hostapis(hostapi)['devices']
    return [d['name'] for i, d in enumerate(sd.query_devices())
            if i in indices and d['max_output_channels'] > 0]


def resolve_device(name, sd):
    if not name:
        return None
    for i, device in enumerate(sd.query_devices()):
        if device['max_output_channels'] > 0 and device['name'] == name:
            return i
    raise ValueError(f'Salida no disponible: {name}. Elige otra en el menu.')


class Receiver:
    def __init__(self, settings, sd=None, retired=None):
        self.settings = settings
        self.sd = sd
        self.retired = retired
        self.stop_event = threading.Event()
        self.receiving = False
        self.error = ''

    def check_retired(self):
        # --uninstall from another terminal stops this open client too.
        if self.retired and self.retired.exists():
            self.stop_event.set()
        return self.stop_event.is_set()
    def read_exact(self, connection, size):
        data = b''
        deadline = time.monotonic() + 1
        while len(data) < size and not self.stop_event.is_set():
            if not self.settings['enabled']:
                raise OSError('Recepción apagada')
            if time.monotonic() >= deadline:
                raise OSError('Vinculación o cabecera incompleta')
            try:
                chunk = connection.recv(size - len(data))
            except socket.timeout:
                continue
            if not chunk:
                raise OSError('Vinculación o cabecera incompleta')
            data += chunk
        return data

    def play(self, connection):
        connection.settimeout(.5)
        nonce = secrets.token_bytes(16)
        connection.sendall(nonce)
        proof = self.read_exact(connection, 48)
        key = None
        # Compare every saved code before choosing a matching server.
        for saved in self.settings.get('codes', []):
            candidate = saved.encode('ascii')
            if hmac.compare_digest(proof[:32], hmac.digest(candidate, b'servidor' + nonce, 'sha256')):
                key = candidate
        if key is None:
            raise OSError('Servidor sin vincular: usa Vincular servidor')
        connection.sendall(hmac.digest(key, b'cliente' + proof[32:], 'sha256'))
        if self.read_exact(connection, 44) != WAV_HEADER:
            raise OSError('Cabecera WAV no válida')
        if self.stop_event.is_set() or not self.settings['enabled']:
            return
        sd = self.sd or sound_device()
        device_name = self.settings['device']
        with sd.RawOutputStream(samplerate=24000, channels=1, dtype='int16',
                                device=resolve_device(device_name, sd), blocksize=480,
                                latency='high') as stream:
            pending = queued = b''
            last_data = 0.0
            while not self.stop_event.is_set():
                if self.stop_event.is_set() or not self.settings['enabled'] or self.settings['device'] != device_name:
                    return
                try:
                    chunk = connection.recv(960)
                except socket.timeout:
                    self.receiving = False
                    self.check_retired()
                    continue
                if not chunk:
                    if queued:
                        stream.write(scale_pcm(queued, self.settings['volume']))
                    return
                now = time.monotonic()
                data = pending + chunk
                pending = data[len(data) // 2 * 2:]
                data = data[:len(data) // 2 * 2]
                if not data:
                    continue
                # Keep the existing 200 ms prebuffer, including after pauses.
                if now - last_data > .3:
                    if queued:
                        stream.write(scale_pcm(queued, self.settings['volume']))
                    queued = b''
                last_data = now
                self.receiving = True
                if queued is not None:
                    queued += data
                    if len(queued) < 9600:
                        continue
                    data, queued = queued, None
                stream.write(scale_pcm(data, self.settings['volume']))

    def run(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            try:
                if os.name == 'nt':
                    listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                listener.bind(ADDRESS)
                listener.listen(1)
                listener.settimeout(.5)
            except OSError:
                self.error = 'Puerto 18766 ocupado; cierra el otro receptor o programa que lo usa.'
                return
            while not self.check_retired():
                try:
                    connection, _ = listener.accept()
                except socket.timeout:
                    continue
                try:
                    connection.settimeout(.5)
                    if self.settings['enabled'] and self.settings.get('codes'):
                        self.play(connection)
                        self.error = ''
                except Exception as exc:
                    self.error = str(exc)
                finally:
                    connection.close()
                    self.receiving = False


def retired_path():
    return home_dir() / '.tehablo/cliente-retirado'


def remove_legacy_login_entry(system=None, run=subprocess.run):
    """Earlier test builds could register a login entry; uninstall removes it."""
    system, home = system or platform.system(), home_dir()
    if system == 'Windows':
        appdata = Path(os.environ.get('APPDATA') or home / 'AppData/Roaming')
        path, command = appdata / 'Microsoft/Windows/Start Menu/Programs/Startup/tehablo-cliente.vbs', None
    elif system == 'Darwin':
        path = home / 'Library/LaunchAgents/com.tehablo.cliente.plist'
        command = ['launchctl', 'unload', str(path)]
    else:
        path = home / '.config/systemd/user/tehablo-cliente.service'
        command = ['systemctl', '--user', 'disable', '--now', path.name]
    if not path.exists():
        return
    if command:
        try:
            run(command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        except (OSError, subprocess.SubprocessError):
            pass
    path.unlink(missing_ok=True)


def uninstall(output=None, system=None, run=subprocess.run):
    settings = load_settings()
    settings['enabled'] = False
    save_settings(settings)
    retired_path().parent.mkdir(parents=True, exist_ok=True)
    retired_path().touch()
    remove_legacy_login_entry(system, run)
    # Never delete the clone, only the known downloaded client.
    installed = home_dir() / '.local/share/tehablo-cliente/tehablo_cliente.py'
    installed.unlink(missing_ok=True)
    (output or print)(f'Cliente retirado. Si añadiste {FORWARD} a mano, puedes quitarlo del Host correspondiente en {home_dir() / ".ssh/config"}.')


def status_text(settings, receiver):
    receiving = receiver.receiving
    if not settings['enabled']:
        lines = ['○ Recepción apagada']
    else:
        lines = ['● Recibiendo voz' if receiving else '○ Listo para recibir (se conecta al usar SSH)']
    if not settings.get('codes'):
        lines.append('Sin vincular: escribe abajo el código que muestra /tts codigo en el servidor.')
    if receiver.error:
        lines.append('Aviso: ' + receiver.error)
    return '\n'.join(lines)


def exit_message(settings):
    if not settings['enabled']:
        return 'Recepción apagada: enciéndela en el menú para oír la voz.'
    return 'Recepción detenida: abre el cliente cuando quieras oír la voz.'


def menu_app(settings, receiver, voice=None):
    voice = voice or VoiceChannel()
    # Textual loads only when opening the menu.
    from textual.app import App
    from textual.containers import Horizontal, Vertical
    from textual.screen import ModalScreen
    from textual.widgets import Input, OptionList, Static
    from textual.widgets.option_list import Option
    from rich.text import Text

    class Choices(ModalScreen):
        BINDINGS = [('escape', 'cancel', 'Volver')]

        def __init__(self, text, options):
            super().__init__()
            self.text, self.options = text, options

        def compose(self):
            with Vertical(id='caja'):
                yield Static(self.text, id='pregunta', markup=False)
                yield OptionList(*(Option(label, id=value) for value, label in self.options),
                                 id='opciones', compact=True)

        def on_option_list_option_selected(self, event):
            self.dismiss(event.option.id)

        def action_cancel(self):
            self.dismiss(None)

    class Entry(ModalScreen):
        BINDINGS = [('escape', 'cancel', 'Volver')]

        def __init__(self, text, password=False):
            super().__init__()
            self.text, self.password = text, password

        def compose(self):
            with Vertical(id='caja'):
                yield Static(self.text, markup=False)
                yield Input(password=self.password, compact=True, id='entrada')

        def on_input_submitted(self, event):
            self.dismiss(event.value)

        def action_cancel(self):
            self.dismiss(None)

    class Row(Static, can_focus=True):
        def __init__(self, label, id):
            super().__init__('', id=id)
            self.label = label

        def show_value(self, value):
            text = Text('▌ ' if self.has_focus else '  ')
            text.append(f'{self.label:<20}', style='dim')
            text.append(value)
            self.update(text)

        def on_focus(self):
            self.app.refresh_status()

        def on_blur(self):
            self.app.refresh_status()

        def on_click(self, event):
            self.focus()
            if self.id == 'volumen':
                if 22 <= event.x <= 41:
                    self.app.volume((event.x - 22) / 19)
            else:
                self.app.activate(self.id)

        def on_key(self, event):
            if event.key in ('up', 'down'):
                self.screen.focus_previous() if event.key == 'up' else self.screen.focus_next()
            elif self.id == 'volumen' and event.key in ('left', 'right'):
                self.app.volume(settings['volume'] + (.1 if event.key == 'right' else -.1))
            elif event.key == 'enter':
                self.app.activate(self.id)
            else:
                return
            event.stop()

    class Menu(App):
        TITLE = 'teHablo receptor'
        ENABLE_COMMAND_PALETTE = False
        CSS = '''
        Screen { align: center top; }
        #panel { width: 72; max-width: 100%; height: auto; padding: 1 2 0 2; }
        #cabecera { height: 2; }
        #titulo { width: 20; text-style: bold; }
        #estado { width: 1fr; text-align: right; color: $accent; }
        #alerta, #aviso { height: auto; color: $text-muted; }
        #alerta { margin-bottom: 1; }
        Row { height: 1; margin-bottom: 1; }
        Row:focus { color: $accent; text-style: bold; }
        #salir { margin-bottom: 0; }
        .separador { height: 1; color: $text-muted; }
        #pistas { height: 1; color: $text-muted; }
        Choices, Entry { align: center middle; }
        #caja { width: 90%; max-width: 92; height: auto; max-height: 95%;
                background: $surface; padding: 1 2; overflow-y: auto; }
        #pregunta { height: auto; margin-bottom: 1; }
        OptionList { height: auto; max-height: 12; border: none; background: transparent; padding: 0; }
        Input { border: none; background: transparent; }
        '''
        BINDINGS = [('escape', 'quit', 'Salir')]

        def compose(self):
            self.theme = 'tokyo-night'
            with Vertical(id='panel'):
                with Horizontal(id='cabecera'):
                    yield Static('teHablo · receptor', id='titulo')
                    yield Static(id='estado', markup=False)
                yield Static(id='alerta', markup=False)
                for label, name in [('Recepción', 'recepcion'), ('Salida', 'salida'),
                                    ('Volumen', 'volumen')]:
                    yield Row(label, id=name)
                yield Static('─' * 68, classes='separador')
                for label, name in [('Vincular servidor', 'vincular'), ('Conexión SSH', 'ssh'),
                                    ('Desinstalar', 'desinstalar'), ('Salir', 'salir')]:
                    yield Row(label, id=name)
                yield Static(id='aviso', markup=False)
                yield Static('↑↓ moverse   Enter cambiar   ←→ volumen   clic también   Esc salir', id='pistas')

        def on_mount(self):
            self.voice_reason = ''
            self.refresh_status()
            self.set_interval(1, self.refresh_status)

        def refresh_status(self):
            if not self.query('#estado'):
                return
            if receiver.retired and receiver.check_retired():
                voice.stop()
                self.exit('Cliente desinstalado desde otra terminal; recepción detenida.')
                return
            reason = voice.reason()
            if reason:
                self.voice_reason = reason
                self.notice(reason)
            lines = status_text(settings, receiver).splitlines()
            self.query_one('#estado').update(lines[0])
            warnings = lines[1:]
            if not settings.get('codes'):
                warnings[0] = 'Sin vincular: usa Vincular servidor con el código de /tts codigo.'
            self.query_one('#alerta').update('\n'.join(warnings))
            values = dict(recepcion='Encendida' if settings['enabled'] else 'Apagada',
                          salida=(settings['device'] or 'Predeterminada') + ' ▾',
                          volumen='━' * round(settings['volume'] * 20) + '─' * (20 - round(settings['volume'] * 20)) + f"  {settings['volume']:.0%}",
                          vincular='✓ vinculado' if settings.get('codes') else 'pendiente',
                          ssh=f'● Voz conectada a {voice.host}' if voice.running else getattr(self, 'voice_reason', '') or 'Elegir conexión ▾',
                          desinstalar='›', salir='›')
            for name, value in values.items():
                self.query_one('#' + name, Row).show_value(value)

        def notice(self, text):
            self.query_one('#aviso').update(text)

        def save(self):
            save_settings(settings)
            self.refresh_status()

        def volume(self, value):
            settings['volume'] = round(max(0, min(1, value)), 2)
            self.save()

        def guarded(self, function, value):
            try:
                function(value)
            except Exception as exc:
                self.notice(f'No se pudo completar -> {exc}')

        def choose(self, text, options, callback):
            self.push_screen(Choices(text, options),
                             lambda value: self.guarded(callback, value) if value is not None else None)

        def entry(self, text, callback, password=False):
            self.push_screen(Entry(text, password),
                             lambda value: self.guarded(callback, value) if value is not None else None)

        def activate(self, name):
            self.guarded(self.change, name)

        def change(self, name):
            if name == 'recepcion':
                settings['enabled'] = not settings['enabled']
                self.save()
            elif name == 'salida':
                devices = list(dict.fromkeys(['', *output_devices(), settings['device']]))
                def select(index):
                    settings['device'] = devices[int(index)]
                    self.save()
                self.choose('Salida de audio', [(str(i), value or 'Predeterminada')
                                               for i, value in enumerate(devices)], select)
            elif name == 'vincular':
                def link(value):
                    pair(settings, value)
                    self.save()
                    self.notice('Servidor vinculado.')
                self.entry('Código de vinculación: cópialo de /tts codigo en el servidor.', link, True)
            elif name == 'ssh':
                if voice.running:
                    def stop(value):
                        if value == 'detener':
                            voice.stop()
                            self.refresh_status()
                    self.choose(f'Voz conectada a {voice.host}', [('detener', 'Detener voz'),
                                                               ('volver', 'Volver')], stop)
                    return
                if not shutil.which('ssh'):
                    self.other_program()
                    return
                sessions = open_ssh_sessions(commands=True)
                options = [(str(i), host + '   abierta ahora'
                            + ('  ✓ voz activa en esta sesión' if active else ''))
                           for i, (host, active, command) in enumerate(sessions)]
                options += [('otra', 'Otra… — pega tu comando ssh'),
                            ('programa', 'Lo hago a mano — ssh -R, PuTTY, Termius, MobaXterm…')]
                def selected(value):
                    if value == 'otra':
                        self.entry('Pega tu comando ssh (por ejemplo ssh pepe@192.168.7.88)',
                                   self.ssh)
                    elif value == 'programa':
                        self.other_program()
                    else:
                        host, active, command = sessions[int(value)]
                        if not active:
                            self.ssh(command)
                self.choose('Tu conexión SSH', options, selected)
            elif name == 'desinstalar':
                def done(value):
                    if value == 'si':
                        lines = []
                        settings['enabled'] = False
                        receiver.stop_event.set()
                        voice.stop()
                        uninstall(output=lines.append)
                        self.exit('\n'.join(lines))
                self.choose('¿Desinstalar el cliente? Se apaga la recepción.',
                            [('si', 'Sí, desinstalar'), ('no', 'No')], done)
            elif name == 'salir':
                self.exit()

        def other_program(self):
            self.choose('Hazlo tú en tu programa SSH. Sirve si entras con contraseña o usas\n'
                        'PuTTY, Termius, MobaXterm…\n\n'
                        'Necesitas un reenvío remoto:\n'
                        'puerto 18766 del servidor → 127.0.0.1:18766 de esta computadora\n\n'
                        '  ssh        ssh -R 18766:127.0.0.1:18766 pepe@192.168.7.88\n'
                        '  ssh fijo   en ~/.ssh/config, bajo tu Host:\n'
                        '             RemoteForward 18766 127.0.0.1:18766\n'
                        '  PuTTY      Connection › SSH › Tunnels › Source port 18766,\n'
                        '             Destination 127.0.0.1:18766, Remote, Add; guarda la sesión\n'
                        '  Otros      un reenvío remoto con esos mismos datos\n\n'
                        'Después conéctate de nuevo y deja este cliente abierto: es el que suena.',
                        [('volver', 'Volver')], lambda value: None)

        def ssh(self, command):
            voice.start(command)
            self.voice_reason = ''
            self.refresh_status()

        def on_unmount(self):
            voice.stop()

        def action_quit(self):
            voice.stop()
            self.exit()

    return Menu()


def menu(settings, receiver, voice=None):
    if not sys.stdin.isatty():
        # curl | sh: the menu reads the real terminal, never the downloaded script.
        try:
            if os.name == 'nt':
                raise OSError
            fd = os.open('/dev/tty', os.O_RDWR)
            os.dup2(fd, 0)
            os.close(fd)
        except OSError:
            print('No hay terminal para abrir el menú; no se cambió nada.')
            return
    voice = voice or VoiceChannel()
    try:
        result = menu_app(settings, receiver, voice).run()
    finally:
        voice.stop()
    if result:
        print(result)
        return
    print(exit_message(settings))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--codigo', help='Código de vinculación mostrado por /tts codigo')
    args = parser.parse_args()
    if args.uninstall:
        uninstall()
        return
    settings = load_settings()
    if args.codigo:
        try:
            pair(settings, args.codigo)
        except ValueError as exc:
            parser.error(str(exc))
        save_settings(settings)
    retired_path().unlink(missing_ok=True)
    receiver = Receiver(settings, retired=retired_path())
    thread = threading.Thread(target=receiver.run, daemon=True)
    thread.start()
    voice = VoiceChannel()
    try:
        menu(settings, receiver, voice)
    except KeyboardInterrupt:
        pass
    finally:
        voice.stop()
        receiver.stop_event.set()
        thread.join(7)


if __name__ == '__main__':
    main()
