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


class VoiceChannelTest(unittest.TestCase):
    def test_background_argv(self):
        tail = ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
                '-o', 'ServerAliveInterval=30', '-R', '18766:127.0.0.1:18766']
        # The destination goes last, so options typed after it are never lost.
        for command, prefix, destination in [
            ('ssh -i "key file" -p 2222 -L 8080:x:80 -R999:x:9 -D 1080 -W h:22 -ftNT pepe@h command',
             ['ssh', '-i', 'key file', '-p', '2222'], 'pepe@h'),
            ('ssh pepe@192.168.7.88', ['ssh'], 'pepe@192.168.7.88'),
            ('saved', ['ssh'], 'saved'),
            (r'"C:\Windows\ssh.exe" -i "C:\a b\key" h',
             [r'C:\Windows\ssh.exe', '-i', r'C:\a b\key'], 'h'),
            ('ssh -J jump -F config -o Port=22 h uptime', ['ssh', '-J', 'jump', '-F', 'config', '-o', 'Port=22'], 'h'),
            ('ssh server -p 2222', ['ssh', '-p', '2222'], 'server'),
            ('ssh -i k server -p 2222 -L 1:x:1 uptime -p 9', ['ssh', '-i', 'k', '-p', '2222'], 'server'),
            ('ssh -p 2222 -- server uptime', ['ssh', '-p', '2222'], 'server')]:
            self.assertEqual(c.voice_argv(command), prefix + tail + [destination])
        for command in ('ssh', 'ssh -p 2222', 'ssh -- ', 'ssh bad;host'):
            with self.assertRaises(ValueError):
                c.voice_argv(command)

    def test_lifecycle_and_reasons(self):
        process = Mock()
        process.poll.return_value = None
        process.stderr = io.BytesIO(b'Permission denied (publickey,password)\n')
        factory = Mock(return_value=process)
        voice = c.VoiceChannel(factory)
        voice.start('ssh pepe@h')
        self.assertTrue(voice.running)
        self.assertEqual(voice.host, 'h')
        self.assertEqual(factory.call_args.kwargs['stdin'], c.subprocess.DEVNULL)
        self.assertEqual(factory.call_args.kwargs['stdout'], c.subprocess.DEVNULL)
        self.assertEqual(factory.call_args.kwargs['stderr'], c.subprocess.PIPE)
        if os.name == 'nt':
            self.assertEqual(factory.call_args.kwargs['creationflags'], c.subprocess.CREATE_NO_WINDOW)
        else:
            self.assertNotIn('creationflags', factory.call_args.kwargs)
        process.poll.return_value = 255
        self.assertIn('contraseña', voice.reason())
        self.assertEqual(voice.reason(), '')
        for error, expected in [(b'remote port forwarding failed', 'ya está abierto'),
                                (b'administratively prohibited', 'ya está abierto'),
                                (b'first\nlast\n', 'last')]:
            process.poll.return_value = None
            process.stderr = io.BytesIO(error)
            voice.start('h')
            process.poll.return_value = 1
            self.assertIn(expected, voice.reason())
        process.poll.return_value = None
        process.stderr = io.BytesIO()
        voice.start('h')
        process.wait.side_effect = [c.subprocess.TimeoutExpired('ssh', 1), None]
        voice.stop()
        process.terminate.assert_called_once()
        process.kill.assert_called_once()
        self.assertFalse(voice.running)


