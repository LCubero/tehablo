"""HTTP contract tests without a model download or audio device."""
import contextlib
import io
import tempfile
import http.client
import json
import os
import socket
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest import mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import tehablo_server
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


class SSHAudioTests(unittest.TestCase):
    def start(self, audio='ssh', idle_exit=0, rate=24000):
        synth = Synth()
        synth.sample_rate = rate
        synth.stream = lambda text, voice, stop: iter([np.full(rate * 2, .1, dtype=np.float32)])
        server = create_server(port=0, model='spanish', catalog=['lola'], audio=audio,
                               idle_exit=idle_exit, synthesizer_factory=lambda _: synth,
                               audio_factory=lambda *_: self.fail('local audio used in SSH mode'))
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, thread

    def stream(self, server):
        conn = http.client.HTTPConnection(*server.server_address, timeout=2)
        self.addCleanup(conn.close)
        conn.request('GET', '/audio.wav')
        return conn.getresponse()

    def test_local_stream_conflict_changes_nothing(self):
        server, _ = self.start('local')
        before = server.service.health(), server.service.status()
        response = self.stream(server)
        self.assertEqual(response.status, 409)
        self.assertIn('error', json.loads(response.read()))
        self.assertEqual(before, (server.service.health(), server.service.status()))

    def test_header_fanout_pacing_stop_and_no_sounddevice(self):
        server, _ = self.start()
        first = self.stream(server)
        second = self.stream(server)
        self.assertEqual(first.status, 200)
        self.assertEqual(first.getheader('Content-Type'), 'audio/wav')
        expected = bytes.fromhex('52494646ffffffff57415645666d74201000000001000100c05d000080bb00000200100064617461ffffffff')
        self.assertEqual(first.read(44), expected)
        self.assertEqual(second.read(44), expected)
        # Drain initial silence before synthesis starts, then both listeners must hear the same frames.
        with mock.patch.dict(sys.modules, {'sounddevice': None}):
            server.service.speak({'id': 'ssh', 'text': 'hola'})
            def voiced(response):
                for _ in range(100):
                    packet = response.read(960)
                    if any(packet):
                        return packet
                self.fail('no synthesized samples received')
            a, b = voiced(first), voiced(second)
            self.assertEqual(a, b)
            self.assertEqual(np.frombuffer(a, dtype='<i2')[0], int(.1 * 1.8 * 32767))
            started = time.monotonic()
            first.read(24000)
            self.assertGreater(time.monotonic() - started, .15)
            self.assertIsNone(server.service.speech_error)
            server.service.control('stop')
            # Allow the bounded queue and in-flight socket packet to drain.
            first.read(14400)
            self.assertEqual(first.read(960), bytes(960))

    def test_resamples_to_24khz(self):
        server, _ = self.start(rate=48000)
        response = self.stream(server)
        response.read(44)
        server.service.speak({'id': 'resampled', 'text': 'hola'})
        for _ in range(100):
            packet = response.read(960)
            if any(packet):
                self.assertEqual(np.frombuffer(packet, dtype='<i2')[0], int(.1 * 1.8 * 32767))
                break
        else:
            self.fail('no resampled samples')

    def test_stream_is_not_idle_activity_and_closes_on_exit(self):
        server, thread = self.start(idle_exit=.4)
        before = server.last_request
        response = self.stream(server)
        self.assertEqual(response.status, 200)
        self.assertEqual(server.last_request, before)
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertLess(len(response.read()), 48000)

    def test_cli_audio_choices(self):
        for audio in ('local', 'ssh'):
            with mock.patch.object(sys, 'argv', ['server', '--audio', audio]), \
                 mock.patch.object(tehablo_server, 'create_server') as factory:
                tehablo_server.main()
                self.assertEqual(factory.call_args.kwargs['audio'], audio)
        with mock.patch.object(sys, 'argv', ['server', '--audio', 'invalid']), \
             contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as result:
            tehablo_server.main()
        self.assertEqual(result.exception.code, 2)

    def test_audio_config_contract(self):
        server = create_server(port=0, model='spanish', catalog=['lola'],
                               synthesizer_factory=lambda _: Synth(), audio_factory=Sink)
        self.addCleanup(server.server_close)
        service = server.service
        self.assertEqual(service.health()['audio'], 'local')
        self.assertEqual(service.status()['audio'], 'local')
        self.assertEqual(service.configure({'audio': 'ssh'})['audio'], 'ssh')
        for value in ('bad', None, True, 3, []):
            with self.assertRaises(ValueError):
                service.configure({'audio': value, 'volume': .5})
            self.assertEqual(service.health()['audio'], 'ssh')
            self.assertEqual(service.volume, 1)
        self.assertEqual(service.configure({'audio': 'local'})['audio'], 'local')


