"""Checks speed change that keeps pitch; no model, no audio output, no pytest needed.

From the repo root: .venv-pocket/Scripts/python tests/test_speed.py
Linux/macOS: .venv-pocket/bin/python tests/test_speed.py
Exit code 0 means every case passed.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from tehablo_speed import SPEEDS, SpeedStream

SR = 24000
TONE = np.sin(2 * np.pi * 440 * np.arange(2 * SR) / SR).astype(np.float32)  # 2 s at 440 Hz

failures = 0
checks = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global failures, checks
    checks += 1
    if not ok:
        failures += 1
        print(f"FAIL {label} {detail}")


def stretch(speed: float, chunk: int = 1920) -> np.ndarray:
    """Feed TONE in small chunks like the model stream does, then flush."""
    stream = SpeedStream(speed)
    parts = [stream.process(TONE[i:i + chunk]) for i in range(0, len(TONE), chunk)]
    parts.append(stream.flush())
    return np.concatenate(parts)


def main_frequency(audio: np.ndarray) -> float:
    spectrum = np.abs(np.fft.rfft(audio))
    return float(np.fft.rfftfreq(len(audio), 1 / SR)[spectrum.argmax()])


def main() -> int:
    check("1.0 is in SPEEDS", 1.0 in SPEEDS)
    check("SPEEDS sorted", list(SPEEDS) == sorted(SPEEDS))

    same = stretch(1.0)
    check("speed 1 leaves audio untouched", np.array_equal(same, TONE))

    for speed in (0.75, 1.25, 1.5):
        out = stretch(speed)
        expected = len(TONE) / speed
        check(f"speed {speed} length", abs(len(out) - expected) / expected < 0.03,
              f"got {len(out)} expected ~{expected:.0f}")
        check(f"speed {speed} dtype float32", out.dtype == np.float32, str(out.dtype))
        check(f"speed {speed} 1-D", out.ndim == 1, str(out.shape))
        freq = main_frequency(out)
        check(f"speed {speed} keeps pitch", abs(freq - 440) < 5, f"got {freq:.1f} Hz")

    stream = SpeedStream(1.25)
    check("empty chunk returns empty", len(stream.process(np.zeros(0, np.float32))) == 0)

    try:
        SpeedStream(0)
        check("speed 0 rejected", False)
    except ValueError as exc:
        check("speed 0 rejected", str(exc) == "speed must be > 0", str(exc))

    print(f"{checks - failures}/{checks} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
