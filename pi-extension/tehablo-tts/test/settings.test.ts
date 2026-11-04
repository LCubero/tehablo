import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULTS, loadSettings, saveSettings} from '../src/settings.ts';

const withRoot = (run: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'tehablo-settings-'));
  try { run(root); } finally { rmSync(root, {recursive: true, force: true}); }
};

test('missing file gives defaults and saving writes tehablo-settings.json', () => withRoot(root => {
  assert.deepEqual(loadSettings(root), DEFAULTS);
  const s = {...DEFAULTS, voice: 'Iker', model: 'phonon', volume: 0.75, speed: 1.25, auto: true, shortcutsOn: true,
    shortcuts: {pause: 'ctrl+alt+p'}};
  saveSettings(root, s);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'tehablo-settings.json'), 'utf8')), s);
  assert.deepEqual(loadSettings(root), s);
}));

test('invalid JSON or wrong types fall back field by field without throwing', () => withRoot(root => {
  writeFileSync(join(root, 'tehablo-settings.json'), '{not json');
  assert.deepEqual(loadSettings(root), DEFAULTS);
  writeFileSync(join(root, 'tehablo-settings.json'), JSON.stringify({
    voice: 5, model: 'gpt', volume: 9, speed: 0.3, auto: 'yes', shortcutsOn: true,
    shortcuts: {pause: 'ctrl+alt+p', bad: 3, unknown: 'ctrl+x'}, voices: 'x'}));
  assert.deepEqual(loadSettings(root), {...DEFAULTS, shortcutsOn: true, shortcuts: {pause: 'ctrl+alt+p'}});
}));

test('known voice table entries survive a reload', () => withRoot(root => {
  const voices = [{name: 'lola', voice: 'lola', model: 'spanish', kind: 'download', note: 'la de siempre', downloaded: true}];
  saveSettings(root, {...DEFAULTS, voices});
  assert.deepEqual(loadSettings(root).voices, voices);
}));
