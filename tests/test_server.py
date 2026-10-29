"""HTTP contract tests without a model download or audio device."""
import http.client
import json
from pathlib import Path
import sys
import threading
import time
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from tehablo_server import create_server


class Synth:
    sample_rate = 24000

    def __init__(self):
        self.calls = []
        self.cancelled = threading.Event()

    def stream(self, text, voice, stop):
        self.calls.append((text, voice))
        for _ in range(200):
            if stop.wait(.005):
                self.cancelled.set()
                return
            yield np.arange(240, dtype=np.float32)


class Sink:
    def __init__(self, rate, callback):
        self.callback = callback
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        while not self.closed.wait(.005):
            self.callback(np.zeros((240, 1), dtype=np.float32), 240, None, None)

    def close(self):
        self.closed.set()
        self.thread.join()


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.loaded = threading.Event()
        self.synth = Synth()

        def load(model):
            self.loaded.wait(3)
            return self.synth

        self.server = create_server(port=0, synthesizer_factory=load,
                                    audio_factory=Sink, catalog=['lola', 'other'])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.loaded.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, body=None, raw=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        method = 'POST' if body is not None or raw is not None else 'GET'
        conn.request(method, path, raw if raw is not None else
                     (json.dumps(body) if body is not None else None),
                     {'Content-Type': 'application/json'})
        response = conn.getresponse()
        result = response.status, json.loads(response.read())
        conn.close()
        return result

    def wait(self, predicate):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.01)
        self.fail('condition timed out')

    def ready(self):
        self.loaded.set()
        self.wait(lambda: self.request('/health')[1]['ready'])

    def test_loading_queue_pipeline_and_latest(self):
        self.assertFalse(self.request('/health')[1]['ready'])
        self.assertEqual(self.request('/status')[1]['state'], 'loading')
        self.assertEqual(self.request('/speak', {'id': 'old', 'text': 'old'})[0], 202)
        self.request('/speak', {'id': 'new', 'text': 'Python 15.000'})
        self.ready()
        self.wait(lambda: bool(self.synth.calls))
        self.assertEqual(self.synth.calls[0][0], 'páiton quince mil')
        self.assertEqual(len(self.synth.calls), 1)
        self.request('/speak', {'id': 'next', 'text': 'hola'})
        self.wait(lambda: self.synth.cancelled.is_set())
        self.wait(lambda: len(self.synth.calls) == 2)
        self.assertEqual(self.request('/status')[1]['id'], 'next')

    def test_technical_lexicon_numbers_order(self):
        self.ready()
        self.request('/speak', {'id': 'tech', 'text': 'Mira src/tehablo_server.py y RH-W-0001'})
        self.wait(lambda: bool(self.synth.calls))
        self.assertEqual(self.synth.calls[0][0],
                         'Mira tehablo sérver punto pai y erre hache, doble ve, cero cero cero uno')

    def test_pipeline_samples_and_model_guard(self):
        samples = [
            ('https://github.com/LCubero/tehablo.', 'enlace a guítjab punto com.'),
            ('www.example.org/a', 'enlace a example punto org'),
            ('src/tehablo_server.py', 'tehablo sérver punto pai'),
            ('docs/repo-harness/roadmap.md', 'roadmap punto eme de'),
            ('.pi/settings.json', 'settings punto yéison'),
            (r'E:\code\x', 'x'),
            ('README.md', 'rídmi punto eme de'),
            ('RH-W-0001', 'erre hache, doble ve, cero cero cero uno'),
            ('ABC-12', 'a be ce, doce'),
            ('T1 y S3', 'te, uno y ese, tres'),
            ('abc1234', 'un hash'),
            ('feat/pi-tts', 'pai te te ese'),
            ('tehablo_server', 'tehablo sérver'),
            ('15.000', 'quince mil'),
            ('3.5', 'tres punto cinco'),
            ('29/10/2026', 'veintinueve de octubre de dos mil veintiséis'),
        ]
        for source, expected in samples:
            with self.subTest(source=source):
                got = self.server.service.normalize_text(source, 'spanish')
                self.assertEqual(got, expected)
                self.assertEqual(self.server.service.normalize_text(source, 'spanish_24l'), expected)
                self.assertEqual(self.server.service.normalize_text(source, 'english'), source)
                print('PIPELINE ' + json.dumps([source, got], ensure_ascii=True))

    def test_controls(self):
        self.ready()
        self.request('/speak', {'id': 'a', 'text': 'hola'})
        self.wait(lambda: self.request('/status')[1]['state'] == 'playing')
        self.assertEqual(self.request('/pause', {})[1]['state'], 'paused')
        self.assertIn(self.request('/resume', {})[1]['state'], ('playing', 'generating'))
        self.assertEqual(self.request('/stop', {})[1], {'state': 'idle'})
        self.assertIsNone(self.request('/status')[1]['id'])

    def test_pause_keeps_position_and_stop_discards_audio(self):
        callbacks = []

        class ManualSink:
            def __init__(self, rate, callback):
                callbacks.append(callback)

            def close(self):
                pass

        self.server.service.audio_factory = ManualSink
        self.ready()
        self.request('/speak', {'id': 'position', 'text': 'hola'})
        self.wait(lambda: self.request('/status')[1]['state'] == 'playing')
        output = np.zeros((100, 1), dtype=np.float32)
        callbacks[0](output, 100, None, None)
        np.testing.assert_array_equal(output[:, 0], np.arange(100))
        self.request('/pause', {})
        callbacks[0](output, 100, None, None)
        np.testing.assert_array_equal(output, 0)
        self.request('/resume', {})
        callbacks[0](output, 100, None, None)
        np.testing.assert_array_equal(output[:, 0], np.arange(100, 200))
        self.request('/stop', {})
        callbacks[0](output, 100, None, None)
        np.testing.assert_array_equal(output, 0)

    def test_validation_and_config(self):
        self.ready()
        before = self.request('/health')[1]
        for body in ({'speed': 2, 'voice': 'other'}, {'model': 'bad'},
                     {'voice': '../bad.wav'}, {'speed': True}, {'speed': float('nan')},
                     {'unexpected': 1}, {'voice': []}):
            self.assertEqual(self.request('/config', body)[0], 400)
            self.assertEqual(self.request('/health')[1], before)
        result = self.request('/config', {'voice': 'other', 'speed': 1.25})
        self.assertEqual(result[0], 200)
        self.assertEqual(result[1]['voice'], 'other')
        self.assertEqual(result[1]['speed'], 1.25)
        self.assertEqual(self.request('/config', {'model': 'spanish_24l'})[0], 200)
        self.wait(lambda: self.request('/health')[1]['ready'])
        self.assertEqual(self.request('/health')[1]['model'], 'spanish_24l')
        self.assertIn('lola', self.request('/voices')[1]['voices'])
        for body in ({'id': 'a', 'text': ''}, {'id': 'a', 'text': '  '},
                     {'id': 'a', 'text': 12}, {'text': 'hola'}, []):
            self.assertEqual(self.request('/speak', body)[0], 400)
        self.assertEqual(self.request('/missing')[0], 404)
        self.assertEqual(self.request('/missing', {})[0], 404)
        self.assertEqual(self.request('/speak', raw='{')[0], 400)
        self.assertEqual(self.request('/pause', raw='[]')[0], 400)

    def test_unsupported_method_returns_json_error(self):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        conn.request('PUT', '/health', '{}')
        response = conn.getresponse()
        self.assertEqual(response.status, 501)
        self.assertIn('error', json.loads(response.read()))
        conn.close()

    def test_shutdown(self):
        self.assertEqual(self.request('/shutdown', {})[1], {'ok': True})
        self.thread.join(3)
        self.assertFalse(self.thread.is_alive())


if __name__ == '__main__':
    unittest.main()
