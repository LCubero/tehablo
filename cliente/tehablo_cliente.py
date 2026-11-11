# /// script
# requires-python = ">=3.10"
# dependencies = ["sounddevice", "textual>=8,<9"]
# [tool.uv]
# python-preference = "system"
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
import queue
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
DEFAULTS = dict(device='', volume=1.0, enabled=True, codes=[], general=[])
WAV_HEADER = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 0xFFFFFFFF, b'WAVE',
                         b'fmt ', 16, 1, 1, 24000, 48000, 2, 16, b'data', 0xFFFFFFFF)


def normalize_code(value):
    code = value.replace('-', '').replace(' ', '').lower()
    if not re.fullmatch(r'[0-9a-f]{32}', code):
        raise ValueError('Código no válido: copia el código completo de /tts codigo en el servidor.')
    return code


def pair(settings, code, connection=None):
    code = normalize_code(code)
    codes = settings.get('codes', [])
    general = settings.get('general', list(codes))
    associations = settings.get('connection_codes', {})
    if connection is not None and associations.get(connection) == code:
        return False
    previous = associations.get(connection) if connection is not None else None
    settings['codes'] = list(dict.fromkeys([*codes, code]))
    settings['general'] = list(general)
    if connection is None:
        settings['general'] = list(dict.fromkeys([*general, code]))
    else:
        settings['connection_codes'] = {**associations, connection: code}
        if (previous and previous not in general
                and previous not in settings['connection_codes'].values()):
            settings['codes'].remove(previous)
    return True


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
        settings = dict(device=value['device'], volume=value['volume'], enabled=value['enabled'],
                        codes=[normalize_code(code) for code in codes])
        general = value.get('general')
        try:
            general = [normalize_code(code) for code in general] if isinstance(general, list) else None
        except (TypeError, ValueError, AttributeError):
            general = None
        # Missing or damaged origin counts as general: saved codes are never lost or auto-revoked.
        if general is None or any(code not in settings['codes'] for code in general):
            general = list(settings['codes'])
        settings['general'] = general
        associations = value.get('connection_codes')
        if isinstance(associations, dict):
            settings['connection_codes'] = {}
            for key, code in associations.items():
                try:
                    if isinstance(code, str):
                        code = normalize_code(code)
                        # Associations only remember credentials already accepted by the receiver.
                        if code in settings['codes']:
                            settings['connection_codes'][key] = code
                except ValueError:
                    continue
        return settings
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


def voice_argv(command, interactive=False, password=False):
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
                    if (interactive or password) and option == 'o' and re.split(r'[=\s]+', value, maxsplit=1)[0].lower() in (
                            ('batchmode', 'stdinnull', 'numberofpasswordprompts') if password else ('batchmode', 'stdinnull')):
                        break  # OpenSSH uses the first value, so remove conflicting originals.
                    if option not in 'LRDW' and not (option == 'o' and value.lower().startswith(
                            ('remoteforward', 'localforward', 'dynamicforward'))):
                        flags += option
                        kept.extend(['-' + flags, value])
                        flags = ''
                    break
                if option not in '46AaCfGgKkMNnqsTtVvXxYyf':
                    raise ValueError('No se reconoce esa conexión SSH.')
                if option not in ('ftNTn' if interactive else 'ftNT'):
                    flags += option
            if flags:
                kept.append('-' + flags)
            continue
        if destination is not None:
            break  # OpenSSH reads options after the host; the first other word starts a remote command.
        destination = token
    if destination is None or not re.fullmatch(r'[\w.@:%\[\]-]+', destination) or destination.startswith('-'):
        raise ValueError('No se reconoce esa conexión SSH.')
    if interactive:
        # Typed by the user in a terminal: their options plus the voice forward, nothing else.
        return ['ssh'] + kept[1:] + ['-N', '-R', '18766:127.0.0.1:18766', destination]
    # With a typed password: one attempt only, so a typo never counts three times against server lockouts.
    auth = ['-o', 'NumberOfPasswordPrompts=1'] if password else ['-o', 'BatchMode=yes']
    return kept + ['-N', '-T', *auth, '-o', 'ExitOnForwardFailure=yes',
                   '-o', 'ServerAliveInterval=30', '-R', '18766:127.0.0.1:18766', destination]


