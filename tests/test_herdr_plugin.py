"""Decision logic for the herdr voice plugin, without network or processes."""
import importlib.util
import json
import os
import tempfile
import unittest
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

    def test_keeps_fresh_notices_and_drops_the_rest(self):
        state = {'pending': [
            {'pane': 'w1:p1', 'status': 'done', 'project': 'tehablo', 'label': 'A', 'ts': self.now - 1},
            {'pane': 'w1:p2', 'status': 'done', 'project': 'tehablo', 'label': 'B', 'ts': self.now - 100},
            {'pane': 'w1:p3', 'status': 'working', 'project': 'tehablo', 'label': 'C', 'ts': self.now},
            {'pane': 'w1:p4', 'status': 'done', 'project': 'tehablo', 'label': 'D', 'ts': 'x'},
        ]}
        self.assertEqual(notify.pending_items(state, self.now, 2.0),
                         [{'pane': 'w1:p1', 'status': 'done', 'project': 'tehablo', 'label': 'A'}])

    def test_survives_a_corrupt_state(self):
        self.assertEqual(notify.pending_items({'pending': 'nope'}, self.now, 2.0), [])

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


if __name__ == '__main__':
    unittest.main(verbosity=2)
