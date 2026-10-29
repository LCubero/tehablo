"""Regression checks for measurement CLI paths that never load TTS models."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "measure_tts.py"
USAGE = (
    "usage: measure_tts.py [-h] --model {spanish,spanish_24l} --text TEXT --output\n"
    "                      OUTPUT [--runs {1,2,3,4,5,6,7,8,9,10}]\n"
)


class MeasureTtsCliTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".repo-harness" / "tmp").mkdir(parents=True, exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(
            prefix="test-measure-tts-", dir=ROOT / ".repo-harness" / "tmp"
        )
        self.addCleanup(self.scratch.cleanup)
        self.directory = Path(self.scratch.name)
        self.text = self.directory / "input.txt"
        self.text.write_text("Hola mundo.", encoding="utf-8")
        self.output = self.directory / "result.json"

    def invoke(self, *arguments):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, arguments)],
            cwd=ROOT,
            env={**os.environ, "COLUMNS": "80", "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True,
            text=True,
            timeout=15,
        )

    def test_help_documents_cli_and_offline_operation(self):
        result = self.invoke("--help")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertTrue(result.stdout.startswith(USAGE))
        for term in ("--model", "--text", "--output", "--runs", "offline"):
            with self.subTest(term=term):
                self.assertIn(term, result.stdout.lower())
        self.assertFalse(self.output.exists())

    def assert_rejected(self, model="spanish", runs="3", empty=False, error=""):
        if empty:
            self.text.write_text(" \n\t", encoding="utf-8")
        for existing_output in (False, True):
            with self.subTest(existing_output=existing_output):
                sentinel = b"existing measurement must survive\n"
                if existing_output:
                    self.output.write_bytes(sentinel)
                result = self.invoke(
                    "--model", model, "--text", self.text,
                    "--output", self.output, "--runs", runs,
                )
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                if existing_output:
                    self.assertEqual(self.output.read_bytes(), sentinel)
                else:
                    self.assertFalse(self.output.exists())
                # argparse's choice quoting differs between Python versions.
                variants = (error, error.replace("'spanish'", "spanish").replace(
                    "'spanish_24l'", "spanish_24l"
                ).replace("choice: 0", "choice: '0'").replace(
                    "choice: 11", "choice: '11'"
                ))
                self.assertIn(result.stderr, tuple(
                    USAGE + "measure_tts.py: error: " + message + "\n"
                    for message in variants
                ))

    def test_invalid_model_is_rejected(self):
        self.assert_rejected(
            model="invalid",
            error="argument --model: invalid choice: 'invalid' (choose from 'spanish', 'spanish_24l')",
        )

    def test_runs_below_minimum_is_rejected(self):
        self.assert_rejected(
            runs="0",
            error="argument --runs: invalid choice: 0 (choose from 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)",
        )

    def test_runs_above_maximum_is_rejected(self):
        self.assert_rejected(
            runs="11",
            error="argument --runs: invalid choice: 11 (choose from 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)",
        )

    def test_empty_input_is_rejected(self):
        self.assert_rejected(empty=True, error="text must not be empty")


if __name__ == "__main__":
    unittest.main()
