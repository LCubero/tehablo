"""Startup diagnostics without loading a model, downloading, or playing audio."""
import contextlib
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import tehablo_server as server


class StartupTests(unittest.TestCase):
    def test_model_load_timing_preserves_model_and_sample_rate(self):
        model = SimpleNamespace(sample_rate=24000)
        calls = []
        tts = SimpleNamespace(load_tts_model=lambda name: calls.append(name) or model)
        output = io.StringIO()
        with patch.dict(sys.modules, tehablo_tts=tts), \
                patch('tehablo_server.time.perf_counter', side_effect=[10, 12.5], create=True), \
                contextlib.redirect_stdout(output):
            synth = server.PocketSynthesizer('spanish')
        self.assertEqual(output.getvalue(), 'Startup: model spanish loaded in 2.500 s\n')
        self.assertEqual(calls, ['spanish'])
        self.assertIs(synth.model, model)
        self.assertEqual(synth.sample_rate, 24000)
        self.assertEqual(synth.voices, {})

    def test_default_catalog_import_timing_preserves_health(self):
        output = io.StringIO()
        tts = SimpleNamespace(VOICES=['lola'])
        model = SimpleNamespace(sample_rate=24000)
        with patch.dict(sys.modules, tehablo_tts=tts), \
                patch('tehablo_server.time.perf_counter', side_effect=[10, 11.25], create=True), \
                contextlib.redirect_stdout(output):
            instance = server.create_server(port=0, synthesizer_factory=lambda name: model)
            try:
                self.assertEqual(instance.service.health()['voice'], 'lola')
                self.assertIsNone(instance.service.health()['error'])
            finally:
                instance.server_close()
        self.assertEqual(output.getvalue(), 'Startup: TTS imports completed in 1.250 s\n')

    def test_explicit_catalog_skips_tts_import_and_timing(self):
        output = io.StringIO()
        model = SimpleNamespace(sample_rate=24000)
        with patch.dict(sys.modules, tehablo_tts=None), \
                patch('tehablo_server.time.perf_counter') as clock, \
                contextlib.redirect_stdout(output):
            instance = server.create_server(port=0, catalog=['lola'],
                                            synthesizer_factory=lambda name: model)
            try:
                self.assertEqual(instance.service.health()['model'], 'spanish')
            finally:
                instance.server_close()
        clock.assert_not_called()
        self.assertEqual(output.getvalue(), '')

    def test_failed_model_load_preserves_exception_without_success_log(self):
        output = io.StringIO()
        failure = RuntimeError('unavailable')
        from unittest.mock import Mock
        tts = SimpleNamespace(load_tts_model=Mock(side_effect=failure))
        with patch.dict(sys.modules, tehablo_tts=tts), \
                contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                server.PocketSynthesizer('spanish')
        self.assertEqual(output.getvalue(), '')

    def test_help_remains_free_of_startup_diagnostics(self):
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(sys, 'argv', ['tehablo_server.py', '--help']), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            with self.assertRaises(SystemExit) as exit:
                server.main()
        self.assertEqual(exit.exception.code, 0)
        self.assertTrue(output.getvalue().startswith('usage: tehablo_server.py'))
        self.assertNotIn('Startup:', output.getvalue())
        self.assertEqual(errors.getvalue(), '')

    def test_main_reports_server_imports_without_changing_listening_message(self):
        class FakeServer:
            server_port = 12345
            def serve_forever(self):
                pass
            def server_close(self):
                self.closed = True
        instance = FakeServer()
        output = io.StringIO()
        with patch.object(server, 'create_server', return_value=instance), \
                patch.object(sys, 'argv', ['tehablo_server.py']), \
                patch('tehablo_server.time.perf_counter', return_value=server.IMPORT_STARTED + 0.5), \
                contextlib.redirect_stdout(output):
            server.main()
        self.assertEqual(output.getvalue(), 'Startup: server imports completed in 0.500 s\nListening on http://127.0.0.1:12345\n')
        self.assertTrue(instance.closed)


if __name__ == '__main__':
    unittest.main()
