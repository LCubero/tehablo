"""Installer preparation, without network, models or audio."""
import contextlib
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import prepare_pocket


class InstallVoicesTests(unittest.TestCase):
    def test_both_installers_prepare_before_ready(self):
        for name in ('install.sh', 'install.ps1'):
            text = (ROOT / name).read_text(encoding='utf-8')
            self.assertIn('scripts/prepare_pocket.py', text.replace('\\', '/'))
            self.assertLess(text.index('prepare_pocket.py'), text.index('Listo:'))

    def test_final_notes_are_last_and_grouped(self):
        for name in ('install.sh', 'install.ps1'):
            text = (ROOT / name).read_text(encoding='utf-8')
            before, block = text.split('Listo. Lee esto:', 1)
            self.assertIn('prepare_pocket.py --installer', before)
            self.assertIn('Aviso:', before)  # captured warnings are collected, not discarded
            for note in ('Listo:', 'Para iniciar:', 'pi install', 'Audio por SSH (en tu PC)',
                         'Phonon 40M', 'pide el token', 'Pocket spanish, Lola y Rafael'):
                self.assertIn(note, block)
            self.assertNotIn('tambien', text)
            self.assertNotIn('prepare_pocket.py', block)
            self.assertNotIn('uv pip', block)
            self.assertIn('notes', block.lower())
            self.assertTrue(block.rstrip().endswith("'  pide el token solo para descargarla y no lo guarda.'"))
            self.assertIn('1. Avisos de instalación:', block)
            self.assertIn('Con Audio: SSH no hace falta PortAudio', before)
            self.assertIn('falta PortAudio', before)

    def test_installer_mode_collects_failures_without_stderr(self):
        with patch.object(prepare_pocket, 'assets', return_value=[('lola', 'a'), ('rafael', 'b')]), \
                patch.object(prepare_pocket, 'fetch', side_effect=[RuntimeError('private'), 'cached']), \
                contextlib.redirect_stdout(io.StringIO()) as out, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            prepare_pocket.main(installer=True)
        self.assertEqual(errors.getvalue(), '')
        self.assertEqual(out.getvalue(), 'Aviso: no se pudo descargar lola; vuelve a ejecutar el instalador.\nPreparado: rafael\n')

    def test_installer_mode_reports_config_failure(self):
        with patch.object(prepare_pocket, 'assets', side_effect=RuntimeError('private')), \
                contextlib.redirect_stdout(io.StringIO()) as out, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            prepare_pocket.main(installer=True)
        self.assertEqual(errors.getvalue(), '')
        self.assertEqual(out.getvalue(), 'Aviso: no se pudo preparar Pocket spanish; vuelve a ejecutar el instalador.\n')

    def test_assets_follow_installed_pocket_config_and_catalog(self):
        from pocket_tts.utils.config import CONFIGS_DIR
        from pocket_tts.utils.utils import get_predefined_voice
        import yaml
        config = yaml.safe_load((CONFIGS_DIR / 'spanish.yaml').read_text(encoding='utf-8'))
        assets = dict(prepare_pocket.assets())
        # Same order as Pocket's loader: the cloning bundle first, the public one only as fallback.
        self.assertEqual(assets['Pocket spanish'], (config['weights_path'], config['weights_path_without_voice_cloning']))
        self.assertEqual(assets['tokenizer spanish'], config['flow_lm']['lookup_table']['tokenizer_path'])
        for name in ('lola', 'rafael'):
            self.assertEqual(assets[name], get_predefined_voice('spanish', name))

    def test_download_uses_public_hub_and_pinned_revision(self):
        hub = SimpleNamespace(try_to_load_from_cache=Mock(return_value=None),
                              hf_hub_download=Mock(return_value='cached'))
        with patch.dict(sys.modules, huggingface_hub=hub):
            self.assertEqual(prepare_pocket.fetch('hf://kyutai/repo/voice.safetensors@abc'), 'cached')
        hub.hf_hub_download.assert_called_once_with('kyutai/repo', 'voice.safetensors', revision='abc', token=False)

    def test_model_falls_back_like_pocket_and_downloads_one_bundle(self):
        fetch = Mock(side_effect=[RuntimeError('gated'), 'public'])
        with patch.object(prepare_pocket, 'assets', return_value=[('Pocket spanish', ('clon', 'publico'))]), \
                patch.object(prepare_pocket, 'fetch', fetch), contextlib.redirect_stdout(io.StringIO()) as out, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            prepare_pocket.main()
        self.assertEqual([call.args[0] for call in fetch.call_args_list], ['clon', 'publico'])
        self.assertEqual((out.getvalue(), errors.getvalue()), ('Preparado: Pocket spanish\n', ''))
        fetch = Mock(return_value='clon')
        with patch.object(prepare_pocket, 'assets', return_value=[('Pocket spanish', ('clon', 'publico'))]), \
                patch.object(prepare_pocket, 'fetch', fetch), contextlib.redirect_stdout(io.StringIO()):
            prepare_pocket.main()
        self.assertEqual([call.args[0] for call in fetch.call_args_list], ['clon'])

    def test_cache_hit_does_not_download(self):
        hub = SimpleNamespace(try_to_load_from_cache=Mock(return_value='cached'), hf_hub_download=Mock())
        with patch.dict(sys.modules, huggingface_hub=hub):
            self.assertEqual(prepare_pocket.fetch('hf://kyutai/repo/voice@abc'), 'cached')
        hub.hf_hub_download.assert_not_called()

    def test_failure_is_one_line_and_other_assets_continue(self):
        errors = io.StringIO()
        with patch.object(prepare_pocket, 'assets', return_value=[('lola', 'a'), ('rafael', 'b')]), \
                patch.object(prepare_pocket, 'fetch', side_effect=[RuntimeError('secret\ntrace'), 'cached']) as fetch, \
                contextlib.redirect_stderr(errors), contextlib.redirect_stdout(io.StringIO()):
            prepare_pocket.main()
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(errors.getvalue(), 'Aviso: no se pudo descargar lola; vuelve a ejecutar el instalador.\n')


if __name__ == '__main__':
    unittest.main()
