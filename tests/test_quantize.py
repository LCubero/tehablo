"""Quantization default: on for Linux, off elsewhere; TEHABLO_QUANTIZE=0/1 overrides."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from tehablo_tts import quantize_default


class QuantizeDefaultTest(unittest.TestCase):
    def test_platform_default(self):
        self.assertTrue(quantize_default(env={}, platform='linux'))
        self.assertFalse(quantize_default(env={}, platform='win32'))
        self.assertFalse(quantize_default(env={}, platform='darwin'))

    def test_env_override(self):
        self.assertFalse(quantize_default(env={'TEHABLO_QUANTIZE': '0'}, platform='linux'))
        self.assertTrue(quantize_default(env={'TEHABLO_QUANTIZE': '1'}, platform='win32'))

    def test_invalid_env_falls_back_to_platform(self):
        self.assertTrue(quantize_default(env={'TEHABLO_QUANTIZE': 'si'}, platform='linux'))
        self.assertFalse(quantize_default(env={'TEHABLO_QUANTIZE': ''}, platform='win32'))


if __name__ == '__main__':
    result = unittest.main(exit=False, verbosity=0).result
    total = result.testsRun
    failed = len(result.failures) + len(result.errors)
    print(f'{total - failed}/{total} passed')
    sys.exit(1 if failed else 0)
