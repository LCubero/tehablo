"""Silent decision and multiprocess tests for the herdr voice plugin."""
import importlib.util
import http.client
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.response
from pathlib import Path
from unittest import mock

PLUGIN = Path(__file__).resolve().parents[1] / 'herdr-plugin'
SPEC = importlib.util.spec_from_file_location('herdr_notify', PLUGIN / 'notify.py')
notify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notify)


class StripPrefixTest(unittest.TestCase):
    def test_drops_the_agent_tag(self):
        self.assertEqual(notify.strip_prefix('OC | PRs para issues 8 y 9'), 'PRs para issues 8 y 9')
        self.assertEqual(notify.strip_prefix('PI | Arreglo de audio'), 'Arreglo de audio')
        self.assertEqual(notify.strip_prefix('OC|sin espacios'), 'sin espacios')

    def test_drops_the_pi_title_prefix(self):
        # Pi titles its terminal "\u03c0 - folder".
        self.assertEqual(notify.strip_prefix('\u03c0 - code'), 'code')
        self.assertEqual(notify.strip_prefix('OC | \u03c0 - notas'), '\u03c0 - notas')
        self.assertEqual(notify.compose([{'status': 'done', 'project': 'code',
                                          'label': notify.label_of({'terminal_title': '\u03c0 - code'})}]),
                         'code: termin\u00f3.')

    def test_keeps_titles_without_a_tag(self):
        self.assertEqual(notify.strip_prefix('tehablo'), 'tehablo')
        self.assertEqual(notify.strip_prefix('A | B | C'), 'B | C')

    def test_rejects_empty_input(self):
        self.assertIsNone(notify.strip_prefix('   '))
        self.assertIsNone(notify.strip_prefix(None))


class CleanTest(unittest.TestCase):
    def test_collapses_whitespace_and_separators(self):
        self.assertEqual(notify.clean('  hola   mundo  '), 'hola mundo')
        self.assertEqual(notify.clean('OC | a'), 'OC a')
        self.assertEqual(notify.clean('linea\nnueva'), 'linea nueva')

    def test_truncates_at_a_word_boundary(self):
        self.assertEqual(notify.clean('a' * 100), 'a' * 48)
        shortened = notify.clean('uno dos tres ' * 10)
        self.assertLessEqual(len(shortened), 48)
        self.assertTrue(shortened.endswith('dos'))

    def test_rejects_noise_only(self):
        self.assertIsNone(notify.clean('#@$'))
        self.assertIsNone(notify.clean('   '))
        self.assertIsNone(notify.clean(None))


class LabelTest(unittest.TestCase):
    def test_prefers_the_terminal_title(self):
        agent = {'name': 'Mi agente', 'terminal_title_stripped': 'OC | X'}
        self.assertEqual(notify.label_of(agent), 'X')

    def test_uses_the_agent_name_without_a_title(self):
        self.assertEqual(notify.label_of({'name': 'Mi agente'}), 'Mi agente')

    def test_uses_the_title_without_the_agent_tag(self):
        self.assertEqual(notify.label_of({'terminal_title_stripped': 'OC | PRs para issues 8 y 9'}),
                         'PRs para issues 8 y 9')
        self.assertEqual(notify.label_of({'terminal_title': 'OC | Sin stripped'}), 'Sin stripped')

    def test_falls_back_to_the_agent_kind(self):
        self.assertEqual(notify.label_of({'display_agent': 'OpenCode', 'pane_id': 'w25:p6'}), 'OpenCode p6')
        self.assertEqual(notify.label_of({'agent': 'opencode', 'pane_id': 'w25:p6'}), 'opencode p6')
        self.assertEqual(notify.label_of({'agent': 'opencode'}), 'opencode')
        self.assertEqual(notify.label_of({}), 'agente')


class ProjectTest(unittest.TestCase):
    def test_prefers_the_sidebar_label(self):
        self.assertEqual(notify.project_of({'cwd': 'D:\\DocumentosDiscoD\\tehablo'}, 'tehablo'), 'tehablo')

    def test_falls_back_to_the_directory_name(self):
        self.assertEqual(notify.project_of({'cwd': 'D:\\DocumentosDiscoD\\tehablo'}), 'tehablo')
        self.assertEqual(notify.project_of({'cwd': '/home/x/proj/'}), 'proj')
        self.assertEqual(notify.project_of({}), 'proyecto')


