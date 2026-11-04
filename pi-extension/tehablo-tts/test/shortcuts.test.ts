import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keyOf, label, usedByPi} from '../src/shortcuts.ts';

test('legacy terminal sequences decode to Ctrl/Alt combinations', () => {
  assert.equal(keyOf('\x10'), 'ctrl+p');
  assert.equal(keyOf('\x1bp'), 'alt+p');
  assert.equal(keyOf('\x1b\x10'), 'ctrl+alt+p');
  assert.equal(keyOf('\x1b5'), 'alt+5');
});

test('kitty sequences decode with modifiers and ignore key releases', () => {
  assert.equal(keyOf('\x1b[112;5u'), 'ctrl+p');
  assert.equal(keyOf('\x1b[112;7u'), 'ctrl+alt+p');
  assert.equal(keyOf('\x1b[80;6u'), 'ctrl+shift+p');
  assert.equal(keyOf('\x1b[112;5:3u'), '');
});

test('plain keys, Enter, Esc, Tab, Backspace, arrows and unknown sequences are refused', () => {
  for (const data of ['p', 'P', '\r', '\x1b', '\t', '\x7f', '\x1b[A', '\x1b[112u', '\x1b[112;2u', '\x1bOP', '\x08', '\x09'])
    assert.equal(keyOf(data), '', JSON.stringify(data));
});

test('labels are readable', () => {
  assert.equal(label('ctrl+alt+p'), 'Ctrl+Alt+P');
  assert.equal(label(undefined), '(sin atajo)');
});

test('conflicts with Pi use its resolved bindings in any modifier order', () => {
  const kb = {getResolvedBindings: () => ({'app.model.select': 'ctrl+l', 'app.model.cycleBackward': ['shift+ctrl+p'], 'app.none': []})};
  assert.equal(usedByPi(kb, 'ctrl+l'), true);
  assert.equal(usedByPi(kb, 'ctrl+shift+p'), true);
  assert.equal(usedByPi(kb, 'ctrl+alt+p'), false);
  assert.equal(usedByPi({}, 'ctrl+l'), false);
});
