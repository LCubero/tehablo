"""Loopback HTTP speech service with interruptible, buffered playback."""
import time

IMPORT_STARTED = time.perf_counter()

import argparse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import hmac
import math
import re
import os
from pathlib import Path
import socket
import secrets
import struct
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


TOKEN_REFUSED = ('Hugging Face rechazó el token: revisa que esté completo y que aceptaste los términos '
                 'en huggingface.co/gradium/phonon-40m-es.')


def token_refused(reason):
    """Whether Hugging Face refused the token (invalid, or the gated terms not accepted)."""
    # A 401/403 from a proxy is not Hugging Face refusing the token.
    return 'huggingface.co' in reason and any(
        mark in reason for mark in ('Authentication required', 'GatedRepo', '401 Client Error', '403 Client Error'))


def hide_token(error):
    """Error text safe for logs, API and notices: never the Hugging Face token."""
    text = str(error)
    token = os.environ.get('HF_TOKEN')
    if token:
        text = text.replace(token, 'hf_***')
    return re.sub(r'hf_[A-Za-z0-9]{20,}', 'hf_***', text)


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


# Must match pocket_tts get_predefined_voice(); a test pins it to the installed version.
POCKET_VOICES_REVISION = 'a7056f505a4a8ca72d8b5fb1440071d6f1a35739'


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
    # Pocket's predefined embedding at its pinned revision, checked without loading Pocket/torch.
    return (Path(constants.HF_HUB_CACHE) / 'models--kyutai--pocket-tts-without-voice-cloning' /
            'snapshots' / POCKET_VOICES_REVISION /
            'languages' / model / 'embeddings' / f'{name}.safetensors').is_file()


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

    def prepare(self, voice):
        if voice not in self.voices:
            self.voices[voice] = self.model.get_state_for_audio_prompt(voice, truncate=True)

    def stream(self, text, voice, stop):
        self.prepare(voice)
        if stop.is_set():
            return
        for chunk in self.model.generate_audio_stream(self.voices[voice], text, stop=stop):
            if stop.is_set():
                return
            yield chunk.detach().cpu().numpy().astype(np.float32).reshape(-1)


def output_devices(include_hidden=False):
    """Query only on demand: SSH playback must not depend on PortAudio."""
    import sounddevice as sd
    # Filter by default; an explicit request exposes outputs from every API.
    indices = None if include_hidden else sd.query_hostapis(sd.query_devices(kind='output')['hostapi'])['devices']
    return [{'index': i, 'name': d['name'], 'default': i == sd.default.device[1]}
            for i, d in enumerate(sd.query_devices()) if d['max_output_channels'] > 0 and (indices is None or i in indices)]


class DeviceMissing(ValueError):
    """The saved output is absent; keep the choice and use the system default."""


def audio_sink(rate, callback, device=None):
    import sounddevice as sd
    # PortAudio caches the device list; refresh it so a new default output is used.
    sd._terminate()
    sd._initialize()
    if device:
        # Like the client, resolve saved names across all APIs, even if absent from the menu.
        matching = [i for i, d in enumerate(sd.query_devices())
                    if d['max_output_channels'] > 0 and d['name'] == device]
        if not matching:
            raise DeviceMissing(device)
        device = matching[0]
    stream = sd.OutputStream(samplerate=rate, channels=1, dtype='float32', callback=callback, device=device)
    stream.start()
    return stream


# Unknown-length RIFF is understood by ffplay without buffering an entire reading.
WAV_HEADER = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 0xFFFFFFFF, b'WAVE',
                         b'fmt ', 16, 1, 1, 24000, 48000, 2, 16, b'data', 0xFFFFFFFF)