ASKPASS_ENV = 'TEHABLO_SSH_SECRETO'


def askpass(prompt, environ=os.environ):
    """SSH_ASKPASS answer: the typed password, only for password or key passphrase prompts."""
    secret = environ.get(ASKPASS_ENV)
    if (secret is None or not re.search('password|passphrase', prompt, re.I)
            or re.search('yes/no|fingerprint', prompt, re.I)):
        return 1  # Host key confirmations and any other question are refused, never accepted.
    sys.stdout.write(secret + '\n')
    return 0


def askpass_supported(executable='ssh', run=subprocess.run):
    """SSH_ASKPASS_REQUIRE=force needs OpenSSH 8.4+ (Win32-OpenSSH 8.6+)."""
    try:
        result = run([executable, '-V'], capture_output=True, text=True, timeout=5,
                     **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}))
    except (OSError, subprocess.SubprocessError):
        return False
    match = re.search(r'OpenSSH\w*?_(\d+)\.(\d+)', (result.stdout or '') + (result.stderr or ''))
    if not match:
        return False
    minimum = (8, 6) if 'windows' in match[0].lower() else (8, 4)
    return (int(match[1]), int(match[2])) >= minimum


def askpass_helper():
    """Launcher without secrets: OpenSSH runs it with its prompt; it calls this client with --askpass."""
    folder = home_dir() / '.tehablo'
    folder.mkdir(parents=True, exist_ok=True)
    client = str(Path(__file__).resolve())
    if os.name == 'nt':
        # cmd.exe reads batch files in the OEM code page.
        # %% keeps a literal % in a path from expanding as a variable.
        python, client = sys.executable.replace('%', '%%'), client.replace('%', '%%')
        path, text, encoding = folder / 'askpass.cmd', f'@"{python}" "{client}" --askpass %*\r\n', 'oem'
    else:
        path, encoding = folder / 'askpass.sh', 'utf-8'
        text = f'#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(client)} --askpass "$@"\n'
    if not path.exists() or path.read_bytes() != text.encode(encoding):
        path.write_bytes(text.encode(encoding))
    path.chmod(0o700)
    return path


def manual_command(argv, windows):
    """Copyable text; quote only what needs it (PowerShell single quotes are literal)."""
    if not windows:
        return shlex.join(argv)
    return ' '.join(arg if re.fullmatch(r'[\w@%+=:,./-]+', arg) else "'" + arg.replace("'", "''") + "'"
                    for arg in argv)


def connection_key(command):
    """Literal destination/user/port only; never resolve aliases or read SSH config."""
    argv = voice_argv(command)
    destination = argv[-1]
    user, host = destination.rsplit('@', 1) if '@' in destination else (None, destination)
    port = None
    # Explicit user@host wins; otherwise OpenSSH keeps the first User/Port option.
    # voice_argv has already expanded attached options and removed remote commands.
    tokens = iter(argv[1:-1])
    for token in tokens:
        if not token.startswith('-') or token[-1:] not in 'BbcDEeFIiJLlmOopQRSWw':
            continue
        value = next(tokens)
        token = '-' + token[-1]
        if token in ('-l', '-p', '-o'):
            if token == '-l' and user is None:
                user = value
            elif token == '-p' and port is None:
                port = value
            elif token == '-o':
                parts = re.split(r'[=\s]+', value, maxsplit=1)
                if len(parts) == 2:
                    name, value = parts
                    if name.lower() == 'user' and user is None:
                        user = value
                    elif name.lower() == 'port' and port is None:
                        port = value
    return json.dumps([user or '', host, port or '22'], ensure_ascii=False)


