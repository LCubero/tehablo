"""Textual TUI for Pocket TTS: paste text, pick a voice, press play.

Voices: Pocket TTS catalog plus any .wav/.mp3/.flac/.safetensors in voices/
(audio files are cloned). Run scripts/get_voices.py to download Spanish samples.

Run:  .venv-pocket/Scripts/python src/tehablo_tui.py     (Windows)
      .venv-pocket/bin/python src/tehablo_tui.py         (Linux/macOS)
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

import threading
import time
from pathlib import Path

import numpy as np
import scipy.io.wavfile
import sounddevice as sd
from pocket_tts import TTSModel
from rich.markup import escape
from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES
from textual import work
from textual.app import App, ComposeResult
from textual.containers import Horizontal
from textual.widgets import Button, Footer, Header, RichLog, Select, TextArea

from tehablo_lexicon import Lexicon
from tehablo_numbers import normalize_numbers
from tehablo_speed import SPEEDS, SpeedStream

VOICES_DIR = ROOT / "voices"
OUT_DIR = ROOT / "pocket-out"
AUDIO_EXT = {".wav", ".mp3", ".flac", ".safetensors"}
MODELS = ["spanish", "spanish_24l", "english", "french", "german", "italian", "portuguese"]
DEFAULT_TEXT = "Hola, ¿cómo estás? Esta es una prueba de voz local con Pocket TTS."


def list_voices() -> list[tuple[str, str]]:
    local = []
    if VOICES_DIR.is_dir():
        local = [
            (f"[archivo] {p.stem}", str(p))
            for p in sorted(VOICES_DIR.iterdir())
            if p.suffix.lower() in AUDIO_EXT
        ]
    catalog = [(f"[catalogo] {name}", name) for name in sorted(_ORIGINS_OF_PREDEFINED_VOICES)]
    return local + catalog


class TehabloApp(App):
    TITLE = "tehablo - Pocket TTS"
    CSS = """
    #controls { height: auto; }
    #voice { width: 2fr; }
    #model { width: 1fr; }
    #speed { width: 18; }
    Button { margin: 0 1; }
    #text { height: 1fr; }
    #log { height: 10; border: round $accent; }
    """
    BINDINGS = [
        ("f5", "play", "Reproducir"),
        ("f6", "stop", "Detener"),
        ("f7", "save", "Guardar"),
        ("f8", "reload_voices", "Recargar voces"),
        ("ctrl+q", "quit", "Salir"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.model: TTSModel | None = None
        self.model_name = ""
        self.voice_states: dict[str, object] = {}
        self.lexicon = Lexicon(ROOT / "pronunciaciones.json")
        self.last_audio: np.ndarray | None = None
        self.stop_event = threading.Event()
        self.busy = threading.Lock()
        self.loading = False
        self.speaking = False

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="controls"):
            yield Select(list_voices(), value="lola", allow_blank=False, id="voice", prompt="Voz")
            yield Select([(m, m) for m in MODELS], value="spanish", allow_blank=False, id="model")
            yield Select(
                [(f"Velocidad {s:g}x", s) for s in SPEEDS], value=1.0, allow_blank=False, id="speed"
            )
            yield Button("Reproducir (F5)", id="play", variant="success")
            yield Button("Detener (F6)", id="stop", variant="error")
            yield Button("Guardar (F7)", id="save")
        yield TextArea(DEFAULT_TEXT, id="text")
        yield RichLog(id="log", wrap=True, markup=True)
        yield Footer()

    def on_mount(self) -> None:
        self.log_msg("Pega o escribe texto arriba y pulsa Reproducir. Voces propias: carpeta voices/.")
        self.load_model("spanish")

    def log_msg(self, msg: str) -> None:
        if threading.current_thread() is threading.main_thread():
            self.query_one("#log", RichLog).write(msg)
        else:
            self.call_from_thread(self.query_one("#log", RichLog).write, msg)

    @work(thread=True, exclusive=True, group="model")
    def load_model(self, name: str) -> None:
        self.loading = True
        with self.busy:
            self.log_msg(f"Cargando modelo '{name}'...")
            start = time.perf_counter()
            try:
                self.model = TTSModel.load_model(language=name)
            except Exception as exc:
                self.log_msg(f"[red]Error cargando modelo: {exc}[/red]")
                return
            finally:
                self.loading = False
            self.model_name = name
            self.voice_states.clear()
            self.log_msg(f"Modelo '{name}' listo en {time.perf_counter() - start:.1f} s")

    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id == "model" and event.value != self.model_name and self.model_name:
            self.load_model(str(event.value))

    def on_button_pressed(self, event: Button.Pressed) -> None:
        actions = {"play": self.action_play, "stop": self.action_stop, "save": self.action_save}
        actions[event.button.id]()

    def action_play(self) -> None:
        text = " ".join(self.query_one("#text", TextArea).text.split())
        if not text:
            self.log_msg("No hay texto.")
            return
        if self.speaking:
            self.log_msg("Ya se esta reproduciendo: espera o pulsa Detener.")
            return
        if self.loading:
            self.log_msg("Cargando el modelo; se reproducira en cuanto termine.")
        self.speaking = True
        speed = float(self.query_one("#speed", Select).value)
        self.speak(text, str(self.query_one("#voice", Select).value), speed)

    def action_stop(self) -> None:
        self.stop_event.set()

    def action_reload_voices(self) -> None:
        select = self.query_one("#voice", Select)
        current = select.value
        voices = list_voices()
        select.set_options(voices)
        if any(v == current for _, v in voices):
            select.value = current
        self.log_msg(f"{len(voices)} voces disponibles.")

    def action_save(self) -> None:
        if self.last_audio is None or self.model is None:
            self.log_msg("Todavia no hay audio para guardar.")
            return
        OUT_DIR.mkdir(exist_ok=True)
        voice = Path(str(self.query_one("#voice", Select).value)).stem
        path = OUT_DIR / f"{voice}-{time.strftime('%Y%m%d-%H%M%S')}.wav"
        scipy.io.wavfile.write(path, self.model.sample_rate, self.last_audio)
        self.log_msg(f"Guardado: {path}")

    @work(thread=True, exclusive=True, group="speak")
    def speak(self, text: str, voice: str, speed: float = 1.0) -> None:
        try:
            self._speak(text, voice, speed)
        finally:
            self.speaking = False

    def _speak(self, text: str, voice: str, speed: float) -> None:
        with self.busy:
            if self.model is None:
                self.log_msg("El modelo aun no esta cargado.")
                return
            self.stop_event.clear()
            try:
                if voice not in self.voice_states:
                    self.log_msg(f"Preparando voz '{Path(voice).stem}'...")
                    self.voice_states[voice] = self.model.get_state_for_audio_prompt(voice, truncate=True)
                if self.model_name.startswith("spanish"):
                    text = normalize_numbers(self.lexicon.apply(text))
                    if self.lexicon.error:
                        self.log_msg(f"[yellow]{escape(self.lexicon.error)}[/yellow]")
                sr = self.model.sample_rate
                chunks: list[np.ndarray] = []
                stretch = SpeedStream(speed)
                start = time.perf_counter()
                self.log_msg(f"Generando {len(text)} caracteres a velocidad {speed:g}x...")
                with sd.OutputStream(samplerate=sr, channels=1, dtype="float32") as out:
                    for chunk in self.model.generate_audio_stream(
                        self.voice_states[voice], text, stop=self.stop_event
                    ):
                        if self.stop_event.is_set():
                            break
                        audio = chunk.detach().cpu().numpy().astype(np.float32).reshape(-1)
                        data = stretch.process(audio).reshape(-1, 1)
                        if data.size:
                            chunks.append(data)
                            out.write(data)
                    if not self.stop_event.is_set():
                        tail = stretch.flush().reshape(-1, 1)
                        if tail.size:
                            chunks.append(tail)
                            out.write(tail)
            except Exception as exc:
                self.log_msg(f"[red]Error: {exc}[/red]")
                return
            if chunks:
                self.last_audio = np.concatenate(chunks)
                state = "detenido" if self.stop_event.is_set() else "listo"
                self.log_msg(
                    f"{state}: {len(self.last_audio) / sr:.1f} s de audio en {time.perf_counter() - start:.1f} s"
                )


if __name__ == "__main__":
    TehabloApp().run()