class AnnounceableTest(unittest.TestCase):
    def test_speaks_only_done_and_blocked(self):
        self.assertEqual(notify.announceable({'agent_status': 'done'}), 'done')
        self.assertEqual(notify.announceable({'agent_status': 'blocked'}), 'blocked')
        for status in ('working', 'idle', 'unknown'):
            self.assertIsNone(notify.announceable({'agent_status': status}))
        self.assertIsNone(notify.announceable(None))

    def test_skips_the_focused_pane_by_default(self):
        agent = {'agent_status': 'done', 'focused': True}
        self.assertIsNone(notify.announceable(agent))
        self.assertEqual(notify.announceable(agent, skip_focused=False), 'done')


class DuplicateTest(unittest.TestCase):
    def test_ignores_an_already_spoken_completion(self):
        state = {'seen': {'w1:p1': 5}}
        self.assertTrue(notify.is_duplicate(state, 'w1:p1', 'done', 5))
        self.assertFalse(notify.is_duplicate(state, 'w1:p1', 'done', 6))
        self.assertFalse(notify.is_duplicate(state, 'w1:p1', 'blocked', 5))
        self.assertFalse(notify.is_duplicate(state, 'w1:p1', 'done', None))
        self.assertFalse(notify.is_duplicate({}, 'w1:p1', 'done', 5))

    def test_marks_only_completed_work(self):
        state = {}
        notify.mark_seen(state, 'w1:p1', 'done', 7)
        notify.mark_seen(state, 'w1:p2', 'blocked', 8)
        self.assertEqual(state['seen'], {'w1:p1': 7})


class ParseEventTest(unittest.TestCase):
    def test_reads_the_observed_herdr_payload(self):
        # Captured from herdr 0.9.5 on 2026-11-17; the inner event name is
        # snake_case while the manifest hook uses pane.agent_status_changed.
        raw = json.dumps({'event': 'pane_agent_status_changed',
                          'data': {'type': 'pane_agent_status_changed', 'pane_id': 'w25:p6',
                                   'workspace_id': 'w25', 'agent_status': 'done',
                                   'agent': 'opencode'}})
        self.assertEqual(notify.parse_event(raw), {'pane_id': 'w25:p6', 'agent_status': 'done'})

    def test_reads_the_pane_from_the_envelope(self):
        raw = json.dumps({'type': 'pane.agent_status_changed',
                          'data': {'type': 'pane.agent_status_changed', 'pane_id': 'w1:p1',
                                   'agent_status': 'done'}})
        self.assertEqual(notify.parse_event(raw), {'pane_id': 'w1:p1', 'agent_status': 'done'})

    def test_reads_a_flat_payload(self):
        self.assertEqual(notify.parse_event(json.dumps({'pane_id': 'w1:p1'})),
                         {'pane_id': 'w1:p1', 'agent_status': None})

    def test_rejects_anything_else(self):
        for raw in (None, '', 'not json', '[]', '{}', json.dumps({'data': {'pane_id': ''}})):
            self.assertEqual(notify.parse_event(raw), {})


class PendingTest(unittest.TestCase):
    now = 1_000.0

    def test_keeps_delayed_notices_and_drops_invalid_entries(self):
        state = {'pending': [
            {'pane': 'w1:p1', 'status': 'done', 'project': 'tehablo', 'label': 'A', 'ts': self.now - 1},
            {'pane': 'w1:p2', 'status': 'done', 'project': 'tehablo', 'label': 'B', 'ts': self.now - 20},
            {'pane': 'w1:p3', 'status': 'working', 'project': 'tehablo', 'label': 'C', 'ts': self.now},
            {'pane': 'w1:p4', 'status': 'done', 'project': 'tehablo', 'label': 'D', 'ts': 'x'},
        ]}
        with mock.patch.object(notify.time, 'time', return_value=self.now):
            self.assertEqual(notify.pending_items(state),
                             [{'pane': 'w1:p1', 'status': 'done', 'project': 'tehablo', 'label': 'A'},
                              {'pane': 'w1:p2', 'status': 'done', 'project': 'tehablo', 'label': 'B'}])

    def test_survives_a_corrupt_state(self):
        self.assertEqual(notify.pending_items({'pending': 'nope'}), [])

    def test_ignores_a_repeat_of_the_same_pane_and_status(self):
        state = {'pending': []}
        notify.add_pending(state, {'pane': 'w1:p1', 'status': 'done', 'project': 'p', 'label': 'A', 'ts': 1.0})
        notify.add_pending(state, {'pane': 'w1:p1', 'status': 'done', 'project': 'p', 'label': 'A', 'ts': 2.0})
        notify.add_pending(state, {'pane': 'w1:p1', 'status': 'blocked', 'project': 'p', 'label': 'A', 'ts': 3.0})
        self.assertEqual(len(state['pending']), 2)
        self.assertEqual(state['pending'][0]['ts'], 2.0)


