"""Thin installer checks with stub uv; never install or play anything."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / '.repo-harness/tmp/t9-check'
SCRATCH.mkdir(parents=True, exist_ok=True)


@unittest.skipUnless(shutil.which('sh'), 'needs POSIX sh')
class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, HOME=str(self.home))
        self.sh = shutil.which('sh')

    def run_installer(self, *args):
        return subprocess.run([self.sh, '-c', 'PATH="$HOME/bin"; export PATH; . "$0" "$@"',
                               (ROOT / 'receptor/install.sh').as_posix(), *args], env=self.env,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15)

    def test_missing_uv_leaves_home_unchanged(self):
        before = sorted(p.relative_to(self.home) for p in self.home.rglob('*'))
        result = self.run_installer('--yes', 'vps')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('https://astral.sh/uv/install.sh', result.stdout + result.stderr)
        self.assertEqual(sorted(p.relative_to(self.home) for p in self.home.rglob('*')), before)

    def test_piped_download_with_stub_curl_and_uv(self):
        for name, content in {
            'uv': '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/uv-args"\n',
            'curl': '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/curl-args"\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf "# fake client\\n" > "$1"; fi; shift; done\n',
        }.items():
            path = self.bin / name
            path.write_text(content, encoding='utf-8', newline='\n')
            path.chmod(0o755)
        result = subprocess.run([self.sh, '-s', '--', '--yes', 'vps'],
                                input='PATH="$HOME/bin:/usr/bin:/bin"; export PATH\n' + (ROOT / 'receptor/install.sh').read_text(), env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.home / '.local/share/tehablo-cliente/tehablo_cliente.py').exists())
        self.assertIn('https://raw.githubusercontent.com/LCubero/tehablo/master/cliente/tehablo_cliente.py',
                      (self.home / 'curl-args').read_text())
        self.assertEqual((self.home / 'uv-args').read_text().splitlines()[-2:], ['--yes', 'vps'])
        self.assertFalse((self.home / '.ssh').exists())

    def test_yes_and_uninstall_delegate_to_uv(self):
        # A shell stub logs only; it never runs the real client.
        stub = self.bin / 'uv'
        stub.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/uv-args"\n', encoding='utf-8', newline='\n')
        stub.chmod(0o755)
        for args in (('--yes', 'vps'), ('--uninstall',)):
            result = self.run_installer(*args)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            actual = (self.home / 'uv-args').read_text().splitlines()
            self.assertEqual(actual[:2], ['run', '--script'])
            self.assertTrue(actual[2].replace('\\', '/').endswith('/cliente/tehablo_cliente.py'))
            self.assertEqual(actual[3:], list(args))
            self.assertFalse((self.home / '.ssh').exists())


if __name__ == '__main__':
    unittest.main()
