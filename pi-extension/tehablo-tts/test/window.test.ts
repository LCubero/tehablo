import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SettingsWindow, type Controller} from '../src/window.ts';
import {DEFAULTS, type VoiceRow} from '../src/settings.ts';

const ROWS: VoiceRow[] = [
  {name: 'Regina', voice: 'Regina', model: 'phonon', kind: 'account', note: 'México', downloaded: false},
  {name: 'Iker', voice: 'Iker', model: 'phonon', kind: 'account', note: 'España', downloaded: false},
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
    download: async row => { c.choose(row); },
    change: (field, value) => { calls.push(['change', field, value]); (state.settings as any)[field] = value; },
    power: action => { calls.push(['power', action]); if (action !== 'restart') state.server = action === 'on' ? 'ready' : 'off'; },
    saveToken: value => { if (value === 'bad') throw new Error('El token no es válido: copia el token completo de Hugging Face.'); calls.push(['token', value.length]); state.token = true; },
    open: url => calls.push(['open', url]),
    dict: row => state.settings.dict[row.voice] ?? row.model !== 'phonon',
    toggleDict: row => { calls.push(['dict', row.voice]); state.settings = {...state.settings, dict: {...state.settings.dict, [row.voice]: !c.dict(row)}}; },
    setShortcut: (action, key) => { calls.push(['shortcut', action, key]); const sc = {...state.settings.shortcuts}; if (key) sc[action] = key; else delete sc[action]; state.settings = {...state.settings, shortcuts: sc}; },
  };
  const w = new SettingsWindow(c, over.theme ?? theme, kb, () => { closed = true; }, () => {});
  return {w, calls, state, closed: () => closed, text: () => w.render(100).join('\n'), key: (k: string) => w.handleInput(k),
    click: (label: string) => {
      const lines = w.render(100);
      const y = lines.findIndex(l => l.includes(label));
      assert.ok(y >= 0, `missing ${label}`);
      const x = Array.from(lines[y]).indexOf(Array.from(label)[0], Array.from(lines[y].slice(0, lines[y].indexOf(label))).length);
      w.handleMouse({type: 'click', button: 'left', x, y});
    }};
}

test('S3 download confirmation prepares now and reports completion or error', async () => {
  const s = setup();
  let finish!: () => void;
  (s.w.c as any).download = () => new Promise<void>(resolve => { finish = resolve; });
  s.w.choose(ROWS[2]);
  s.w.confirm();
  assert.match(s.text(), /Descargando rafael…/);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.text(), /rafael lista/);
  (s.w.c as any).download = async () => { throw new Error('Sin conexión'); };
  s.w.choose(ROWS[2]); s.w.confirm();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.text(), /Sin conexión/);
});

test('S4 Regina and Iker keep token then prepare their own model', async () => {
  for (const row of ROWS.slice(0, 2)) {
    const s = setup();
    (s.w.c as any).download = async (voice: any) => { s.calls.push(['prepare', voice.voice, voice.model]); };
    s.w.choose(row);
    assert.equal(s.w.page, 'token');
    s.w.token = 'test-placeholder'; s.w.saveToken();
    assert.equal(s.w.page, 'download');
    s.w.confirm();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(s.calls, [['token', 16], ['prepare', row.voice, row.model]]);
  }
});