class ComposeTest(unittest.TestCase):
    def single(self, status='done'):
        return [{'status': status, 'project': 'tehablo', 'label': 'PRs para issues 8 y 9'}]

    def test_nothing_to_say(self):
        self.assertIsNone(notify.compose([]))

    def test_one_notice_names_project_and_task(self):
        self.assertEqual(notify.compose(self.single()), 'tehablo, PRs para issues 8 y 9: terminó.')
        self.assertEqual(notify.compose(self.single('blocked')), 'tehablo, PRs para issues 8 y 9: te espera.')

    def test_task_named_like_the_project_is_said_once(self):
        items = [{'status': 'done', 'project': 'tehablo', 'label': 'TeHablo'}]
        self.assertEqual(notify.compose(items), 'tehablo: terminó.')
        items.append({'status': 'done', 'project': 'dockhand', 'label': 'B'})
        self.assertEqual(notify.compose(items), 'Terminaron tehablo; dockhand, B.')

    def test_several_notices_become_one_sentence(self):
        items = [{'status': 'done', 'project': 'tehablo', 'label': 'A'},
                 {'status': 'done', 'project': 'dockhand', 'label': 'B'}]
        self.assertEqual(notify.compose(items), 'Terminaron tehablo, A; dockhand, B.')

    def test_more_than_two_notices_are_counted(self):
        items = [{'status': 'done', 'project': project, 'label': label}
                 for project, label in (('tehablo', 'A'), ('dockhand', 'B'), ('engram', 'C'))]
        self.assertEqual(notify.compose(items), 'Terminaron tehablo, A; dockhand, B; y 1 más.')

    def test_done_and_blocked_use_different_phrases(self):
        items = [{'status': 'done', 'project': 'tehablo', 'label': 'A'},
                 {'status': 'blocked', 'project': 'dockhand', 'label': 'B'}]
        self.assertEqual(notify.compose(items), 'tehablo, A: terminó. dockhand, B: te espera.')

    def test_repeated_names_are_spoken_once(self):
        items = [{'status': 'done', 'project': 'tehablo', 'label': 'A'},
                 {'status': 'done', 'project': 'tehablo', 'label': 'A'}]
        self.assertEqual(notify.compose(items), 'Terminaron tehablo, A.')


class SettingsTest(unittest.TestCase):
    def read(self, payload=None):
        with tempfile.TemporaryDirectory() as directory:
            if payload is not None:
                (Path(directory) / 'config.json').write_text(payload, encoding='utf-8')
            with mock.patch.dict(os.environ, {'HERDR_PLUGIN_CONFIG_DIR': directory}):
                return notify.settings()

    def test_defaults_without_a_config_file(self):
        self.assertEqual(self.read(), {'skip_focused': True, 'window': 2.0, 'lexicon': True})

    def test_reads_a_valid_config_file(self):
        self.assertEqual(self.read('{"skip_focused": false, "window": 0.5, "lexicon": false}'),
                         {'skip_focused': False, 'window': 0.5, 'lexicon': False})

    def test_ignores_broken_values(self):
        self.assertEqual(self.read('{"skip_focused": "no", "window": 99, "lexicon": 1}'),
                         {'skip_focused': True, 'window': 2.0, 'lexicon': True})
        self.assertEqual(self.read('no json'), {'skip_focused': True, 'window': 2.0, 'lexicon': True})


