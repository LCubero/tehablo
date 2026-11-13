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
END_LINES = ('\n[Cliente instalado]\n\nPara iniciar:', '\n\n[Cómo usar]\n\n1.',
             '1. Conexión SSH → elegir servidor.',
             '2. Vincular servidor → pegar el código de /tts codigo.',
             '3. Deja el cliente abierto para oír la voz.')


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

    def test_install_end_block(self):
        uv = self.bin / 'uv'
        uv.write_text('#!/bin/sh\nexit 0\n')
        uv.chmod(0o755)
        result = self.run_installer()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, '')
        for line in END_LINES:
            self.assertIn(line, result.stdout)
        self.assertIn('uv run --script', result.stdout)

    def test_prompt_only_on_terminal(self):
        uv = self.bin / 'uv'
        uv.write_text('#!/bin/sh\nprintf opened > "$HOME/opened"\n')
        uv.chmod(0o755)
        result = self.run_installer()
        self.assertEqual(result.returncode, 0)
        self.assertNotIn('Presiona Enter', result.stdout)
        self.assertFalse((self.home / 'opened').exists())
        import pty
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        self.addCleanup(os.close, slave)
        process = subprocess.Popen([self.sh, str(ROOT / 'receptor/install.sh')],
                                   env=dict(self.env, PATH=str(self.bin)), stdin=slave,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            os.write(master, b'\n')
            out, err = process.communicate(timeout=15)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
        self.assertEqual((process.returncode, err), (0, ''))
        self.assertIn('Presiona Enter para abrir el cliente (Ctrl+C para salir)', out)
        self.assertTrue((self.home / 'opened').exists())

    def test_missing_uv_leaves_home_unchanged(self):
        before = sorted(p.relative_to(self.home) for p in self.home.rglob('*'))
        result = self.run_installer()
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
        result = subprocess.run([self.sh, '-s', '--', '--uninstall'],
                                input='PATH="$HOME/bin:/usr/bin:/bin"; export PATH\n' + (ROOT / 'receptor/install.sh').read_text(), env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.home / '.local/share/tehablo-cliente/tehablo_cliente.py').exists())
        self.assertIn('https://raw.githubusercontent.com/LCubero/tehablo/master/cliente/tehablo_cliente.py',
                      (self.home / 'curl-args').read_text())
        self.assertEqual((self.home / 'uv-args').read_text().splitlines()[-1:], ['--uninstall'])
        self.assertFalse((self.home / '.ssh').exists())

    def test_interrupted_download_does_not_leave_a_broken_client(self):
        def stub(name, content):
            path = self.bin / name
            path.write_text(content, encoding='utf-8', newline='\n')
            path.chmod(0o755)

        def run():
            return subprocess.run([self.sh, '-s'],
                                  input='PATH="$HOME/bin:/usr/bin:/bin"; export PATH\n' + (ROOT / 'receptor/install.sh').read_text(),
                                  env=self.env, capture_output=True, text=True, timeout=15)

        client = self.home / '.local/share/tehablo-cliente/tehablo_cliente.py'
        stub('uv', '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/uv-args"\n')
        # A cut connection: curl writes part of the file, then fails.
        stub('curl', '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf "# half" > "$1"; fi; shift; done\nexit 18\n')
        result = run()
        self.assertEqual(result.returncode, 18, result.stdout + result.stderr)
        self.assertFalse(client.exists())
        self.assertFalse((self.home / 'uv-args').exists())

        stub('curl', '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; printf "# fake client\\n" > "$1"; fi; shift; done\n')
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(client.read_text(), '# fake client\n')
        self.assertFalse(client.with_name(client.name + '.part').exists())
        self.assertFalse((self.home / 'uv-args').exists())

    def test_menu_and_uninstall_delegate_to_uv(self):
        # A shell stub logs only; it never runs the real client.
        stub = self.bin / 'uv'
        stub.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/uv-args"\n', encoding='utf-8', newline='\n')
        stub.chmod(0o755)
        for args in ((), ('--uninstall',)):
            result = self.run_installer(*args)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            if not args:
                self.assertFalse((self.home / 'uv-args').exists())
                self.assertIn('Para iniciar:', result.stdout)
                continue
            actual = (self.home / 'uv-args').read_text().splitlines()
            self.assertEqual(actual[:2], ['run', '--script'])
            self.assertTrue(actual[2].replace('\\', '/').endswith('/cliente/tehablo_cliente.py'))
            self.assertEqual(actual[3:], list(args))
            self.assertFalse((self.home / '.ssh').exists())


    def test_removed_flags_are_rejected(self):
        for flag in ('--yes', '--config-only', 'vps'):
            result = self.run_installer(flag)
            self.assertEqual(result.returncode, 2)
            self.assertIn('Uso:', result.stderr)
            self.assertFalse((self.home / 'uv-args').exists())


