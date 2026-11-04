import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SettingsWindow, type Controller} from '../src/window.ts';
import {DEFAULTS, type VoiceRow} from '../src/settings.ts';

const ROWS: VoiceRow[] = [
  {name: 'Regina', voice: 'Regina', model: 'phonon', kind: 'account', note: 'México', downloaded: false},
  {name: 'rafael', voice: 'rafael', model: 'spanish', kind: 'download', note: 'España', downloaded: false},
  {name: 'lola', voice: 'lola', model: 'spanish', kind: 'download', note: 'la de siempre', downloaded: true},
  {name: 'ar-hombre-4310', voice: 'ar-hombre-4310.wav', model: 'spanish', kind: 'account', note: 'Argentina, clonada', downloaded: false},
];
const KEYS: Record<string, string> = {'\x1b[A': 'tui.select.up', '\x1b[B': 'tui.select.down', '\r': 'tui.select.confirm',
  '\x1b': 'tui.select.cancel', '\x1b[D': 'tui.editor.cursorLeft', '\x1b[C': 'tui.editor.cursorRight', '\x7f': 'tui.editor.deleteCharBackward'};
const kb = {matches: (data: string, id: string) => KEYS[data] === id, getResolvedBindings: () => ({'app.model.select': 'ctrl+l'})};
const theme = {fg: (_: string, t: string) => t};

function setup(over: Partial<Record<string, any>> = {}) {
  const calls: any[] = [];
  let closed = false;
  const state = {settings: {...DEFAULTS, voice: 'lola', model: 'spanish'}, server: 'off' as 'off' | 'loading' | 'ready', token: false, ...over};
  const c: Controller = {
    state: () => state as any,
    active: () => state.settings.voice ? {model: state.settings.model, voice: state.settings.voice} : {model: 'spanish', voice: 'lola'},
    voices: () => ROWS,
    choose: row => { calls.push(['choose', row.voice, row.model]); state.settings = {...state.settings, voice: row.voice, model: row.model}; },
    change: (field, value) => { calls.push(['change', field, value]); (state.settings as any)[field] = value; },
    power: action => { calls.push(['power', action]); if (action !== 'restart') state.server = action === 'on' ? 'ready' : 'off'; },
    saveToken: value => { if (value === 'bad') throw new Error('El token no es válido: copia el token completo de Hugging Face.'); calls.push(['token', value.length]); state.token = true; },
    setShortcut: (action, key) => { calls.push(['shortcut', action, key]); const sc = {...state.settings.shortcuts}; if (key) sc[action] = key; else delete sc[action]; state.settings = {...state.settings, shortcuts: sc}; },
  };
  const w = new SettingsWindow(c, theme, kb, () => { closed = true; }, () => {});
  return {w, calls, state, closed: () => closed, text: () => w.render(100).join('\n'), key: (k: string) => w.handleInput(k),
    click: (label: string) => {
      const lines = w.render(100);
      const y = lines.findIndex(l => l.includes(label));
      assert.ok(y >= 0, `missing ${label}`);
      const x = Array.from(lines[y]).indexOf(Array.from(label)[0], Array.from(lines[y].slice(0, lines[y].indexOf(label))).length);
      w.handleMouse({type: 'click', button: 'left', x, y});
    }};
}

test('main window shows active voice, sound, auto, shortcuts and server buttons', () => {
  const s = setup();
  const text = s.text();
  for (const part of ['tehablo · Ajustes', 'lola · la de siempre', '[ Cambiar ]', '◀ 100 % ▶', '◀ 1.00x ▶', 'Lectura automática',
    'Atajos de teclado', '[ Editar ]', 'Servidor ○ apagado', '[ Encender ]', '[ Reiniciar ]', '[ Cerrar ]']) assert.ok(text.includes(part), part);
  s.click('[ Reiniciar ]');
  assert.deepEqual(s.calls, []);
  s.click('[ Encender ]');
  assert.deepEqual(s.calls, [['power', 'on']]);
  assert.ok(s.text().includes('Servidor ● activo') && s.text().includes('[ Apagar ]'));
  s.click('[ Reiniciar ]');
  s.click('[ Apagar ]');
  assert.deepEqual(s.calls.slice(1), [['power', 'restart'], ['power', 'off']]);
});

test('keyboard changes volume, speed and auto within their limits', () => {
  const s = setup();
  s.key('\x1b[B'); s.key('\x1b[C');
  assert.deepEqual(s.calls.at(-1), ['change', 'volume', 1.25]);
  for (let i = 0; i < 9; i++) s.key('\x1b[D');
  assert.deepEqual(s.calls.at(-1), ['change', 'volume', 0.1]);
  s.key('\x1b[B'); s.key('\x1b[C');
  assert.deepEqual(s.calls.at(-1), ['change', 'speed', 1.1]);
  s.key('\x1b[B'); s.key('\r');
  assert.deepEqual(s.calls.at(-1), ['change', 'auto', true]);
  s.key('\x1b');
  assert.equal(s.closed(), true);
});