class VoiceChannel:
    def __init__(self, process_factory=None):
        self.factory = process_factory or subprocess.Popen
        self.process = None
        self.host = ''
        self.needs_interaction = False
        self.used_password = False

    @property
    def running(self):
        return self.process is not None and self.process.poll() is None

    def start(self, command, password=None):
        argv = voice_argv(command, password=password is not None)
        self.needs_interaction = False
        self.used_password = password is not None
        self.stop()
        self.host = argv[-1].rsplit('@', 1)[-1]
        extra = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        if password is not None:
            # Only this ssh child and its askpass helper see the password; it is never stored.
            extra['env'] = {**os.environ, 'SSH_ASKPASS': str(askpass_helper()),
                            'SSH_ASKPASS_REQUIRE': 'force', ASKPASS_ENV: password}
        self.process = self.factory(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, **extra)

    def reason(self):
        if self.process is None or self.running:
            return ''
        process, self.process = self.process, None
        error = process.stderr.read().decode('utf-8', errors='replace').strip() if process.stderr else ''
        if process.stderr:
            process.stderr.close()
        if re.search('host key verification failed', error, re.I):
            self.needs_interaction = 'host'
            return 'SSH necesita confirmar la huella del servidor: hazlo una vez en una terminal.'
        if re.search('permission denied|publickey|password|read_passphrase', error, re.I):
            self.needs_interaction = 'auth'
            if self.used_password:
                return 'Contraseña incorrecta.'
            return 'SSH necesita autenticación o confirmación; también puede ser una clave incorrecta.'
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
        if process.stderr:
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
    return None  # Disconnected (Bluetooth, headset): play on the system default.