POWERSHELL = shutil.which('pwsh') or shutil.which('powershell')


class PowerShellSourceTest(unittest.TestCase):
    def test_scripts_are_ascii(self):
        # Windows PowerShell 5.1 reads BOM-less scripts as ANSI; a BOM breaks irm | iex.
        for name in ('install.ps1', 'receptor/install.ps1'):
            data = (ROOT / name).read_bytes()
            self.assertTrue(data.isascii(), name)


@unittest.skipUnless(shutil.which('powershell'), 'needs Windows PowerShell 5.1')
class WindowsPowerShellOutputTest(unittest.TestCase):
    def test_end_block_reads_correctly_from_a_file(self):
        script = ('[Console]::OutputEncoding = [Text.Encoding]::UTF8\n'
                  'function uv { $global:LASTEXITCODE = 0 }\n'
                  '& $env:TEHABLO_PS1 -Yes\n')
        env = dict(os.environ, TEHABLO_PS1=str(ROOT / 'receptor/install.ps1'))
        result = subprocess.run([shutil.which('powershell'), '-NoProfile', '-NonInteractive', '-Command', script],
                                env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
        out = result.stdout.decode('utf-8')
        self.assertEqual(result.returncode, 0, out + result.stderr.decode('utf-8', 'replace'))
        for line in END_LINES:
            self.assertIn(line, out)
        self.assertNotIn('Write-Host', out)
        self.assertTrue(out.startswith('\n[Cliente instalado]\n'), out)
        self.assertIn('oír la voz.\n\n', out)


@unittest.skipUnless(POWERSHELL, 'needs PowerShell')
class WindowsInstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.env = dict(os.environ, HOME=str(self.home))

    def run_piped(self, download):
        # Stub functions shadow uv and Invoke-WebRequest; nothing is downloaded or run.
        script = (
            'function uv { $args | Set-Content (Join-Path $env:HOME "uv-args"); $global:LASTEXITCODE = 0 }\n'
            'function Invoke-WebRequest { param([switch]$UseBasicParsing, $Uri, $OutFile) ' + download + ' }\n'
            '& ([scriptblock]::Create((Get-Content -Raw $env:TEHABLO_PS1))) -Yes\n')
        env = dict(self.env, TEHABLO_PS1=str(ROOT / 'receptor/install.ps1'))
        return subprocess.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-Command', script], env=env,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)

    def test_interrupted_download_does_not_leave_a_broken_client(self):
        client = self.home / '.local/share/tehablo-cliente/tehablo_cliente.py'
        # A cut connection: part of the file is written, then the request fails.
        result = self.run_piped("Set-Content $OutFile '# half'; throw 'cut'")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(client.exists())
        self.assertFalse((self.home / 'uv-args').exists())

        result = self.run_piped("Set-Content $OutFile '# fake client'")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(client.read_text().strip(), '# fake client')
        self.assertFalse(client.with_name(client.name + '.part').exists())
        self.assertIn('Cliente instalado', result.stdout)


if __name__ == '__main__':
    unittest.main()
