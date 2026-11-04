"""Download Spanish reference voices for Pocket TTS cloning.

Source: Google crowdsourced Latin American Spanish TTS corpora (OpenSLR 61/71/72),
mirrored on Hugging Face by ylacombe. License: CC BY-SA 4.0 (attribution required).
Only a few short clips per speaker are fetched through the HF datasets-server API;
they are concatenated into one ~15 s PCM16 reference WAV per speaker under voices/.
Existing files are skipped and left untouched (no automatic conversion).

With --prepare (no download), every voice in src/voice_table.json that has a "source"
is exported once to voices/<name>.safetensors: the voice state already encoded by the
spanish model. It loads instantly and works without a token; preparing it needs the
Hugging Face token (HF_TOKEN in .env) once. Source WAVs may be PCM16 or 32-bit float.

Usage: python scripts/get_voices.py [--speakers 3] [--seconds 15]
       python scripts/get_voices.py --prepare
"""

import argparse
import io
import json
import sys
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
TABLE = Path(__file__).resolve().parent.parent / "src" / "voice_table.json"
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


def load_cloning_model():
    sys.path.insert(0, str(TABLE.parent))
    import tehablo_tts  # noqa: F401  loads HF_TOKEN from .env
    from pocket_tts import TTSModel
    # Released (not quantized) weights, like the predefined voices.
    return TTSModel.load_model(language="spanish", quantize=False)


def prepare_voices() -> None:
    pending = []
    for voice in json.loads(TABLE.read_text(encoding="utf-8")):
        if not voice.get("source"):
            continue
        target, source = VOICES_DIR / f"{voice['name']}.safetensors", VOICES_DIR / f"{voice['source']}.wav"
        if target.exists():
            print(f"ya existe {target.name}")
        elif not source.exists():
            print(f"falta {source.name} para preparar {voice['name']}: descárgala con python scripts/get_voices.py",
                  file=sys.stderr)
        else:
            pending.append((target, source))
    if not pending:
        return
    model = load_cloning_model()
    if not model.has_voice_cloning:
        print("Preparar voces necesita una cuenta gratis de Hugging Face: guarda tu token como HF_TOKEN en .env.",
              file=sys.stderr)
        raise SystemExit(1)
    import torch
    from pocket_tts.data.audio_utils import convert_audio
    from pocket_tts.models.model_state import export_model_state
    for target, source in pending:
        rate, data = scipy.io.wavfile.read(source)
        if data.dtype == np.int16:
            data = data.astype(np.float32) / 32768.0
        if data.ndim > 1:
            data = data.mean(axis=1)
        audio = torch.from_numpy(data[: rate * 30].astype(np.float32)).unsqueeze(0)  # like truncate=True
        audio = convert_audio(audio, rate, model.config.mimi.sample_rate, 1)
        export_model_state(model.get_state_for_audio_prompt(audio), target)
        print(f"{target.name}: preparada desde {source.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--speakers", type=int, default=3, help="speakers per accent and gender")
    parser.add_argument("--seconds", type=float, default=15.0, help="reference length per speaker")
    parser.add_argument("--prepare", action="store_true",
                        help="only export the table voices to voices/<name>.safetensors (needs HF_TOKEN once)")
    args = parser.parse_args()
    if args.prepare:
        prepare_voices()
        return

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
                audio = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
                scipy.io.wavfile.write(path, rate, audio)
                print(f"{path.name}: {len(audio) / rate:.1f} s")
                credits.append(f"{path.name}: speaker {speaker}, {dataset} ({origin})")

    if credits:
        with open(VOICES_DIR / "ATTRIBUTION.txt", "a", encoding="utf-8") as fh:
            fh.write("Google crowdsourced Latin American Spanish TTS corpora, CC BY-SA 4.0\n")
            fh.write("\n".join(credits) + "\n")


if __name__ == "__main__":
    main()
