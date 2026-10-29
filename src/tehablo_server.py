"""Loopback HTTP speech service with interruptible, buffered playback."""
import argparse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
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
MODELS = {'spanish', 'spanish_24l'}


class PocketSynthesizer:
    def __init__(self, name):
        from tehablo_tts import TTSModel
        self.model = TTSModel.load_model(language=name)
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
    stream = sd.OutputStream(samplerate=rate, channels=1, dtype='float32', callback=callback)
    stream.start()
    return stream


class SpeechService:
    def __init__(self, model, voice, speed, synthesizer_factory, audio_factory, catalog):
        self.condition = threading.Condition(threading.RLock())
        self.factory = synthesizer_factory
        self.audio_factory = audio_factory
        self.catalog = list(catalog)
        self.model_name, self.voice, self.speed = model, voice, speed
        self.volume = 1.0
        self.validate({'model': model, 'voice': voice, 'speed': speed})
        self.lexicon = Lexicon(ROOT / 'pronunciaciones.json')
        self.ready = False
        self.state = 'loading'
        self.id = None
        self.pending = None
        self.cancel = threading.Event()
        self.closed = False
        self.revision = 0
        self.buffer = deque()
        self.offset = 0
        self.done = False
        self.paused = False
        self.worker = threading.Thread(target=self.run, name='speech-worker', daemon=True)
        self.worker.start()

    def normalize_text(self, text, model):
        """Prepare Spanish speech in technical → lexicon → numbers order."""
        if model in MODELS:
            return normalize_numbers(self.lexicon.apply(normalize_technical(text)))
        return text

    def voices(self):
        local = sorted(p for p in VOICES_DIR.iterdir()
                       if p.is_file() and p.suffix.lower() in AUDIO_EXT) if VOICES_DIR.is_dir() else []
        return [str(p) for p in local] + sorted(self.catalog)

    def resolve_voice(self, value):
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
            raise ValueError('model must be spanish or spanish_24l')
        if 'voice' in body:
            self.resolve_voice(body['voice'])
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
                    'voice': self.voice, 'speed': float(self.speed), 'volume': self.volume}

    def status(self):
        with self.condition:
            return {'state': self.state, 'id': self.id}

    def clear(self):
        self.cancel.set()
        self.pending = None
        self.buffer.clear()
        self.offset = 0
        self.done = False
        self.paused = False
        self.id = None

    def speak(self, body):
        text, identifier = body.get('text'), body.get('id')
        if not isinstance(text, str) or not text.strip() or not isinstance(identifier, str):
            raise ValueError('id and nonempty text must be strings')
        with self.condition:
            self.clear()
            self.cancel = threading.Event()
            self.id = identifier
            self.pending = (text, self.cancel, self.voice, self.speed)
            self.state = 'generating' if self.ready else 'loading'
            self.condition.notify_all()
        return {'id': identifier}

    def control(self, action):
        with self.condition:
            if action == 'stop':
                self.clear()
                self.state = 'idle'
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
                self.state = 'loading'
            self.voice = body.get('voice', self.voice)
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
                outdata[written:written + count, 0] = np.clip(
                    chunk[self.offset:self.offset + count] * self.volume, -1, 1)
                written += count
                self.offset += count
                if self.offset == len(chunk):
                    self.buffer.popleft()
                    self.offset = 0
            if self.done and not self.buffer:
                self.state, self.id = 'idle', None
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
                        synth = self.factory(name)
                    except Exception as exc:
                        print(f'Model load failed: {exc}', file=sys.stderr)
                        with self.condition:
                            loaded_revision = revision
                            self.condition.wait_for(lambda: self.closed or self.revision != revision)
                        continue
                    with self.condition:
                        loaded_revision = revision
                        if self.closed or revision != self.revision:
                            continue
                        self.ready = True
                        if not self.pending:
                            self.state = 'idle'
                with self.condition:
                    if not self.pending or revision != self.revision:
                        continue
                    text, cancel, voice, speed = self.pending
                    self.pending = None
                    if not self.paused:
                        self.state = 'generating'
                try:
                    if sink is None:
                        sink = self.audio_factory(synth.sample_rate, self.callback)
                    text = self.normalize_text(text, name)
                    with self.condition:
                        speed = self.speed
                    stretch = SpeedStream(speed)
                    for chunk in synth.stream(text, self.resolve_voice(voice), cancel):
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
                except Exception as exc:
                    print(f'Speech failed: {exc}', file=sys.stderr)
                    with self.condition:
                        if not cancel.is_set():
                            self.clear()
                            self.state = 'idle'
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

    def server_close(self):
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

    def do_GET(self):
        service = self.server.service
        routes = {'/health': service.health, '/status': service.status,
                  '/voices': lambda: {'voices': service.voices()}}
        if self.path not in routes:
            self.reply(404, {'error': 'unknown path'})
            return
        self.reply(200, routes[self.path]())

    def do_POST(self):
        service = self.server.service
        if self.path not in {'/speak', '/pause', '/resume', '/stop', '/config', '/shutdown'}:
            self.reply(404, {'error': 'unknown path'})
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
                self.reply(200, service.control(self.path[1:]))
        except (ValueError, UnicodeDecodeError) as exc:
            self.reply(400, {'error': str(exc)})


def create_server(port=8765, model='spanish', voice='lola', speed=1.0,
                  synthesizer_factory=PocketSynthesizer, audio_factory=audio_sink, catalog=None):
    if catalog is None:
        from tehablo_tts import VOICES
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
    parser.add_argument('--model', choices=sorted(MODELS), default='spanish')
    parser.add_argument('--voice', default='lola')
    parser.add_argument('--speed', type=float, default=1.0)
    args = parser.parse_args()
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