class OrphanNoticeTest(unittest.TestCase):
    def test_old_orphans_are_removed_without_speaking_in_both_window_modes(self):
        for window in (0, 2.0):
            with self.subTest(window=window), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'config.json').write_text(json.dumps({'window': window}), encoding='utf-8')
                orphan = {'pane': 'old', 'status': 'done', 'project': 'old project',
                          'label': 'orphan task', 'ts': 0}
                path = root / 'state.json'
                path.write_text(json.dumps({'seen': {'old': 1}, 'pending': [orphan]}), encoding='utf-8')
                env = {'HERDR_PLUGIN_STATE_DIR': str(root), 'HERDR_PLUGIN_CONFIG_DIR': str(root),
                       'HERDR_PLUGIN_EVENT_JSON': '{"data":{"pane_id":"new"}}'}
                agent = {'pane_id': 'new', 'workspace_id': 'w1', 'agent_status': 'done',
                         'completion_seq': 2, 'terminal_title_stripped': 'current task'}
                with mock.patch.dict(os.environ, env), \
                     mock.patch.object(notify, 'agent_info', return_value=agent), \
                     mock.patch.object(notify, 'workspace_label', return_value='current project'), \
                     mock.patch.object(notify.time, 'time', return_value=1000), \
                     mock.patch.object(notify.time, 'sleep'), \
                     mock.patch.object(notify, 'tehablo_base', return_value='http://127.0.0.1:23765'), \
                     mock.patch.object(notify, 'speak', return_value=True) as speak, \
                     mock.patch('sys.stderr', new_callable=io.StringIO) as stderr:
                    self.assertEqual(notify.main([]), 0)
                speak.assert_called_once_with('http://127.0.0.1:23765', 'new',
                                              'current project, current task: terminó.', True)
                self.assertEqual(stderr.getvalue(), '')
                state = json.loads(path.read_text(encoding='utf-8'))
                self.assertEqual(state['pending'], [])
                self.assertEqual(state['seen'], {'old': 1, 'new': 2})


class BatchingTest(unittest.TestCase):
    def run_hook(self, root, event_status, agent_status, window, during_sleep=None):
        (root / 'config.json').write_text(json.dumps({'window': window}), encoding='utf-8')
        event = {'data': {'pane_id': 'b', 'agent_status': event_status}}
        env = {'HERDR_PLUGIN_STATE_DIR': str(root), 'HERDR_PLUGIN_CONFIG_DIR': str(root),
               'HERDR_PLUGIN_EVENT_JSON': json.dumps(event)}
        agent = {'pane_id': 'b', 'workspace_id': 'w1', 'agent_status': agent_status,
                 'completion_seq': 1, 'terminal_title_stripped': 'task b'}
        with mock.patch.dict(os.environ, env), \
             mock.patch.object(notify, 'agent_info', return_value=agent) as lookup, \
             mock.patch.object(notify, 'workspace_label', return_value='p'), \
             mock.patch.object(notify.time, 'sleep', side_effect=during_sleep), \
             mock.patch.object(notify, 'tehablo_base', return_value='http://127.0.0.1:23765'), \
             mock.patch.object(notify, 'speak', return_value=True) as speak:
            self.assertEqual(notify.main([]), 0)
        return lookup, speak

    def test_event_status_decides_the_transition_spoken(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lookup, speak = self.run_hook(root, 'working', 'blocked', 0)
            lookup.assert_not_called()
            speak.assert_not_called()
            _, speak = self.run_hook(root, 'blocked', 'blocked', 0)
            speak.assert_called_once_with('http://127.0.0.1:23765', 'b', 'p, task b: te espera.', True)

    def test_sleeper_from_a_spoken_batch_leaves_the_next_batch_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'state.json'
            newer = {'pane': 'c', 'status': 'done', 'project': 'p', 'label': 'task c', 'ts': time.time()}

            def other_hooks_meanwhile(_seconds):
                # Another hook speaks this batch, then a new notice starts the next one.
                state = json.loads(path.read_text(encoding='utf-8'))
                state['batch'] = notify.batch_of(state) + 1
                state['pending'] = [newer]
                path.write_text(json.dumps(state), encoding='utf-8')

            _, speak = self.run_hook(root, 'done', 'done', 2.0, other_hooks_meanwhile)
            speak.assert_not_called()
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['pending'], [newer])


