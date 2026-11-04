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



class FakeModel:
    def __init__(self, cloning=True):
        self.has_voice_cloning = cloning
        self.config = type("C", (), {"mimi": type("M", (), {"sample_rate": 24000})()})()
        self.prompts = []

    def get_state_for_audio_prompt(self, audio):
        import torch
        self.prompts.append(audio)
        return {"flow": {"cache": torch.ones(2, 3)}}


class PrepareVoicesTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".repo-harness" / "tmp").mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(prefix="test-prepare-", dir=ROOT / ".repo-harness" / "tmp")
        self.addCleanup(self.scratch.cleanup)
        base = Path(self.scratch.name)
        self.voices, self.table = base / "voices", base / "voice_table.json"
        self.voices.mkdir()
        self.table.write_text(
            '[{"name": "lola", "model": "spanish", "kind": "download", "note": "x"},'
            ' {"name": "Facundo", "model": "spanish", "kind": "account", "note": "Argentina", "source": "ar-hombre-4310"},'
            ' {"name": "Diego", "model": "spanish", "kind": "account", "note": "Chile", "source": "cl-hombre-3397"}]',
            encoding="utf-8",
        )
        # The original downloads are 32-bit float WAVs, which Pocket TTS cannot read directly.
        self.source = self.voices / "ar-hombre-4310.wav"
        scipy.io.wavfile.write(self.source, 48000, np.full(4800, 0.25, dtype=np.float32))
        self.original = self.source.read_bytes()

    def run_prepare(self, model):
        stdout, stderr = io.StringIO(), io.StringIO()
        loads = []
        with (
            patch.object(get_voices, "VOICES_DIR", self.voices),
            patch.object(get_voices, "TABLE", self.table),
            patch.object(get_voices, "load_cloning_model", side_effect=lambda: loads.append(1) or model),
            patch("sys.argv", ["get_voices.py", "--prepare"]),
            redirect_stdout(stdout), redirect_stderr(stderr),
        ):
            try:
                code = get_voices.main()
            except SystemExit as exit_:
                code = exit_.code
        return code, stdout.getvalue(), stderr.getvalue(), len(loads)

    def test_prepare_exports_table_voices_from_float_wavs_once(self):
        import safetensors.torch
        model = FakeModel()
        code, out, err, loads = self.run_prepare(model)
        self.assertEqual((code, loads), (None, 1))
        self.assertEqual(out, "Facundo.safetensors: preparada desde ar-hombre-4310.wav\n")
        self.assertEqual(err, "falta cl-hombre-3397.wav para preparar Diego: descárgala con python scripts/get_voices.py\n")
        self.assertEqual(len(model.prompts), 1)
        self.assertEqual(tuple(model.prompts[0].shape), (1, 2400))  # mono, resampled 48 kHz -> 24 kHz
        self.assertAlmostEqual(float(model.prompts[0].mean()), 0.25, places=2)
        saved = safetensors.torch.load_file(self.voices / "Facundo.safetensors")
        self.assertEqual(list(saved), ["flow/cache"])
        self.assertEqual(self.source.read_bytes(), self.original)
        before = {p.name: p.read_bytes() for p in self.voices.iterdir()}
        code, out, err, loads = self.run_prepare(FakeModel())
        self.assertEqual((code, loads), (None, 0))
        self.assertEqual(out, "ya existe Facundo.safetensors\n")
        self.assertEqual(err, "falta cl-hombre-3397.wav para preparar Diego: descárgala con python scripts/get_voices.py\n")
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.voices.iterdir()})

    def test_prepare_without_token_explains_and_writes_nothing(self):
        code, out, err, loads = self.run_prepare(FakeModel(cloning=False))
        self.assertEqual((code, out, loads), (1, "", 1))
        self.assertEqual(err, "falta cl-hombre-3397.wav para preparar Diego: descárgala con python scripts/get_voices.py\n"
                              "Preparar voces necesita una cuenta gratis de Hugging Face: guarda tu token como HF_TOKEN en .env.\n")
        self.assertEqual(sorted(p.name for p in self.voices.iterdir()), ["ar-hombre-4310.wav"])
        self.assertEqual(self.source.read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main()
