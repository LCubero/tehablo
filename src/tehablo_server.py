"""Loopback HTTP speech service with interruptible, buffered playback."""
import time

IMPORT_STARTED = time.perf_counter()

import argparse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import socket
import sys
import threading

import numpy as np

from tehablo_lexicon import Lexicon
from tehablo_numbers import normalize_numbers
from tehablo_tech import normalize_technical
from tehablo_speed import SpeedStream

ROOT = Path(__file__).resolve().parent.parent
VOICES_DIR = ROOT / 'voices'
AUDIO_EXT = {'.wav', '.mp3', '.flac', '.safetensors'}
MODELS = {'phonon', 'spanish', 'spanish_24l'}
# Fixed output gain under every volume level: Pocket and Phonon voices come out at about -24 dBFS
# (peak -6 dBFS); 1.8x was chosen by listening with lola (2026-11-04).
BASE_GAIN = 1.8
LIMIT = 0.8


def soft_limit(x):
    """Leave samples up to LIMIT unchanged and round louder peaks smoothly below full scale."""
    x = np.asarray(x, dtype=np.float32)
    over = np.abs(x) > LIMIT
    if over.any():
        x = x.copy()
        x[over] = np.sign(x[over]) * (LIMIT + (1 - LIMIT) * np.tanh((np.abs(x[over]) - LIMIT) / (1 - LIMIT)))
    return x
PHONON_VOICES = {'Regina', 'Iker', 'Noa', 'Lucía-Sol', 'Candela', 'Celia', 'Alba',
                 'Alicia', 'Marcos', 'Borja', 'Nuno', 'Izan', 'Guillermo', 'Rebeca',
                 'Danae', 'Azucena'}


# Voices offered in the Pi settings window, shared with the extension (shown while the server is off).
# kind: 'download' needs no account; 'account' needs a Hugging Face token once.
# A voice with 'source' is included in the repository as voices/<name>.safetensors (prepared from voices/<source>.wav).
_TABLE = json.loads((ROOT / 'src' / 'voice_table.json').read_text(encoding='utf-8'))
VOICE_TABLE = [(v['name'], v['model'], v['kind'], v['note']) for v in _TABLE]
INCLUDED = {v['name'] for v in _TABLE if v.get('source')}
# Per-voice loudness correction ('gain_db'), measured against lola with one sentence (2026-11-04).
VOICE_GAIN = {v['name']: 10 ** (v['gain_db'] / 20) for v in _TABLE if v.get('gain_db')}


def voice_gain(voice):
    name = Path(voice).stem if str(voice).endswith('.safetensors') else voice
    return VOICE_GAIN.get(name, 1.0)
# The start voice is the one marked "default": the best free voice that works without an account.
START_MODEL, START_VOICE = next((v['model'], v['name']) for v in _TABLE if v.get('default'))


def cached(name, model, kind):
    """Whether a voice can be used offline, checking the local cache only (no network)."""
    from huggingface_hub import constants, try_to_load_from_cache
    if model == 'phonon':
        return isinstance(try_to_load_from_cache('gradium/phonon-40m-es', 'model.q8.gguf'), str)
    if name in INCLUDED:
        # A prepared voice (.safetensors) also works on the weights without voice cloning (no token).
        hub = Path(constants.HF_HUB_CACHE)
        weights = [p for repo in ('pocket-tts', 'pocket-tts-without-voice-cloning')
                   for p in (hub / f'models--kyutai--{repo}' / 'snapshots').glob('*/languages/spanish/model.safetensors')]
        return (VOICES_DIR / f'{name}.safetensors').is_file() and bool(weights)
    from pocket_tts.utils.utils import get_predefined_voice
    repo, _, rest = get_predefined_voice(model, name).removeprefix('hf://').partition('/')
    repo = f'{repo}/{rest.split("/", 1)[0]}'
    path, _, revision = rest.split('/', 1)[1].partition('@')
    return isinstance(try_to_load_from_cache(repo, path, revision=revision or None), str)


def default_voice(model):
    if model == START_MODEL:
        return START_VOICE
    return 'Regina' if model == 'phonon' else 'lola'


