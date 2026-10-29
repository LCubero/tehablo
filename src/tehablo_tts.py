"""Minimal console app for Pocket TTS: type text, hear it.

Run:  .venv-pocket/Scripts/python src/tehablo_tts.py        (Windows)
      .venv-pocket/bin/python src/tehablo_tts.py            (Linux/macOS)
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from ./.env (e.g. HF_TOKEN) without overriding real env vars."""
    env = ROOT / ".env"
    if not env.is_file():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_dotenv()

import argparse
import time
from pathlib import Path

import numpy as np
import scipy.io.wavfile
import sounddevice as sd
from pocket_tts import TTSModel
from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES

from tehablo_lexicon import Lexicon
from tehablo_numbers import normalize_numbers

VOICES = sorted(_ORIGINS_OF_PREDEFINED_VOICES)
OUT_DIR = ROOT / "pocket-out"

HELP = """Comandos:
  (texto)                 genera y reproduce
  /leer <archivo.txt>     lee desde el directorio actual (ej.: samples/prueba-larga.txt)
  /multi                  pega texto en varias lineas; termina con una linea vacia
  /voz <nombre|archivo>   cambia de voz (nombre del catalogo, .wav para clonar o .safetensors)
  /voces                  lista las voces del catalogo
  /modelo <idioma>        recarga el modelo (spanish, spanish_24l, english, ...)
  /guardar [nombre]       guarda el ultimo audio en pocket-out/
  /ayuda                  muestra esta ayuda
  /salir                  termina
Ctrl+C durante la reproduccion la corta."""


class App:
    def __init__(self, language: str, voice: str):
        self.voice_cache: dict[str, object] = {}
        self.lexicon = Lexicon(ROOT / "pronunciaciones.json")
        self.last_audio: np.ndarray | None = None
        self.load_model(language)
        self.set_voice(voice)

    def load_model(self, language: str) -> None:
        print(f"Cargando modelo '{language}'...")
        start = time.perf_counter()
        self.model = TTSModel.load_model(language=language)
        self.language = language
        self.voice_cache.clear()
        print(f"Modelo listo en {time.perf_counter() - start:.1f} s")

    def set_voice(self, voice: str) -> None:
        if voice not in self.voice_cache:
            print(f"Preparando voz '{voice}'...")
            self.voice_cache[voice] = self.model.get_state_for_audio_prompt(voice, truncate=True)
        self.voice = voice

    def speak(self, text: str) -> None:
        if self.language.startswith("spanish"):
            text = normalize_numbers(self.lexicon.apply(text))
            if self.lexicon.error:
                print(f"Aviso: {self.lexicon.error}")
        sr = self.model.sample_rate
        chunks: list[np.ndarray] = []
        start = time.perf_counter()
        with sd.OutputStream(samplerate=sr, channels=1, dtype="float32") as out:
            try:
                for chunk in self.model.generate_audio_stream(self.voice_cache[self.voice], text):
                    data = chunk.detach().cpu().numpy().astype(np.float32).reshape(-1, 1)
                    chunks.append(data)
                    out.write(data)
            except KeyboardInterrupt:
                print("\n(cortado)")
        if chunks:
            self.last_audio = np.concatenate(chunks)
            dur = len(self.last_audio) / sr
            print(f"[{self.voice}] {dur:.1f} s de audio, {time.perf_counter() - start:.1f} s en total")

    def save(self, name: str | None) -> None:
        if self.last_audio is None:
            print("Todavia no hay audio para guardar.")
            return
        OUT_DIR.mkdir(exist_ok=True)
        path = OUT_DIR / (name or f"{self.voice}-{time.strftime('%Y%m%d-%H%M%S')}")
        path = path.with_suffix(".wav")
        scipy.io.wavfile.write(path, self.model.sample_rate, self.last_audio)
        print(f"Guardado: {path}")

    def handle(self, line: str) -> bool:
        cmd, _, arg = line.partition(" ")
        arg = arg.strip()
        if cmd == "/salir":
            return False
        if cmd == "/ayuda":
            print(HELP)
        elif cmd == "/leer":
            path = Path(arg.strip('"'))
            if not arg or not path.is_file():
                print(f"No existe el archivo: {arg}")
            else:
                text = " ".join(path.read_text(encoding="utf-8").split())
                print(f"Leyendo {len(text)} caracteres de {path.name}...")
                self.speak(text)
        elif cmd == "/multi":
            print("Pega el texto. Termina con una linea vacia.")
            lines: list[str] = []
            while True:
                try:
                    part = input()
                except EOFError:
                    break
                if not part.strip():
                    break
                lines.append(part.strip())
            if lines:
                self.speak(" ".join(lines))
        elif cmd == "/voces":
            print(", ".join(VOICES))
        elif cmd == "/voz":
            if not arg:
                print(f"Voz actual: {self.voice}")
            elif arg in VOICES or Path(arg).is_file():
                self.set_voice(arg)
            else:
                print(f"No existe la voz o el archivo: {arg}")
        elif cmd == "/modelo":
            if arg:
                self.load_model(arg)
                self.set_voice(self.voice)
            else:
                print(f"Modelo actual: {self.language}")
        elif cmd == "/guardar":
            self.save(arg or None)
        elif cmd.startswith("/"):
            print("Comando desconocido. Escribe /ayuda.")
        else:
            self.speak(line)
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Escribe texto y escuchalo con Pocket TTS.")
    parser.add_argument("--language", default="spanish")
    parser.add_argument("--voice", default="lola")
    args = parser.parse_args()

    app = App(args.language, args.voice)
    print(HELP)
    while True:
        try:
            line = input(f"\n[{app.language} | {app.voice}] > ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if line:
            try:
                if not app.handle(line):
                    break
            except Exception as exc:  # keep the loop alive on bad input
                print(f"Error: {exc}")
    print("Hasta luego.")


if __name__ == "__main__":
    main()
