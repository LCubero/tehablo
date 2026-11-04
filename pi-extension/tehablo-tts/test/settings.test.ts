import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULTS, loadSettings, saveSettings, settingsDir} from '../src/settings.ts';

// dir is the user folder (~/.tehablo), project is the repository root with the old tehablo-settings.json.
const withDirs = (run: (dir: string, project: string) => void) => {
  const base = mkdtempSync(join(tmpdir(), 'tehablo-settings-'));
  try { run(join(base, 'home', '.tehablo'), base); } finally { rmSync(base, {recursive: true, force: true}); }
};

test('settings live in .tehablo inside the user folder', () => {
  assert.equal(settingsDir(), join(homedir(), '.tehablo'));
});

test('missing file gives defaults and saving creates the folder and settings.json', () => withDirs((dir, project) => {
  assert.deepEqual(loadSettings(dir, project), DEFAULTS);
  const s = {...DEFAULTS, voice: 'Iker', model: 'phonon', volume: 0.75, speed: 1.25, auto: true, shortcutsOn: true,
    shortcuts: {pause: 'ctrl+alt+p'}};
  saveSettings(dir, s);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), s);
  assert.deepEqual(loadSettings(dir, project), s);
  assert.equal(existsSync(join(project, 'tehablo-settings.json')), false);
}));

test('without user settings the old project file is read once, and left unchanged', () => withDirs((dir, project) => {
  const old = JSON.stringify({...DEFAULTS, voice: 'Regina', model: 'phonon'});
  writeFileSync(join(project, 'tehablo-settings.json'), old);
  assert.deepEqual(loadSettings(dir, project), {...DEFAULTS, voice: 'Regina', model: 'phonon'});
  saveSettings(dir, {...DEFAULTS, voice: 'lola', model: 'spanish'});
  assert.deepEqual(loadSettings(dir, project), {...DEFAULTS, voice: 'lola', model: 'spanish'});
  assert.equal(readFileSync(join(project, 'tehablo-settings.json'), 'utf8'), old);
}));

test('invalid JSON or wrong types fall back field by field without throwing', () => withDirs((dir, project) => {
  saveSettings(dir, DEFAULTS);
  writeFileSync(join(dir, 'settings.json'), '{not json');
  assert.deepEqual(loadSettings(dir, project), DEFAULTS);
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({
    voice: 5, model: 'gpt', volume: 9, speed: 0.3, auto: 'yes', shortcutsOn: true,
    shortcuts: {pause: 'ctrl+alt+p', bad: 3, unknown: 'ctrl+x'}, voices: 'x'}));
  assert.deepEqual(loadSettings(dir, project), {...DEFAULTS, shortcutsOn: true, shortcuts: {pause: 'ctrl+alt+p'}});
}));

test('known voice table entries survive a reload', () => withDirs((dir, project) => {
  const voices = [{name: 'lola', voice: 'lola', model: 'spanish', kind: 'download', note: 'la de siempre', downloaded: true}];
  saveSettings(dir, {...DEFAULTS, voices});
  assert.deepEqual(loadSettings(dir, project).voices, voices);
}));
