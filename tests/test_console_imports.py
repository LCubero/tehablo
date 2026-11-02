"""Console imports and public methods without models, devices or file writes."""
import builtins
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.imports = []
        self.writer = Mock()
        self.stream = Mock()
        self.stream.__enter__ = Mock(return_value=self.stream)
        self.stream.__exit__ = Mock(return_value=False)
        original_import = builtins.__import__
        wavfile = SimpleNamespace(write=self.writer)
        scipy = SimpleNamespace(io=SimpleNamespace(wavfile=wavfile))
        modules = {
            'scipy': scipy, 'scipy.io': scipy.io, 'scipy.io.wavfile': wavfile,
            'sounddevice': SimpleNamespace(OutputStream=Mock(return_value=self.stream)),
            'pocket_tts': SimpleNamespace(TTSModel=Mock()),
            'pocket_tts.utils.utils': SimpleNamespace(_ORIGINS_OF_PREDEFINED_VOICES={'lola': None}),
        }

        def tracked(name, *args, **kwargs):
            self.imports.append(name)
            return original_import(name, *args, **kwargs)

        self.enterContext(patch.dict(sys.modules, modules))
        self.enterContext(patch('builtins.__import__', side_effect=tracked))
        is_file = Path.is_file
        # Never inspect the local secrets file, even indirectly through module startup.
        with patch.object(Path, 'is_file', lambda p: False if p.name == '.env' else is_file(p)):
            spec = importlib.util.spec_from_file_location('tehablo_tts', ROOT / 'src/tehablo_tts.py')
            self.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.module)
        self.startup_imports = self.imports[:]
        self.imports.clear()
        self.app = self.module.App.__new__(self.module.App)
        self.app.language = 'english'
        self.app.voice = 'lola'
        self.app.voice_cache = {'lola': object()}
        self.app.last_audio = None
        self.app.model = Mock(sample_rate=24000)
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_import_does_not_request_console_dependencies(self):
        self.assertNotIn('sounddevice', self.startup_imports)
        self.assertNotIn('scipy.io.wavfile', self.startup_imports)

    def test_save_without_audio_does_not_import_or_write(self):
        self.app.save(None)
        self.assertEqual(self.output.getvalue(), 'Todavia no hay audio para guardar.\n')
        self.assertNotIn('scipy.io.wavfile', self.imports)
        self.writer.assert_not_called()

    def test_save_preserves_samples_rate_name_and_message(self):
        self.app.last_audio = np.array([[.25], [-.25]], dtype=np.float32)
        with patch.object(Path, 'mkdir') as mkdir:
            self.app.save('sample.txt')
        path = self.module.OUT_DIR / 'sample.wav'
        mkdir.assert_called_once_with(exist_ok=True)
        self.writer.assert_called_once_with(path, 24000, self.app.last_audio)
        self.assertEqual(self.output.getvalue(), f'Guardado: {path}\n')
        self.assertIn('scipy.io.wavfile', self.imports)

    def test_playback_preserves_stream_and_saved_samples(self):
        chunk = Mock()
        chunk.detach.return_value.cpu.return_value.numpy.return_value = np.array([.25, -.25])
        self.app.model.generate_audio_stream.return_value = iter([chunk, chunk])
        self.app.speak('hello')
        sys.modules['sounddevice'].OutputStream.assert_called_once_with(
            samplerate=24000, channels=1, dtype='float32')
        self.app.model.generate_audio_stream.assert_called_once_with(self.app.voice_cache['lola'], 'hello')
        self.assertEqual(self.stream.write.call_count, 2)
        np.testing.assert_array_equal(self.app.last_audio, [[.25], [-.25], [.25], [-.25]])
        self.assertEqual(self.app.last_audio.dtype, np.float32)
        self.assertTrue(self.output.getvalue().startswith('[lola] 0.0 s de audio, '))
        self.assertIn('sounddevice', self.imports)

    def test_empty_stream_keeps_previous_audio(self):
        previous = np.array([[.5]], dtype=np.float32)
        self.app.last_audio = previous
        self.app.model.generate_audio_stream.return_value = iter(())
        self.app.speak('hello')
        self.assertIs(self.app.last_audio, previous)
        self.stream.write.assert_not_called()
        self.assertEqual(self.output.getvalue(), '')

    def test_interruption_keeps_played_chunks(self):
        chunk = Mock()
        chunk.detach.return_value.cpu.return_value.numpy.return_value = np.array([.5])
        def interrupted():
            yield chunk
            raise KeyboardInterrupt
        self.app.model.generate_audio_stream.return_value = interrupted()
        self.app.speak('hello')
        np.testing.assert_array_equal(self.app.last_audio, [[.5]])
        self.assertIn('(cortado)', self.output.getvalue())


if __name__ == '__main__':
    unittest.main()
