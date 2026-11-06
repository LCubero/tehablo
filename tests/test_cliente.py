"""Client contracts; no real sound device, SSH config or login entries."""
from pathlib import Path
import array
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import MagicMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / '.repo-harness/tmp/t8-check'
SCRATCH.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('cliente', ROOT / 'cliente/tehablo_cliente.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)

    def test_ssh_matrix_idempotent_backup_only_on_change(self):
        cases = [
            (b'Host vps\n User a\n', b'Host vps\n User a\n    LocalForward 18765 127.0.0.1:8765\n'),
            (b'Host vps\n User a\nHost vps\n IdentityFile k\n', b'Host vps\n User a\n    LocalForward 18765 127.0.0.1:8765\nHost vps\n IdentityFile k\n'),
            (b'Host vps\n LocalForward localhost:18765 127.0.0.1:8765\n', None),
            (b'Host other\n User a\nHost vps\n LocalForward 18765 127.0.0.1:8765\n', None),
            (b'Host vps\n User a\nHost vps\n LocalForward [::1]:18765 elsewhere:9\n', None),
            (b'Host other\r\n User a', b'Host other\r\n User a\r\nHost vps\r\n    LocalForward 18765 127.0.0.1:8765\r\n'),
            (b'Host vps\r\n User a', b'Host vps\r\n User a\r\n    LocalForward 18765 127.0.0.1:8765\r\n'),
            (b'Host vps\nMatch all\n User b', b'Host vps\n    LocalForward 18765 127.0.0.1:8765\nMatch all\n User b'),
            (b'Host other\n LocalForward 18765 elsewhere:9\n', b'Host other\n LocalForward 18765 elsewhere:9\nHost vps\n    LocalForward 18765 127.0.0.1:8765\n'),
            (b'Host one vps\n User a\n', b'Host one vps\n User a\n    LocalForward 18765 127.0.0.1:8765\n'),
        ]
        for i, (before, after) in enumerate(cases):
            with self.subTest(i=i):
                path = self.home / str(i) / 'config'
                path.parent.mkdir()
                path.write_bytes(before)
                for _ in range(2):
                    c.configure_ssh('vps', path=path, yes=True, output=lambda *a: None)
                self.assertEqual(path.read_bytes(), after or before)
                backups = list(path.parent.glob('*.bak'))
                self.assertEqual(len(backups), int(after is not None))
                if backups:
                    self.assertEqual(backups[0].read_bytes(), before)

    def test_consent_and_no_terminal_do_not_change_anything(self):
        path = self.home / '.ssh/config'
        for answer in ('n', '', 'sure'):
            log = []
            c.configure_ssh('vps', path=path, ask=lambda p: answer, output=log.append)
            self.assertFalse(path.parent.exists())
            self.assertIn(str(path), '\n'.join(log))
            self.assertIn(c.FORWARD, '\n'.join(log))
        with patch.object(c, 'terminal_input', side_effect=EOFError):
            c.configure_ssh('vps', path=path, output=lambda *a: None)
        self.assertFalse(path.parent.exists())
        for answer in ('S', 'si', 'SÍ', 'Y', 'YES'):
            target = self.home / answer / 'config'
            c.configure_ssh('vps', path=target, ask=lambda p: answer, output=lambda *a: None)
            self.assertIn(c.FORWARD, target.read_text())
        with self.assertRaises(ValueError):
            c.configure_ssh('bad\nhost', path=path, yes=True)

    def test_terminal_input_nonseekable_tty(self):
        class Nonseekable(io.StringIO):
            def seekable(self):
                return False
        reader = Nonseekable('sí\n')
        writer = Nonseekable()
        def open_tty(path, mode='r'):
            self.assertEqual(path, '/dev/tty')
            if '+' in mode:
                raise io.UnsupportedOperation('File or stream is not seekable')
            return reader if mode == 'r' else writer
        with patch.object(c.sys.stdin, 'isatty', return_value=False), patch.object(c.os, 'name', 'posix'), patch('builtins.open', side_effect=open_tty):
            self.assertEqual(c.terminal_input('Pregunta: '), 'sí')

    def test_ssh_missing_final_newline_and_bom(self):
        for eol in ('\n', '\r\n'):
            for tail in ('', eol + 'Host other' + eol + ' User b'):
                before = 'Host vps' + eol + ' User a' + tail
                expected = ('Host vps' + eol + ' User a' + eol + '    ' + c.FORWARD + eol + tail.lstrip('\r\n'))
                with self.subTest(eol=eol, tail=tail):
                    self.assertEqual(c.ssh_text(before, 'vps'), expected)
        before = '\ufeffHost vps\n User a\n'
        expected = '\ufeffHost vps\n User a\n    ' + c.FORWARD + '\n'
        self.assertEqual(c.ssh_text(before, 'vps'), expected)
        self.assertEqual(c.ssh_text(expected, 'vps'), expected)

    def test_settings(self):
        path = self.home / 'cliente.json'
        self.assertEqual(c.load_settings(path), c.DEFAULTS)
        settings = dict(device='Fake', volume=0.4, enabled=False)
        c.save_settings(settings, path)
        self.assertEqual(c.load_settings(path), settings)
        path.write_text('{broken')
        self.assertEqual(c.load_settings(path), c.DEFAULTS)
        path.write_text(json.dumps(dict(device=4, volume=99, enabled='yes')))
        self.assertEqual(c.load_settings(path), c.DEFAULTS)

    def test_volume(self):
        data = array.array('h', [-32768, -100, 0, 100, 32767])
        if sys.byteorder != 'little':
            data.byteswap()
        scaled = array.array('h')
        scaled.frombytes(c.scale_pcm(data.tobytes(), 0.5))
        if sys.byteorder != 'little':
            scaled.byteswap()
        self.assertEqual(list(scaled), [-16384, -50, 0, 50, 16383])
        self.assertEqual(c.scale_pcm(data.tobytes(), 0), bytes(len(data) * 2))

    def test_devices(self):
        sd = Mock()
        sd.query_devices.return_value = [dict(name='Mic', max_output_channels=0), dict(name='Speaker', max_output_channels=2)]
        self.assertEqual(c.output_devices(sd), ['Speaker'])
        self.assertIsNone(c.resolve_device('', sd))
        self.assertEqual(c.resolve_device('Speaker', sd), 1)
        with self.assertRaises(ValueError):
            c.resolve_device('Missing', sd)

    def test_prebuffers_200_ms_before_playing_and_plays_everything(self):
        # Writing each 20 ms packet as it arrives empties the device buffer on network jitter.
        stop = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(bytes(44))
                for _ in range(15):
                    self.wfile.write(b'\x01\x00' * 480)
                    self.wfile.flush()
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        sd = MagicMock()
        stream = sd.RawOutputStream.return_value.__enter__.return_value
        receiver = c.Receiver(dict(c.DEFAULTS), sd=sd, url=f'http://127.0.0.1:{server.server_port}/audio.wav')
        receiver.stop_event = stop
        with patch.object(stop, 'wait', side_effect=lambda _: stop.set()):
            receiver.run()
        sizes = [len(call.args[0]) for call in stream.write.call_args_list]
        self.assertGreaterEqual(sizes[0], 9600)
        self.assertEqual(sum(sizes), 15 * 960)

    def test_reconnect_after_eof_no_real_audio(self):
        calls = []
        stop = threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(bytes(44) + b'\x64\x00' * 10)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        sd = MagicMock()
        stream = sd.RawOutputStream.return_value.__enter__.return_value
        def wait(seconds):
            self.assertEqual(seconds, 3)
            if len(calls) >= 2:
                stop.set()
        receiver = c.Receiver(dict(c.DEFAULTS), sd=sd, url=f'http://127.0.0.1:{server.server_port}/audio.wav')
        receiver.stop_event = stop
        with patch.object(stop, 'wait', side_effect=wait):
            receiver.run()
        self.assertEqual(calls, ['/audio.wav'] * 2)
        self.assertEqual(stream.write.call_count, 2)
        self.assertEqual(stream.write.call_args.args[0], b'\x64\x00' * 10)
        self.assertEqual(sd.RawOutputStream.call_args.kwargs['samplerate'], 24000)
        self.assertFalse(receiver.receiving)

    def test_disabled_reception_never_connects_or_opens_device(self):
        sd = Mock()
        receiver = c.Receiver(dict(c.DEFAULTS, enabled=False), sd=sd)
        def wait(seconds):
            self.assertEqual(seconds, 1)
            receiver.stop_event.set()
        with patch.object(receiver.stop_event, 'wait', side_effect=wait), patch.object(c.urllib.request, 'urlopen') as connect:
            receiver.run()
        connect.assert_not_called()
        sd.RawOutputStream.assert_not_called()

    def test_short_header_retries_without_opening_device(self):
        sd = Mock()
        receiver = c.Receiver(dict(c.DEFAULTS), sd=sd)
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'bad'
        def wait(seconds):
            self.assertEqual(seconds, 3)
            receiver.stop_event.set()
        with patch.object(c.urllib.request, 'urlopen', return_value=response), patch.object(receiver.stop_event, 'wait', side_effect=wait):
            receiver.run()
        sd.RawOutputStream.assert_not_called()
        self.assertIn('incompleta', receiver.error)

    def test_fragmented_pcm_and_volume_with_fake_response(self):
        sd = MagicMock()
        receiver = c.Receiver(dict(c.DEFAULTS, volume=0.5), sd=sd)
        response = MagicMock()
        response.__enter__.return_value.read.return_value = bytes(44)
        response.__enter__.return_value.read1.side_effect = [bytes([100]), bytes([0, 100, 0]), b'']
        with patch.object(c.urllib.request, 'urlopen', return_value=response), patch.object(receiver.stop_event, 'wait', side_effect=lambda s: receiver.stop_event.set()):
            receiver.run()
        stream = sd.RawOutputStream.return_value.__enter__.return_value
        stream.write.assert_called_once_with(bytes([50, 0]) * 2)

    def test_yes_and_uninstall_cli_are_isolated(self):
        manager = Mock()
        installed = self.home / '.local/share/tehablo-cliente/tehablo_cliente.py'
        installed.parent.mkdir(parents=True)
        installed.write_text('# downloaded client')
        with patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData')), patch.object(c, 'Autostart', return_value=manager), patch.object(c, 'sound_device') as sound, patch.object(c, 'print'):
            with patch.object(sys, 'argv', ['cliente', '--yes', 'vps']):
                c.main()
            manager.enable.assert_called_once()
            manager.start_windows.assert_called_once()
            self.assertIn(c.FORWARD, (self.home / '.ssh/config').read_text())
            with patch.object(sys, 'argv', ['cliente', '--uninstall']):
                c.main()
            manager.disable.assert_called_once()
            self.assertFalse(installed.exists())
            self.assertFalse(c.load_settings()['enabled'])
            self.assertTrue((self.home / '.tehablo/cliente-retirado').exists())
            sound.assert_not_called()
        self.assertTrue((self.home / '.ssh/config').exists())

    def test_autostart_isolated_paths_and_commands(self):
        script = self.home / 'with spaces/cliente.py'
        for system in ('Windows', 'Linux', 'Darwin'):
            commands = []
            manager = c.Autostart(home=self.home, appdata=self.home / 'AppData', system=system,
                                  script=script, uv='/fake path/uv', run=lambda cmd: commands.append(cmd))
            manager.enable()
            self.assertTrue(manager.enabled())
            text = manager.path.read_text(encoding='utf-16' if system == 'Windows' else 'utf-8')
            self.assertIn('--fondo', text)
            self.assertIn('cliente.py', text)
            if system == 'Windows':
                self.assertIn(', 0, False', text)
            manager.disable()
            self.assertFalse(manager.enabled())


if __name__ == '__main__':
    unittest.main()