class Receiver:
    def __init__(self, settings, sd=None, retired=None):
        self.settings = settings
        self.sd = sd
        self.retired = retired
        self.stop_event = threading.Event()
        self.receiving = False
        self.error = ''
        self.connection_code = lambda: None
        self.connection_scope = lambda: None
        self.pairing_failures = queue.SimpleQueue()

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
        # An owned live channel is scoped; manual reception keeps general pairing.
        scope = self.connection_scope()
        selected = scope[1] if scope else self.connection_code()
        for saved in ([selected] if selected else [] if scope else self.settings.get('codes', [])):
            candidate = saved.encode('ascii')
            if hmac.compare_digest(proof[:32], hmac.digest(candidate, b'servidor' + nonce, 'sha256')):
                key = candidate
        if key is None:
            if scope:
                self.pairing_failures.put(scope)
            raise OSError('Servidor sin vincular: usa Vincular servidor')
        connection.sendall(hmac.digest(key, b'cliente' + proof[32:], 'sha256'))
        if self.read_exact(connection, 44) != WAV_HEADER:
            raise OSError('Cabecera WAV no válida')
        if self.stop_event.is_set() or not self.settings['enabled']:
            return
        sd = self.sd or sound_device()
        device_name = self.settings['device']
        device = resolve_device(device_name, sd)
        # Checked on every reading: the saved choice is kept and used again once it reconnects.
        self.device_note = (f'{device_name} no está conectada: suena por la predeterminada.'
                            if device_name and device is None else '')
        with sd.RawOutputStream(samplerate=24000, channels=1, dtype='int16',
                                device=device, blocksize=480,
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
                    if self.settings['enabled'] and (self.settings.get('codes') or self.connection_scope()):
                        self.device_note = ''
                        self.play(connection)
                        self.error = self.device_note
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
    for helper in ('askpass.cmd', 'askpass.sh'):
        (home_dir() / '.tehablo' / helper).unlink(missing_ok=True)
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
    from textual.widgets import Button, Input, OptionList, Static
    from textual.widgets.option_list import Option
    from rich.text import Text

    class Choices(ModalScreen):
        BINDINGS = [('escape', 'cancel', 'Volver'), ('r', 'refresh', 'Refrescar')]

        def __init__(self, text, options):
            super().__init__()
            self.text, self.options = text, options

        def compose(self):
            with Vertical(id='caja'):
                yield Static(self.text, id='pregunta', markup=False)
                yield OptionList(*(Option(label, id=value) for value, label in self.options),
                                 id='opciones', compact=True)

                if self.text == 'Tu conexión SSH':
                    yield Button('Refrescar', id='refrescar', compact=True)
                    yield Static('r refrescar   Esc volver', id='ayuda')

        def action_refresh(self):
            if self.text == 'Tu conexión SSH':
                self.app.search_sessions(self)

        def on_button_pressed(self, event):
            if event.button.id == 'refrescar':
                self.action_refresh()

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
                yield Static(self.text, id='pregunta', markup=False)
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
            self.consume_pairing_failures()
            reason = voice.reason()
            if reason:
                self.voice_reason = reason
                self.notice(reason)
                if voice.needs_interaction and getattr(self, 'selected_command', None):
                    kind, voice.needs_interaction = voice.needs_interaction, False
                    if kind == 'auth' and askpass_supported(voice_argv(self.selected_command)[0]):
                        self.ask_password(voice.used_password)
                    else:
                        self.other_program()
            lines = status_text(settings, receiver).splitlines()
            self.query_one('#estado').update(lines[0])
            warnings = lines[1:]
            if not settings.get('codes'):
                warnings[0] = 'Sin vincular: usa Vincular servidor con el código de /tts codigo.'
            self.query_one('#alerta').update('\n'.join(warnings))
            values = dict(recepcion='Encendida' if settings['enabled'] else 'Apagada',
                          salida=(settings['device'] or 'Predeterminada') + ' ▾',
                          volumen='━' * round(settings['volume'] * 20) + '─' * (20 - round(settings['volume'] * 20)) + f"  {settings['volume']:.0%}",
                          vincular=('Cambiar código de esta conexión' if getattr(self, 'selected_command', None)
                                    else '✓ vinculado (general)' if settings.get('codes') else 'pendiente'),
                          ssh=f'Canal SSH en ejecución: {voice.host}' if voice.running else
                          'Buscando sesiones…' if getattr(self, 'searching', False) else
                          getattr(self, 'voice_reason', '') or 'Elegir conexión ▾',
                          desinstalar='›', salir='›')
            for name, value in values.items():
                self.query_one('#' + name, Row).show_value(value)

        def consume_pairing_failures(self):
            while not receiver.pairing_failures.empty():
                scope = receiver.pairing_failures.get()
                command = getattr(self, 'selected_command', None)
                current = (connection_key(command), settings.get('connection_codes', {}).get(
                    connection_key(command))) if command else None
                if (scope != current or scope != receiver.connection_scope()
                        or getattr(self, 'pairing_prompt', False)):
                    continue
                # Do not stack a pairing dialog over password or other input.
                if len(self.screen_stack) > 1:
                    receiver.pairing_failures.put(scope)
                    return
                self.pairing_prompt = True
                def done(value, command=command, scope=scope):
                    self.pairing_prompt = False
                    selected = getattr(self, 'selected_command', None)
                    if (value is not None and selected and connection_key(selected) == scope[0]
                            and settings.get('connection_codes', {}).get(scope[0]) == scope[1]):
                        self.guarded(lambda value: self.store_connection_code(command, value), value)
                self.push_screen(Entry('El servidor no reconoce el código de esta conexión. '
                                       'Escribe el código que muestra /tts codigo (o Audio en /tts menu).', True), done)

        def store_connection_code(self, command, value):
            code = normalize_code(value)
            if pair(settings, code, connection=connection_key(command)):
                self.save()

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
                self.link_connection(getattr(self, 'selected_command', None))
            elif name == 'ssh':
                if voice.running:
                    def stop(value):
                        if value == 'detener':
                            voice.stop()
                            self.refresh_status()
                    self.choose(f'Canal SSH en ejecución: {voice.host}', [('detener', 'Detener voz'),
                                                               ('volver', 'Volver')], stop)
                    return
                if not shutil.which('ssh'):
                    self.other_program()
                    return
                self.search_sessions()
            elif name == 'desinstalar':
                self.confirm_uninstall()
            elif name == 'salir':
                self.exit()

        def search_sessions(self, chooser=None):
            if getattr(self, 'searching', False):
                return
            self.searching = True
            self.refresh_status()
            if chooser is not None:
                chooser.query_one('#pregunta').update('Buscando sesiones…')
            # Process discovery always runs off the UI thread.
            threading.Thread(target=lambda: self.call_from_thread(
                self.show_sessions, open_ssh_sessions(commands=True), chooser), daemon=True).start()

        def show_sessions(self, sessions, chooser=None):
                self.searching = False
                self.refresh_status()
                if chooser is not None and chooser not in self.screen_stack:
                    return
                options = [(str(i), host + '   abierta ahora'
                            + ('  ✓ voz activa en esta sesión' if active else ''))
                           for i, (host, active, command) in enumerate(sessions)]
                options += [('otra', 'Otra… — pega tu comando ssh'),
                            ('programa', 'Lo hago a mano — ssh -R, PuTTY, Termius, MobaXterm…')]
                if chooser is not None:
                    listing = chooser.query_one(OptionList)
                    index = listing.highlighted
                    host = chooser.sessions[index][0] if index is not None and index < len(chooser.sessions) else None
                    chooser.sessions = sessions
                    listing.clear_options()
                    listing.add_options(Option(label, id=value) for value, label in options)
                    listing.highlighted = next((i for i, session in enumerate(sessions)
                                                if session[0] == host), 0)
                    chooser.query_one('#pregunta').update('Tu conexión SSH')
                    return
                chooser = Choices('Tu conexión SSH', options)
                chooser.sessions = sessions
                def selected(value):
                    if value == 'otra':
                        self.entry('Pega tu comando ssh (por ejemplo ssh pepe@192.168.7.88)',
                                   self.ssh)
                    elif value == 'programa':
                        self.other_program()
                    else:
                        host, active, command = chooser.sessions[int(value)]
                        self.ssh(command, active=active)
                self.push_screen(chooser, lambda value: self.guarded(selected, value)
                                 if value is not None else None)

        def confirm_uninstall(self):
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

        def other_program(self):
            command = getattr(self, 'selected_command', None) or 'ssh usuario@servidor'
            windows = os.name == 'nt'
            self.choose('Corre este comando en otra terminal' + (' (PowerShell)' if windows else '')
                        + ' de esta computadora:\n\n'
                        '  ' + manual_command(voice_argv(command, interactive=True), windows) + '\n\n'
                        'SSH te pedirá la contraseña ahí. Después no muestra nada más: es normal,\n'
                        'el canal de voz está abierto. Déjala abierta mientras quieras oír la voz,\n'
                        'con este cliente también abierto; Ctrl+C la cierra.\n'
                        'Código de voz: /tts codigo en Pi → Vincular servidor (no es la contraseña SSH).\n\n'
                        'PuTTY: SSH › Tunnels: Source 18766, Destination\n'
                        '127.0.0.1:18766, Remote, Add. Termius/MobaXterm: igual.',
                        [('volver', 'Volver')], lambda value: None)

        def ask_password(self, retry=False):
            target = voice_argv(self.selected_command)[-1]
            self.push_screen(Entry(('Contraseña incorrecta. ' if retry else '')
                                   + f'Contraseña SSH de {target} (o la frase de tu clave).\n'
                                   'No se guarda. Esc: comando para otra terminal.', True),
                             lambda value: self.guarded(self.start_with_password, value) if value
                             else self.other_program())

        def start_with_password(self, password):
            voice.start(self.selected_command, password=password)
            self.voice_reason = ''
            self.refresh_status()

        def link_connection(self, command=None, after=None):
            key = connection_key(command) if command else None
            label = voice_argv(command)[-1] if command else 'servidor (código general)'
            def link(value):
                code = normalize_code(value)  # Validate before any mutation or tunnel.
                changed = pair(settings, code, connection=key)
                if key is not None:
                    self.selected_command = command
                if changed:
                    self.save()
                self.notice('Código guardado para ' + label + '.')
                if after:
                    after()
            self.entry('Código para ' + label + ': cópialo de /tts codigo en el servidor.', link, True)

        def ssh(self, command, active=False):
            key = connection_key(command)
            def ready():
                self.selected_command = command
                self.selected_active = active
                if not active:
                    voice.start(command)
                self.voice_reason = '' if not active else '✓ voz activa en esta sesión'
                self.refresh_status()
            if key not in settings.get('connection_codes', {}):
                self.link_connection(command, ready)
            else:
                ready()

        def on_unmount(self):
            voice.stop()

        def action_quit(self):
            voice.stop()
            self.exit()

    app = Menu()
    receiver.connection_scope = lambda: (
        (connection_key(app.selected_command), settings.get('connection_codes', {}).get(
            connection_key(app.selected_command)))
        if (voice.running or getattr(app, 'selected_active', False))
        and getattr(app, 'selected_command', None) else None)
    receiver.connection_code = lambda: (
        settings.get('connection_codes', {}).get(connection_key(app.selected_command))
        if voice.running and getattr(app, 'selected_command', None) else None)
    return app


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
    if sys.argv[1:2] == ['--askpass']:
        # Called by OpenSSH through the askpass helper: answer and exit, no menu or settings.
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')  # OpenSSH reads UTF-8, not the console code page.
        sys.exit(askpass(' '.join(sys.argv[2:])))
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
