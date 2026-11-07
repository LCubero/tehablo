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

test('S21 receiver success persists and survives unrelated stale-session saves', () => withDirs((dir) => {
  assert.equal(loadSettings(dir).sshListo, false);
  saveSettings(dir, DEFAULTS);
  const stale = loadSettings(dir);
  saveSettings(dir, {...stale, sshListo: true}, stale);
  saveSettings(dir, {...stale, volume: .5}, stale);
  assert.equal(loadSettings(dir).sshListo, true);
  assert.equal(loadSettings(dir).volume, .5);
}));

test('settings live in .tehablo inside the user folder', () => {
  assert.equal(settingsDir(), join(homedir(), '.tehablo'));
});

test('missing file gives defaults and saving creates the folder and settings.json', () => withDirs((dir, project) => {
  assert.deepEqual(loadSettings(dir, project), DEFAULTS);
  const s = {...DEFAULTS, voice: 'Iker', model: 'phonon', volume: 0.75, speed: 1.25, auto: true, toolbar: false, indicator: false, shortcutsOn: true,
    shortcuts: {pause: 'ctrl+alt+p'}};
  saveSettings(dir, s);
  const {auto, ...shared} = s;
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')), shared);
  assert.deepEqual(loadSettings(dir, project), {...s, auto: false});
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
    voice: 5, model: 'gpt', volume: 9, speed: 0.3, auto: 'yes', toolbar: 'no', indicator: 'no', shortcutsOn: true,
    shortcuts: {pause: 'ctrl+alt+p', bad: 3, unknown: 'ctrl+x'}, voices: 'x'}));
  assert.deepEqual(loadSettings(dir, project), {...DEFAULTS, shortcutsOn: true, shortcuts: {pause: 'ctrl+alt+p'}});
}));

test('dict loads boolean overrides field by field', () => withDirs((dir, project) => {
  for (const dict of [null, 'bad', [], 4, {lola:false, Regina:true, Iker:'no', other:1}]) {
    saveSettings(dir, {...DEFAULTS, dict} as any);
    assert.deepEqual(loadSettings(dir, project).dict,
      dict && !Array.isArray(dict) && typeof dict === 'object' ? {lola:false, Regina:true} : {});
  }
}));

test('playback policy persists and invalid or missing values default to stop', () => withDirs((dir, project) => {
  assert.equal(loadSettings(dir, project).policy, 'stop');
  for (const policy of ['wait', 'stop', 'pause', null, 2]) {
    saveSettings(dir, {...DEFAULTS, policy} as any);
    assert.equal(loadSettings(dir, project).policy, policy === 'wait' ? 'wait' : 'stop');
  }
}));

test('icon mode defaults, normalizes and merges across sessions', () => withDirs((dir, project) => {
  assert.equal(loadSettings(dir, project).icons, 'symbols');
  for (const icons of [undefined, 'invalid', null, 1, 'text', 'symbols']) {
    saveSettings(dir, {...DEFAULTS, icons} as any);
    assert.equal(loadSettings(dir, project).icons, icons === 'text' ? 'text' : 'symbols');
  }
  const before = loadSettings(dir, project);
  saveSettings(dir, {...before, icons: 'text'}, before);
  saveSettings(dir, {...before, speed: 1.25}, before);
  assert.equal(loadSettings(dir, project).icons, 'text');
  assert.equal(loadSettings(dir, project).speed, 1.25);
}));

test('audio defaults to local, rejects invalid values and merges with icons', () => withDirs((dir, project) => {
  assert.equal(loadSettings(dir, project).audio, 'local');
  for (const audio of ['ssh', 'local', 'bad', null, 3]) {
    saveSettings(dir, {...DEFAULTS, audio} as any);
    assert.equal(loadSettings(dir, project).audio, audio === 'ssh' ? 'ssh' : 'local');
  }
  const before = loadSettings(dir, project);
  saveSettings(dir, {...before, audio: 'ssh'}, before);
  saveSettings(dir, {...before, icons: 'text'}, before);
  assert.equal(loadSettings(dir, project).audio, 'ssh');
  assert.equal(loadSettings(dir, project).icons, 'text');
}));

test('S11 device defaults, rejects bad values and merges without changing sound/icons', () => withDirs((dir, project) => {
  assert.equal(loadSettings(dir, project).device, '');
  for (const device of [null, 3, true, {}, [], 'Headphones', '']) {
    saveSettings(dir, {...DEFAULTS, device} as any);
    assert.equal(loadSettings(dir, project).device, typeof device === 'string' ? device : '');
  }
  const before = loadSettings(dir, project);
  saveSettings(dir, {...before, device: 'Headphones'}, before);
  saveSettings(dir, {...before, volume: .5, speed: 1.25, icons: 'text'}, before);
  const s = loadSettings(dir, project);
  assert.equal(s.device, 'Headphones');
  assert.equal(s.volume, .5); assert.equal(s.speed, 1.25); assert.equal(s.icons, 'text');
}));

test('known voice table entries survive a reload', () => withDirs((dir, project) => {
  const voices = [{name: 'lola', voice: 'lola', model: 'spanish', kind: 'download', note: 'la de siempre', downloaded: true}];
  saveSettings(dir, {...DEFAULTS, voices});
  assert.deepEqual(loadSettings(dir, project).voices, voices);
}));