class PhononSynthesizer:
    def __init__(self):
        import ptts
        started = time.perf_counter()
        ptts.set_num_threads(2)
        # The repository is gated: without a token Hugging Face refuses even a cached model,
        # so a cached model loads offline, from the cache only.
        offline = (not os.environ.get('HF_TOKEN') and 'HF_HUB_OFFLINE' not in os.environ
                   and cached('', 'phonon', 'account'))
        if offline:
            os.environ['HF_HUB_OFFLINE'] = '1'
        try:
            self.model = ptts.TTS('hf://gradium/phonon-40m-es', lang='es', quant='q8')
        finally:
            if offline:
                del os.environ['HF_HUB_OFFLINE']
        print(f'Startup: model phonon loaded in {time.perf_counter() - started:.3f} s', flush=True)
        self.sample_rate = 24000

    def stream(self, text, voice, stop):
        if stop.is_set():
            return
        with self.model.stream(text, voice=voice) as audio:
            if audio.sample_rate != self.sample_rate:
                raise ValueError('unexpected Phonon sample rate')
            for chunk in audio:
                if stop.is_set():
                    return
                yield np.asarray(chunk, dtype=np.float32).reshape(-1)


def synthesizer(name):
    return PhononSynthesizer() if name == 'phonon' else PocketSynthesizer(name)


class PocketSynthesizer:
    def __init__(self, name):
        from tehablo_tts import load_tts_model
        started = time.perf_counter()
        self.model = load_tts_model(name)
        print(f'Startup: model {name} loaded in {time.perf_counter() - started:.3f} s', flush=True)
        self.sample_rate = self.model.sample_rate
        self.voices = {}

    def stream(self, text, voice, stop):
        if voice not in self.voices:
            self.voices[voice] = self.model.get_state_for_audio_prompt(voice, truncate=True)
        if stop.is_set():
            return
        for chunk in self.model.generate_audio_stream(self.voices[voice], text, stop=stop):
            if stop.is_set():
                return
            yield chunk.detach().cpu().numpy().astype(np.float32).reshape(-1)


def audio_sink(rate, callback):
    import sounddevice as sd
    # PortAudio caches the device list; refresh it so a new default output is used.
    sd._terminate()
    sd._initialize()
    stream = sd.OutputStream(samplerate=rate, channels=1, dtype='float32', callback=callback)
    stream.start()
    return stream