class SshPickerTest(unittest.TestCase):
    def test_targets(self):
        for command, host in [('ssh pepe@192.168.7.88', '192.168.7.88'),
                              ('ssh -p 2222 pepe@host', 'host'),
                              ('ssh -l pepe host', 'host'), ('pepe@host', 'host'),
                              ('mi-servidor', 'mi-servidor'),
                              ('ssh -i "key file" -J jump -o Port=22 host', 'host')]:
            self.assertEqual(c.ssh_target(command), host)
        for command in ('', 'ssh', 'ssh -p 2222', 'ssh -l', 'ssh -V'):
            with self.assertRaisesRegex(ValueError, 'conexión SSH'):
                c.ssh_target(command)

    def test_open_sessions(self):
        cases = [(r'ssh -i "C:\a b\key" -p 2222 root@127.0.0.1', ('127.0.0.1', False)),
                 ('ssh -R 18766:127.0.0.1:18766 pepe@h', ('h', True)),
                 ("ssh git@github.com git-upload-pack 'x'", None),
                 ('ssh -F cfg alias', None),
                 (r'C:\Windows\System32\OpenSSH\ssh.exe pepe@h', ('h', False)),
                 ('/usr/bin/ssh mi-servidor', ('mi-servidor', False)),
                 ('python script.py', None),
                 ('ssh -L 18766:localhost:18766 h', ('h', False)),
                 ('ssh -R 9999:localhost:18766 h', ('h', False)),
                 ('ssh -o RemoteForward=18766:127.0.0.1:18766 h', ('h', True))]
        for command, expected in cases:
            self.assertEqual(c.ssh_process(command), expected, command)
        runner = Mock(return_value=Mock(returncode=0, stdout='ssh h\nssh h\npython x'))
        self.assertEqual(c.open_ssh_sessions(runner, 'Linux'), [('h', False)])
        self.assertEqual(runner.call_args.kwargs['timeout'], 3)
        for failure in (FileNotFoundError(), TimeoutError()):
            self.assertEqual(c.open_ssh_sessions(Mock(side_effect=failure), 'Windows'), [])
        self.assertEqual(c.open_ssh_sessions(Mock(return_value=Mock(returncode=1)), 'Darwin'), [])


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)

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
        sd.query_devices.return_value = [dict(name='Mic', max_output_channels=0, hostapi=0), dict(name='Speaker', max_output_channels=2, hostapi=1), dict(name='Duplicate', max_output_channels=2, hostapi=0)]
        sd.query_devices.side_effect = lambda *args, **kwargs: (sd.query_devices.return_value[1] if args or kwargs else sd.query_devices.return_value)
        sd.query_hostapis.return_value = dict(name='Default', devices=[0, 1])
        # API membership (not a substring/name heuristic) controls the menu.
        sd.query_devices.return_value[0]['hostapi'] = 1
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

    def test_uninstall_stops_an_open_receiver(self):
        with patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData/Roaming')):
            receiver = c.Receiver(dict(c.DEFAULTS, codes=[self.CODE]), retired=c.retired_path())
            listener = MagicMock()
            def accept():
                if not c.retired_path().exists():
                    c.uninstall(output=lambda *a: None)
                    raise c.socket.timeout()
                self.fail('the receiver must stop before accepting after uninstall')
            listener.accept.side_effect = accept
            with patch.object(c.socket, 'socket') as factory:
                factory.return_value.__enter__.return_value = listener
                receiver.run()
            self.assertTrue(receiver.stop_event.is_set())
            self.assertFalse(c.load_settings()['enabled'])

    def test_uninstall_removes_legacy_login_entries(self):
        cases = [('Windows', 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/tehablo-cliente.vbs', None),
                 ('Linux', '.config/systemd/user/tehablo-cliente.service',
                  ['systemctl', '--user', 'disable', '--now', 'tehablo-cliente.service']),
                 ('Darwin', 'Library/LaunchAgents/com.tehablo.cliente.plist', 'launchctl')]
        for system, relative, command in cases:
            with self.subTest(system=system):
                path = self.home / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('legacy')
                calls = []
                with patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData/Roaming')):
                    c.uninstall(output=lambda *a: None, system=system, run=lambda cmd, **kw: calls.append(cmd))
                self.assertFalse(path.exists())
                if command is None:
                    self.assertEqual(calls, [])
                elif command == 'launchctl':
                    self.assertEqual(calls, [['launchctl', 'unload', str(path)]])
                else:
                    self.assertEqual(calls, [command])
        calls = []
        with patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData/Roaming')):
            c.uninstall(output=lambda *a: None, system='Linux', run=lambda cmd, **kw: calls.append(cmd))
        self.assertEqual(calls, [])

    def test_pair_and_uninstall_cli_are_isolated(self):
        installed = self.home / '.local/share/tehablo-cliente/tehablo_cliente.py'
        installed.parent.mkdir(parents=True)
        installed.write_text('# downloaded client')
        with patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData')), patch.object(c, 'sound_device') as sound, patch.object(c, 'print'):
            with patch.object(sys, 'argv', ['cliente', '--codigo', self.CODE]), patch.object(c, 'menu'), patch.object(c.threading, 'Thread'):
                c.main()
            self.assertEqual(c.load_settings()['codes'], [self.CODE])
            self.assertTrue(c.load_settings()['enabled'])
            self.assertEqual(sorted(str(p.relative_to(self.home)).replace('\\', '/') for p in self.home.rglob('*') if p.is_file()),
                             sorted(['.local/share/tehablo-cliente/tehablo_cliente.py',
                                     '.tehablo/cliente.json']))
            with patch.object(sys, 'argv', ['cliente', '--uninstall']):
                c.main()
            self.assertFalse(installed.exists())
            self.assertFalse(c.load_settings()['enabled'])
            self.assertEqual(c.load_settings()['codes'], [self.CODE])
            self.assertTrue((self.home / '.tehablo/cliente-retirado').exists())
            sound.assert_not_called()
        self.assertFalse((self.home / '.ssh/config').exists())

    def test_open_receiver_status_and_menu_exit_stop_reception(self):
        receiver = c.Receiver(dict(c.DEFAULTS, codes=[self.CODE]))
        receiver.receiving = True
        self.assertIn('Recibiendo voz', c.status_text(receiver.settings, receiver))
        receiver.receiving = False
        self.assertIn('Listo para recibir', c.status_text(receiver.settings, receiver))
        with patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData/Roaming')), patch.object(sys, 'argv', ['cliente']), patch.object(c, 'Receiver', return_value=receiver), patch.object(c.threading, 'Thread') as thread, patch.object(c, 'menu') as menu, patch.object(c, 'VoiceChannel') as channel:
            c.save_settings(receiver.settings)
            c.main()
        self.assertTrue(receiver.stop_event.is_set())
        menu.assert_called_once_with(receiver.settings, receiver, channel.return_value)
        channel.return_value.stop.assert_called_once()
        thread.return_value.start.assert_called_once()
        thread.return_value.join.assert_called_once_with(7)

    def test_removed_flags_are_rejected(self):
        for args in (['--yes'], ['--config-only'], ['vps'], ['--fondo']):
            with patch.object(sys, 'argv', ['cliente', *args]), patch.object(sys, 'stderr', io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    c.main()
            self.assertEqual(error.exception.code, 2)


@unittest.skipUnless(importlib.util.find_spec('textual'), 'run with: uv run --no-project --with "textual>=8,<9" python -m unittest tests.test_cliente')
class MenuTest(unittest.IsolatedAsyncioTestCase):
    CODE = ClientTest.CODE

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        for patcher in (patch.dict(os.environ, HOME=str(self.home), APPDATA=str(self.home / 'AppData/Roaming')),
                        patch.object(c, 'open_ssh_sessions', return_value=[]),
                        patch.object(c, 'output_devices', return_value=['Altavoces', 'Audífonos'])):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.settings = c.load_settings()
        self.receiver = c.Receiver(dict(self.settings))
        self.process = Mock()
        self.process.poll.return_value = None
        self.process.stderr = io.BytesIO()
        self.factory = Mock(return_value=self.process)
        patcher = patch.object(c.subprocess, 'Popen', self.factory)
        patcher.start()
        self.addCleanup(patcher.stop)

    def text(self, app, selector):
        return str(app.query_one(selector).render())

    async def test_menu_is_clickable_and_saves_every_option(self):
        app = c.menu_app(self.settings, self.receiver)
        async with app.run_test(size=(100, 45)) as pilot:
            self.assertIn('Sin vincular', self.text(app, '#alerta'))
            self.assertIn('/tts codigo', self.text(app, '#alerta'))
            self.assertIn('Listo para recibir', self.text(app, '#estado'))
            await pilot.click('#recepcion')
            await pilot.pause()
            self.assertFalse(c.load_settings()['enabled'])
            self.assertIn('Recepción apagada', self.text(app, '#estado'))
            await pilot.click('#volumen', offset=(1, 0))
            await pilot.press('right', 'left', 'left')
            await pilot.pause()
            self.assertEqual(c.load_settings()['volume'], 0.8)
            self.assertIn('80%', self.text(app, '#volumen'))
            await pilot.click('#salida')
            await pilot.press('down', 'down', 'enter')
            await pilot.pause()
            self.assertEqual(c.load_settings()['device'], 'Audífonos')
            await pilot.click('#vincular')
            await pilot.press('m', 'a', 'l', 'o', 'enter')
            await pilot.pause()
            self.assertIn('/tts codigo', self.text(app, '#aviso'))
            self.assertEqual(c.load_settings()['codes'], [])
            await pilot.click('#vincular')
            await pilot.press(*self.CODE, 'enter')
            await pilot.pause()
            self.assertEqual(c.load_settings()['codes'], [self.CODE])
            self.assertNotIn('Sin vincular', self.text(app, '#alerta'))
            self.assertFalse(app.query('#inicio'))
            await pilot.click('#salir')
        self.assertFalse(app.is_running)

    async def test_open_session_channel_and_stop(self):
        command = 'ssh -i "key file" -p 2222 pepe@servidor'
        app = c.menu_app(self.settings, self.receiver)
        with patch.object(c.shutil, 'which', return_value='ssh'), patch.object(
                c, 'open_ssh_sessions', return_value=[('servidor', False, command),
                                                      ('activo', True, 'ssh -R18766:x:9 activo')]) as listing:
          async with app.run_test(size=(100, 30)) as pilot:
            listing.assert_not_called()
            await pilot.click('#ssh')
            await pilot.pause()
            from textual.widgets import OptionList
            prompts = str(app.screen.query_one(OptionList).get_option_at_index(0).prompt)
            self.assertIn('abierta ahora', prompts)
            app.save_screenshot('ssh-picker.svg', path=str(ROOT / '.repo-harness/tmp/menu-shot'))
            await pilot.press('down', 'enter')
            self.factory.assert_not_called()
            await pilot.click('#ssh')
            await pilot.press('enter')
            await pilot.pause()
            self.assertIn('● Voz conectada a servidor', self.text(app, '#ssh'))
            self.assertEqual(self.factory.call_args.args[0], c.voice_argv(command))
            app.save_screenshot('ssh-connected.svg', path=str(ROOT / '.repo-harness/tmp/menu-shot'))
            await pilot.click('#ssh')
            await pilot.press('enter')
            await pilot.pause()
            self.process.terminate.assert_called_once()
            self.assertNotIn('conectada', self.text(app, '#ssh'))
            self.assertFalse((self.home / '.ssh/config').exists())

    async def test_picker_never_reads_config(self):
        config = self.home / '.ssh/config'
        config.parent.mkdir()
        config.write_bytes(b'Host secret-saved-host\n')
        original = Path.read_text
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(path, config, 'picker must not read SSH config')
            return original(path, *args, **kwargs)
        app = c.menu_app(self.settings, self.receiver)
        with patch.object(c.shutil, 'which', return_value='ssh'), patch.object(Path, 'read_text', guarded):
          async with app.run_test(size=(100, 30)) as pilot:
            await pilot.click('#ssh')
            await pilot.pause()
            from textual.widgets import OptionList
            options = app.screen.query_one(OptionList)
            self.assertEqual(options.option_count, 2)
            self.assertNotIn('secret-saved-host', str(options.get_option_at_index(0).prompt))

    async def test_manual_text_exact(self):
        expected = ('Hazlo tú en tu programa SSH. Sirve si entras con contraseña o usas\n'
                    'PuTTY, Termius, MobaXterm…\n\n'
                    'Necesitas un reenvío remoto:\n'
                    'puerto 18766 del servidor → 127.0.0.1:18766 de esta computadora\n\n'
                    '  ssh        ssh -R 18766:127.0.0.1:18766 pepe@192.168.7.88\n'
                    '  ssh fijo   en ~/.ssh/config, bajo tu Host:\n'
                    '             RemoteForward 18766 127.0.0.1:18766\n'
                    '  PuTTY      Connection › SSH › Tunnels › Source port 18766,\n'
                    '             Destination 127.0.0.1:18766, Remote, Add; guarda la sesión\n'
                    '  Otros      un reenvío remoto con esos mismos datos\n\n'
                    'Después conéctate de nuevo y deja este cliente abierto: es el que suena.')
        app = c.menu_app(self.settings, self.receiver)
        async with app.run_test(size=(100, 40)) as pilot:
            app.other_program()
            await pilot.pause()
            self.assertEqual(self.text(app.screen, '#pregunta'), expected)

    async def test_open_session_and_uninstall_confirmation(self):
        app = c.menu_app(self.settings, self.receiver)
        with patch.object(c.shutil, 'which', return_value='ssh'), patch.object(
                c, 'open_ssh_sessions', return_value=[('vps', False, 'ssh vps')]):
          async with app.run_test(size=(100, 30)) as pilot:
            await pilot.click('#ssh')
            await pilot.press('enter')
            await pilot.pause()
            self.assertIn('conectada a vps', self.text(app, '#ssh'))
            await pilot.click('#desinstalar')
            await pilot.press('down', 'enter')
            self.assertTrue(app.is_running)
            await pilot.click('#desinstalar')
            await pilot.press('enter')
            await pilot.pause()
        self.process.terminate.assert_called_once()
        self.assertTrue(self.receiver.stop_event.is_set())
        self.assertFalse(c.load_settings()['enabled'])

    async def test_channel_exit_reason_once_and_menu_exit(self):
        voice = c.VoiceChannel(self.factory)
        voice.start('h')
        app = c.menu_app(self.settings, self.receiver, voice)
        async with app.run_test(size=(100, 30)) as pilot:
            self.process.stderr = io.BytesIO(b'Permission denied (publickey,password)')
            self.process.poll.return_value = 255
            app.refresh_status()
            self.assertIn('contraseña', self.text(app, '#aviso'))
            self.assertIn('contraseña', self.text(app, '#ssh'))
            app.notice('otro aviso')
            app.refresh_status()
            self.assertEqual(self.text(app, '#aviso'), 'otro aviso')
            self.process.poll.return_value = None
            self.process.stderr = io.BytesIO()
            voice.start('h')
            await pilot.press('escape')
        self.process.terminate.assert_called_once()

    async def test_salir_stops_channel(self):
        voice = c.VoiceChannel(self.factory)
        voice.start('h')
        app = c.menu_app(self.settings, self.receiver, voice)
        async with app.run_test(size=(100, 30)) as pilot:
            await pilot.click('#salir')
        self.process.terminate.assert_called_once()

    async def test_marker_stops_channel(self):
        voice = c.VoiceChannel(self.factory)
        voice.start('h')
        self.receiver.retired = c.retired_path()
        app = c.menu_app(self.settings, self.receiver, voice)
        async with app.run_test(size=(100, 30)) as pilot:
            self.receiver.retired.parent.mkdir(parents=True, exist_ok=True)
            self.receiver.retired.touch()
            app.refresh_status()
            await pilot.pause()
        self.process.terminate.assert_called_once()

    async def test_compact_layout_volume_limits_and_keyboard(self):
        app = c.menu_app(self.settings, self.receiver)
        async with app.run_test(size=(80, 24)) as pilot:
            from textual.widgets import Button, Select, Switch
            self.assertFalse(app.query(Button))
            self.assertFalse(app.query(Select))
            self.assertFalse(app.query(Switch))
            self.assertLess(app.query_one('#pistas').region.bottom, 25)
            await pilot.click('#volumen', offset=(1, 0))
            await pilot.press('right')
            self.assertEqual(c.load_settings()['volume'], 1)
            await pilot.click('#volumen', offset=(22, 0))
            self.assertEqual(c.load_settings()['volume'], 0)
            await pilot.press('left')
            self.assertEqual(c.load_settings()['volume'], 0)
            await pilot.click('#volumen', offset=(41, 0))
            self.assertEqual(c.load_settings()['volume'], 1)
            await pilot.press('up', 'up', 'enter')
            self.assertFalse(c.load_settings()['enabled'])
            self.assertFalse(app.query('#inicio'))
            await pilot.press('escape')
        self.assertFalse(app.is_running)

    async def test_other_connection_and_other_program(self):
        config = self.home / '.ssh/config'
        app = c.menu_app(self.settings, self.receiver)
        with patch.object(c.shutil, 'which', return_value='ssh'):
          async with app.run_test(size=(100, 30)) as pilot:
            await pilot.click('#ssh')
            await pilot.press('enter')
            await pilot.press(*'ssh bad/host', 'enter')
            await pilot.pause()
            self.assertIn('conexión SSH', self.text(app, '#aviso'))
            self.assertNotIn('alias', self.text(app, '#aviso'))
            self.assertFalse(config.exists())
            await pilot.click('#ssh')
            await pilot.press('enter')
            await pilot.press(*'ssh pepe@192.168.7.88', 'enter')
            await pilot.pause()
            self.assertIn('conectada a 192.168.7.88', self.text(app, '#ssh'))
            self.assertFalse(config.exists())
            await pilot.click('#ssh')
            await pilot.press('enter')
            await pilot.click('#ssh')
            await pilot.press('down', 'enter')
            await pilot.pause()
            text = self.text(app.screen, '#pregunta')
            for word in ('18766', '127.0.0.1:18766', 'PuTTY', 'Connection › SSH › Tunnels'):
                self.assertIn(word, text)
            await pilot.press('escape')
            self.assertFalse(config.exists())
            with patch.object(c.shutil, 'which', return_value=None):
                await pilot.click('#ssh')
                await pilot.pause()
                self.assertIn('PuTTY', self.text(app.screen, '#pregunta'))
                self.assertFalse(config.exists())


class MenuTextTest(unittest.TestCase):
    def test_pairing_guidance_names_tts_codigo(self):
        with self.assertRaises(ValueError) as error:
            c.normalize_code('malo')
        self.assertIn('/tts codigo', str(error.exception))
        self.assertNotIn('/tts status', (ROOT / 'cliente/tehablo_cliente.py').read_text(encoding='utf-8'))

    def test_exit_message_says_if_voice_keeps_arriving(self):
        self.assertEqual(c.exit_message(dict(c.DEFAULTS)),
                         'Recepción detenida: abre el cliente cuando quieras oír la voz.')
        self.assertEqual(c.exit_message(dict(c.DEFAULTS, enabled=False)),
                         'Recepción apagada: enciéndela en el menú para oír la voz.')

    def test_menu_without_terminal_changes_nothing(self):
        log = []
        with patch.object(c.sys.stdin, 'isatty', return_value=False), patch.object(c.os, 'name', 'nt'), patch.object(c, 'menu_app') as app, patch.object(c, 'print', side_effect=log.append):
            c.menu(dict(c.DEFAULTS), Mock())
        app.assert_not_called()
        self.assertIn('terminal', ' '.join(log))


if __name__ == '__main__':
    unittest.main()
