import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, statSync, renameSync, mkdirSync, rmSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileStore} from '../src/extension.ts';
import {DEFAULTS, saveSettings} from '../src/settings.ts';

const directories: string[] = [];
after(() => { for (const dir of directories) rmSync(dir, {recursive: true, force: true}); });

// Each store represents a separate Pi process, sharing only the file.
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tehablo-sync-'));
  directories.push(dir);
  saveSettings(dir, DEFAULTS);
  return {dir, file: join(dir, 'settings.json'), a: fileStore(dir, dir), b: fileStore(dir, dir)};
};

test('S2: stale sessions merge only changed keys, nested entries and the voice/model pair', () => {
  const {a,b} = fixture();
  let x = a.load(), y = b.load();
  a.save({...x, volume: 0.7, dict: {lola: false}, shortcuts: {play: 'ctrl+p'}, model: 'phonon', voice: 'Iker'});
  b.save({...y, speed: 1.25, dict: {Regina: true}, shortcuts: {stop: 'ctrl+s'}});
  x = a.load();
  assert.equal(x.volume, 0.7);
  assert.equal(x.speed, 1.25);
  assert.deepEqual(x.dict, {lola: false, Regina: true});
  assert.deepEqual(x.shortcuts, {play: 'ctrl+p', stop: 'ctrl+s'});
  assert.equal(x.model, 'phonon'); assert.equal(x.voice, 'Iker');
  y = b.load();
  a.save({...x, shortcuts: {stop: 'ctrl+s'}});
  b.save({...y, toolbar: false, indicator: false});
  const merged = a.load();
  assert.deepEqual(merged.shortcuts, {stop: 'ctrl+s'});
  assert.equal(merged.toolbar, false);
  assert.equal(merged.indicator, false);
  a.save({...merged, indicator: true});
  assert.equal(b.load().indicator, true);
});

test('S6 rhythm defaults, validates presets and merges independently of speed', () => {
  const {a, b, file} = fixture();
  const x = a.load(), y = b.load();
  assert.equal(x.rhythm, 0);
  a.save({...x, rhythm: -0.5});
  b.save({...y, speed: 1.25});
  assert.equal(a.load().rhythm, -0.5);
  assert.equal(a.load().speed, 1.25);
  for (const value of [-1, -0.5, 0, 0.5, 1]) {
    writeFileSync(file, JSON.stringify({...DEFAULTS, rhythm: value}));
    assert.equal(a.load().rhythm, value);
  }
  for (const value of [true, '0', null, -2, 2, 0.25]) {
    writeFileSync(file, JSON.stringify({...DEFAULTS, rhythm: value}));
    assert.equal(a.load().rhythm, 0);
  }
});

test('S3: malformed and unreadable files retain the last good store snapshot', () => {
  const {a, file, dir} = fixture();
  a.load(); a.save({...DEFAULTS, volume: 0.7}); a.load();
  writeFileSync(file, '{broken');
  assert.equal(a.load().volume, 0.7);
  writeFileSync(file, 'null');
  assert.equal(a.load().volume, 0.7);
  renameSync(file, join(dir, 'saved.json')); mkdirSync(file);
  assert.equal(a.load().volume, 0.7, 'an unreadable path also keeps the last good value');
});

test('S3: saves atomically replace the file rather than truncating its inode', () => {
  const {a, file, dir} = fixture();
  const before = statSync(file).ino;
  a.load(); a.save({...DEFAULTS, speed: 1.25});
  assert.notEqual(statSync(file).ino, before);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).speed, 1.25);
  assert.deepEqual(readdirSync(dir), ['settings.json']);
});

test('S4: store change detection uses file metadata and acknowledges loads', () => {
  const {a,b} = fixture();
  a.load(); b.load();
  assert.equal(a.changed?.(), false);
  b.save({...DEFAULTS, toolbar: false});
  assert.equal(a.changed?.(), true);
  a.load(); assert.equal(a.changed?.(), false);
});

test('S5: legacy auto is ignored and never written back', () => {
  const {a, file} = fixture();
  writeFileSync(file, JSON.stringify({...DEFAULTS, auto: true}));
  assert.equal(a.load().auto, false);
  a.save({...a.load(), auto: true, speed: 1.25});
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(file, 'utf8')), 'auto'), false);
});
