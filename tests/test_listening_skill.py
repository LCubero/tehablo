"""Execute the documented shell example without network, audio or scratch files."""
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import unittest

SKILL = Path(__file__).resolve().parents[1] / '.pi/skills/tehablo-pronunciacion/SKILL.md'


def snippet():
    return re.findall(r'```bash\n(.*?)```', SKILL.read_text(encoding='utf-8'), re.S)[1]


class ListeningSkillTests(unittest.TestCase):
    def run_example(self, states=('generating', 'playing', 'idle'), failure='', port='9123', text=None):
        replies = [json.dumps(s if isinstance(s, dict) else {'state': s, 'error': None}) for s in states]
        # Run the snippet's python3 with this interpreter (Git Bash may only have a Store stub).
        mock = '''
python3() { PYTHON_VALUE "$@"; }
PORT=PORT_VALUE
n=0
curl() {
  printf 'CALL %s\\n' "$*" >&2
  case "$*" in
    */speak*)
      if [[ "$failure" == post-transport ]]; then return 7; fi
      if [[ "$failure" == post-http && "$*" == *--fail* ]]; then return 22; fi
      printf '{"ok":true}';;
    */status*)
      if [[ "$failure" == status-transport ]]; then return 7; fi
      if [[ "$failure" == status-http && "$*" == *--fail* ]]; then return 22; fi
      i=$n; (( i >= ${#replies[@]} )) && i=$((${#replies[@]}-1))
      printf '%s' "${replies[$i]}";;
  esac
}
sleep() { printf 'SLEEP %s\\n' "$1" >&2; n=$((n+1)); }
'''.replace('PORT_VALUE', port).replace('PYTHON_VALUE', shlex.quote(Path(sys.executable).as_posix()))
        code = snippet()
        if text is not None:
            code = code[:code.index('say "fícher."')] + 'say ' + shlex.quote(text) + ' 0.6\n'
        result = subprocess.run(['bash', '-c', 'failure=' + shlex.quote(failure) + '\nreplies=(' + ' '.join(map(shlex.quote, replies)) + ')\n' + mock + code], capture_output=True, text=True, encoding='utf-8', timeout=15)
        calls = [line[5:] for line in result.stderr.splitlines() if line.startswith('CALL ')]
        return result, calls

    def test_selected_port_and_successful_sequence(self):
        result, calls = self.run_example()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertTrue(all('localhost:9123/' in call for call in calls))
        self.assertEqual(sum('/speak' in c for c in calls), 2)
        self.assertIn('SLEEP 0.6', result.stderr)
        self.assertIn('SLEEP 1.5', result.stderr)
        for call in calls:
            self.assertIn('--connect-timeout', call)
            self.assertIn('--max-time', call)

    def test_json_safe_text(self):
        text = 'güi "hola" \\ fin\nlínea'
        result, calls = self.run_example(states=('idle',), text=text)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = calls[0].split('-d ', 1)[1]
        self.assertEqual(json.loads(payload), {'id': 'w', 'text': text})

    def test_errors_abort_sequence(self):
        cases = [(['idle'], f) for f in ('post-transport', 'post-http', 'status-transport', 'status-http')]
        cases += [([s], '') for s in ({'state': 'error'}, {'state': 'idle', 'error': 'speech failed'}, {'state': 'mystery'})]
        for states, failure in cases:
            with self.subTest(states=states, failure=failure):
                result, calls = self.run_example(states, failure)
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, '')
                self.assertEqual(sum('/speak' in c for c in calls), 1)
                self.assertNotIn('SLEEP 0.6', result.stderr)
                self.assertNotIn('SLEEP 1.5', result.stderr)

    def test_stuck_generation_aborts_without_next_word(self):
        result, calls = self.run_example(states=('generating',))
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sum('/speak' in c for c in calls), 1)
        self.assertLessEqual(sum('/status' in c for c in calls), 601)
        self.assertIn('Tiempo de espera agotado', result.stderr)


if __name__ == '__main__':
    unittest.main()
