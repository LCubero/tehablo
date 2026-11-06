# /// script
# requires-python = ">=3.10"
# dependencies = ["sounddevice"]
# ///
"""Cliente de audio SSH de teHablo. Ejecutar con uv run --script este_archivo."""
import argparse
from array import array
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

URL = 'http://127.0.0.1:18765/audio.wav'
FORWARD = 'LocalForward 18765 127.0.0.1:8765'
DEFAULTS = dict(device='', volume=1.0, enabled=True)


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
        return {key: value[key] for key in DEFAULTS}
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save_settings(settings, path=None):
    path = path or settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(settings, ensure_ascii=False), encoding='utf-8')
    temp.replace(path)


def terminal_input(prompt):
    # curl | sh has no stdin terminal. Never consume the downloaded script as input.
    if sys.stdin.isatty():
        return input(prompt)
    if os.name != 'nt':
        with open('/dev/tty') as tty, open('/dev/tty', 'w') as output:
            output.write(prompt)
            output.flush()
            answer = tty.readline()
            if answer:
                return answer.rstrip('\r\n')
    raise EOFError('No hay terminal para preguntar')


def ssh_text(text, alias):
    """Return the unchanged text or append to the FIRST matching Host block."""
    if text.startswith('\ufeff'):
        return '\ufeff' + ssh_text(text[1:], alias)
    headers = list(re.finditer(r'(?im)^[ \t]*(Host|Match)[ \t]+[^\r\n]*', text))
    insert_at = None
    for i, header in enumerate(headers):
        tokens = header.group().split()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        if tokens[0].lower() == 'host' and alias in tokens[1:]:
            body = text[header.start():end]
            if re.search(r'(?im)^[ \t]*LocalForward[ \t]+(?:\S*:)?18765(?:[ \t]|$)', body):
                return text
            if insert_at is None:
                insert_at = end
    eol = '\r\n' if '\r\n' in text else '\n'
    if insert_at is None:
        prefix = eol if text and not text.endswith('\n') else ''
        return text + prefix + 'Host ' + alias + eol + '    ' + FORWARD + eol
    prefix = eol if insert_at and text[insert_at - 1] != '\n' else ''
    return text[:insert_at] + prefix + '    ' + FORWARD + eol + text[insert_at:]


def configure_ssh(alias, path=None, yes=False, ask=None, output=print):
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+', alias):
        raise ValueError('Usa un alias SSH simple (letras, numeros, punto, guion).')
    path = path or home_dir() / '.ssh/config'
    before = path.read_bytes() if path.exists() else b''
    text = before.decode('utf-8')
    after = ssh_text(text, alias).encode('utf-8')
    if before == after:
        output(f'{path} ya reenvia el puerto 18765 para {alias}; no se cambia.')
        return False
    for line in (f'Archivo: {path}', f'Host {alias}', '    ' + FORWARD,
                 'Lleva la voz del servidor a esta computadora por tu conexion SSH; el puerto solo escucha en esta computadora (127.0.0.1).',
                 'Se hara una copia de seguridad del archivo existente antes de cambiarlo.'):
        output(line)
    if not yes:
        try:
            yes = (ask or terminal_input)('¿Continuar? [s/N] ').strip().lower() in ('s', 'si', 'sí', 'y', 'yes')
        except (EOFError, OSError):
            yes = False
    if not yes:
        output(f'Sin cambios. Anade a mano en {path}, bajo Host {alias}:\n    {FORWARD}')
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_name(path.name + '.tehablo-' + uuid.uuid4().hex + '.bak')
        shutil.copy2(path, backup)
    # Preserve identity/permissions; original bytes and line order remain untouched.
    path.write_bytes(after)
    return True


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
    return [d['name'] for d in sd.query_devices() if d['max_output_channels'] > 0]


def resolve_device(name, sd):
    if not name:
        return None
    for i, device in enumerate(sd.query_devices()):
        if device['max_output_channels'] > 0 and device['name'] == name:
            return i
    raise ValueError(f'Salida no disponible: {name}. Elige otra en el menu.')


