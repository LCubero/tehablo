import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hasToken, saveToken} from '../src/token.ts';

const withRoot = (run: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'tehablo-token-'));
  try { run(root); } finally { rmSync(root, {recursive: true, force: true}); }
};

test('saving creates .env with only HF_TOKEN and private permissions', () => withRoot(root => {
  assert.equal(hasToken(root, {}), false);
  saveToken(root, 'hf_abcDEF123');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'HF_TOKEN=hf_abcDEF123\n');
  assert.equal(hasToken(root, {}), true);
  if (process.platform !== 'win32') assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
}));

test('saving replaces an existing HF_TOKEN and keeps the other lines', () => withRoot(root => {
  writeFileSync(join(root, '.env'), '# mine\nOTHER=1\nHF_TOKEN=hf_old\nTEHABLO_PORT=9000\n');
  saveToken(root, 'hf_new');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), '# mine\nOTHER=1\nHF_TOKEN=hf_new\nTEHABLO_PORT=9000\n');
}));

test('saving appends to a file without trailing newline', () => withRoot(root => {
  writeFileSync(join(root, '.env'), 'OTHER=1');
  saveToken(root, 'hf_x1');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'OTHER=1\nHF_TOKEN=hf_x1\n');
}));

test('invalid tokens are rejected without echoing them and leave .env unchanged', () => withRoot(root => {
  writeFileSync(join(root, '.env'), 'OTHER=1\n');
  for (const bad of ['', '   ', 'hf_a b', 'hf_a\nEVIL=1', 'hf_"quoted"']) {
    assert.throws(() => saveToken(root, bad), (error: Error) => {
      assert.equal(error.message, 'El token no es válido: copia el token completo de Hugging Face.');
      return true;
    });
  }
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'OTHER=1\n');
}));

test('token presence comes from .env or the environment, and empty values do not count', () => withRoot(root => {
  writeFileSync(join(root, '.env'), 'HF_TOKEN=\n');
  assert.equal(hasToken(root, {}), false);
  assert.equal(hasToken(root, {HF_TOKEN: 'hf_env'}), true);
  writeFileSync(join(root, '.env'), 'HF_TOKEN="hf_q"\n');
  assert.equal(hasToken(root, {}), true);
}));

test('rejects boundary whitespace without changing existing bytes', () => withRoot(root => {
  const file = join(root, '.env');
  const before = Buffer.from('# keep\r\nOTHER=1\r\n');
  writeFileSync(file, before);
  for (const value of [' hf_new', 'hf_new ', '\thf_new', 'hf_new\n', '\r\nhf_new']) {
    assert.throws(() => saveToken(root, value), {message: 'El token no es válido: copia el token completo de Hugging Face.'});
    assert.deepEqual(readFileSync(file), before);
  }
}));

test('preserves CRLF comments and unrelated assignments', () => withRoot(root => {
  const file = join(root, '.env');
  writeFileSync(file, '# keep\r\nOTHER=1\r\nHF_TOKEN=hf_old\r\n');
  saveToken(root, 'hf_new');
  assert.equal(readFileSync(file, 'utf8'), '# keep\r\nOTHER=1\r\nHF_TOKEN=hf_new\r\n');
}));

test('presence follows the server: environment first, then the first assignment', () => withRoot(root => {
  const file = join(root, '.env');
  writeFileSync(file, 'HF_TOKEN=hf_file\n');
  assert.equal(hasToken(root, {HF_TOKEN: ''}), false);
  assert.equal(hasToken(root, {HF_TOKEN: 'hf_env'}), true);
  writeFileSync(file, 'HF_TOKEN=\nHF_TOKEN=hf_second\n');
  assert.equal(hasToken(root, {}), false);
  writeFileSync(file, 'HF_TOKEN=\'""\'\n');
  assert.equal(hasToken(root, {}), false);
}));

test('a rewrite makes an existing file private', () => withRoot(root => {
  const file = join(root, '.env');
  writeFileSync(file, 'HF_TOKEN=hf_old\n', {mode: 0o644});
  saveToken(root, 'hf_new');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
}));

test('refuses a symlinked .env without modifying its target', {skip: process.platform === 'win32'}, () => withRoot(root => {
  const target = join(root, 'other');
  writeFileSync(target, 'OTHER=keep\n');
  symlinkSync(target, join(root, '.env'));
  assert.throws(() => saveToken(root, 'hf_new'), {message: 'No se guardó el token: .env es un enlace; reemplázalo por un archivo normal.'});
  assert.equal(readFileSync(target, 'utf8'), 'OTHER=keep\n');
}));
