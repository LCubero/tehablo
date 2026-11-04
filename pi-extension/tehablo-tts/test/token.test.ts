import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkToken, hasToken} from '../src/token.ts';

const withRoot = (run: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'tehablo-token-'));
  try { run(root); } finally { rmSync(root, {recursive: true, force: true}); }
};

test('a valid token passes the check and is never written anywhere', () => withRoot(root => {
  assert.doesNotThrow(() => checkToken('hf_abcDEF123'));
  assert.deepEqual(readdirSync(root), []);
  assert.equal(hasToken(root, {}), false);
}));

test('invalid tokens are rejected without echoing them', () => {
  for (const bad of ['', '   ', 'hf_a b', 'hf_a\nEVIL=1', 'hf_"quoted"', ' hf_new', 'hf_new ', '\thf_new', 'hf_new\n', '\r\nhf_new']) {
    assert.throws(() => checkToken(bad), (error: Error) => {
      assert.equal(error.message, 'El token no es válido: copia el token completo de Hugging Face.');
      return true;
    });
  }
});

test('token presence comes from .env or the environment, and empty values do not count', () => withRoot(root => {
  writeFileSync(join(root, '.env'), 'HF_TOKEN=\n');
  assert.equal(hasToken(root, {}), false);
  assert.equal(hasToken(root, {HF_TOKEN: 'hf_env'}), true);
  writeFileSync(join(root, '.env'), 'HF_TOKEN="hf_q"\n');
  assert.equal(hasToken(root, {}), true);
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