class IdleTests(unittest.TestCase):
    def start(self, timeout):
        server = create_server(port=0, model='spanish', idle_exit=timeout,
                               synthesizer_factory=lambda model: Synth(),
                               audio_factory=Sink, catalog=['lola'])
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, thread

    def test_idle_exit_without_requests(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            server, thread = self.start(.2)
            thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(output.getvalue(), 'Idle: no requests for 0.2 s; shutting down\n')

    def test_requests_keep_server_alive_then_idle_exits(self):
        server, thread = self.start(.3)
        for _ in range(8):
            conn = http.client.HTTPConnection(*server.server_address, timeout=1)
            conn.request('GET', '/health')
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
            conn.close()
            time.sleep(.08)
            self.assertTrue(thread.is_alive())
        thread.join(2)
        self.assertFalse(thread.is_alive())

    def test_zero_disables_idle_exit(self):
        server, thread = self.start(0)
        time.sleep(.4)
        self.assertTrue(thread.is_alive())
        conn = http.client.HTTPConnection(*server.server_address, timeout=1)
        conn.request('POST', '/shutdown', '{}', {'Content-Type': 'application/json'})
        response = conn.getresponse()
        self.assertEqual((response.status, json.loads(response.read())), (200, {'ok': True}))
        conn.close()
        thread.join(2)
        self.assertFalse(thread.is_alive())


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.loaded = threading.Event()
        self.synth = Synth()
        self.audio_factory = Sink

        def load(model):
            self.loaded.wait(3)
            return self.synth

        self.server = create_server(port=0, model='spanish', synthesizer_factory=load,
                                    audio_factory=lambda rate, callback: self.audio_factory(rate, callback),
                                    catalog=['lola', 'other'])
        # Never touch the real model cache: importing it can take longer than the HTTP timeout in CI.
        self.server.service.cached = lambda name, model, kind: False
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.loaded.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, body=None, raw=None, headers=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        method = 'POST' if body is not None or raw is not None else 'GET'
        conn.request(method, path, raw if raw is not None else
                     (json.dumps(body) if body is not None else None),
                     {'Content-Type': 'application/json'} if headers is None else headers)
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

    def test_http_audio_configuration_and_validation(self):
        self.ready()
        self.assertEqual(self.request('/health')[1]['audio'], 'local')
        self.assertEqual(self.request('/status')[1]['audio'], 'local')
        self.request('/config', {'voice': 'other'})
        switched = self.request('/config', {'audio': 'ssh'})[1]
        self.assertEqual(switched['audio'], 'ssh')
        self.assertEqual(switched['voice'], 'other')
        for value in ('invalid', None, True, 3, [], {}):
            before = self.request('/health')[1]
            code, payload = self.request('/config', {'audio': value, 'volume': .5})
            self.assertEqual(code, 400)
            self.assertIn('error', payload)
            after = self.request('/health')[1]
            self.assertEqual(after['audio'], before['audio'])
            self.assertEqual(after['volume'], before['volume'])
        self.assertEqual(self.request('/config', {'audio': 'local'})[1]['audio'], 'local')

    def test_queue_cues_mix_and_prefix_promoted_audio(self):
        sinks = []

        class ManualSink:
            def __init__(self, rate, callback):
                self.callback = callback
                sinks.append(self)

            def read(self, frames):
                output = np.zeros((frames, 1), dtype=np.float32)
                self.callback(output, frames, None, None)
                return output[:, 0]

            def close(self):
                pass

        synthesized = []

        class ShortSynth:
            sample_rate = 24000

            def stream(self, text, voice, stop):
                synthesized.append((text, voice))
                yield np.full(24000, .1, dtype=np.float32)

        self.synth = ShortSynth()
        self.audio_factory = ManualSink
        self.ready()
        self.request('/speak', {'id': 'a', 'text': 'first'})
        self.wait(lambda: bool(sinks) and self.request('/status')[1]['state'] == 'playing')
        baseline = sinks[0].read(3600)
        self.assertTrue(np.all(baseline == baseline[0]))
        self.request('/speak', {'id': 'b', 'text': 'second', 'policy': 'wait'})
        self.request('/config', {'volume': .5})
        mixed = sinks[0].read(3600)
        with self.subTest(spec='S2 mixing'):
            self.assertGreater(float(np.ptp(mixed)), .001)
        self.assertGreater(float(mixed.min()), 0)
        self.assertLess(float(np.max(np.abs(mixed - baseline * .5))), .018)
        self.assertEqual(self.request('/status')[1]['id'], 'a')
        self.assertTrue(np.all(sinks[0].read(1000) == baseline[0] * .5))
        sinks[0].read(24000)
        self.wait(lambda: len(sinks) == 2 and self.request('/status')[1]['state'] == 'playing')
        prefix = sinks[-1].read(18000)
        with self.subTest(spec='S3 promotion pause'):
            self.assertTrue(np.all(prefix[:14400] == 0))
        self.assertGreater(float(np.ptp(prefix[14400:])), .001)
        np.testing.assert_allclose(prefix[14400:], mixed - baseline * .5, atol=1e-7)
        self.assertEqual(synthesized, [('first', 'lola'), ('Siguiente lectura. second', 'lola')])
        speech = sinks[-1].read(2400)
        self.assertTrue(np.all(speech == baseline[0] * .5))
        self.request('/speak', {'id': 'replacement', 'text': 'replacement', 'policy': 'stop'})
        self.wait(lambda: len(sinks) == 3 and self.request('/status')[1]['state'] == 'playing')
        self.assertTrue(np.all(sinks[-1].read(2400) == baseline[0] * .5))
        self.assertEqual(synthesized[-1], ('replacement', 'lola'))

    def test_promoted_reading_announces_before_normalized_text(self):
        self.ready()
        for lexicon, expected in ((True, 'páiton quince mil'),
                                  (False, 'Python quince mil')):
            with self.subTest(lexicon=lexicon):
                count = len(self.synth.calls)
                self.request('/speak', {'id': 'first', 'text': 'Python 15.000',
                                        'policy': 'wait', 'lexicon': lexicon})
                self.wait(lambda: len(self.synth.calls) == count + 1)
                self.assertEqual(self.synth.calls[-1][0], expected)
                self.request('/speak', {'id': 'queued', 'text': 'Python 15.000',
                                        'policy': 'wait', 'lexicon': lexicon})
                self.request('/stop', {'id': 'first'})
                self.wait(lambda: len(self.synth.calls) == count + 2)
                self.assertEqual(self.synth.calls[-1][0], 'Siguiente lectura. ' + expected)
                self.request('/speak', {'id': 'replacement', 'text': 'Python 15.000',
                                        'policy': 'stop', 'lexicon': lexicon})
                self.wait(lambda: len(self.synth.calls) == count + 3)
                self.assertEqual(self.synth.calls[-1][0], expected)
                self.request('/stop', {})

    def test_queue_promotions_are_reported_after_completion_and_bounded(self):
        self.assertNotIn('promoted', self.request('/status')[1])
        self.request('/speak', {'id': 'first', 'text': 'first'})
        for i in range(12):
            identifier = str(i)
            self.request('/speak', {'id': identifier, 'text': identifier, 'policy': 'wait'})
            current = 'first' if i == 0 else str(i - 1)
            self.request('/stop', {'id': current})
        self.request('/stop', {'id': '11'})
        status = self.request('/status')[1]
        self.assertEqual(status['state'], 'idle')
        self.assertNotIn('queue', status)
        self.assertEqual(status.get('promoted'), [str(i) for i in range(2, 12)])

    def test_accepted_replay_removes_old_promotion_under_either_policy(self):
        for policy in ('wait', 'stop'):
            with self.subTest(policy=policy):
                self.request('/speak', {'id': 'other', 'text': 'other'})
                self.request('/speak', {'id': 'a', 'text': 'first A', 'policy': 'wait'})
                self.request('/stop', {'id': 'other'})
                self.request('/stop', {'id': 'a'})
                self.assertIn('a', self.request('/status')[1]['promoted'])
                self.request('/speak', {'id': 'other', 'text': 'other'})
                code, result = self.request('/speak', {'id': 'a', 'text': 'replayed A', 'policy': policy})
                self.assertEqual(code, 202)
                status = self.request('/status')[1]
                self.assertNotIn('promoted', status)
                if policy == 'wait':
                    self.assertEqual(result['state'], 'queued')
                    self.assertEqual(status['queue'], ['a'])
                    self.request('/stop', {'id': 'other'})
                    self.assertEqual(self.request('/status')[1]['promoted'], ['a'])
                self.request('/stop', {})

    def test_cross_engine_queue_uses_current_voice(self):
        self.request('/speak', {'id': 'first', 'text': 'first'})
        for model, voice in [('phonon', 'Iker'), ('spanish', 'other')]:
            with self.subTest(model=model):
                count = len(self.synth.calls)
                self.request('/speak', {'id': 'next', 'text': 'next', 'policy': 'wait'})
                self.request('/config', {'model': model, 'voice': voice})
                self.ready()
                self.wait(lambda: len(self.synth.calls) > count)
                self.assertEqual(self.synth.calls[-1], ('Siguiente lectura. next', voice))

    def test_queue_uses_fallback_voice(self):
        original = self.server.service.factory

        def load(model):
            if model == 'phonon':
                self.loaded.wait(3)
                raise RuntimeError('unavailable')
            return original(model)

        self.server.service.factory = load
        self.request('/speak', {'id': 'first', 'text': 'first'})
        self.request('/config', {'model': 'phonon'})
        self.request('/speak', {'id': 'loading', 'text': 'loading'})
        self.request('/speak', {'id': 'next', 'text': 'next', 'policy': 'wait'})
        self.ready()
        self.wait(lambda: bool(self.synth.calls))
        self.request('/stop', {'id': 'loading'})
        self.wait(lambda: len(self.synth.calls) == 2)
        self.assertEqual(self.synth.calls[-1], ('Siguiente lectura. next', 'lola'))

    def test_same_model_retry_preserves_queue(self):
        attempts = []

        def load(model):
            attempts.append(model)
            self.loaded.wait(3)
            if len(attempts) == 1:
                raise RuntimeError('temporary load failure')
            return self.synth

        # The initial factory is already waiting; fail the next revision instead.
        self.ready()
        self.server.service.factory = load
        self.loaded.clear()
        self.request('/speak', {'id': 'first', 'text': 'first'})
        self.request('/speak', {'id': 'next', 'text': 'next', 'policy': 'wait'})
        self.request('/config', {'model': 'spanish_24l'})
        self.loaded.set()
        self.wait(lambda: self.request('/health')[1]['error'] is not None)
        self.assertEqual(self.request('/status')[1]['queue'], ['next'])
        self.request('/config', {'model': 'spanish_24l'})
        self.wait(lambda: self.request('/health')[1]['ready'])
        self.wait(lambda: any('next' in text for text, _ in self.synth.calls))
        self.assertEqual(attempts, ['spanish_24l', 'spanish_24l'])

    def test_buffer_backpressure_and_interruptions(self):
        sinks = []
        generated = []

        class ManualSink:
            def __init__(self, rate, callback):
                self.callback = callback
                sinks.append(self)

            def close(self):
                pass

        class FastSynth:
            sample_rate = 24000

            def stream(self, text, voice, stop):
                generated.append(text)
                for _ in range(100):
                    if stop.is_set():
                        return
                    generated.append('chunk')
                    yield np.full(24000, .1, dtype=np.float32)

        self.synth = FastSynth()
        self.audio_factory = ManualSink
        self.ready()
        for action in ('stop', 'replace', 'model', 'close'):
            with self.subTest(action=action):
                generated.clear()
                self.request('/speak', {'id': 'a', 'text': 'first'})
                self.wait(lambda: generated.count('chunk') >= 4)
                self.request('/pause', {'id': 'a'})
                time.sleep(.05)
                self.assertLessEqual(generated.count('chunk'), 4)
                count = generated.count('chunk')
                output = np.zeros((24000, 1), dtype=np.float32)
                sinks[-1].callback(output, 24000, None, None)
                self.assertFalse(output.any())
                self.request('/resume', {'id': 'a'})
                sinks[-1].callback(output, 24000, None, None)
                self.assertTrue(output.any())
                self.wait(lambda: generated.count('chunk') > count)
                if action == 'stop':
                    self.request('/stop', {})
                    self.request('/speak', {'id': 'b', 'text': 'second'})
                elif action == 'replace':
                    self.request('/speak', {'id': 'b', 'text': 'second'})
                elif action == 'model':
                    self.request('/speak', {'id': 'b', 'text': 'second', 'policy': 'wait'})
                    self.request('/config', {'model': 'spanish_24l'})
                else:
                    self.server.service.close()
                    self.assertFalse(self.server.service.worker.is_alive())
                    continue
                self.wait(lambda: any('second' in text for text in generated))
                self.request('/stop', {})

    def test_large_chunk_is_split_at_buffer_limit(self):
        sinks = []
        yielded = threading.Event()

        class ManualSink:
            def __init__(self, rate, callback):
                self.callback = callback
                sinks.append(self)

            def close(self):
                pass

        class LargeSynth:
            sample_rate = 24000

            def stream(self, text, voice, stop):
                yielded.set()
                yield np.full(240000, .1, dtype=np.float32)

        self.synth = LargeSynth()
        self.audio_factory = ManualSink
        self.ready()
        self.request('/speak', {'id': 'large', 'text': 'large'})
        self.wait(lambda: yielded.is_set() and self.request('/status')[1]['state'] == 'playing')
        self.request('/pause', {'id': 'large'})
        output = np.zeros((240000, 1), dtype=np.float32)
        sinks[-1].callback(output, len(output), None, None)
        self.assertFalse(output.any())
        self.request('/resume', {'id': 'large'})
        sinks[-1].callback(output, len(output), None, None)
        self.assertEqual(np.count_nonzero(output), 72000)
        self.assertTrue(np.all(output[:72000] > 0))
        self.request('/stop', {})
        self.assertEqual(self.request('/status')[1]['state'], 'idle')

    def test_model_reload_continues_the_queue(self):
        self.request('/speak', {'id': 'first', 'text': 'first'})
        self.request('/speak', {'id': 'next', 'text': 'next', 'policy': 'wait'})
        self.request('/speak', {'id': 'last', 'text': 'last', 'policy': 'wait'})
        self.assertEqual(self.request('/config', {'model': 'spanish_24l'})[0], 200)
        self.ready()
        self.wait(lambda: bool(self.synth.calls))
        self.assertEqual(self.synth.calls[0][0], 'Siguiente lectura. next')
        self.assertEqual(self.request('/status')[1]['id'], 'next')
        self.assertEqual(self.request('/status')[1]['queue'], ['last'])

    def test_wait_queue_loading_fifo_limit_and_scoped_stop(self):
        self.request('/speak', {'id': 'first', 'text': 'first'})
        for i in range(10):
            code, body = self.request('/speak', {'id': str(i), 'text': str(i), 'policy': 'wait'})
            self.assertEqual((code, body.get('state')), (202, 'queued'))
        self.assertEqual(self.request('/status')[1]['queue'], [str(i) for i in range(10)])
        self.assertEqual(self.request('/speak', {'id': 'overflow', 'text': 'overflow', 'policy': 'wait'})[0], 400)
        self.request('/stop', {'id': '3'})
        self.assertEqual(self.request('/status')[1]['id'], 'first')
        self.request('/stop', {'id': 'first'})
        self.assertEqual(self.request('/status')[1]['id'], '0')
        self.request('/speak', {'id': 'replacement', 'text': 'new'})
        self.assertEqual(self.request('/status')[1]['id'], 'replacement')
        self.assertEqual(self.request('/status')[1]['queue'], ['1', '2', '4', '5', '6', '7', '8', '9'])
        self.request('/stop', {})
        self.assertNotIn('queue', self.request('/status')[1])
        self.assertIsNone(self.request('/status')[1]['id'])

    def test_wait_queue_drains_after_playback_and_pause(self):
        class ShortSynth(Synth):
            def stream(self, text, voice, stop):
                self.calls.append((text, voice))
                for _ in range(10):
                    if stop.wait(.005):
                        return
                    yield np.ones(240, dtype=np.float32)

        self.synth = ShortSynth()
        self.ready()
        self.request('/speak', {'id': 'first', 'text': 'first'})
        self.wait(lambda: bool(self.synth.calls))
        self.request('/pause', {})
        self.assertEqual(self.request('/speak', {'id': 'second', 'text': 'second', 'policy': 'wait'})[0], 202)
        self.assertEqual(self.request('/status')[1]['id'], 'second')
        self.assertNotIn('queue', self.request('/status')[1])
        self.assertEqual(self.request('/status')[1]['promoted'], ['second'])
        self.wait(lambda: len(self.synth.calls) == 2)
        self.assertEqual(self.synth.calls[1][0], 'Siguiente lectura. second')
        self.wait(lambda: self.request('/status')[1]['state'] == 'idle')
        self.assertNotIn('queue', self.request('/status')[1])

    def test_wait_replaces_paused_reading_in_fifo_order_even_at_capacity(self):
        self.request('/speak', {'id': 'paused', 'text': 'paused'})
        for i in range(10):
            self.request('/speak', {'id': str(i), 'text': str(i), 'policy': 'wait'})
        self.request('/pause', {'id': 'paused'})
        code, result = self.request('/speak', {'id': 'new', 'text': 'new', 'policy': 'wait'})
        self.assertEqual(code, 202)
        self.assertEqual(result.get('state'), 'queued')
        status = self.request('/status')[1]
        self.assertEqual(status['id'], '0')
        self.assertEqual(status['queue'], [str(i) for i in range(1, 10)] + ['new'])
        self.assertEqual(status['promoted'], ['0'])
        self.ready()
        self.wait(lambda: bool(self.synth.calls))
        self.assertEqual(self.synth.calls[0][0], 'Siguiente lectura. cero')

    def test_wait_from_pause_uses_the_promotion_audio_cue(self):
        sinks = []

        class ManualSink:
            def __init__(self, rate, callback):
                self.callback = callback
                sinks.append(self)

            def close(self):
                pass

        self.audio_factory = ManualSink
        self.ready()
        self.request('/speak', {'id': 'paused', 'text': 'paused'})
        self.wait(lambda: bool(sinks) and self.request('/status')[1]['state'] == 'playing')
        self.request('/pause', {'id': 'paused'})
        self.request('/speak', {'id': 'new', 'text': 'new', 'policy': 'wait'})
        self.wait(lambda: len(sinks) == 2 and len(self.synth.calls) == 2
                  and self.request('/status')[1]['state'] == 'playing')
        output = np.zeros((18000, 1), dtype=np.float32)
        sinks[-1].callback(output, 18000, None, None)
        self.assertTrue(np.all(output[:14400] == 0))
        self.assertGreater(float(np.ptp(output[14400:])), .001)
        self.assertEqual(self.synth.calls[-1][0], 'Siguiente lectura. new')
        self.assertEqual(self.request('/status')[1]['id'], 'new')

    def test_pause_resume_are_scoped_and_validate_ids(self):
        self.request('/speak', {'id': 'a', 'text': 'first'})
        self.request('/speak', {'id': 'b', 'text': 'second', 'policy': 'wait'})
        for action in ('pause', 'resume'):
            self.assertEqual(self.request('/' + action, {'id': 42})[0], 400)
        self.request('/pause', {'id': 'b'})
        self.assertNotEqual(self.request('/status')[1]['state'], 'paused')
        self.request('/pause', {'id': 'a'})
        self.assertEqual(self.request('/status')[1]['state'], 'paused')
        self.request('/resume', {'id': 'foreign'})
        self.assertEqual(self.request('/status')[1]['state'], 'paused')
        self.request('/resume', {'id': 'a'})
        self.assertNotEqual(self.request('/status')[1]['state'], 'paused')
        self.assertEqual(self.request('/status')[1]['queue'], ['b'])
        self.request('/pause', {})
        self.assertEqual(self.request('/status')[1]['state'], 'paused')
        self.request('/resume', {})
        self.assertNotEqual(self.request('/status')[1]['state'], 'paused')

    def test_queue_waits_for_done_and_empty_buffer_then_recovers_from_failure(self):
        sinks = []

        class ManualSink:
            def __init__(self, rate, callback):
                self.callback = callback
                sinks.append(self)

            def drain(self):
                self.callback(np.zeros((4800, 1), dtype=np.float32), 4800, None, None)

            def close(self):
                pass

        class ShortSynth:
            sample_rate = 24000

            def __init__(self):
                self.calls = []
                self.finished = threading.Event()

            def stream(self, text, voice, stop):
                self.calls.append(text)
                if text == 'Siguiente lectura. broken':
                    raise RuntimeError('broken queued reading')
                yield np.ones(2400, dtype=np.float32)
                self.finished.set()

        synth = ShortSynth()
        self.synth = synth
        self.audio_factory = ManualSink
        self.ready()
        self.request('/speak', {'id': 'a', 'text': 'first'})
        self.assertTrue(synth.finished.wait(3))
        self.request('/speak', {'id': 'b', 'text': 'broken', 'policy': 'wait'})
        self.request('/speak', {'id': 'c', 'text': 'last', 'policy': 'wait'})
        self.assertEqual(synth.calls, ['first'])
        self.assertEqual(self.request('/status')[1]['queue'], ['b', 'c'])
        self.assertEqual(self.request('/status')[1]['id'], 'a')
        def drain_first():
            if self.request('/status')[1]['id'] == 'a':
                sinks[0].drain()
            return len(synth.calls) == 3

        self.wait(drain_first)
        self.assertEqual(synth.calls, ['first', 'Siguiente lectura. broken', 'Siguiente lectura. last'])
        self.assertEqual(self.request('/status')[1]['id'], 'c')
        self.assertNotIn('queue', self.request('/status')[1])
        self.wait(lambda: (sinks[-1].drain(), self.request('/status')[1]['state'] == 'idle')[1])
        self.assertEqual(self.request('/status')[1]['promoted'], ['b', 'c'])
        self.assertEqual(self.request('/speak', {'id': 'bad', 'text': 'text', 'policy': 'pause'})[0], 400)
        self.assertEqual(self.request('/stop', {'id': 42})[0], 400)

    def test_fallback_pending_retry_and_no_pocket_fallback(self):
        entered, release = threading.Event(), threading.Event()
        calls = []

        def load(name):
            calls.append(name)
            if name == 'phonon' and calls.count('phonon') == 1:
                entered.set()
                release.wait(3)
                raise OSError('no access\ntry login')
            if name == 'spanish_24l':
                raise RuntimeError('broken 24l')
            return self.synth

        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            server = create_server(port=0, model='phonon', synthesizer_factory=load, audio_factory=Sink, catalog=['lola'])
            service = server.service
            try:
                self.assertTrue(entered.wait(3))
                service.speak({'id': 'pending', 'text': 'hola'})
                release.set()
                self.wait(lambda: bool(self.synth.calls))
                self.assertEqual(self.synth.calls[0], ('hola', 'lola'))
                self.assertEqual((service.health()['model'], service.health()['voice']), ('spanish', 'lola'))
                self.assertEqual(output.getvalue(),
                                 'Phonon unavailable (no access try login); using spanish with lola\n')
                service.configure({'model': 'phonon'})
                self.wait(lambda: service.health()['ready'])
                self.assertEqual(calls, ['phonon', 'spanish', 'phonon'])
                self.assertEqual(service.health()['voice'], 'Regina')
                service.configure({'model': 'spanish_24l'})
                self.wait(lambda: service.health()['error'] is not None)
                health = service.health()
                self.assertEqual((health['ready'], health['model'], health['error']),
                                 (False, 'spanish_24l', 'model load failed: broken 24l'))
                self.assertEqual(calls, ['phonon', 'spanish', 'phonon', 'spanish_24l'])
            finally:
                release.set()
                server.server_close()

    def test_superseded_or_closed_phonon_failure_does_not_fallback(self):
        for action in ('revision', 'close'):
            with self.subTest(action=action):
                entered, release = threading.Event(), threading.Event()
                calls = []

                def load(name):
                    calls.append(name)
                    if name == 'phonon':
                        entered.set()
                        release.wait(3)
                        raise OSError('denied')
                    return self.synth

                output = io.StringIO()
                with contextlib.redirect_stderr(output):
                    server = create_server(port=0, model='phonon', synthesizer_factory=load, audio_factory=Sink, catalog=['lola'])
                    service = server.service
                    try:
                        self.assertTrue(entered.wait(3))
                        if action == 'revision':
                            service.configure({'model': 'spanish_24l'})
                        else:
                            with service.condition:
                                service.closed = True
                                service.condition.notify_all()
                        release.set()
                        if action == 'revision':
                            self.wait(lambda: service.health()['ready'])
                            self.assertEqual(service.health()['model'], 'spanish_24l')
                            self.assertEqual(calls, ['phonon', 'spanish_24l'])
                        else:
                            service.worker.join(3)
                            self.assertFalse(service.worker.is_alive())
                            self.assertEqual(calls, ['phonon'])
                            self.assertFalse(service.health()['ready'])
                        self.assertNotIn('Phonon unavailable', output.getvalue())
                    finally:
                        release.set()
                        server.server_close()

    def test_combined_config_validates_target_model(self):
        self.ready()
        for model, voice in (('phonon', 'Iker'), ('spanish', 'other'), ('spanish_24l', 'lola')):
            self.assertEqual(self.request('/config', {'model': model, 'voice': voice})[0], 200)
            self.wait(lambda: self.request('/health')[1]['ready'])
            self.assertEqual(self.request('/health')[1]['voice'], voice)
        for model, voice, message in (('phonon', 'lola', 'voice must be a Phonon Spanish voice name'),
                                      ('spanish', 'Regina', 'voice must be a catalog name or a file in voices/')):
            before = self.request('/health')
            self.assertEqual(self.request('/config', {'model': model, 'voice': voice}), (400, {'error': message}))
            self.assertEqual(self.request('/health'), before)

    def test_start_voice_comes_from_the_shared_table(self):
        table = json.loads((Path(__file__).resolve().parents[1] / 'src' / 'voice_table.json').read_text(encoding='utf-8'))
        defaults = [v for v in table if v.get('default')]
        self.assertEqual(len(defaults), 1)
        self.assertEqual((tehablo_server.START_MODEL, tehablo_server.START_VOICE), (defaults[0]['model'], defaults[0]['name']))

    def test_pocket_lola_default(self):
        server = create_server(port=0, synthesizer_factory=lambda name: self.synth,
                               audio_factory=Sink, catalog=['lola'])
        try:
            self.assertEqual(server.service.health()['model'], 'spanish')
            self.assertEqual(server.service.health()['voice'], 'lola')
            self.assertIsNone(server.service.health()['fallback'])
        finally:
            server.server_close()

    def test_phonon_fallback(self):
        for error in (ImportError('missing'), OSError('gated'), RuntimeError('broken')):
            with self.subTest(error=error):
                calls = []
                def load(name):
                    calls.append(name)
                    if name == 'phonon':
                        raise error
                    return self.synth
                output = io.StringIO()
                with contextlib.redirect_stderr(output):
                    server = create_server(port=0, model='phonon', synthesizer_factory=load,
                                           audio_factory=Sink, catalog=['lola'])
                    try:
                        self.wait(lambda: server.service.health()['ready'])
                        health = server.service.health()
                        self.assertEqual((health['model'], health['voice'], health['error']),
                                         ('spanish', 'lola', None))
                        # Pi warns with the voice that failed; a later model change clears it.
                        self.assertEqual(health['fallback'], 'Regina')
                        self.assertEqual(calls, ['phonon', 'spanish'])
                        server.service.configure({'model': 'spanish', 'voice': 'lola'})
                        self.assertIsNone(server.service.health()['fallback'])
                        self.assertEqual(output.getvalue(),
                                         f'Phonon unavailable ({error}); using spanish with lola\n')
                    finally:
                        server.server_close()

    def test_cached_phonon_loads_offline_without_token(self):
        # The repository is gated: online, Hugging Face refuses even a cached model without a token.
        seen = []
        class TTS:
            def __init__(self, *args, **kwargs):
                seen.append(os.environ.get('HF_HUB_OFFLINE'))
        fake = type(sys)('ptts')
        fake.TTS, fake.set_num_threads = TTS, lambda n: None
        for token, is_cached, expected in (('', True, '1'), ('', False, None), ('hf_x', True, None)):
            with self.subTest(token=token, cached=is_cached):
                seen.clear()
                with mock.patch.dict(sys.modules, {'ptts': fake}), \
                        mock.patch.dict(os.environ, {'HF_TOKEN': token}), \
                        mock.patch.object(tehablo_server, 'cached', lambda *a: is_cached), \
                        contextlib.redirect_stdout(io.StringIO()):
                    os.environ.pop('HF_HUB_OFFLINE', None)
                    tehablo_server.PhononSynthesizer()
                    self.assertEqual(seen, [expected])
                    self.assertNotIn('HF_HUB_OFFLINE', os.environ)
        # A value set by the user is kept as is, during and after the load.
        with self.subTest(preset='0'):
            seen.clear()
            with mock.patch.dict(sys.modules, {'ptts': fake}), \
                    mock.patch.dict(os.environ, {'HF_TOKEN': '', 'HF_HUB_OFFLINE': '0'}), \
                    mock.patch.object(tehablo_server, 'cached', lambda *a: True), \
                    contextlib.redirect_stdout(io.StringIO()):
                tehablo_server.PhononSynthesizer()
                self.assertEqual(seen, ['0'])
                self.assertEqual(os.environ.get('HF_HUB_OFFLINE'), '0')
        # A failed offline load still removes the variable it set.
        class Broken:
            def __init__(self, *args, **kwargs):
                seen.append(os.environ.get('HF_HUB_OFFLINE'))
                raise RuntimeError('cache corrupt')
        broken = type(sys)('ptts')
        broken.TTS, broken.set_num_threads = Broken, lambda n: None
        with self.subTest(failure=True):
            seen.clear()
            with mock.patch.dict(sys.modules, {'ptts': broken}), \
                    mock.patch.dict(os.environ, {'HF_TOKEN': ''}), \
                    mock.patch.object(tehablo_server, 'cached', lambda *a: True), \
                    contextlib.redirect_stdout(io.StringIO()):
                os.environ.pop('HF_HUB_OFFLINE', None)
                with self.assertRaisesRegex(RuntimeError, 'cache corrupt'):
                    tehablo_server.PhononSynthesizer()
                self.assertEqual(seen, ['1'])
                self.assertNotIn('HF_HUB_OFFLINE', os.environ)

    def test_voice_table_kinds_and_cache_state(self):
        seen = []

        def cached(name, model, kind):
            seen.append((name, model, kind))
            return name in {'lola', 'Regina'}

        self.server.service.cached = cached
        status, data = self.request('/voices')
        self.assertEqual(status, 200)
        self.assertIn('voices', data)
        table = {v['name']: v for v in data['catalog']}
        self.assertEqual(table['lola'], {'name': 'lola', 'voice': 'lola', 'model': 'spanish', 'kind': 'download',
                                         'note': 'la de siempre', 'downloaded': True})
        self.assertEqual(table['rafael']['downloaded'], False)
        self.assertEqual((table['Regina']['model'], table['Regina']['kind'], table['Regina']['downloaded']),
                         ('phonon', 'account', True))
        self.assertEqual((table['Iker']['kind'], table['Iker']['downloaded']), ('account', False))
        self.assertEqual((table['Facundo']['model'], table['Facundo']['kind'], table['Facundo']['voice']),
                         ('spanish', 'download', 'Facundo.safetensors'))
        self.assertNotIn('ar-hombre-4310', table)
        self.assertEqual(len(seen), len(data['catalog']))
        for entry in data['catalog']:
            self.assertEqual(set(entry), {'name', 'voice', 'model', 'kind', 'note', 'downloaded'})

    def test_included_voice_is_cached_with_either_spanish_weights(self):
        from unittest import mock
        from huggingface_hub import constants
        with tempfile.TemporaryDirectory() as tmp:
            voices, hub = Path(tmp) / 'voices', Path(tmp) / 'hub'
            voices.mkdir()
            (voices / 'Facundo.wav').write_bytes(b'')
            with mock.patch.object(tehablo_server, 'VOICES_DIR', voices), mock.patch.object(constants, 'HF_HUB_CACHE', str(hub)):
                cached = tehablo_server.cached
                weights = hub / 'models--kyutai--pocket-tts-without-voice-cloning' / 'snapshots' / 'abc' / 'languages' / 'spanish'
                weights.mkdir(parents=True)
                (weights / 'model.safetensors').write_bytes(b'')
                self.assertFalse(cached('Facundo', 'spanish', 'download'))
                (voices / 'Facundo.safetensors').write_bytes(b'')
                self.assertTrue(cached('Facundo', 'spanish', 'download'))
                (weights / 'model.safetensors').unlink()
                self.assertFalse(cached('Facundo', 'spanish', 'download'))
                full = hub / 'models--kyutai--pocket-tts' / 'snapshots' / 'abc' / 'languages' / 'spanish'
                full.mkdir(parents=True)
                (full / 'model.safetensors').write_bytes(b'')
                self.assertTrue(cached('Facundo', 'spanish', 'download'))

    def test_voice_table_survives_cache_errors(self):
        def broken(name, model, kind):
            raise OSError('cache unreadable')

        self.server.service.cached = broken
        status, data = self.request('/voices')
        self.assertEqual(status, 200)
        self.assertTrue(data['catalog'])
        self.assertTrue(all(v['downloaded'] is False for v in data['catalog']))

    def test_model_voices_and_defaults(self):
        self.ready()
        for model, voice, invalid in [('phonon', 'Regina', 'lola'),
                                       ('spanish', 'lola', 'Regina'),
                                       ('spanish_24l', 'lola', 'Regina')]:
            self.assertEqual(self.request('/config', {'model': model})[0], 200)
            self.wait(lambda: self.request('/health')[1]['ready'])
            before = self.request('/health')
            self.assertEqual(before[1]['voice'], voice)
            self.assertIn(voice, self.request('/voices')[1]['voices'])
            self.assertEqual(self.request('/config', {'voice': voice})[0], 200)
            self.assertEqual(self.request('/config', {'voice': invalid})[0], 400)
            self.assertEqual(self.request('/health'), before)
            self.assertEqual(self.synth.calls, [])

    def test_speech_failures_are_visible_and_clearable(self):
        self.ready()
        original = self.synth.stream
        for kind in ('stream', 'sink'):
            with self.subTest(kind=kind):
                def fail(*args):
                    raise RuntimeError('broken playback')
                self.synth.stream = fail if kind == 'stream' else original
                self.server.service.audio_factory = fail if kind == 'sink' else Sink
                # Close any previous sink by reloading the model.
                model = 'spanish_24l' if kind == 'sink' else 'spanish'
                self.request('/config', {'model': model})
                self.wait(lambda: self.request('/health')[1]['ready'])
                self.assertEqual(self.request('/speak', {'id': kind, 'text': 'hola'})[0], 202)
                self.wait(lambda: self.request('/status')[1]['state'] == 'idle')
                self.assertEqual(self.request('/status'), (200, {
                    'state': 'idle', 'id': None, 'audio': 'local', 'error': 'speech failed: broken playback'}))
                self.assertIsNone(self.request('/health')[1]['error'])
                self.assertEqual(self.request('/stop', {}), (200, {'state': 'idle'}))
                self.assertEqual(self.request('/status')[1], {'state': 'idle', 'id': None, 'audio': 'local', 'error': None})
        self.server.service.audio_factory = Sink
        self.synth.stream = fail
        self.request('/speak', {'id': 'fail', 'text': 'hola'})
        self.wait(lambda: self.request('/status')[1]['error'] is not None)
        self.synth.stream = original
        self.assertEqual(self.request('/speak', {'id': 'ok', 'text': 'hola'}), (202, {'id': 'ok'}))
        self.assertIsNone(self.request('/status')[1]['error'])
        self.wait(lambda: bool(self.synth.calls))

    def test_each_reading_opens_a_fresh_output(self):
        # A new output per reading follows a changed default device (RH-W-0017).
        sinks = []

        def factory(rate, callback):
            sinks.append(Sink(rate, callback))
            return sinks[-1]

        self.server.service.audio_factory = factory
        self.ready()
        for count, identifier in ((1, 'one'), (2, 'two')):
            self.assertEqual(self.request('/speak', {'id': identifier, 'text': 'hola'}), (202, {'id': identifier}))
            self.wait(lambda: len(self.synth.calls) == count)
        self.assertEqual(len(sinks), 2)
        self.assertTrue(sinks[0].closed.is_set())
        self.assertFalse(sinks[1].closed.is_set())

    def test_lexicon_error_logged_once_per_change(self):
        from tehablo_lexicon import Lexicon
        self.ready()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'pronunciaciones.json'
            path.write_text('{', encoding='utf-8')
            self.server.service.lexicon = Lexicon(path)
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                for identifier in ('one', 'two'):
                    self.request('/speak', {'id': identifier, 'text': 'hola'})
                    self.wait(lambda: len(self.synth.calls) == (1 if identifier == 'one' else 2))
            message = self.server.service.lexicon.error
            self.assertTrue(message)
            self.assertEqual(output.getvalue(), f'Pronunciation dictionary error: {message}\n')

    def test_origin_rejections(self):
        self.ready()
        before = self.request('/health')
        status = self.request('/status')
        for path, body in [('/health', None), ('/missing', None),
                           ('/speak', {'id': 'bad', 'text': 'hola'}),
                           ('/shutdown', {}), ('/config', {'speed': 1.25})]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path, body, headers={'Origin': '', 'Content-Type': 'text/plain'}),
                                 (403, {'error': 'cross-origin requests are not allowed'}))
                self.assertEqual(self.request('/health'), before)
                self.assertEqual(self.request('/status'), status)
                self.assertEqual(self.synth.calls, [])

    def test_content_type_rejections_and_json_variants(self):
        self.ready()
        before = self.request('/health')
        status = self.request('/status')
        for headers in ({}, {'Content-Type': 'text/plain'}):
            for path, body in [('/speak', {'id': 'bad', 'text': 'hola'}),
                               ('/shutdown', {}), ('/config', {'speed': 1.25})]:
                with self.subTest(headers=headers, path=path):
                    self.assertEqual(self.request(path, body, headers=headers),
                                     (415, {'error': 'Content-Type must be application/json'}))
                    self.assertEqual(self.request('/health'), before)
                    self.assertEqual(self.request('/status'), status)
                    self.assertEqual(self.synth.calls, [])
        self.assertEqual(self.request('/missing', {}, headers={}), (404, {'error': 'unknown path'}))
        for media in ('application/json; charset=utf-8', 'Application/JSON', ' application/json '):
            self.assertEqual(self.request('/config', {'speed': 1.25}, headers={'Content-Type': media})[0], 200)
        self.assertEqual(self.request('/speak', {'id': 'normal', 'text': 'hola'}), (202, {'id': 'normal'}))
        self.wait(lambda: bool(self.synth.calls))

    def test_model_load_failure_and_config_retry(self):
        retry = threading.Event()
        self.addCleanup(retry.set)

        def load(model):
            if model == 'spanish':
                raise RuntimeError('broken model')
            retry.wait(3)
            return self.synth

        self.server.service.factory = load
        self.loaded.set()
        # The initial factory may already be running; force a fresh revision.
        self.request('/config', {'model': 'spanish_24l'})
        retry.set()
        self.wait(lambda: self.request('/health')[1]['ready'])
        retry.clear()
        self.request('/config', {'model': 'spanish'})
        self.wait(lambda: self.request('/status')[1]['state'] != 'loading')
        message = 'model load failed: broken model'
        health = self.request('/health')
        self.assertEqual(health[0], 200)
        self.assertFalse(health[1]['ready'])
        self.assertEqual(health[1]['error'], message)
        self.assertEqual(self.request('/status'), (200, {'state': 'error', 'id': None, 'audio': 'local', 'error': message}))
        self.assertEqual(self.request('/speak', {'id': 'bad', 'text': 'hola'}), (503, {'error': message}))
        self.assertEqual(self.request('/health'), health)
        self.assertEqual(self.synth.calls, [])
        result = self.request('/config', {'model': 'spanish_24l'})
        self.assertEqual(result[0], 200)
        self.assertIsNone(result[1]['error'])
        self.assertFalse(result[1]['ready'])
        self.assertEqual(self.request('/status')[1], {'state': 'loading', 'id': None, 'audio': 'local', 'error': None})
        retry.set()
        self.wait(lambda: self.request('/health')[1]['ready'])
        self.assertIsNone(self.request('/health')[1]['error'])
        self.assertEqual(self.request('/speak', {'id': 'retry', 'text': 'hola'}), (202, {'id': 'retry'}))
        self.wait(lambda: bool(self.synth.calls))

    def test_request_lexicon_control(self):
        before = self.request('/status')
        for value in (None, 0, 1, 'false', [], {}):
            self.assertEqual(self.request('/speak', {'id': 'bad', 'text': 'hola', 'lexicon': value}),
                             (400, {'error': 'lexicon must be a boolean'}))
            self.assertEqual(self.request('/status'), before)
        self.ready()
        for count, value in enumerate((False, True), 1):
            self.request('/speak', {'id': str(count), 'text': 'Python 15.000 README.md', 'lexicon': value})
            self.wait(lambda: len(self.synth.calls) == count)
            self.assertEqual(self.synth.calls[-1][0],
                             'páiton quince mil rídmi punto eme de' if value else 'Python quince mil README punto eme de')
        self.assertEqual(self.request('/config', {'lexicon': False})[0], 400)

    def test_speak_defaults_to_lexicon(self):
        self.ready()
        self.request('/speak', {'id': 'default', 'text': 'Python 15.000'})
        self.wait(lambda: bool(self.synth.calls))
        self.assertEqual(self.synth.calls[0][0], 'páiton quince mil')

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

    def test_long_id_speak_pipeline(self):
        self.ready()
        self.assertEqual(self.request('/speak', {
            'id': 'long-id',
            'text': '#12340007; 10000000 kg; resultado=10000000; commit 3862ef7.'
        })[0], 202)
        self.wait(lambda: bool(self.synth.calls))
        self.assertEqual(self.synth.calls[0][0],
                         'terminación en cero cero cero siete; diez millones kilogramos; '
                         'resultado igual a diez millones; comít .')

    def test_pipeline_samples_and_model_guard(self):
        samples = [
            ('https://github.com/LCubero/tehablo.', 'enlace a guítjab punto com.'),
            ('www.example.org/a', 'enlace a example punto org'),
            ('src/tehablo_server.py', 'tehablo sérver punto pai'),
            ('docs/repo-harness/roadmap.md', 'róudmap punto eme de'),
            ('.pi/settings.json', 'settings punto yéison'),
            (r'E:\code\x', 'equis'),
            ('README.md', 'rídmi punto eme de'),
            ('RH-W-0001', 'erre hache, doble ve, cero cero cero uno'),
            ('ABC-12', 'a be ce, doce'),
            ('T1 y S3', 'te, uno y ese, tres'),
            ('abc1234', ''),
            ('feat/pi-tts', 'fit eslash pai ti ti es'),
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
                self.assertEqual(self.server.service.normalize_text(source, 'phonon'), expected)
                self.assertEqual(self.server.service.normalize_text(source, 'english'), source)
                print('PIPELINE ' + json.dumps([source, got], ensure_ascii=True))

    def test_volume_validation_and_live_gain(self):
        before = self.request('/health')[1]
        self.assertEqual(before['volume'], 1.0)
        for value in (0, 1.6, True, '1', float('nan'), float('inf')):
            self.assertEqual(self.request('/config', {'volume': value}),
                             (400, {'error': 'volume must be between 0.1 and 1.5'}))
            self.assertEqual(self.request('/health')[1], before)
        service = self.server.service
        # The loading worker cannot consume these samples: gain is output-time only.
        with service.condition:
            service.buffer.append(np.array([.8, -.8, .4, -.4], dtype=np.float32))
        self.assertEqual(self.request('/config', {'volume': 1.5})[1]['volume'], 1.5)
        output = np.zeros((2, 1), dtype=np.float32)
        service.callback(output, 2, None, None)
        # Loud peaks are rounded by the soft limiter, never past full scale.
        self.assertTrue(np.all(np.abs(output[:, 0]) <= 1) and output[0, 0] > .99 and output[1, 0] < -.99)
        self.request('/config', {'volume': .1})
        service.callback(output, 2, None, None)
        # Every level includes the fixed 1.8x base gain (the voices come out at about -24 dBFS).
        np.testing.assert_allclose(output[:, 0], [.072, -.072], rtol=1e-6)
        with service.condition:
            service.buffer.append(np.array([.25, -.25], dtype=np.float32))
        self.request('/config', {'volume': 1.0})
        service.callback(output, 2, None, None)
        np.testing.assert_allclose(output[:, 0], [.45, -.45], rtol=1e-6)

    def test_soft_limit_keeps_normal_samples_and_rounds_peaks(self):
        x = np.array([0, .5, -.8, .9, -1.2, 3], dtype=np.float32)
        y = tehablo_server.soft_limit(x)
        np.testing.assert_allclose(y[:3], [0, .5, -.8])
        self.assertTrue(.8 < y[3] < .9 and -1 < y[4] < -.9 and .99 < y[5] <= 1)
        self.assertTrue(np.all(np.diff(tehablo_server.soft_limit(np.linspace(0, 4, 50))) >= 0))

    def test_voice_gain_comes_from_the_table(self):
        gain = tehablo_server.voice_gain
        self.assertAlmostEqual(gain('Javiera.safetensors'), 10 ** (3 / 20))
        self.assertAlmostEqual(gain(str(tehablo_server.VOICES_DIR / 'Javiera.safetensors')), 10 ** (3 / 20))
        self.assertAlmostEqual(gain('Iker'), 10 ** (-1 / 20))
        self.assertEqual((gain('lola'), gain('Regina'), gain('mi-voz.wav')), (1.0, 1.0, 1.0))

    def test_speed_changes_between_generated_chunks(self):
        from unittest.mock import patch
        events = []

        class Stretch:
            def __init__(self, speed):
                self.speed = speed
                events.append(('new', speed))

            def process(self, chunk):
                events.append(('process', self.speed))
                return chunk

            def flush(self):
                events.append(('flush', self.speed))
                return np.zeros(0, dtype=np.float32)

        def stream(text, voice, stop):
            yield np.array([.2], dtype=np.float32)
            self.request('/config', {'speed': 1.25})
            yield np.array([.3], dtype=np.float32)

        self.synth.stream = stream
        with patch('tehablo_server.SpeedStream', Stretch):
            self.ready()
            self.request('/speak', {'id': 'speed', 'text': 'hola'})
            # Queue completion consumes the internal done flag; idle remains observable.
            self.wait(lambda: self.request('/status')[1]['state'] == 'idle')
        self.assertEqual(events, [('new', 1.0), ('process', 1.0), ('flush', 1.0),
                                  ('new', 1.25), ('process', 1.25), ('flush', 1.25)])

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
        np.testing.assert_array_equal(output[:, 0], tehablo_server.soft_limit(np.arange(100) * tehablo_server.BASE_GAIN))
        self.request('/pause', {})
        callbacks[0](output, 100, None, None)
        np.testing.assert_array_equal(output, 0)
        self.request('/resume', {})
        callbacks[0](output, 100, None, None)
        np.testing.assert_array_equal(output[:, 0], np.ones(100))
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

    def test_busy_port_reports_address_in_use(self):
        # A failed bind closes the server before create_server attaches the service.
        with self.assertRaises(OSError):
            create_server(port=self.server.server_address[1], synthesizer_factory=lambda model: self.synth,
                          audio_factory=Sink, catalog=['lola'])

    def test_stop_preserves_failed_model_status(self):
        self.ready()

        def fail(model):
            raise RuntimeError('broken model')

        self.server.service.factory = fail
        self.request('/config', {'model': 'spanish_24l'})
        self.wait(lambda: bool(self.request('/health')[1]['error']))
        self.assertEqual(self.request('/stop', {}), (200, {'state': 'error'}))
        self.assertEqual(self.request('/status'),
                         (200, {'state': 'error', 'id': None, 'audio': 'local', 'error': 'model load failed: broken model'}))

    def test_rejected_body_closes_connection(self):
        self.ready()
        before = self.request('/health')
        body = (b'POST /shutdown HTTP/1.1\r\nHost: localhost\r\n'
                b'Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{}')
        with socket.create_connection(self.server.server_address, timeout=3) as conn:
            conn.sendall(b'POST /speak HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n'
                         b'Content-Type: text/plain\r\nContent-Length: ' + str(len(body)).encode()
                         + b'\r\n\r\n' + body)
            chunks = []
            while True:
                try:
                    chunk = conn.recv(4096)
                except ConnectionResetError:
                    break
                if not chunk:
                    break
                chunks.append(chunk)
        response = b''.join(chunks)
        self.assertTrue(response.startswith(b'HTTP/1.0 415 '))
        self.assertEqual(response.count(b'HTTP/1.0 '), 1)
        self.assertEqual(json.loads(response.split(b'\r\n\r\n', 1)[1]),
                         {'error': 'Content-Type must be application/json'})
        self.assertEqual(self.request('/health'), before)

    def test_shutdown(self):
        self.assertEqual(self.request('/shutdown', {})[1], {'ok': True})
        self.thread.join(3)
        self.assertFalse(self.thread.is_alive())


if __name__ == '__main__':
    unittest.main()