class DryRunTest(unittest.TestCase):
    def test_dry_run_prints_without_touching_the_shared_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = {'pane': 'live', 'status': 'done', 'project': 'p', 'label': 'real task', 'ts': 1000}
            path = root / 'state.json'
            path.write_text(json.dumps({'seen': {'live': 1}, 'pending': [real]}), encoding='utf-8')
            before = path.read_bytes()
            env = {'HERDR_PLUGIN_STATE_DIR': str(root), 'HERDR_PLUGIN_CONFIG_DIR': str(root),
                   'HERDR_PLUGIN_EVENT_JSON': '{"data":{"pane_id":"new"}}'}
            agent = {'pane_id': 'new', 'workspace_id': 'w1', 'agent_status': 'done',
                     'completion_seq': 2, 'terminal_title_stripped': 'current task'}
            with mock.patch.dict(os.environ, env), \
                 mock.patch.object(notify, 'agent_info', return_value=agent), \
                 mock.patch.object(notify, 'workspace_label', return_value='current project'), \
                 mock.patch.object(notify.time, 'time', return_value=1000), \
                 mock.patch.object(notify.time, 'sleep') as sleep, \
                 mock.patch('sys.stdout', new_callable=io.StringIO) as stdout, \
                 mock.patch('sys.stderr', new_callable=io.StringIO) as stderr, \
                 mock.patch('socket.create_connection', side_effect=AssertionError('network forbidden')):
                self.assertEqual(notify.main(['--dry-run']), 0)
            self.assertEqual(stdout.getvalue(), 'current project, current task: terminó.\n')
            self.assertEqual(stderr.getvalue(), '')
            sleep.assert_not_called()
            self.assertEqual(path.read_bytes(), before)


PROBE_TIMEOUT = 20

PROCESS_PROBE = r'''
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location("notify", sys.argv[1])
notify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notify)
root, pane = Path(sys.argv[2]), sys.argv[3]
real_sleep = time.sleep
timeout = float(os.environ["TEST_TIMEOUT"])
window = float(os.environ["TEST_WINDOW"])

def wait_for(path):
    deadline = time.monotonic() + timeout
    while not path.exists():
        if time.monotonic() > deadline:
            raise RuntimeError("barrier timed out: " + path.name)
        real_sleep(0.01)

def controlled_wait(seconds):
    if window > 0 and seconds == window:
        # handle() has saved and unlocked the queue before this wait.
        (root / ("queued-" + pane)).touch()
        wait_for(root / "claim")
    else:
        real_sleep(seconds)

notify.time.sleep = controlled_wait
notify.agent_info = lambda _: {
    "pane_id": pane, "workspace_id": pane, "agent_status": "done",
    "completion_seq": 1, "terminal_title_stripped": "task " + pane,
    "focused": False,
}
notify.workspace_label = lambda _: "project"
notify.tehablo_base = lambda: "http://unused"
def speak(base, identifier, text, lexicon=True):
    (root / ("spoken-" + pane + ".json")).write_text(
        json.dumps({"id": identifier, "text": text, "lexicon": lexicon}),
        encoding="utf-8")
    return True
notify.speak = speak
(root / ("ready-" + pane)).touch()
wait_for(root / ("start-" + pane))
sys.exit(notify.main([]))
'''


