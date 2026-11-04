"""Downloader regression tests: synthetic WAVs, no network or original voices."""

from contextlib import redirect_stderr, redirect_stdout
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

import numpy as np
import scipy.io.wavfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts import get_voices  # noqa: E402


class GetVoicesTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".repo-harness" / "tmp").mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(
            prefix="test-get-voices-", dir=ROOT / ".repo-harness" / "tmp"
        )
        self.addCleanup(self.scratch.cleanup)
        self.voices = Path(self.scratch.name) / "voices"
        self.rate = 48000
        # Stereo exercises the existing mono normalization too.
        samples = np.array([-2, -1, -0.5, 0, 0.5, 1, 2], dtype=np.float32)
        self.samples = np.tile(samples[:, None], (1, 2))
        payload = io.BytesIO()
        scipy.io.wavfile.write(payload, self.rate, self.samples)
        self.payload = payload.getvalue()

    def invoke(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        rows = [{"speaker_id": "4310", "audio": [{"src": "https://invalid.test/clip"}]}]
        with (
            patch.object(get_voices, "VOICES_DIR", self.voices),
            patch.object(get_voices, "SOURCES", {"ar": ("dataset", "origin")}),
            patch.object(get_voices, "GENDERS", {"male": "hombre"}),
            patch.object(get_voices, "fetch_rows", return_value=rows) as fetch,
            patch.object(get_voices.urllib.request, "urlopen", return_value=io.BytesIO(self.payload)) as network,
            patch("sys.argv", ["get_voices.py", "--speakers", "1", "--seconds", "0.0001"]),
            redirect_stdout(stdout), redirect_stderr(stderr),
        ):
            result = get_voices.main()
        self.assertIsNone(result)  # Normal CLI completion, exit 0.
        self.assertEqual(stderr.getvalue(), "")
        fetch.assert_called_once_with("dataset", "male")
        return stdout.getvalue(), network

    def test_new_wav_is_clipped_mono_pcm16_with_original_timing_and_credits(self):
        stdout, network = self.invoke()
        self.assertEqual(stdout, "ar-hombre-4310.wav: 0.4 s\n")
        network.assert_called_once_with("https://invalid.test/clip", timeout=60)
        with wave.open(str(self.voices / "ar-hombre-4310.wav"), "rb") as wav:
            self.assertEqual(wav.getsampwidth(), 2)
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getframerate(), self.rate)
            self.assertEqual(wav.getcomptype(), "NONE")
            self.assertEqual(wav.getnframes(), 7 + int(self.rate * 0.4))
            self.assertAlmostEqual(wav.getnframes() / wav.getframerate(), 0.4 + 7 / self.rate)
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        np.testing.assert_array_equal(samples[:7], [-32767, -32767, -16383, 0, 16383, 32767, 32767])
        np.testing.assert_array_equal(samples[7:], np.zeros(int(self.rate * 0.4), dtype=np.int16))
        self.assertEqual(
            (self.voices / "ATTRIBUTION.txt").read_text(encoding="utf-8"),
            "Google crowdsourced Latin American Spanish TTS corpora, CC BY-SA 4.0\n"
            "ar-hombre-4310.wav: speaker 4310, dataset (origin)\n",
        )
        # A second run preserves the new WAV and does not append duplicate credit.
        before = {path.name: path.read_bytes() for path in self.voices.iterdir()}
        stdout, network = self.invoke()
        self.assertEqual(stdout, "ya existe ar-hombre-4310.wav\n")
        network.assert_not_called()
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.voices.iterdir()})

    def test_existing_float_wav_and_attribution_are_untouched(self):
        self.voices.mkdir()
        path = self.voices / "ar-hombre-4310.wav"
        path.write_bytes(self.payload)
        credits = self.voices / "ATTRIBUTION.txt"
        credits.write_bytes(b"original attribution\n")
        stdout, network = self.invoke()
        self.assertEqual(stdout, "ya existe ar-hombre-4310.wav\n")
        network.assert_not_called()
        self.assertEqual(path.read_bytes(), self.payload)
        self.assertEqual(credits.read_bytes(), b"original attribution\n")
        self.assertEqual(sorted(p.name for p in self.voices.iterdir()), ["ATTRIBUTION.txt", path.name])


if __name__ == "__main__":
    unittest.main()