class SpeechService:
    def __init__(self, model, voice, speed, synthesizer_factory, audio_factory, catalog):
        self.condition = threading.Condition(threading.RLock())
        self.factory = synthesizer_factory
        self.cached = cached
        self.audio_factory = audio_factory
        self.catalog = list(catalog)
        self.model_name, self.voice, self.speed = model, voice if voice is not None else default_voice(model), speed
        self.volume = 1.0
        self.validate({'model': model, 'voice': self.voice, 'speed': speed})
        self.lexicon = Lexicon(ROOT / 'pronunciaciones.json')
        self.ready = False
        self.error = None
        self.fallback = None  # The Phonon voice that failed to load and was replaced by lola.
        self.speech_error = None
        self.lexicon_error = None
        self.state = 'loading'
        self.id = None
        self.pending = None
        self.queue = deque()
        self.promoted = deque(maxlen=10)
        self.cancel = threading.Event()
        self.closed = False
        self.revision = 0
        self.buffer = deque()
        self.offset = 0
        self.done = False
        self.paused = False
        self.worker = threading.Thread(target=self.run, name='speech-worker', daemon=True)
        self.worker.start()

    def normalize_text(self, text, model, lexicon=True):
        """Prepare Spanish speech in technical → lexicon → numbers order."""
        if model in MODELS:
            text = normalize_technical(text)
            if lexicon:
                text = self.lexicon.apply(text)
            if self.lexicon.error != self.lexicon_error:
                self.lexicon_error = self.lexicon.error
                if self.lexicon_error:
                    print(f'Pronunciation dictionary error: {self.lexicon_error}', file=sys.stderr)
            return normalize_numbers(text)
        return text

    def voice_table(self):
        table = []
        for name, model, kind, note in VOICE_TABLE:
            try:
                downloaded = bool(self.cached(name, model, kind))
            except Exception:
                downloaded = False
            voice = f'{name}.safetensors' if name in INCLUDED else name
            table.append({'name': name, 'voice': voice, 'model': model, 'kind': kind, 'note': note,
                          'downloaded': downloaded})
        return table

    def voices(self):
        if self.model_name == 'phonon':
            return sorted(PHONON_VOICES)
        local = sorted(p for p in VOICES_DIR.iterdir()
                       if p.is_file() and p.suffix.lower() in AUDIO_EXT) if VOICES_DIR.is_dir() else []
        return [str(p) for p in local] + sorted(self.catalog)

    def resolve_voice(self, value, model=None):
        if (model or self.model_name) == 'phonon':
            if not isinstance(value, str) or value not in PHONON_VOICES:
                raise ValueError('voice must be a Phonon Spanish voice name')
            return value
        if not isinstance(value, str):
            raise ValueError('voice must be a catalog name or a file in voices/')
        if value in self.catalog:
            return value
        path = Path(value)
        if not path.is_absolute():
            path = ROOT / path if path.parts and path.parts[0] == 'voices' else VOICES_DIR / path
        path = path.resolve()
        if path.parent != VOICES_DIR.resolve() or not path.is_file() or path.suffix.lower() not in AUDIO_EXT:
            raise ValueError('voice must be a catalog name or a file in voices/')
        return str(path)

    def validate(self, body):
        if set(body) - {'model', 'voice', 'speed', 'volume'}:
            raise ValueError('unknown config field')
        if 'model' in body and (not isinstance(body['model'], str) or body['model'] not in MODELS):
            raise ValueError('model must be phonon, spanish or spanish_24l')
        if 'voice' in body:
            self.resolve_voice(body['voice'], body.get('model', self.model_name))
        if 'speed' in body:
            value = body['speed']
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not .75 <= value <= 1.5:
                raise ValueError('speed must be between 0.75 and 1.5')

        if 'volume' in body:
            value = body['volume']
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not .1 <= value <= 1.5:
                raise ValueError('volume must be between 0.1 and 1.5')

    def health(self):
        with self.condition:
            return {'ok': True, 'ready': self.ready, 'model': self.model_name,
                    'voice': self.voice, 'speed': float(self.speed), 'volume': self.volume,
                    'error': self.error, 'fallback': self.fallback}

    def status(self):
        with self.condition:
            return {'state': self.state, 'id': self.id, 'error': self.error or self.speech_error,
                    **({'queue': [item[0] for item in self.queue]} if self.queue else {}),
                    **({'promoted': list(self.promoted)} if self.promoted else {})}

    def clear(self):
        self.speech_error = None
        self.cancel.set()
        self.pending = None
        self.buffer.clear()
        self.offset = 0
        self.done = False
        self.paused = False
        self.id = None

    def start_reading(self, item):
        identifier, text, voice, speed, lexicon = item
        self.clear()
        self.cancel = threading.Event()
        self.id = identifier
        self.pending = (text, self.cancel, voice, speed, lexicon)
        self.state = 'generating' if self.ready else 'loading'
        self.condition.notify_all()

    def next_reading(self):
        if self.queue and not self.closed and self.error is None:
            item = self.queue.popleft()
            self.start_reading(item)
            self.promoted.append(item[0])

    def speak(self, body):
        text, identifier = body.get('text'), body.get('id')
        if not isinstance(text, str) or not text.strip() or not isinstance(identifier, str):
            raise ValueError('id and nonempty text must be strings')
        if not isinstance(body.get('lexicon', True), bool):
            raise ValueError('lexicon must be a boolean')
        policy = body.get('policy', 'stop')
        if policy not in ('stop', 'wait'):
            raise ValueError('policy must be stop or wait')
        with self.condition:
            if self.error is not None:
                raise RuntimeError(self.error)
            item = (identifier, text, self.voice, self.speed, body.get('lexicon', True))
            if policy == 'wait' and self.id is not None and len(self.queue) >= 10:
                raise ValueError('La cola de lecturas está llena (máximo 10).')
            self.promoted = deque((id for id in self.promoted if id != identifier), maxlen=self.promoted.maxlen)
            if policy == 'wait' and self.id is not None:
                self.queue.append(item)
                return {'id': identifier, 'state': 'queued'}
            self.start_reading(item)
        return {'id': identifier}

    def control(self, action, identifier=None):
        with self.condition:
            if action == 'stop':
                if identifier is not None and not isinstance(identifier, str):
                    raise ValueError('id must be a string')
                if identifier is None:
                    self.queue.clear()
                else:
                    self.queue = deque(item for item in self.queue if item[0] != identifier)
                    if identifier != self.id:
                        return {'state': self.state}
                self.clear()
                self.state = 'error' if self.error is not None else 'idle'
                self.next_reading()
            elif self.id is not None:
                self.paused = action == 'pause'
                if self.paused:
                    self.state = 'paused'
                else:
                    self.state = ('playing' if self.buffer else 'generating') if self.ready else 'loading'
            return {'state': self.state}

    def configure(self, body):
        with self.condition:
            self.validate(body)
            reload = body.get('model', self.model_name) != self.model_name
            if reload:
                self.clear()
                self.model_name = body['model']
                self.revision += 1
                self.ready = False
                self.error = None
                self.state = 'loading'
            if 'model' in body or 'voice' in body:
                self.fallback = None  # A new choice replaces the old warning.
            self.voice = body.get('voice', default_voice(self.model_name) if reload else self.voice)
            self.speed = float(body.get('speed', self.speed))
            self.volume = float(body.get('volume', self.volume))
            self.condition.notify_all()
            return self.health()

    def callback(self, outdata, frames, time_info, status):
        outdata.fill(0)
        with self.condition:
            if self.paused:
                return
            written = 0
            while self.buffer and written < frames:
                chunk = self.buffer[0]
                count = min(frames - written, len(chunk) - self.offset)
                outdata[written:written + count, 0] = soft_limit(
                    chunk[self.offset:self.offset + count] * (self.volume * BASE_GAIN))
                written += count
                self.offset += count
                if self.offset == len(chunk):
                    self.buffer.popleft()
                    self.offset = 0
            if self.done and not self.buffer:
                self.done = False
                self.state, self.id = 'idle', None
                self.next_reading()
            elif written:
                self.state = 'playing'

    def append(self, data, cancel):
        data = np.asarray(data, dtype=np.float32).reshape(-1)
        with self.condition:
            if data.size and not cancel.is_set():
                self.buffer.append(data)
                if not self.paused:
                    self.state = 'playing'

    def run(self):
        loaded_revision = -1
        synth = sink = None
        try:
            while True:
                with self.condition:
                    self.condition.wait_for(lambda: self.closed or loaded_revision != self.revision or self.pending)
                    if self.closed:
                        return
                    revision, name = self.revision, self.model_name
                if loaded_revision != revision:
                    if sink is not None:
                        sink.close()
                        sink = None
                    try:
                        try:
                            synth = self.factory(name)
                        except Exception as exc:
                            if name != 'phonon':
                                raise
                            reason = ' '.join(str(exc).splitlines())
                            with self.condition:
                                if self.closed or revision != self.revision:
                                    continue
                                print(f'Phonon unavailable ({reason}); using spanish with lola',
                                      file=sys.stderr, flush=True)
                                self.fallback = self.voice
                                self.model_name, self.voice = 'spanish', 'lola'
                                name = 'spanish'
                                if self.pending:
                                    text, cancel, _, speed, lexicon = self.pending
                                    self.pending = (text, cancel, 'lola', speed, lexicon)
                            synth = self.factory(name)
                    except Exception as exc:
                        print(f'Model load failed: {exc}', file=sys.stderr)
                        with self.condition:
                            loaded_revision = revision
                            if revision == self.revision:
                                self.clear()
                                self.ready = False
                                self.error = f'model load failed: {exc}'
                                self.state = 'error'
                            self.condition.wait_for(lambda: self.closed or self.revision != revision)
                        continue
                    with self.condition:
                        loaded_revision = revision
                        if self.closed or revision != self.revision:
                            continue
                        self.ready = True
                        if not self.pending:
                            self.state = 'idle'
                            self.next_reading()
                with self.condition:
                    if not self.pending or revision != self.revision:
                        continue
                    text, cancel, voice, speed, lexicon = self.pending
                    self.pending = None
                    if not self.paused:
                        self.state = 'generating'
                try:
                    # Open the output per reading so it follows the current default device.
                    if sink is not None:
                        sink.close()
                        sink = None
                    sink = self.audio_factory(synth.sample_rate, self.callback)
                    text = self.normalize_text(text, name, lexicon)
                    with self.condition:
                        speed = self.speed
                    stretch = SpeedStream(speed)
                    gain = voice_gain(voice)
                    for chunk in synth.stream(text, self.resolve_voice(voice, name), cancel):
                        chunk = chunk * gain
                        if cancel.is_set():
                            break
                        with self.condition:
                            current_speed = self.speed
                        if current_speed != speed:
                            self.append(stretch.flush(), cancel)
                            speed = current_speed
                            stretch = SpeedStream(speed)
                        self.append(stretch.process(chunk), cancel)
                    if not cancel.is_set():
                        self.append(stretch.flush(), cancel)
                        with self.condition:
                            if not cancel.is_set():
                                self.done = True
                                if not self.buffer and not self.paused:
                                    self.done = False
                                    self.state, self.id = 'idle', None
                                    self.next_reading()
                except Exception as exc:
                    print(f'Speech failed: {exc}', file=sys.stderr)
                    with self.condition:
                        if not cancel.is_set():
                            self.clear()
                            self.speech_error = f'speech failed: {exc}'
                            self.state = 'error' if self.error is not None else 'idle'
                            self.next_reading()
        finally:
            if sink is not None:
                sink.close()

    def close(self):
        with self.condition:
            self.closed = True
            self.clear()
            self.condition.notify_all()
        self.worker.join(timeout=5)


class SpeechHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second socket bind a busy port, so a server
    # started next to AnkiConnect (also 8765) would share the port silently.
    allow_reuse_address = sys.platform != 'win32'

    def server_bind(self):
        if sys.platform == 'win32':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def server_close(self):
        # A failed bind closes the server before create_server attaches the service.
        if hasattr(self, 'service'):
            self.service.close()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def reply(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()

    def send_error(self, code, message=None, explain=None):
        self.close_connection = True
        self.reply(code, {'error': message or self.responses.get(code, ('HTTP error',))[0]})

    def reject_origin(self):
        if 'Origin' in self.headers:
            self.close_connection = True  # The body, if any, stays unread.
            self.reply(403, {'error': 'cross-origin requests are not allowed'})
            return True
        return False

    def do_GET(self):
        if self.reject_origin():
            return
        service = self.server.service
        routes = {'/health': service.health, '/status': service.status,
                  '/voices': lambda: {'voices': service.voices(), 'catalog': service.voice_table()}}
        if self.path not in routes:
            self.reply(404, {'error': 'unknown path'})
            return
        self.reply(200, routes[self.path]())

    def do_POST(self):
        if self.reject_origin():
            return
        service = self.server.service
        if self.path not in {'/speak', '/pause', '/resume', '/stop', '/config', '/shutdown'}:
            self.reply(404, {'error': 'unknown path'})
            return
        if self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
            self.close_connection = True
            self.reply(415, {'error': 'Content-Type must be application/json'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 1_048_576:
                raise ValueError('expected a JSON object (maximum 1 MiB)')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('expected a JSON object')
            if self.path == '/speak':
                self.reply(202, service.speak(body))
            elif self.path == '/config':
                self.reply(200, service.configure(body))
            elif self.path == '/shutdown':
                self.reply(200, {'ok': True})
                service.control('stop')
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            else:
                self.reply(200, service.control(self.path[1:], body.get('id') if self.path == '/stop' else None))
        except RuntimeError as exc:
            self.reply(503, {'error': str(exc)})
        except (ValueError, UnicodeDecodeError) as exc:
            self.reply(400, {'error': str(exc)})


def create_server(port=8765, model=START_MODEL, voice=None, speed=1.0,
                  synthesizer_factory=synthesizer, audio_factory=audio_sink, catalog=None):
    if catalog is None:
        started = time.perf_counter()
        from tehablo_tts import VOICES
        print(f'Startup: TTS imports completed in {time.perf_counter() - started:.3f} s', flush=True)
        catalog = VOICES
    service = SpeechService(model, voice, speed, synthesizer_factory, audio_factory, catalog)
    try:
        server = SpeechHTTPServer(('127.0.0.1', port), Handler)
    except Exception:
        service.close()
        raise
    server.service = service
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=os.environ.get('TEHABLO_PORT', '8765'))
    parser.add_argument('--model', choices=sorted(MODELS), default=START_MODEL,
                        help=f'engine (default: {START_MODEL}; see src/voice_table.json)')
    parser.add_argument('--voice', default=None,
                        help='voice (default: Regina for phonon, lola for Pocket)')
    parser.add_argument('--speed', type=float, default=1.0)
    args = parser.parse_args()
    print(f'Startup: server imports completed in {time.perf_counter() - IMPORT_STARTED:.3f} s', flush=True)
    try:
        server = create_server(**vars(args))
    except ValueError as exc:
        parser.error(str(exc))
    try:
        print(f'Listening on http://127.0.0.1:{server.server_port}', flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