test('main window shows active voice, sound, auto, shortcuts and server buttons', () => {
  const s = setup();
  const text = s.text();
  for (const part of ['teHablo · Ajustes', 'lola · la de siempre', '[ Cambiar ]', '◀ 100 % ▶', '◀ 1.00x ▶', 'Lectura automática',
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

test('S11 output row cycles devices with keyboard and click, disabled in SSH', () => {
  const s = setup();
  (s.w.c as any).devices = () => ['Speakers', 'Headphones'];
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida');
  assert.ok(s.w.row >= 0);
  assert.ok(s.text().includes('Predeterminada'));
  s.key('\x1b[C');
  assert.equal(s.state.settings.device, 'Speakers');
  s.click('Speakers');
  assert.equal(s.state.settings.device, 'Headphones');
  s.key('\x1b[C');
  assert.equal(s.state.settings.device, '');
  s.key('\x1b[D');
  assert.equal(s.state.settings.device, 'Headphones');
  s.state.settings.audio = 'ssh';
  assert.ok(s.text().includes('(SSH: la elige el cliente)'));
  s.key('\x1b[C');
  assert.equal(s.state.settings.device, 'Headphones');
  assert.equal(s.state.settings.volume, 1);
  assert.equal(s.state.settings.speed, 1);
  assert.equal(s.state.settings.icons, 'symbols');
});

test('audio row supports click and left/right without changing icons', () => {
  const s = setup();
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Audio');
  assert.ok(s.text().includes('Local'));
  s.key('\x1b[C');
  assert.equal(s.state.settings.audio, 'ssh');
  assert.ok(s.text().includes('SSH'));
  s.key('\x1b[D');
  assert.equal(s.state.settings.audio, 'local');
  s.click('Local');
  assert.equal(s.state.settings.audio, 'ssh');
  assert.equal(s.state.settings.icons, 'symbols');
});

test('icon row supports mouse and keyboard', () => {
  const s = setup();
  assert.match(s.text(), /Iconos/);
  s.click('Símbolos');
  assert.deepEqual(s.calls.at(-1), ['change', 'icons', 'text']);
  assert.match(s.text(), /Texto/);
  s.key('\x1b[D');
  assert.deepEqual(s.calls.at(-1), ['change', 'icons', 'symbols']);
  s.key('\r');
  assert.deepEqual(s.calls.at(-1), ['change', 'icons', 'text']);
});

test('policy and toolbar rows support keyboard and mouse', () => {
  const s = setup();
  assert.match(s.text(), /Si llega otra lectura/);
  s.click('Detener');
  assert.deepEqual(s.calls.at(-1), ['change', 'policy', 'wait']);
  s.key('\x1b[D');
  assert.deepEqual(s.calls.at(-1), ['change', 'policy', 'stop']);
  s.click('visible');
  assert.deepEqual(s.calls.at(-1), ['change', 'toolbar', false]);
  s.key('\r');
  assert.deepEqual(s.calls.at(-1), ['change', 'toolbar', true]);
});

test('indicator row supports keyboard and mouse independently of toolbar', () => {
  const s = setup();
  assert.match(s.text(), /Indicador de estado/);
  s.w.row = 7;
  s.key('\r');
  assert.deepEqual(s.calls.at(-1), ['change', 'indicator', false]);
  assert.equal(s.state.settings.toolbar, true);
  s.click('oculto');
  assert.deepEqual(s.calls.at(-1), ['change', 'indicator', true]);
});

test('voice table orders downloaded, downloadable, then account voices and marks the active one', () => {
  const s = setup();
  s.click('[ Cambiar ]');
  const lines = s.w.render(100);
  const order = ['lola', 'rafael', 'Regina', 'ar-hombre-4310'].map(n => lines.findIndex(l => l.includes(n + ' (') || l.includes(n + ' * (')));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(lines.some(l => /Voz\s+Estado\s+RAM aprox\.\s+Dict\s*│$/.test(l)) && !lines.some(l => l.includes('Tipo')));
  assert.ok(lines[order[0]].includes('● lola (') && lines[order[0]].includes('Descargada') && lines[order[0]].includes('~1 GB'));
  assert.ok(lines[order[1]].includes('  rafael (') && lines[order[1]].includes('~1 GB'));
  assert.ok(lines[order[2]].includes('  Regina * (') && lines[order[2]].includes('~0,3 GB'));
  assert.ok(!lines.some(l => l.includes('activa')));
  assert.ok(lines[order[1]].includes('Para descargar'));
  assert.ok(lines[order[2]].includes('Con cuenta gratis'));
});

test('each voice row shows and toggles its own pronunciation fixes by click or ←→, without choosing it', () => {
  const s = setup();
  s.click('[ Cambiar ]');
  const row = (n: string) => s.w.render(100).find(l => l.includes(n + ' (') || l.includes(n + ' * ('))!;
  assert.match(row('lola'), /~1 GB\s+sí\s*│$/);
  assert.match(row('Regina'), /~0,3 GB\s+no\s*│$/);
  s.key('[C');
  assert.match(row('lola'), /\s+no\s*│$/);
  const lines = s.w.render(100), y = lines.indexOf(row('Regina'));
  s.w.handleMouse({type: 'click', button: 'left', x: Array.from(lines[y]).length - 4, y});
  assert.match(row('Regina'), /\s+sí\s*│$/);
  assert.deepEqual(s.calls, [['dict', 'lola'], ['dict', 'Regina']]);
  assert.equal(s.w.page, 'voices');
  assert.match(s.text(), /←→ dict/);
  // Every line keeps the window frame: same width, closed on both sides.
  const frame = s.w.render(100).map(l => Array.from(l).length);
  assert.ok(frame.every(n => n === frame[0]), String(frame));
});

test('voice table shows the active voice name in yellow (warning), also under the cursor', () => {
  const s = setup({theme: {fg: (st: string, t: string) => `<${st}>${t}</${st}>`}});
  s.key('\r');
  const lines = s.w.render(100);
  const row = (n: string) => lines.find(l => l.includes(n + ' (') || l.includes(n + ' * ('))!;
  assert.match(row('lola'), /<warning>● lola \(la de siempre\)\s*<\/warning>/);
  for (const n of ['rafael', 'Regina', 'ar-hombre-4310']) assert.ok(!row(n).includes(`<warning>${n}`), n);
  s.key('\x1b[B');
  assert.match(s.w.render(100).find(l => l.includes('lola ('))!, /<warning>● lola \(/);
  assert.match(s.w.render(100).find(l => l.includes('rafael ('))!, /<accent>  rafael \(/);
});

test('choosing by type: downloaded activates, downloadable confirms, account asks for the token first', async () => {
  const s = setup();
  s.click('[ Cambiar ]'); s.click('rafael (');
  assert.ok(s.text().includes('[ Descargar y usar ]'));
  s.click('[ Descargar y usar ]');
  assert.deepEqual(s.calls.at(-1), ['choose', 'rafael', 'spanish']);
  await new Promise(resolve => setImmediate(resolve));
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

test('the token guide keeps its short addresses and a click opens each one in the browser', () => {
  const s = setup();
  s.click('[ Cambiar ]'); s.click('Regina * (');
  const lines = s.w.render(100);
  assert.ok(lines.every(l => Array.from(l).length === 72), 'every line fits the window');
  assert.ok(!lines.some(l => l.includes('https://')));
  assert.ok(lines.some(l => l.includes(' 3. Token «Read-Only»:      huggingface.co/settings/tokens')), 'names the Hugging Face preset');
  assert.ok(lines.some(l => l.includes('Enter · Esc · clic en un enlace lo abre')));
  for (const link of ['huggingface.co/join', 'huggingface.co/gradium/phonon-40m-es', 'huggingface.co/settings/tokens']) s.click(link);
  assert.deepEqual(s.calls, [['open', 'https://huggingface.co/join'], ['open', 'https://huggingface.co/gradium/phonon-40m-es'],
    ['open', 'https://huggingface.co/settings/tokens']]);
  s.click('Crea una cuenta:');
  assert.equal(s.calls.length, 3, 'only the address is clickable');
  assert.ok(s.text().includes('Token:'), 'the guide stays open');
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
  assert.ok(s.w.render(100).find(l => l.includes('Regina * ('))!.includes('Para descargar'));
  assert.ok(!s.text().includes('Con cuenta ✓'));
  s.click('Regina * (');
  assert.ok(s.text().includes('[ Descargar y usar ]'));
  assert.ok(s.text().includes(' Incluye también: Iker (España).'), 'names the voices in the same download');
  s.key(''); s.click('rafael (');
  assert.ok(s.text().includes('[ Descargar y usar ]') && !s.text().includes('Incluye también'), 'Pocket voices download one by one');
});

test('Editar opens the shortcuts table; keys are captured, validated and removable', () => {
  const s = setup();
  s.click('[ Editar ]');
  const table = s.text();
  for (const part of ['Atajos de teclado', 'Encender / apagar TTS', 'Lectura automática sí/no', 'Escuchar la última respuesta',
    'Pausar / seguir', 'Detener', 'Abrir ajustes', 'Leer lo copiado', '(sin atajo)']) assert.ok(table.includes(part), part);
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
  assert.ok(s.text().includes('teHablo · Ajustes'));
});

test('keyboard reaches Quitar and removes a bound shortcut without entering capture', () => {
  const s = setup({settings: {...DEFAULTS, shortcuts: {power: 'ctrl+alt+p'}}});
  for (let i = 0; i < 4; i++) s.key('\x1b[B');
  s.key('\r');
  s.key('\x1b[C'); s.key('\r');
  assert.deepEqual(s.calls, [['shortcut', 'power', undefined]]);
  assert.deepEqual(s.state.settings.shortcuts, {});
  assert.ok(!s.text().includes('Ctrl+Alt+P'));
  assert.ok(!s.text().includes('[ Quitar ]'));
  assert.ok(!s.text().includes('Presiona la combinación'));
  s.key('\r'); s.key('\x1b\x10');
  assert.equal(s.state.settings.shortcuts.power, 'ctrl+alt+p');
  assert.ok(s.text().includes('Ctrl+Alt+P'));
});

test('shortcut buttons show horizontal focus and left returns to keyboard assignment', () => {
  const s = setup({settings: {...DEFAULTS, shortcuts: {power: 'ctrl+alt+p'}},
    theme: {fg: (st: string, t: string) => `<${st}>${t}</${st}>`}});
  for (let i = 0; i < 4; i++) s.key('\x1b[B');
  s.key('\r');
  s.key('\x1b[C');
  assert.ok(s.text().includes('<accent>[ Quitar ]</accent>'));
  assert.ok(!s.text().includes('<accent>[ Cambiar ]</accent>'));
  s.key('\x1b[D'); s.key('\r'); s.key('\x1b\x11');
  assert.equal(s.state.settings.shortcuts.power, 'ctrl+alt+q');
  assert.ok(s.text().includes('Ctrl+Alt+Q'));
  s.key('\x7f');
  assert.deepEqual(s.state.settings.shortcuts, {});
});

test('mouse Quitar still removes the shortcut and updates the table', () => {
  const s = setup({settings: {...DEFAULTS, shortcuts: {power: 'ctrl+alt+p'}}});
  s.click('[ Editar ]'); s.click('[ Quitar ]');
  assert.deepEqual(s.calls, [['shortcut', 'power', undefined]]);
  assert.deepEqual(s.state.settings.shortcuts, {});
  assert.ok(!s.text().includes('[ Quitar ]'));
  assert.ok(!s.text().includes('Ctrl+Alt+P'));
});

test('with the server off, unknown download state is shown by kind and asks for download confirmation', () => {
  const rows = [{name: 'lola', voice: 'lola', model: 'spanish', kind: 'download', note: 'la de siempre', downloaded: null},
    {name: 'Regina', voice: 'Regina', model: 'phonon', kind: 'account', note: 'México', downloaded: null}];
  const s = setup({settings: {...DEFAULTS}});
  (s.w.c as any).voices = () => rows;
  s.click('[ Cambiar ]');
  const text = s.text();
  assert.ok(text.includes('Sin cuenta') && text.includes('Con cuenta gratis'));
  assert.match(text.split('\n').find(l => l.includes('lola ('))!, /● lola \(/);
  s.click('lola (');
  assert.equal(s.w.page, 'download');
  assert.deepEqual(s.calls, []);
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
