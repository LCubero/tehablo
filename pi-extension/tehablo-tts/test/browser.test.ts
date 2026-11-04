import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCommand} from '../src/browser.ts';

test('each system opens a link with its own built-in tool', () => {
  assert.equal(browserCommand('win32'), 'explorer.exe');
  assert.equal(browserCommand('darwin'), 'open');
  assert.equal(browserCommand('linux'), 'xdg-open');
});