def read_pairing_code(path):
    """Create privately and exclusively; concurrent servers reuse the same code."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        temporary = path.with_name(path.name + '.' + secrets.token_hex(16))
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, 'w', encoding='ascii') as file:
                file.write(secrets.token_hex(16) + '\n')
            try:
                os.link(temporary, path)  # Publish complete bytes, never replace a winner.
            except FileExistsError:
                pass
        finally:
            temporary.unlink()
    code = path.read_text(encoding='ascii').strip()
    if len(code) != 32 or any(c not in '0123456789abcdef' for c in code):
        raise ValueError('Invalid SSH pairing code file')
    return code


def load_ssh_code():
    return read_pairing_code(Path.home() / '.tehablo/ssh-codigo')


class AudioPairingError(OSError):
    """A peer supplied a nonce but did not complete the pairing proof."""


def authenticate_audio(connection, code):
    """Fixed-size mutual proof; the shared secret never crosses the socket."""
    def receive(size):
        data = b''
        deadline = time.monotonic() + .5
        while len(data) < size:
            connection.settimeout(max(.001, deadline - time.monotonic()))
            if time.monotonic() >= deadline:
                raise OSError('Audio authentication failed')
            chunk = connection.recv(size - len(data))
            if not chunk:
                raise OSError('Audio authentication failed')
            data += chunk
        return data
    key = code.encode('ascii')
    client_nonce = receive(16)
    try:
        server_nonce = secrets.token_bytes(16)
        connection.sendall(hmac.digest(key, b'servidor' + client_nonce, 'sha256') + server_nonce)
        if not hmac.compare_digest(receive(32), hmac.digest(key, b'cliente' + server_nonce, 'sha256')):
            raise OSError('Audio authentication failed')
    except OSError as exc:
        raise AudioPairingError('Audio authentication failed') from exc


class SSHAudio:
    """One paced authenticated WAV connection per reading; failure stops that reading."""
    def __init__(self, service):
        self.service = service
        self.lock = threading.RLock()
        self.connection = None
        self.attempted = False
        self.receiver_authenticated = False
        self.rate = 24000
        self.callback = None
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self.run, name='ssh-audio', daemon=True)
        self.thread.start()

    def attach(self, rate, callback):
        with self.lock:
            self.disconnect()
            self.attempted = False
            self.rate, self.callback = rate, callback
        return self

    def close(self):
        # The clock closes after its final callback packet, including queue promotion.
        with self.lock:
            self.callback = None

    def disconnect(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def failed(self, exc, identifier, streaming=False):
        self.disconnect()
        self.service.control('stop', identifier)
        if streaming:
            self.service.speech_error = 'Se cortó el audio por SSH: revisa el cliente en tu computadora.'
        elif isinstance(exc, AudioPairingError):
            self.service.speech_error = 'El cliente de tu computadora no está vinculado con este servidor: en el cliente usa «Vincular servidor» con el código de /tts codigo (o Audio en /tts menu).'
        else:
            self.service.speech_error = 'Sin cliente de audio por SSH: abre el cliente en tu computadora y elige esta sesión SSH.'
        print(self.service.speech_error, file=sys.stderr, flush=True)

    def shutdown(self):
        self.closed.set()
        self.thread.join(timeout=2)
        with self.lock:
            self.disconnect()

    def run(self):
        next_tick = time.monotonic() + .02
        while not self.closed.wait(max(0, next_tick - time.monotonic())):
            next_tick = max(next_tick + .02, time.monotonic())
            # Same lock order as control/clear; the callback re-enters the condition.
            with self.service.condition, self.lock:
                rate, callback = self.rate, self.callback
                if callback is None or self.service.audio != 'ssh' or self.service.state not in ('generating', 'playing', 'paused'):
                    self.disconnect()
                    continue
                if self.service.state == 'paused':
                    continue
                identifier = self.service.id
                if not self.attempted:
                    self.attempted = True
                    streaming = False
                    try:
                        self.connection = socket.create_connection(('127.0.0.1', 18766), timeout=.5)
                        self.connection.settimeout(.1)
                        authenticate_audio(self.connection, load_ssh_code())
                        self.receiver_authenticated = True
                        streaming = True
                        self.connection.settimeout(.1)
                        self.connection.sendall(WAV_HEADER)
                    except (OSError, ValueError) as exc:
                        self.failed(exc, identifier, streaming=streaming)
                        continue
                frames = round(rate * .02)
                samples = np.zeros((frames, 1), dtype=np.float32)
                callback(samples, frames, None, None)
                data = samples[:, 0]
                if rate != 24000:
                    data = np.interp(np.arange(480) * rate / 24000, np.arange(frames), data)
                packet = (np.clip(data, -1, 1) * 32767).astype('<i2').tobytes()
                if self.connection is not None:
                    try:
                        self.connection.sendall(packet)
                    except OSError as exc:
                        self.failed(exc, identifier, streaming=True)
                if self.callback is None or self.service.state not in ('generating', 'playing', 'paused'):
                    self.disconnect()


class SpeechService:
    def __init__(self, model, voice, speed, synthesizer_factory, audio_factory, catalog, audio='local', device_provider=output_devices):
        self.condition = threading.Condition(threading.RLock())
        self.factory = synthesizer_factory
        self.cached = cached
        if audio not in ('local', 'ssh'):
            raise ValueError('audio must be local or ssh')
        self.audio = audio
        self.device = ''
        self.device_note = None
        self.device_provider = device_provider
        self.local_audio_factory = audio_factory
        self.audio_factory = lambda rate, callback: (self.ssh_audio.attach(rate, callback)
                                                    if self.audio == 'ssh' else self.local_sink(rate, callback))
        # A callable catalog loads on first use: Phonon never needs the Pocket voice list.
        self._catalog = catalog if callable(catalog) else list(catalog)
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
        self.preparation = None
        self.queue = deque()
        self.promoted = deque(maxlen=10)
        self.cancel = threading.Event()
        self.closed = False
        self.revision = 0
        self.buffer = deque()
        self.offset = 0
        self.done = False
        self.paused = False
        self.cue = np.empty(0, dtype=np.float32)
        self.cue_rate = None
        self.cue_pending = 0
        self.cue_offset = 0
        self.queue_prefix = False
        self.ssh_audio = SSHAudio(self)
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

    @property
    def catalog(self):
        if callable(self._catalog):
            self._catalog = list(self._catalog())
        return self._catalog

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

    def local_sink(self, rate, callback):
        self.device_note = None
        if self.device:
            try:
                return self.local_audio_factory(rate, callback, device=self.device)
            except DeviceMissing:
                self.device_note = f'{self.device} no está conectada: suena por la predeterminada.'
        return self.local_audio_factory(rate, callback)

    def devices(self, include_hidden=False):
        if self.audio == 'ssh':
            return {'devices': [], 'note': 'En SSH, la salida se elige en el cliente.'}
        try:
            return {'devices': self.device_provider(include_hidden=True) if include_hidden else self.device_provider()}
        except Exception as exc:
            return {'devices': [], 'error': str(exc)}

    def validate(self, body):
        if 'device' in body:
            device = body['device']
            # A saved local output may be disconnected when Pi starts.
            if not isinstance(device, str) or (device and body.get('audio', self.audio) == 'ssh'):
                raise ValueError('unknown output device')
        if set(body) - {'model', 'voice', 'speed', 'volume', 'audio', 'device'}:
            raise ValueError('unknown config field')
        if 'audio' in body and body['audio'] not in ('local', 'ssh'):
            raise ValueError('audio must be local or ssh')
        if 'model' in body and (not isinstance(body['model'], str) or body['model'] not in MODELS):
            raise ValueError('model must be phonon, spanish or spanish_24l')
        if 'voice' in body:
            self.resolve_voice(body['voice'], body.get('model', self.model_name))
        if 'speed' in body:
            value = body['speed']
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not .5 <= value <= 1.5:
                raise ValueError('speed must be between 0.5 and 1.5')

        if 'volume' in body:
            value = body['volume']
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not .1 <= value <= 1.5:
                raise ValueError('volume must be between 0.1 and 1.5')

    def health(self):
        with self.condition:
            return {'ok': True, 'version': getattr(self, 'version', None), 'ready': self.ready, 'model': self.model_name,
                    'voice': self.voice, 'speed': float(self.speed), 'volume': self.volume, 'audio': self.audio, 'device': self.device,
                    'error': self.error, 'fallback': self.fallback,
                    'preparation': dict(self.preparation) if self.preparation else None,
                    'sshReceiver': self.ssh_audio.receiver_authenticated}

    def status(self):
        with self.condition:
            return {'state': self.state, 'id': self.id, 'audio': self.audio, 'error': self.error or self.speech_error,
                    **({'note': self.device_note} if self.device_note else {}),
                    **({'queue': [item[0] for item in self.queue]} if self.queue else {}),
                    **({'promoted': list(self.promoted)} if self.promoted else {})}

    def clear(self):
        self.ssh_audio.close()
        self.speech_error = None
        self.device_note = None
        self.cancel.set()
        self.pending = None
        self.buffer.clear()
        self.offset = 0
        self.done = False
        self.paused = False
        self.id = None
        self.cue_pending = self.cue_offset = 0
        self.queue_prefix = False
        self.condition.notify_all()

    def start_reading(self, item):
        identifier, text, voice, speed, lexicon = item
        self.clear()
        self.cancel = threading.Event()
        self.id = identifier
        try:
            self.resolve_voice(voice)
        except ValueError:
            voice = self.voice
        self.pending = (text, self.cancel, voice, speed, lexicon)
        self.state = 'generating' if self.ready else 'loading'
        self.condition.notify_all()

    def next_reading(self):
        if self.queue and not self.closed and self.error is None:
            item = self.queue.popleft()
            identifier, text, voice, speed, lexicon = item
            self.start_reading((identifier, 'Siguiente lectura. ' + text, voice, speed, lexicon))
            self.queue_prefix = True
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
            if policy == 'wait' and self.id is not None and not self.paused and len(self.queue) >= 10:
                raise ValueError('La cola de lecturas está llena (máximo 10).')
            self.promoted = deque((id for id in self.promoted if id != identifier), maxlen=self.promoted.maxlen)
            if policy == 'wait' and self.paused and self.id is not None:
                self.control('stop', self.id)
                if self.id is None:
                    self.queue.append(item)
                    self.next_reading()
                    return {'id': identifier}
            if policy == 'wait' and self.id is not None:
                self.queue.append(item)
                self.cue_pending += 1
                return {'id': identifier, 'state': 'queued'}
            self.start_reading(item)
        return {'id': identifier}

    def control(self, action, identifier=None):
        with self.condition:
            if identifier is not None and not isinstance(identifier, str):
                raise ValueError('id must be a string')
            if action == 'stop':
                if identifier is None:
                    self.queue.clear()
                else:
                    self.queue = deque(item for item in self.queue if item[0] != identifier)
                    if identifier != self.id:
                        return {'state': self.state}
                self.clear()
                self.state = 'error' if self.error is not None else 'idle'
                self.next_reading()
            elif self.id is not None and (identifier is None or identifier == self.id):
                self.paused = action == 'pause'
                if self.paused:
                    self.state = 'paused'
                    self.condition.notify_all()
                else:
                    self.state = ('playing' if self.buffer else 'generating') if self.ready else 'loading'
                    self.condition.notify_all()
            return {'state': self.state}

    def prepare(self, body):
        """Queue catalog downloads on the model's existing worker (never speech)."""
        if set(body) != {'model', 'voice'} or not any(
                model == body.get('model') and name == body.get('voice')
                for name, model, kind, _ in VOICE_TABLE):
            raise ValueError('expected a catalog download voice')
        with self.condition:
            if self.preparation and self.preparation['state'] == 'downloading':
                raise RuntimeError('Ya se está descargando una voz.')
            self.configure(body)
            self.preparation = {'id': secrets.token_hex(8), 'voice': body['voice'],
                                'revision': self.revision, 'state': 'downloading', 'error': None}
            self.condition.notify_all()
            return dict(self.preparation)

    def configure(self, body):
        with self.condition:
            self.validate(body)
            model_reload = (body.get('model', self.model_name) != self.model_name
                            or ('model' in body and self.error is not None))
            if model_reload or body.get('audio', self.audio) != self.audio:
                self.clear()
                self.model_name = body.get('model', self.model_name)
                self.revision += 1
                self.ready = False
                self.error = None
                self.state = 'loading'
            if 'model' in body or 'voice' in body:
                self.fallback = None  # A new choice replaces the old warning.
            self.voice = body.get('voice', default_voice(self.model_name) if model_reload else self.voice)
            self.audio = body.get('audio', self.audio)
            self.device = body.get('device', self.device)
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
            if written:
                self.condition.notify_all()
            position = 0
            while self.cue_pending and self.cue.size and position < frames:
                count = min(frames - position, len(self.cue) - self.cue_offset)
                outdata[position:position + count, 0] += self.cue[self.cue_offset:self.cue_offset + count] * self.volume
                position += count
                self.cue_offset += count
                if self.cue_offset == len(self.cue):
                    self.cue_pending -= 1
                    self.cue_offset = 0
            np.clip(outdata, -1, 1, out=outdata)
            if self.done and not self.buffer:
                self.done = False
                self.state, self.id = 'idle', None
                self.next_reading()
            elif written:
                self.state = 'playing'

    def append(self, data, cancel):
        data = np.asarray(data, dtype=np.float32).reshape(-1)
        with self.condition:
            # Keep at most three seconds queued, even when a synth yields a large chunk.
            limit = 3 * self.cue_rate
            position = 0
            while position < data.size and not cancel.is_set() and not self.closed:
                buffered = sum(len(chunk) for chunk in self.buffer) - self.offset
                if buffered >= limit:
                    self.condition.wait()
                    continue
                count = min(data.size - position, limit - buffered)
                self.buffer.append(data[position:position + count].copy())
                position += count
                if not self.paused:
                    self.state = 'playing'

    def run(self):
        loaded_revision = -1
        synth = sink = None
        try:
            while True:
                with self.condition:
                    self.condition.wait_for(lambda: self.closed or loaded_revision != self.revision or self.pending
                                            or (self.preparation and self.preparation['state'] == 'downloading'))
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
                            reason = ' '.join(hide_token(exc).splitlines())
                            with self.condition:
                                if self.closed or revision != self.revision:
                                    continue
                                print(f'Phonon unavailable ({reason}); using spanish with lola',
                                      file=sys.stderr, flush=True)
                                # A Regina/Iker download ends here with its own reason, never as a Pocket voice.
                                job = self.preparation
                                if job and job['state'] == 'downloading' and job['revision'] == revision:
                                    if token_refused(reason):
                                        job.update(state='error', error=TOKEN_REFUSED, code='token')
                                    else:
                                        job.update(state='error', error=f'No se pudo descargar Phonon: {reason}')
                                self.fallback = self.voice
                                self.model_name, self.voice = 'spanish', 'lola'
                                name = 'spanish'
                                if self.pending:
                                    text, cancel, _, speed, lexicon = self.pending
                                    self.pending = (text, cancel, 'lola', speed, lexicon)
                            synth = self.factory(name)
                    except Exception as exc:
                        exc = hide_token(exc)
                        print(f'Model load failed: {exc}', file=sys.stderr)
                        with self.condition:
                            loaded_revision = revision
                            if revision == self.revision:
                                self.clear()
                                self.ready = False
                                self.error = f'model load failed: {exc}'
                                if self.preparation and self.preparation['state'] == 'downloading':
                                    self.preparation.update(state='error', error=self.error)
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
                    job = self.preparation
                    if job and job['state'] == 'downloading':
                        if job['revision'] != revision or revision != self.revision:
                            job.update(state='error', error='La voz cambió durante la descarga.')
                            continue
                    else:
                        job = None
                if job:
                    try:
                        # Phonon downloads all its bundled voices when the model loads.
                        if name != 'phonon':
                            synth.prepare(self.resolve_voice(job['voice'], name))
                        with self.condition:
                            job.update(state='ready')
                    except Exception as exc:
                        with self.condition:
                            job.update(state='error', error=hide_token(exc))
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
                    with self.condition:
                        if self.cue_rate != synth.sample_rate:
                            self.cue_rate = synth.sample_rate
                            phase = np.arange(round(.15 * self.cue_rate), dtype=np.float32) / self.cue_rate
                            self.cue = (.035 * np.sin(2 * np.pi * 660 * phase) * np.sin(np.pi * phase / .15) ** 2).astype(np.float32)
                        if self.queue_prefix and not cancel.is_set():
                            self.buffer.append(np.zeros(round(.6 * self.cue_rate), dtype=np.float32))
                            self.buffer.append(self.cue / BASE_GAIN)
                            self.queue_prefix = False
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
                    exc = hide_token(exc)
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
        self.ssh_audio.shutdown()


class SpeechHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second socket bind a busy port, so a server
    # started next to AnkiConnect (also 8765) would share the port silently.
    allow_reuse_address = sys.platform != 'win32'

    def server_bind(self):
        if sys.platform == 'win32':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def stop_serving(self):
        self.service.control('stop')
        self.streams_closed.set()
        self.shutdown()

    def serve_forever(self, poll_interval=.5):
        stopped = threading.Event()

        def watch_idle():
            while not stopped.wait(min(2, self.idle_exit / 4)):
                if time.monotonic() - self.last_request > self.idle_exit:
                    print(f'Idle: no requests for {self.idle_exit:g} s; shutting down', flush=True)
                    self.stop_serving()
                    return

        if self.idle_exit:
            threading.Thread(target=watch_idle, name='idle-exit', daemon=True).start()
        try:
            super().serve_forever(poll_interval)
        finally:
            stopped.set()
            self.streams_closed.set()

    def server_close(self):
        # A failed bind closes the server before create_server attaches the service.
        if hasattr(self, 'service'):
            self.service.close()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    def parse_request(self):
        parsed = super().parse_request()
        if parsed:
            supplied = self.headers.get('X-Tehablo-Codigo', '').encode('utf-8')
            try:
                valid = hmac.compare_digest(supplied, load_ssh_code().encode('ascii'))
            except (OSError, ValueError):
                valid = False
            if not valid and not (self.command == 'GET' and self.path == '/health'):
                self.close_connection = True
                self.reply(403, {'error': 'forbidden'})
                return False
            if valid:
                # An unauthenticated /health still answers but never keeps the server alive.
                self.server.last_request = time.monotonic()
        return parsed

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
        routes = {'/health': service.health, '/status': service.status, '/devices': service.devices,
                  '/devices/all': lambda: service.devices(True),
                  '/voices': lambda: {'voices': service.voices(), 'catalog': service.voice_table()}}
        if self.path not in routes:
            self.reply(404, {'error': 'unknown path'})
            return
        self.reply(200, routes[self.path]())

    def do_POST(self):
        if self.reject_origin():
            return
        service = self.server.service
        if self.path not in {'/speak', '/pause', '/resume', '/stop', '/config', '/prepare', '/shutdown'}:
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
            elif self.path == '/prepare':
                self.reply(202, service.prepare(body))
            elif self.path == '/shutdown':
                self.reply(200, {'ok': True})
                threading.Thread(target=self.server.stop_serving, daemon=True).start()
            else:
                self.reply(200, service.control(self.path[1:], body.get('id')))
        except RuntimeError as exc:
            self.reply(503, {'error': str(exc)})
        except (ValueError, UnicodeDecodeError) as exc:
            self.reply(400, {'error': str(exc)})


