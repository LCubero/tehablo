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


if __name__ == '__main__':
    unittest.main()
