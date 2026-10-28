"""Download Spanish reference voices for Pocket TTS cloning.

Source: Google crowdsourced Latin American Spanish TTS corpora (OpenSLR 61/71/72),
mirrored on Hugging Face by ylacombe. License: CC BY-SA 4.0 (attribution required).
Only a few short clips per speaker are fetched through the HF datasets-server API;
they are concatenated into one ~15 s reference WAV per speaker under voices/.

Usage: python scripts/get_voices.py [--speakers 3] [--seconds 15]
"""

import argparse
import io
import json
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
import scipy.io.wavfile

API = "https://datasets-server.huggingface.co/rows"
SOURCES = {
    "ar": ("ylacombe/google-argentinian-spanish", "https://www.openslr.org/61/"),
    "cl": ("ylacombe/google-chilean-spanish", "https://www.openslr.org/71/"),
    "co": ("ylacombe/google-colombian-spanish", "https://www.openslr.org/72/"),
}
GENDERS = {"female": "mujer", "male": "hombre"}
VOICES_DIR = Path(__file__).resolve().parent.parent / "voices"
ROWS_TO_SCAN = 400


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.load(resp)


def fetch_rows(dataset: str, config: str) -> list[dict]:
    rows = []
    for offset in range(0, ROWS_TO_SCAN, 100):
        query = urllib.parse.urlencode(
            {"dataset": dataset, "config": config, "split": "train", "offset": offset, "length": 100}
        )
        rows += [r["row"] for r in get_json(f"{API}?{query}")["rows"]]
    return rows


def download_wav(url: str) -> tuple[int, np.ndarray]:
    with urllib.request.urlopen(url, timeout=60) as resp:
        rate, data = scipy.io.wavfile.read(io.BytesIO(resp.read()))
    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768.0
    if data.ndim > 1:
        data = data.mean(axis=1)
    return rate, data.astype(np.float32)


def build_voice(clips: list[dict], seconds: float) -> tuple[int, np.ndarray]:
    parts, rate, total = [], None, 0.0
    for clip in clips:
        clip_rate, data = download_wav(clip["audio"][0]["src"])
        if rate is None:
            rate = clip_rate
        if clip_rate != rate:
            continue
        parts += [data, np.zeros(int(rate * 0.4), dtype=np.float32)]
        total += len(data) / rate
        if total >= seconds:
            break
    return rate, np.concatenate(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--speakers", type=int, default=3, help="speakers per accent and gender")
    parser.add_argument("--seconds", type=float, default=15.0, help="reference length per speaker")
    args = parser.parse_args()

    VOICES_DIR.mkdir(exist_ok=True)
    credits = []
    for accent, (dataset, origin) in SOURCES.items():
        for config, label in GENDERS.items():
            by_speaker = defaultdict(list)
            for row in fetch_rows(dataset, config):
                by_speaker[row["speaker_id"]].append(row)
            top = sorted(by_speaker.items(), key=lambda kv: -len(kv[1]))[: args.speakers]
            for speaker, clips in top:
                path = VOICES_DIR / f"{accent}-{label}-{speaker}.wav"
                if path.exists():
                    print(f"ya existe {path.name}")
                    continue
                rate, audio = build_voice(clips, args.seconds)
                scipy.io.wavfile.write(path, rate, audio)
                print(f"{path.name}: {len(audio) / rate:.1f} s")
                credits.append(f"{path.name}: speaker {speaker}, {dataset} ({origin})")

    if credits:
        with open(VOICES_DIR / "ATTRIBUTION.txt", "a", encoding="utf-8") as fh:
            fh.write("Google crowdsourced Latin American Spanish TTS corpora, CC BY-SA 4.0\n")
            fh.write("\n".join(credits) + "\n")


if __name__ == "__main__":
    main()
