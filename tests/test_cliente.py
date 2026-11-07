"""Client contracts; no real sound device, SSH config or login entries."""
from pathlib import Path
import array
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / '.repo-harness/tmp/t11-check'
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
            (b'Host vps\n User a\n', b'Host vps\n User a\n    RemoteForward 18766 127.0.0.1:18766\n'),
            (b'Host vps\n User a\nHost vps\n IdentityFile k\n', b'Host vps\n User a\n    RemoteForward 18766 127.0.0.1:18766\nHost vps\n IdentityFile k\n'),
            (b'Host vps\n RemoteForward localhost:18766 127.0.0.1:18766\n', None),
            (b'Host other\n User a\nHost vps\n RemoteForward 18766 127.0.0.1:18766\n', None),
            (b'Host vps\n User a\nHost vps\n RemoteForward [::1]:18766 elsewhere:9\n', None),
            (b'Host other\r\n User a', b'Host other\r\n User a\r\nHost vps\r\n    RemoteForward 18766 127.0.0.1:18766\r\n'),
            (b'Host vps\r\n User a', b'Host vps\r\n User a\r\n    RemoteForward 18766 127.0.0.1:18766\r\n'),
            (b'Host vps\nMatch all\n User b', b'Host vps\n    RemoteForward 18766 127.0.0.1:18766\nMatch all\n User b'),
            (b'Host other\n RemoteForward 18766 elsewhere:9\n', b'Host other\n RemoteForward 18766 elsewhere:9\nHost vps\n    RemoteForward 18766 127.0.0.1:18766\n'),
            (b'Host one vps\n User a\n', b'Host one vps\n User a\n    RemoteForward 18766 127.0.0.1:18766\n'),
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

    def test_old_forward_is_mentioned_and_never_deleted(self):
        path = self.home / 'config'
        before = b'Host vps\n    LocalForward 18765 127.0.0.1:8765\n'
        path.write_bytes(before)
        log = []
        c.configure_ssh('vps', path=path, yes=True, output=log.append)
        self.assertTrue(path.read_bytes().startswith(before))
        self.assertIn('LocalForward 18765', '\n'.join(log))
        self.assertIn('otro usuario', '\n'.join(log))
        self.assertIn('controlar', '\n'.join(log))

    def test_settings(self):
        path = self.home / 'cliente.json'
        self.assertEqual(c.load_settings(path), c.DEFAULTS)
        settings = dict(device='Fake', volume=0.4, enabled=False, codes=[])
        c.save_settings(settings, path)
        self.assertEqual(c.load_settings(path), settings)
        path.write_text('{broken')
        self.assertEqual(c.load_settings(path), c.DEFAULTS)
        path.write_text(json.dumps(dict(device=4, volume=99, enabled='yes')))
        self.assertEqual(c.load_settings(path), c.DEFAULTS)

    def test_pairing_list_migration_normalization_and_idempotence(self):
        path = self.home / 'cliente.json'
        path.write_text(json.dumps(dict(device='Fake', volume=.4, enabled=True)))
        settings = c.load_settings(path)
        self.assertEqual(settings['codes'], [])
        c.pair(settings, '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF')
        c.pair(settings, self.CODE)
        c.pair(settings, 'f' * 32)
        c.save_settings(settings, path)
        self.assertEqual(c.load_settings(path)['codes'], [self.CODE, 'f' * 32])
        self.assertEqual(c.load_settings(path)['device'], 'Fake')
        with self.assertRaises(ValueError):
            c.pair(settings, 'bad')

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

    CODE = '0123456789abcdef0123456789abcdef'

    def receive(self, chunks, settings=None, connections=1, max_recv=960):
        sd = MagicMock()
        receiver = c.Receiver(settings or dict(c.DEFAULTS, codes=[self.CODE]), sd=sd)
        peers = []
        for _ in range(connections):
            peer = MagicMock()
            wire = b''.join(chunks)
            if wire.startswith(b'TEHABLO/1 ') and len(wire) >= 43:
                key = wire[10:42]
                wire = c.hmac.digest(key, b'servidor' + b'n' * 16, 'sha256') + b's' * 16 + wire[43:]
            data = bytearray(wire)
            def recv(size, data=data):
                size = min(size, max_recv)
                result = bytes(data[:size])
                del data[:size]
                return result
            peer.recv.side_effect = recv
            peers.append(peer)
        listener = MagicMock()
        count = 0
        def accept():
            nonlocal count
            if count == len(peers):
                receiver.stop_event.set()
                raise c.socket.timeout()
            peer = peers[count]
            count += 1
            return peer, ('127.0.0.1', 12345)
        listener.accept.side_effect = accept
        with patch.object(c.secrets, 'token_bytes', return_value=b'n' * 16), patch.object(receiver.stop_event, 'wait', side_effect=lambda _: receiver.stop_event.set()), patch.object(c.socket, 'socket') as factory:
            factory.return_value.__enter__.return_value = listener
            receiver.run()
        listener.bind.assert_called_once_with(('127.0.0.1', 18766))
        self.assertFalse(receiver.receiving)
        for peer in peers:
            peer.close.assert_called_once()
            sent = [call.args[0] for call in peer.sendall.call_args_list]
            self.assertNotIn(self.CODE.encode(), b''.join(sent))
            if sd.RawOutputStream.called:
                self.assertEqual(sent, [b'n' * 16, c.hmac.digest(self.CODE.encode(), b'cliente' + b's' * 16, 'sha256')])
        return sd, receiver

    def test_prebuffers_200_ms_and_returns_to_waiting_after_eof(self):
        sd, _ = self.receive([b'TEHABLO/1 ' + self.CODE.encode() + b'\n', c.WAV_HEADER,
                              b'\x01\x00' * (480 * 15)], connections=2)
        stream = sd.RawOutputStream.return_value.__enter__.return_value
        sizes = [len(call.args[0]) for call in stream.write.call_args_list]
        self.assertGreaterEqual(sizes[0], 9600)
        self.assertEqual(sum(sizes), 2 * 15 * 960)
        self.assertEqual(sd.RawOutputStream.call_count, 2)
        self.assertEqual(sd.RawOutputStream.call_args.kwargs['latency'], 'high')

    def test_wrong_missing_code_and_bad_header_never_open_device(self):
        for wire in (b'', b'TEHABLO/1 ' + b'f' * 32 + b'\n' + c.WAV_HEADER,
                     b'TEHABLO/1 ' + self.CODE.encode() + b'\nBAD'):
            with self.subTest(wire=wire):
                sd, _ = self.receive([wire])
                sd.RawOutputStream.assert_not_called()

    def test_disabled_or_unpaired_never_opens_device(self):
        for settings in (dict(c.DEFAULTS), dict(c.DEFAULTS, codes=[self.CODE], enabled=False)):
            sd, _ = self.receive([b'TEHABLO/1 ' + self.CODE.encode() + b'\n' + c.WAV_HEADER], settings)
            sd.RawOutputStream.assert_not_called()

    def test_short_pcm_volume(self):
        sd, _ = self.receive([b'TEHABLO/1 ' + self.CODE.encode() + b'\n', c.WAV_HEADER,
                              bytes([100, 0]) * 2], dict(c.DEFAULTS, codes=[self.CODE], volume=.5), max_recv=1)
        sd.RawOutputStream.return_value.__enter__.return_value.write.assert_called_once_with(bytes([50, 0]) * 2)

    def test_client_challenges_are_fresh_and_wrong_server_gets_no_proof(self):
        nonces = []
        for key in (self.CODE, self.CODE, 'f' * 32):
            peer = Mock()
            sent = []
            peer.sendall.side_effect = sent.append
            data = bytearray()
            def recv(size):
                if not data:
                    data.extend(c.hmac.digest(key.encode(), b'servidor' + sent[0], 'sha256') + b's' * 16 + b'BAD')
                result = bytes(data[:size])
                del data[:size]
                return result
            peer.recv.side_effect = recv
            sd = Mock()
            receiver = c.Receiver(dict(c.DEFAULTS, codes=[self.CODE]), sd=sd)
            # Stop after authentication: a bad WAV must still never open audio.
            with self.assertRaises(OSError):
                receiver.play(peer)
            sd.RawOutputStream.assert_not_called()
            self.assertNotIn(self.CODE.encode(), b''.join(sent))
            self.assertEqual(len(sent), 1 if key != self.CODE else 2)
            nonces.append(sent[0])
        self.assertEqual(len(set(nonces)), 3)

    def test_port_busy_is_clear_warning(self):
        receiver = c.Receiver(dict(c.DEFAULTS), sd=Mock())
        with patch.object(receiver.stop_event, 'wait', side_effect=lambda _: receiver.stop_event.set()), patch.object(c.socket, 'socket') as factory:
            factory.return_value.__enter__.return_value.bind.side_effect = OSError('busy')
            receiver.run()
        self.assertIn('18766', receiver.error)
        self.assertIn('ocupado', receiver.error)

    def test_yes_and_uninstall_cli_are_isolated(self):
        manager = Mock()
        installed = self.home / '.local/share/tehablo-cliente/tehablo_cliente.py'
        installed.parent.mkdir(parents=True)
        installed.write_text('# downloaded client')
        with patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData')), patch.object(c, 'Autostart', return_value=manager), patch.object(c, 'sound_device') as sound, patch.object(c, 'print'):
            with patch.object(sys, 'argv', ['cliente', '--codigo', self.CODE, '--yes', 'vps']):
                c.main()
            self.assertEqual(c.load_settings()['codes'], [self.CODE])
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
