"""PC receptor: ffplay exits at end of stream and the loop connects again."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import time
import unittest

RECEPTOR = Path(__file__).resolve().parents[1] / 'receptor'


def ffplay_lines(text):
    # Lines that start the player (both use -nodisp), not the uninstall process match.
    return [line for line in text.splitlines() if 'audio.wav' in line and '-nodisp' in line]


class ReceptorTest(unittest.TestCase):
    def test_both_receptors_exit_at_end_of_stream(self):
        for name in ('install.sh', 'install.ps1'):
            lines = ffplay_lines((RECEPTOR / name).read_text(encoding='utf-8'))
            self.assertTrue(lines, name)
            for line in lines:
                self.assertIn('-autoexit', line, f'{name}: {line.strip()}')

    @unittest.skipUnless(shutil.which('sh'), 'needs a POSIX sh')
    def test_loop_connects_again_after_the_stream_ends(self):
        text = (RECEPTOR / 'install.sh').read_text(encoding='utf-8')
        loop = re.search(r"<<'LOOP'\n(.*?)\nLOOP\n", text, re.S).group(1) + '\n'
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / 'loop.sh').write_text(loop, encoding='utf-8', newline='\n')
            log = tmp / 'calls.log'
            stub = tmp / 'ffplay'
            # Stands in for ffplay reaching the end of the stream right away.
            stub.write_text(f'#!/bin/sh\necho "$*" >> "{log.as_posix()}"\nexit 0\n', encoding='utf-8', newline='\n')
            stub.chmod(0o755)
            env = dict(os.environ, PATH=f'{tmp}{os.pathsep}{os.environ.get("PATH", "")}')
            proc = subprocess.Popen([shutil.which('sh'), str(tmp / 'loop.sh')], env=env)
            try:
                time.sleep(4.5)
            finally:
                proc.terminate()
                proc.wait(timeout=10)
            calls = log.read_text(encoding='utf-8').splitlines()
            self.assertGreaterEqual(len(calls), 2, calls)
            self.assertTrue(all('-autoexit' in call for call in calls), calls)

    @unittest.skipUnless(shutil.which('sh'), 'needs a POSIX sh')
    def test_ssh_config_gets_one_forward_and_keeps_existing_ones(self):
        cases = {
            'Host vps\n User a\n': 'Host vps\n User a\n    LocalForward 18765 127.0.0.1:8765\n',
            'Host vps\n User a\nHost vps\n IdentityFile k\n':
                'Host vps\n User a\n    LocalForward 18765 127.0.0.1:8765\nHost vps\n IdentityFile k\n',
            'Host vps\n LocalForward localhost:18765 127.0.0.1:8765\n': None,
            'Host other\n User a\nHost vps\n LocalForward 18765 127.0.0.1:8765\n': None,
        }
        for before, after in cases.items():
            with self.subTest(before=before), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                (home / '.ssh').mkdir()
                (home / '.ssh' / 'config').write_bytes(before.encode())
                (home / 'ffplay').write_text('#!/bin/sh\nexit 0\n', encoding='utf-8', newline='\n')
                (home / 'ffplay').chmod(0o755)
                env = dict(os.environ, HOME=str(home), PATH=f'{home}{os.pathsep}{os.environ.get("PATH", "")}')
                for _ in range(2):  # A second run changes nothing.
                    done = subprocess.run([shutil.which('sh'), str(RECEPTOR / 'install.sh'), '--config-only', 'vps'],
                                          env=env, capture_output=True, text=True, timeout=30)
                    self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual((home / '.ssh' / 'config').read_bytes().decode(), after or before)
                backups = list((home / '.ssh').glob('config.tehablo-*.bak'))
                self.assertEqual(len(backups), 1 if after else 0)
                if after:
                    self.assertEqual(backups[0].read_bytes().decode(), before)


if __name__ == '__main__':
    unittest.main()