def create_server(port=8765, model=START_MODEL, voice=None, speed=1.0,
                  synthesizer_factory=synthesizer, audio_factory=audio_sink, catalog=None, idle_exit=30, audio='local', device_provider=output_devices, version_path=ROOT / 'VERSION'):
    if not math.isfinite(idle_exit) or idle_exit < 0:
        raise ValueError('idle-exit must be a finite nonnegative number')
    if catalog is None:
        def catalog():
            # Importing tehablo_tts loads Pocket and torch (~400 MB, ~4 s), so Phonon defers it.
            started = time.perf_counter()
            from tehablo_tts import VOICES
            print(f'Startup: TTS imports completed in {time.perf_counter() - started:.3f} s', flush=True)
            return VOICES
        if model != 'phonon':
            catalog = catalog()
    service = SpeechService(model, voice, speed, synthesizer_factory, audio_factory, catalog, audio, device_provider)
    try:
        service.version = Path(version_path).read_text(encoding='utf-8').strip() or None
    except (OSError, UnicodeError):
        service.version = None
    try:
        server = SpeechHTTPServer(('127.0.0.1', port), Handler)
    except Exception:
        service.close()
        raise
    server.service = service
    server.streams_closed = threading.Event()
    server.idle_exit = idle_exit
    server.last_request = time.monotonic()
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=os.environ.get('TEHABLO_PORT', '8765'))
    parser.add_argument('--model', choices=sorted(MODELS), default=START_MODEL,
                        help=f'engine (default: {START_MODEL}; see src/voice_table.json)')
    parser.add_argument('--voice', default=None,
                        help='voice (default: Regina for phonon, lola for Pocket)')
    parser.add_argument('--speed', type=float, default=1.0)
    parser.add_argument('--audio', choices=['local', 'ssh'], default='local')
    parser.add_argument('--idle-exit', type=float, default=30,
                        help='exit after SECONDS without requests (default: 30; 0 disables)', metavar='SECONDS')
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