test('voice table orders downloaded, downloadable, then account voices and marks the active one', () => {
  const s = setup();
  s.click('[ Cambiar ]');
  const lines = s.w.render(100);
  const order = ['lola', 'rafael', 'Regina', 'ar-hombre-4310'].map(n => lines.findIndex(l => l.includes(n + ' (') || l.includes(n + ' * (')));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(lines[order[0]].includes('Descargada') && lines[order[0]].includes('● activa'));
  assert.ok(lines[order[1]].includes('Para descargar'));
  assert.ok(lines[order[2]].includes('Con cuenta gratis'));
});

test('choosing by type: downloaded activates, downloadable confirms, account asks for the token first', () => {
  const s = setup();
  s.click('[ Cambiar ]'); s.click('rafael (');
  assert.ok(s.text().includes('[ Descargar y usar ]'));
  s.click('[ Descargar y usar ]');
  assert.deepEqual(s.calls.at(-1), ['choose', 'rafael', 'spanish']);
  s.click('[ Cambiar ]'); s.click('Regina * (');
  const guide = s.text();
  for (const part of ['huggingface.co/join', 'huggingface.co/settings/tokens', 'Token:']) assert.ok(guide.includes(part), part);
  for (const ch of 'hf_secret') s.key(ch);
  s.key('\x1b[200~X\x1b[201~');
  assert.ok(s.text().includes('••••••••••') && !s.text().includes('hf_secret'));
  s.key('\r');
  assert.deepEqual(s.calls.at(-1), ['token', 10]);
  assert.ok(s.text().includes('[ Descargar y usar ]'));
  s.key('\r');
  assert.deepEqual(s.calls.at(-1), ['choose', 'Regina', 'phonon']);
});

test('an invalid token shows the error and keeps the field without revealing it', () => {
  const s = setup();
  s.click('[ Cambiar ]'); s.click('Regina * (');
  for (const ch of 'bad') s.key(ch);
  s.key('\r');
  const text = s.text();
  assert.ok(text.includes('El token no es válido'));
  assert.ok(text.includes('Token: •••'));
  assert.ok(!s.calls.some(c => c[0] === 'token'));
});

test('with a saved token, account voices skip the guide', () => {
  const s = setup({token: true});
  s.click('[ Cambiar ]');
  assert.ok(s.text().includes('Con cuenta ✓'));
  s.click('Regina * (');
  assert.ok(s.text().includes('[ Descargar y usar ]'));
});

test('Editar opens the shortcuts table; keys are captured, validated and removable', () => {
  const s = setup();
  s.click('[ Editar ]');
  const table = s.text();
  for (const part of ['Atajos de teclado', 'Encender / apagar TTS', 'Lectura automática sí/no', 'Escuchar la última respuesta',
    'Pausar / seguir', 'Detener', 'Abrir ajustes', '(sin atajo)']) assert.ok(table.includes(part), part);
  s.key('\r');
  assert.ok(s.text().includes('Presiona la combinación'));
  s.key('p');
  assert.ok(s.text().includes('Usa Ctrl o Alt con una letra o un número.'));
  s.key('\x0c');
  assert.ok(s.text().includes('Pi ya usa Ctrl+L.'));
  s.key('\x1b\x10');
  assert.deepEqual(s.calls.at(-1), ['shortcut', 'power', 'ctrl+alt+p']);
  assert.ok(s.text().includes('Ctrl+Alt+P'));
  s.key('\x1b[B'); s.key('\r'); s.key('\x1b\x10');
  assert.ok(s.text().includes('Ya la usa «Encender / apagar TTS».'));
  s.key('\x1b');
  assert.ok(!s.text().includes('Presiona la combinación'));
  assert.equal(s.calls.filter(c => c[0] === 'shortcut').length, 1);
  s.click('[ Quitar ]');
  assert.deepEqual(s.calls.at(-1), ['shortcut', 'power', undefined]);
  s.key('\x1b');
  assert.ok(s.text().includes('tehablo · Ajustes'));
});

test('with the server off, unknown download state is shown by kind and chosen without a download step', () => {
  const rows = [{name: 'lola', voice: 'lola', model: 'spanish', kind: 'download', note: 'la de siempre', downloaded: null},
    {name: 'Regina', voice: 'Regina', model: 'phonon', kind: 'account', note: 'México', downloaded: null}];
  const s = setup({settings: {...DEFAULTS}});
  (s.w.c as any).voices = () => rows;
  s.click('[ Cambiar ]');
  const text = s.text();
  assert.ok(text.includes('Sin cuenta') && text.includes('Con cuenta gratis'));
  assert.match(text.split('\n').find(l => l.includes('lola ('))!, /● activa/);
  s.click('lola (');
  assert.deepEqual(s.calls.at(-1), ['choose', 'lola', 'spanish']);
});

test('the main row names the active voice even when none was chosen', () => {
  const s = setup({settings: {...DEFAULTS}});
  assert.ok(s.text().includes('lola · la de siempre'));
});

test('account voices carry a * and the table explains it', () => {
  const s = setup();
  s.click('[ Cambiar ]');
  const lines = s.w.render(100);
  assert.ok(lines.find(l => l.includes('Regina'))!.includes('Regina * (México)'));
  assert.ok(lines.find(l => l.includes('ar-hombre-4310'))!.includes('ar-hombre-4310 * ('));
  assert.ok(!lines.find(l => l.includes('lola ('))!.includes('*'));
  assert.ok(lines.some(l => l.includes('* necesita una cuenta gratis de Hugging Face (1 sola vez)')));
});