class ConcurrentHandleTest(unittest.TestCase):
    def run_events(self, root, count, window, late_arrival=False):
        config = root / 'config'
        config.mkdir()
        (config / 'config.json').write_text(json.dumps({'window': window}), encoding='utf-8')
        processes = []
        try:
            for index in range(count):
                pane = f'p{index}'
                env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                           HERDR_PLUGIN_CONFIG_DIR=str(config),
                           HERDR_PLUGIN_STATE_DIR=str(root / 'state'),
                           TEST_TIMEOUT=str(PROBE_TIMEOUT), TEST_WINDOW=str(window),
                           HERDR_PLUGIN_EVENT_JSON=json.dumps({'data': {'pane_id': pane}}))
                processes.append(subprocess.Popen(
                    [sys.executable, '-c', PROCESS_PROBE, str(PLUGIN / 'notify.py'), str(root), pane],
                    env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE))
            deadline = time.monotonic() + PROBE_TIMEOUT
            while len(list(root.glob('ready-*'))) != count:
                self.assertTrue(all(p.poll() is None for p in processes), 'child failed before barrier')
                self.assertLess(time.monotonic(), deadline, 'children did not reach start barrier')
                time.sleep(0.01)
            for index in range(count):
                (root / f'start-p{index}').touch()
                if late_arrival and window > 0:
                    self.wait_for_queued(root, index + 1, processes)
            if window > 0:
                self.wait_for_queued(root, count, processes)
                state = json.loads((root / 'state' / 'state.json').read_text(encoding='utf-8'))
                self.assertEqual({item['pane'] for item in state['pending']},
                                 {f'p{i}' for i in range(count)})
                (root / 'claim').touch()
            for process in processes:
                stdout, stderr = process.communicate(timeout=PROBE_TIMEOUT + 5)
                self.assertEqual(process.returncode, 0, stderr.decode('utf-8', 'replace'))
                self.assertEqual(stdout, b'')
                self.assertEqual(stderr, b'')
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.communicate()
        calls = [json.loads(p.read_text(encoding='utf-8')) for p in root.glob('spoken-*.json')]
        state = json.loads((root / 'state' / 'state.json').read_text(encoding='utf-8'))
        return calls, state

    def wait_for_queued(self, root, count, processes):
        deadline = time.monotonic() + PROBE_TIMEOUT
        while len(list(root.glob('queued-*'))) < count:
            self.assertTrue(all(p.poll() is None for p in processes), 'child failed before enqueue')
            self.assertLess(time.monotonic(), deadline, 'children did not enqueue before claim')
            time.sleep(0.01)

    def test_two_concurrent_events_share_one_phrase(self):
        with tempfile.TemporaryDirectory() as directory:
            calls, state = self.run_events(Path(directory), count=2, window=0.5)
        self.assertEqual(len(calls), 1, calls)
        self.assertIn('project, task p0', calls[0]['text'])
        self.assertIn('project, task p1', calls[0]['text'])
        self.assertIn(calls[0]['id'], ('p0', 'p1'))
        self.assertTrue(calls[0]['lexicon'])
        self.assertEqual(state['seen'], {'p0': 1, 'p1': 1})
        self.assertEqual(state['pending'], [])

    def test_six_concurrent_events_are_counted_without_lock_timeout_or_loss(self):
        with tempfile.TemporaryDirectory() as directory:
            calls, state = self.run_events(Path(directory), count=6, window=2.0)
        self.assertEqual(len(calls), 1, calls)
        self.assertEqual(calls[0]['text'].count('project, task '), 2)
        self.assertIn('y 4 más', calls[0]['text'])
        self.assertEqual(state['seen'], {f'p{i}': 1 for i in range(6)})
        self.assertEqual(state['pending'], [])

    def test_zero_window_preserves_individual_notices(self):
        with tempfile.TemporaryDirectory() as directory:
            calls, state = self.run_events(Path(directory), count=2, window=0)
        self.assertEqual({call['id'] for call in calls}, {'p0', 'p1'})
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(call['text'], f"project, task {call['id']}: terminó.")
        self.assertEqual(state['seen'], {'p0': 1, 'p1': 1})
        self.assertEqual(state['pending'], [])

    def test_notice_arriving_during_the_first_wait_is_grouped(self):
        with tempfile.TemporaryDirectory() as directory:
            calls, state = self.run_events(Path(directory), count=2, window=0.5, late_arrival=True)
        self.assertEqual(len(calls), 1, calls)
        self.assertIn('project, task p0', calls[0]['text'])
        self.assertIn('project, task p1', calls[0]['text'])
        self.assertEqual(state['seen'], {'p0': 1, 'p1': 1})
        self.assertEqual(state['pending'], [])