class Receiver:
    def __init__(self, settings, sd=None, url=URL, reload_settings=None, state_path=None, shutdown_file=None):
        self.settings = settings
        self.sd = sd
        self.url = url
        self.reload_settings = reload_settings
        self.stop_event = threading.Event()
        self.receiving = False
        self.reachable = False
        self.error = ''
        self.state_path = state_path
        self.shutdown_file = shutdown_file
        self.last_report = 0

    def report(self, force=False):
        if self.state_path and (force or time.monotonic() - self.last_report >= 1):
            save_settings(dict(receiving=self.receiving, timestamp=time.time()), self.state_path)
            self.last_report = time.monotonic()

    def run(self):
        while not self.stop_event.is_set():
            if self.shutdown_file and self.shutdown_file.exists():
                return
            if self.reload_settings:
                self.settings.update(self.reload_settings())
            if not self.settings['enabled']:
                self.receiving = False
                self.report()
                self.stop_event.wait(1)
                continue
            try:
                # Timeout bounds idle waits and shutdown; no busy polling without data.
                with urllib.request.urlopen(self.url, timeout=3) as response:
                    self.reachable = True
                    header = response.read(44)
                    if len(header) != 44:
                        raise OSError('Cabecera WAV incompleta')
                    sd = self.sd or sound_device()
                    device_name = self.settings['device']
                    with sd.RawOutputStream(samplerate=24000, channels=1, dtype='int16',
                                            device=resolve_device(device_name, sd), blocksize=480,
                                            latency='low') as stream:
                        pending = b''
                        while not self.stop_event.is_set():
                            if self.reload_settings:
                                self.settings.update(self.reload_settings())
                            if not self.settings['enabled'] or self.settings['device'] != device_name:
                                break
                            chunk = response.read1(960)
                            if not chunk:
                                break
                            data = pending + chunk
                            pending = data[len(data) // 2 * 2:]
                            data = data[:len(data) // 2 * 2]
                            if data:
                                self.receiving = True
                                stream.write(scale_pcm(data, self.settings['volume']))
                                self.report()
                    self.error = ''
            except Exception as exc:
                self.reachable = False
                self.error = str(exc)
            finally:
                self.receiving = False
                self.report(force=True)
            self.stop_event.wait(3)


def run_command(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


class Autostart:
    def __init__(self, home=None, appdata=None, system=None, script=None, uv=None, run=run_command):
        self.home = home or home_dir()
        self.system = system or platform.system()
        self.script = (script or Path(__file__)).resolve()
        self.uv = uv or shutil.which('uv') or 'uv'
        self.run = run
        if self.system == 'Windows':
            appdata = appdata or Path(os.environ.get('APPDATA', self.home / 'AppData/Roaming'))
            self.path = appdata / 'Microsoft/Windows/Start Menu/Programs/Startup/tehablo-cliente.vbs'
        elif self.system == 'Darwin':
            self.path = self.home / 'Library/LaunchAgents/com.tehablo.cliente.plist'
        else:
            self.path = self.home / '.config/systemd/user/tehablo-cliente.service'

    def enabled(self):
        return self.path.exists()

    def enable(self):
        args = [self.uv, 'run', '--script', str(self.script), '--fondo']
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.system == 'Windows':
            command = subprocess.list2cmdline(args).replace('"', '""')
            self.path.write_text(f'CreateObject("WScript.Shell").Run "{command}", 0, False\n', encoding='utf-16')
        elif self.system == 'Darwin':
            self.path.write_bytes(plistlib.dumps(dict(Label='com.tehablo.cliente', ProgramArguments=args,
                                                     RunAtLoad=True, KeepAlive=True)))
            self.run(['launchctl', 'load', str(self.path)])
        else:
            def quote(s):
                return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
            command = ' '.join(quote(s) for s in args)
            self.path.write_text('[Unit]\nDescription=teHablo cliente SSH\n[Service]\nExecStart=' + command +
                                 '\nRestart=always\nRestartSec=3\n[Install]\nWantedBy=default.target\n', encoding='utf-8')
            self.run(['systemctl', '--user', 'daemon-reload'])
            self.run(['systemctl', '--user', 'enable', '--now', self.path.name])

    def start_windows(self):
        if self.system == 'Windows' and self.enabled():
            self.run(['wscript.exe', str(self.path)])

    def disable(self):
        if not self.enabled():
            return
        if self.system == 'Linux':
            self.run(['systemctl', '--user', 'disable', '--now', self.path.name])
        elif self.system == 'Darwin':
            self.run(['launchctl', 'unload', str(self.path)])
        self.path.unlink(missing_ok=True)
        if self.system == 'Linux':
            self.run(['systemctl', '--user', 'daemon-reload'])


class ReceptionLock:
    """One player per user, including when the menu and autostart coexist."""
    def __enter__(self):
        path = home_dir() / '.tehablo/cliente.lock'
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open('a+b')
        self.file.seek(0)
        if self.file.read(1) == b'':
            self.file.write(b'0')
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.file.close()
            return False

    def __exit__(self, *args):
        if not self.file.closed:
            self.file.close()


def uninstall(manager):
    settings = load_settings()
    settings['enabled'] = False
    save_settings(settings)
    (home_dir() / '.tehablo/cliente-retirado').touch()
    manager.disable()
    # Never delete the clone, only the known downloaded client.
    installed = home_dir() / '.local/share/tehablo-cliente/tehablo_cliente.py'
    installed.unlink(missing_ok=True)
    print(f'Cliente retirado. Quita a mano {FORWARD} del Host correspondiente en {home_dir() / ".ssh/config"}.')


def menu(settings, manager, receiver):
    while True:
        try:
            with urllib.request.urlopen('http://127.0.0.1:18765/health', timeout=0.4):
                reachable = True
        except OSError:
            reachable = False
        print('\n--- teHablo: cliente SSH ---')
        print('Servidor por tunel:', 'accesible' if reachable else 'sin conexion')
        receiving = receiver.receiving
        try:
            state = json.loads((home_dir() / '.tehablo/cliente-estado.json').read_text(encoding='utf-8'))
            receiving = state['receiving'] and time.time() - state['timestamp'] < 5
        except (OSError, ValueError, KeyError, TypeError):
            pass
        print('Recepcion:', 'activada' if settings['enabled'] else 'apagada',
              '| Recibiendo:', 'si' if receiving else 'no')
        print('Salida:', settings['device'] or 'Predeterminada', '| Volumen:', f"{settings['volume']:.0%}",
              '| Inicio automatico:', 'si' if manager.enabled() else 'no')
        if receiver.error:
            print('Aviso:', receiver.error)
        # Each option says what it will do, not a toggle the user has to guess.
        print(f"1. {'Apagar' if settings['enabled'] else 'Encender'} recepcion\n2. Elegir salida\n3. Subir volumen\n"
              f"4. Bajar volumen\n5. Configurar SSH\n6. {'Quitar' if manager.enabled() else 'Activar'} inicio automatico\n"
              '7. Desinstalar\n0. Salir')
        try:
            choice = terminal_input('Opcion: ')
            if choice == '0':
                return
            if choice == '1':
                settings['enabled'] = not settings['enabled']
            elif choice == '2':
                devices = [''] + output_devices()
                for i, name in enumerate(devices):
                    print(f'{i}. {name or "Predeterminada"}')
                index = int(terminal_input('Salida: '))
                if not 0 <= index < len(devices):
                    raise ValueError('Salida no valida')
                settings['device'] = devices[index]
            elif choice in ('3', '4'):
                settings['volume'] = round(max(0, min(1, settings['volume'] + (0.1 if choice == '3' else -0.1))), 2)
            elif choice == '5':
                configure_ssh(terminal_input('Alias SSH (por ejemplo mi-servidor): '))
            elif choice == '6':
                manager.disable() if manager.enabled() else manager.enable()
            elif choice == '7':
                if terminal_input('¿Desinstalar el cliente? [s/N] ').lower() in ('s', 'si', 'sí', 'yes', 'y'):
                    uninstall(manager)
                    return
            save_settings(settings)
        except (EOFError, KeyboardInterrupt):
            return
        except Exception as exc:
            print('No se pudo completar:', exc)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fondo', action='store_true')
    parser.add_argument('--yes', action='store_true')
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--config-only', action='store_true')
    parser.add_argument('alias', nargs='?')
    args = parser.parse_args()
    manager = Autostart()
    if args.uninstall:
        uninstall(manager)
        return
    settings = load_settings()
    shutdown_file = home_dir() / '.tehablo/cliente-retirado'
    if not args.fondo:
        shutdown_file.unlink(missing_ok=True)
    if args.yes or args.config_only:
        if not args.alias:
            parser.error('Indica el alias SSH: --yes mi-servidor')
        configure_ssh(args.alias, yes=args.yes)
        if args.config_only:
            return
        settings['enabled'] = True
        save_settings(settings)
        manager.enable()
        manager.start_windows()
        print('Listo. Reconecta SSH y elige Audio: SSH en Pi.')
        return
    receiver = Receiver(dict(settings), reload_settings=load_settings,
                        state_path=home_dir() / '.tehablo/cliente-estado.json', shutdown_file=shutdown_file)
    def receive_once():
        # The menu takes over when an existing login receiver is stopped.
        while not receiver.stop_event.is_set():
            with ReceptionLock() as acquired:
                if acquired:
                    receiver.run()
                    return
            if args.fondo:
                return
            receiver.stop_event.wait(1)

    thread = threading.Thread(target=receive_once, daemon=True)
    thread.start()
    try:
        if args.fondo:
            while thread.is_alive():
                thread.join(1)
        else:
            menu(settings, manager, receiver)
    except KeyboardInterrupt:
        pass
    finally:
        receiver.stop_event.set()
        thread.join(7)
    if not args.fondo:
        manager.start_windows()


if __name__ == '__main__':
    main()