@unittest.skipUnless(shutil.which('sh'), 'POSIX shell unavailable')
class LauncherTest(unittest.TestCase):
    def test_configured_interpreters_take_precedence_and_fallback_still_works(self):
        for source in ('environment', 'config', 'fallback'):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'run.sh').write_text((PLUGIN / 'run.sh').read_text(encoding='utf-8'),
                                             encoding='utf-8')
                (root / 'notify.py').write_text('', encoding='utf-8')
                for name in ('chosen', 'python3', 'python'):
                    script = root / name
                    script.write_text(f'#!/bin/sh\nprintf "{name}\\n" >> "$TEST_LOG"\nexit 0\n',
                                      encoding='utf-8')
                    script.chmod(0o755)
                env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ.get('PATH', ''),
                           HOME=str(root), USERPROFILE=str(root), TEST_LOG=(root / 'log').as_posix())
                env.pop('TEHABLO_PYTHON', None)
                env.pop('HERDR_PLUGIN_CONFIG_DIR', None)
                if source == 'environment':
                    env['TEHABLO_PYTHON'] = (root / 'chosen').as_posix()
                elif source == 'config':
                    env['HERDR_PLUGIN_CONFIG_DIR'] = str(root)
                    (root / 'python.txt').write_text('  ' + (root / 'chosen').as_posix() + '\r\n',
                                                    encoding='utf-8')
                done = subprocess.run([shutil.which('sh'), str(root / 'run.sh'), '--dry-run'],
                                      env=env, cwd=root, capture_output=True, timeout=15)
                self.assertEqual(done.returncode, 0, done.stderr)
                expected = 'python3' if source == 'fallback' else 'chosen'
                self.assertEqual((root / 'log').read_text().splitlines(), [expected, expected])


class HttpBoundaryTest(unittest.TestCase):
    def test_manual_notice_preserves_authenticated_wait_request(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / '.tehablo').mkdir()
            code = 'a' * 32
            (home / '.tehablo' / 'ssh-codigo').write_text(code, encoding='ascii')
            with mock.patch.object(Path, 'home', return_value=home), \
                 mock.patch.object(notify, 'tehablo_base', return_value='http://127.0.0.1:23765'), \
                 mock.patch.object(notify.urllib.request, 'build_opener') as build, \
                 mock.patch('socket.create_connection', side_effect=AssertionError('network forbidden')):
                client = build.return_value
                client.open.return_value.__enter__.return_value.status = 202
                self.assertEqual(notify.main(['--say', 'manual notice']), 0)
                request = client.open.call_args.args[0]
                self.assertEqual(request.full_url, 'http://127.0.0.1:23765/speak')
                self.assertEqual(request.get_method(), 'POST')
                self.assertEqual(request.get_header('X-tehablo-codigo'), code)
                self.assertEqual(json.loads(request.data),
                                 {'id': 'herdr-manual', 'text': 'manual notice',
                                  'policy': 'wait', 'lexicon': True})
                client.open.assert_called_once()
                proxies = [handler for handler in build.call_args.args
                           if isinstance(handler, notify.urllib.request.ProxyHandler)]
                self.assertEqual(len(proxies), 1)
                self.assertEqual(proxies[0].proxies, {})

    def test_health_ignores_non_http_services(self):
        with mock.patch.object(notify.urllib.request, 'urlopen',
                               side_effect=http.client.BadStatusLine('not HTTP')), \
             mock.patch.object(notify.urllib.request.OpenerDirector, 'open',
                               side_effect=http.client.BadStatusLine('not HTTP')):
            self.assertIsNone(notify.tehablo_base())
            with mock.patch.object(notify, 'auth_code', return_value='a' * 32), \
                 mock.patch('sys.stderr', new_callable=io.StringIO) as stderr:
                self.assertFalse(notify.speak('http://127.0.0.1:23765', 'p1', 'notice'))
                self.assertIn('/speak failed', stderr.getvalue())

    def test_invalid_pairing_code_is_not_sent_or_logged(self):
        invalid = 'a' * 16 + '\n' + 'b' * 16
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / '.tehablo').mkdir()
            (home / '.tehablo' / 'ssh-codigo').write_text(invalid, encoding='ascii')
            with mock.patch.object(Path, 'home', return_value=home), \
                 mock.patch.object(notify.urllib.request, 'urlopen') as opened, \
                 mock.patch.object(notify.urllib.request.OpenerDirector, 'open') as local_opened, \
                 mock.patch('sys.stderr', new_callable=io.StringIO) as stderr:
                opened.return_value.__enter__.return_value.status = 202
                local_opened.return_value.__enter__.return_value.status = 202
                self.assertFalse(notify.speak('http://127.0.0.1:1', 'p1', 'notice'))
                opened.assert_not_called()
                local_opened.assert_not_called()
                self.assertNotIn('a' * 16, stderr.getvalue())

    def test_uppercase_pairing_code_is_rejected_like_the_server(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / '.tehablo').mkdir()
            for code, expected in (('A' * 32, None), ('a' * 32, 'a' * 32)):
                (home / '.tehablo' / 'ssh-codigo').write_text(code + '\n', encoding='ascii')
                with self.subTest(code=code[0]), mock.patch.object(Path, 'home', return_value=home):
                    self.assertEqual(notify.auth_code(), expected)

    def test_tehablo_port_pins_discovery_to_one_port(self):
        for value, probed in (('24123', ['http://127.0.0.1:24123/health']), ('not-a-port', []),
                              ('²', []), ('70000', [])):
            seen = []
            def health(request, timeout):
                seen.append(request if isinstance(request, str) else request.full_url)
                raise OSError('refused')
            with self.subTest(value=value), \
                 mock.patch.dict(os.environ, {'TEHABLO_PORT': value}), \
                 mock.patch.object(notify, '_local_open', side_effect=health):
                self.assertIsNone(notify.tehablo_base())
            self.assertEqual(seen, probed)
        healthy = mock.MagicMock()
        healthy.__enter__.return_value.read.return_value = b'{"service": "tehablo"}'
        with mock.patch.dict(os.environ, {'TEHABLO_PORT': '24123'}), \
             mock.patch.object(notify, '_local_open', return_value=healthy):
            self.assertEqual(notify.tehablo_base(), 'http://127.0.0.1:24123')

    def test_health_and_speak_never_follow_redirects(self):
        original_build = notify.urllib.request.build_opener
        for operation in ('health', 'speak'):
            seen = []
            class Transport(notify.urllib.request.BaseHandler):
                handler_order = 100

                def http_open(self, request):
                    seen.append(request.full_url)
                    local = request.full_url.startswith('http://127.0.0.1:')
                    headers = {'Location': 'http://forbidden.invalid/'} if local else {}
                    response = urllib.response.addinfourl(
                        io.BytesIO(b'{"service":"tehablo"}'), headers, request.full_url,
                        302 if local else 200)
                    response.msg = 'Found' if local else 'OK'
                    return response

            transport = Transport()
            permissive = original_build(transport)
            def build(*handlers):
                return original_build(*handlers, transport)
            with self.subTest(operation=operation), \
                 mock.patch.object(notify, 'auth_code', return_value='a' * 32), \
                 mock.patch.object(notify.urllib.request, 'urlopen', side_effect=permissive.open), \
                 mock.patch.object(notify.urllib.request, 'build_opener', side_effect=build), \
                 mock.patch('socket.create_connection', side_effect=AssertionError('network forbidden')), \
                 mock.patch('sys.stderr', new_callable=io.StringIO):
                if operation == 'health':
                    self.assertIsNone(notify.tehablo_base())
                    self.assertEqual(len(seen), len(notify.PORTS))
                else:
                    self.assertFalse(notify.speak('http://127.0.0.1:23765', 'p1', 'notice'))
                    self.assertEqual(len(seen), 1)
                self.assertTrue(all(url.startswith('http://127.0.0.1:') for url in seen))


@unittest.skipUnless(sys.platform == 'win32', 'Windows launcher')
class WindowsLauncherTest(unittest.TestCase):
    def test_override_with_exclamation_mark_is_used_literally(self):
        launcher = Path(__file__).resolve().parent.parent / 'herdr-plugin' / 'run.cmd'
        with tempfile.TemporaryDirectory() as directory:
            # A copy of this interpreter in a folder with "!" and a PATH without any other Python:
            # success proves the launcher used the override literally instead of a fallback.
            folder = Path(directory) / 'py!dir'
            subprocess.run([sys.executable, '-m', 'venv', '--without-pip', str(folder)],
                           check=True, timeout=120)
            python = folder / 'Scripts' / 'python.exe'
            system = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32')
            env = {'SystemRoot': os.environ.get('SystemRoot', r'C:\Windows'), 'PATH': system,
                   'TEHABLO_PYTHON': str(python),
                   'HERDR_PLUGIN_STATE_DIR': directory, 'HERDR_PLUGIN_CONFIG_DIR': directory}
            done = subprocess.run(['cmd', '/c', str(launcher), '--dry-run'], env=env,
                                  capture_output=True, text=True, timeout=PROBE_TIMEOUT)
            self.assertEqual((done.returncode, done.stderr), (0, ''))


if __name__ == '__main__':
    unittest.main(verbosity=2)
