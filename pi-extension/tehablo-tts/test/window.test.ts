import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SettingsWindow, type Controller} from '../src/window.ts';
import {ACTIONS, DEFAULTS, type VoiceRow} from '../src/settings.ts';

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
  const state = {settings: {...DEFAULTS, volume: 1, voice: 'lola', model: 'spanish'}, server: 'off' as 'off' | 'loading' | 'ready', token: false, ...over};
  const c: Controller = {
    sshCode: async (copy = false) => { calls.push(['sshCode', copy]); return '0123-4567-89AB-CDEF-0123-4567-89AB-CDEF'; },
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

test('T3c tabs open on active engine, cycle and click without choosing', t => {
  const s = setup();
  s.click('[ Cambiar ]');
  assert.match(s.text(), /\[ Pocket · 1 GB \]/);
  assert.doesNotMatch(s.text(), /Regina/);
  s.key('\t');
  assert.match(s.text(), /\[ Phonon · 0,3 GB \]/);
  assert.match(s.text(), /el que menos gasta y suena muy bien/);
  assert.doesNotMatch(s.text(), /lola/);
  s.click('Pocket · 1 GB');
  assert.match(s.text(), /\[ Pocket · 1 GB \]/);
  assert.deepEqual(s.calls, []);
});

test('T3c per-tab scrolling, download identity and widths', t => {
  const s = setup();
  let rows: VoiceRow[] = [...Array.from({length: 25}, (_, i) => ({...ROWS[0], name: `Voz${i}`, voice: `v${i}`, note: i < 13 ? 'España' : 'México'})), ROWS[3]];
  s.w.c.voices = () => rows;
  s.click('[ Cambiar ]');
  t.diagnostic('Pocket tab\n' + s.text());
  s.key('\t');
  t.diagnostic('Phonon first screen\n' + s.text());
  assert.match(s.text(), /1\/25/);
  assert.equal(s.w.render().filter(l => /Voz\d/.test(l)).length, 10);
  s.key('\x1b[B');
  rows = rows.map((r, i) => i === 15 ? {...r, downloaded: true} : r);
  assert.match(s.w.render().find(l => l.startsWith('│ ▶ '))!, /Voz1 /);
  for (let i = 0; i < 23; i++) s.key('\x1b[B');
  assert.match(s.text(), /25\/25/);
  assert.doesNotMatch(s.text(), /lola/);
  assert.ok(s.w.render().every(l => Array.from(l).length === 72));
  s.click('[ Anterior ]');
  assert.match(s.text(), /15\/25/);
  s.click('[ Siguiente ]');
  assert.match(s.text(), /25\/25/);
  s.key('\t');
  assert.match(s.text(), /1\/1/);
  s.click('lola');
  assert.deepEqual(s.calls, [['choose', 'lola', 'spanish']]);
  s.w.choose(rows[0]);
  assert.match(s.text(), /75 MB.*token/);
  assert.doesNotMatch(s.text(), /Incluye también/);
});

test('T3c accent precedes download rank, Pocket is stable, arrows stay in tab', () => {
  const s = setup();
  const rows = [ROWS[0], {...ROWS[0], voice: 'mx', name: 'México lista', downloaded: true},
    ROWS[1], {...ROWS[1], voice: 'es', name: 'España lista', downloaded: true},
    ROWS[2], ROWS[3], ROWS[4]];
  s.w.c.voices = () => rows;
  s.state.settings = {...s.state.settings, model: 'phonon', voice: 'Regina'};
  s.click('[ Cambiar ]');
  const ordered = ['España lista', 'Iker', 'México lista', 'Regina'].map(name => s.text().indexOf(name));
  assert.ok(ordered.every((position, i) => position >= 0 && (i === 0 || position > ordered[i - 1])));
  s.key('\x1b[A');
  assert.match(s.w.render().find(l => l.startsWith('│ ▶ '))!, /Regina/);
  s.key('\x1b[B');
  assert.match(s.w.render().find(l => l.startsWith('│ ▶ '))!, /España lista/);
  s.key('\t');
  const text = s.text();
  assert.ok(text.indexOf('lola') < text.indexOf('rafael'));
  assert.ok(text.indexOf('rafael') < text.indexOf('ar-hombre'));
  assert.doesNotMatch(text, /Regina|el que menos/);
  assert.deepEqual(s.calls, []);
  s.key('\x1b');
  s.state.settings = {...s.state.settings, model: 'missing', voice: 'missing'};
  s.click('[ Cambiar ]');
  assert.match(s.text(), /\[ Phonon · 0,3 GB \]/);
});

test('S4 only offered engines get headers; download priority stays within engine', () => {
  const s = setup();
  s.w.c.voices = () => [{...ROWS[0], downloaded: false}, {...ROWS[1], downloaded: true}, ROWS[3],
    {...ROWS[2], model: 'spanish_24l'}];
  s.click('[ Cambiar ]');
  const text = s.text();
  assert.match(text, /spanish_24l · 1,8 GB/);
  s.click('Phonon ·');
  assert.ok(s.text().indexOf('Iker') < s.text().indexOf('Regina'));
  assert.match(s.text(), /Iker\s+España\s+✓/);
  assert.ok(s.w.render().every(l => Array.from(l).length === 72));
  s.click('spanish_24l ·');
  assert.match(s.text(), /\[ spanish_24l · 1,8 GB \]/);
  assert.match(s.text(), /rafael/);
  assert.doesNotMatch(s.text(), /Iker|Regina|lola/);
  assert.ok(s.w.render().every(l => Array.from(l).length === 72));
  s.key('\t');
  assert.match(s.text(), /\[ Phonon · 0,3 GB \]/);
  s.w.c.voices = () => [];
  assert.match(s.text(), /0\/0/);
  assert.doesNotMatch(s.text(), /Phonon|Pocket/);
});

test('S6 rhythm is Phonon-only, below speed, steps and clamps with arrows', () => {
  const s = setup();
  assert.doesNotMatch(s.text(), /Ritmo de Phonon/);
  s.state.settings = {...s.state.settings, model: 'phonon', voice: 'Regina'};
  assert.match(s.text(), /Ritmo de Phonon/);
  assert.match(s.text(), /− más rápido · \+ más pausado/);
  const rows = s.w.mainRows();
  assert.equal(rows[2].label, 'Velocidad');
  assert.equal(rows[3].label, 'Ritmo de Phonon');
  s.w.row = 3;
  for (let i = 0; i < 3; i++) s.key('\x1b[D');
  assert.equal(s.state.settings.rhythm, -1);
  for (let i = 0; i < 5; i++) s.key('\x1b[C');
  assert.equal(s.state.settings.rhythm, 1);
  s.w.row = 2; s.key('\x1b[C');
  assert.equal(s.state.settings.speed, 1.05);
  assert.ok(s.text().indexOf('Lectura automática') > s.text().indexOf('Lectura'));
});

test('T1 missing ungated voice skips token when model is cached, including download errors', async () => {
  const s = setup();
  const voice = {...ROWS[0], needsToken: false};
  s.w.choose(voice);
  assert.equal(s.w.page, 'download');
  assert.equal(s.w.typeLabel(voice), 'Para descargar');
  s.w.c.download = async () => { throw new Error('voice unavailable'); };
  s.w.confirm();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.w.page, 'download');
  assert.equal(s.w.result, 'error');
  assert.deepEqual(s.calls, []);
  s.w.choose({...voice, needsToken: true});
  assert.equal(s.w.page, 'token');
});

test('main sections are rendering-only, ordered, spaced and mouse-safe', () => {
  const s = setup({server: 'ready'});
  const lines = s.w.render();
  const labels = ['Voz y sonido', 'Voz', 'Volumen', 'Velocidad', 'Lectura', 'Lectura automática', 'Si llega otra lectura', 'Interfaz', 'Atajos de teclado', 'Barra de controles', 'Indicador de estado', 'Iconos', 'Audio y servidor', 'Audio', 'Salida', 'Servidor ● activo'];
  let previous = 1;
  for (const label of labels) {
    const y = lines.findIndex((line, i) => i > previous && line.includes(label));
    assert.ok(y > previous, label);
    previous = y;
  }
  assert.equal(lines.length, 21);
  assert.ok(lines.every(line => Array.from(line).length === 72));
  assert.match(s.text(), /Si llega otra lectura +◀/);
  for (const title of ['Voz y sonido', 'Lectura', 'Interfaz', 'Audio y servidor']) {
    s.click(title);
    assert.equal(s.w.row, 0);
    assert.deepEqual(s.calls, []);
  }
  const selected = [];
  for (let i = 0; i < 12; i++) {
    selected.push(s.w.render().find(line => line.startsWith('│ ▶ '))!.trim());
    s.key('\x1b[B');
  }
  assert.equal(s.w.row, 0);
  assert.ok(selected[4].includes('Si llega otra lectura'));
  assert.ok(selected[5].includes('Atajos de teclado'));
  s.key('\x1b[A');
  assert.equal(s.w.row, 11);
  s.click('◀ Detener');
  assert.equal(s.w.row, 4);
  assert.deepEqual(s.calls, [['change', 'policy', 'wait']]);
});

test('returning from submenus keeps the originating main row selected', async () => {
  for (const label of ['Voz', 'Atajos de teclado', 'Salida', 'Audio']) {
    for (const back of ['escape', 'click']) {
      const s = setup();
      if (label === 'Audio') s.state.settings.audio = 'ssh';
      const row = s.w.mainRows().findIndex(r => r.label === label);
      for (let i = 0; i < row; i++) s.key('\x1b[B');
      if (label === 'Audio') s.key('\t');
      s.key('\r');
      await new Promise(resolve => setImmediate(resolve));
      assert.notEqual(s.w.page, 'main');
      // Submenu navigation must not replace the origin row.
      s.key('\x1b[B');
      if (back === 'escape') s.key('\x1b'); else s.click('[ Volver ]');
      assert.equal(s.w.page, 'main');
      assert.equal(s.w.row, row, `${label}: ${back}`);
      assert.match(s.w.render(100).find(l => l.includes(label + '  '))!, /│ ▶ /);
      assert.equal(s.closed(), false);
      assert.deepEqual(s.calls, label === 'Audio' ? [['sshCode', false]] : []);
    }
  }
});

test('voice selection and download returns keep Voz selected', async () => {
  for (const back of ['choose', 'escape', 'click', 'keyboard']) {
    const s = setup();
    s.click('[ Cambiar ]');
    if (back === 'choose') s.click('lola');
    else {
      s.click('rafael'); s.key('\r');
      await new Promise(resolve => setImmediate(resolve));
      if (back === 'escape') s.key('\x1b');
      else if (back === 'click') s.click('[ Volver al menú ]');
      else { s.key('\x1b[C'); s.key('\r'); }
    }
    assert.equal(s.w.page, 'main');
    assert.match(s.w.render(100).find(l => l.includes('Voz  '))!, /│ ▶ Voz/);
    assert.equal(s.w.col, 0);
    assert.equal(s.closed(), false);
    assert.deepEqual(s.calls, [['choose', back === 'choose' ? 'lola' : 'rafael', 'spanish']]);
  }
});

test('S37 Copiar then Ver sit right of SSH on the Audio row; Enter copies; Copiar only says Copiado; Ver opens a window', async () => {
  const CODE = /0123-4567-89AB-CDEF-0123-4567-89AB-CDEF/;
  const s = setup();
  assert.doesNotMatch(s.text(), /\[ Ver \]|\[ Copiar \]/);
  s.state.settings.audio = 'ssh';
  const rows = s.w.mainRows();
  assert.equal(rows.filter(r => r.label === 'Código SSH').length, 0);
  assert.match(s.w.render(100).find(l => l.includes('Audio  '))!, /◀ SSH ▶ +\[ Copiar \] \[ Ver \]/);
  // Enter on the Audio row copies at once; ←→ still switch Local/SSH there.
  s.w.row = rows.findIndex(r => r.label === 'Audio'); s.w.col = 0;
  s.key('\r');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(s.calls, [['sshCode', true]]);
  assert.match(s.w.render(100).find(l => l.includes('Audio  '))!, /Copiado/);
  assert.doesNotMatch(s.text(), CODE);
  s.click('[ Ver ]');
  await new Promise(r => setImmediate(r));
  assert.equal(s.w.page, 'code');
  assert.match(s.text(), CODE);
  for (const l of s.w.render(100)) assert.ok(Array.from(l).length <= 72, l);
  assert.match(s.text().replace(/[│\s]+/g, ' '), /«Vincular servidor»\)\. No lo compartas\./);
  for (const b of ['[ Copiar ]', '[ Volver ]', '[ Cerrar ]']) assert.ok(s.text().includes(b), b);
  assert.doesNotMatch(s.text(), /[Gg]enerar/);
  s.key('\r');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(s.calls.slice(1), [['sshCode', false], ['sshCode', true]]);
  assert.match(s.text(), /Copiado/);
  s.click('[ Volver ]');
  assert.equal(s.w.page, 'main');
  assert.doesNotMatch(s.text(), CODE);
  s.click('[ Ver ]'); await new Promise(r => setImmediate(r));
  s.key('\x1b');
  assert.equal(s.w.page, 'main');
  s.click('[ Ver ]'); await new Promise(r => setImmediate(r));
  s.click('[ Cerrar ]');
  assert.equal(s.closed(), true);
});

test('S37 Tab moves between Copiar and Ver on the Audio row, so Ver opens with the keyboard', async () => {
  const s = setup();
  s.state.settings.audio = 'ssh';
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Audio'); s.w.col = 0;
  assert.match(s.text(), /Tab botón/);
  s.key('\t'); s.key('\r');
  await new Promise(r => setImmediate(r));
  assert.equal(s.w.page, 'code');
  assert.deepEqual(s.calls, [['sshCode', false]]);
  s.key('\x1b');
  s.key('\r');
  await new Promise(r => setImmediate(r));
  assert.equal(s.w.page, 'main');
  assert.deepEqual(s.calls.slice(1), [['sshCode', true]]);
  assert.equal(s.w.mainRows()[s.w.row].label, 'Audio');
  assert.equal(s.state.settings.audio, 'ssh');
});

test('S3 download confirmation prepares now and reports completion or error', async () => {
  const s = setup();
  let finish!: () => void;
  (s.w.c as any).download = () => new Promise<void>(resolve => { finish = resolve; });
  s.w.choose(ROWS[2]);
  s.w.confirm();
  assert.match(s.text(), /Descargando rafael…/);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.text(), /rafael \(España\): Descargada\./);
  (s.w.c as any).download = async () => { throw new Error('Sin conexión'); };
  s.w.choose(ROWS[2]); s.w.confirm();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.text(), /Sin conexión/);
});

test('S7 S8 the download dialog stays open: Descargando…, then Descargada with Cerrar or Volver al menú', async () => {
  const s = setup();
  let finish!: () => void;
  (s.w.c as any).download = () => new Promise<void>(resolve => { finish = resolve; });
  s.w.choose(ROWS[2]);
  s.key('\r');
  assert.equal(s.w.page, 'download');
  assert.match(s.text(), /Descargando rafael…/);
  assert.ok(!s.text().includes('[ Descargar y usar ]'), 'no second download while downloading');
  s.key('\r');
  assert.equal(s.w.page, 'download', 'Enter does nothing while downloading');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.w.page, 'download');
  assert.match(s.text(), /rafael \(España\): Descargada\./);
  assert.ok(s.text().includes('[ Cerrar ]') && s.text().includes('[ Volver al menú ]'));
  s.key('\r');
  assert.equal(s.closed(), true, 'Enter on [ Cerrar ] closes the window');
  // Mouse: back to the menu, and the menu body carries no download line.
  const m = setup();
  (m.w.c as any).download = async () => {};
  m.w.choose(ROWS[2]); m.click('[ Descargar y usar ]');
  await new Promise(resolve => setImmediate(resolve));
  m.click('[ Volver al menú ]');
  assert.equal(m.w.page, 'main');
  assert.ok(!m.text().includes('Descargada') && !m.text().includes('rafael lista'));
  // Keyboard: right then Enter goes back to the menu.
  const k = setup();
  (k.w.c as any).download = async () => {};
  k.w.choose(ROWS[2]); k.key('\r');
  await new Promise(resolve => setImmediate(resolve));
  k.key('\x1b[C'); k.key('\r');
  assert.equal(k.w.page, 'main');
  assert.equal(k.closed(), false);
  // An error stays in the same dialog and the download can be tried again.
  const e = setup();
  (e.w.c as any).download = async () => { throw new Error('Sin conexión'); };
  e.w.choose(ROWS[2]); e.key('\r');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.w.page, 'download');
  assert.match(e.text(), /Sin conexión/);
  assert.ok(e.text().includes('[ Descargar y usar ]') && e.text().includes('[ Volver ]'));
});

test('S10 Descargada is gray in the voice table and in the download dialog', async () => {
  const s = setup({theme: {fg: (st: string, t: string) => `<${st}>${t}</${st}>`}});
  s.key('\r');
  const row = s.w.render(100).find(l => l.includes('lola'))!;
  assert.match(row, /<dim>✓<\/dim>/, row);
  s.w.choose(ROWS[2]); s.w.confirm();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(s.text(), /<dim> rafael \(España\): Descargada\.<\/dim>/);
});

test('S11 S12 a refused token is shown on the token page and asked again', async () => {
  const s = setup();
  s.w.choose(ROWS[0]);
  s.w.token = 'hf_wrong'; s.w.saveToken();
  assert.equal(s.w.page, 'download');
  (s.w.c as any).download = async () => { s.state.token = false; throw new Error('Hugging Face rechazó el token.'); };
  s.w.confirm();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.w.page, 'token');
  assert.equal(s.w.token, '');
  assert.match(s.text(), /Hugging Face rechazó el token\./);
  assert.ok(s.text().includes('Token: '));
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
  assert.deepEqual(s.calls.at(-1), ['change', 'volume', 1.1]); // 10 % steps, like the toolbar
  for (let i = 0; i < 20; i++) s.key('\x1b[D');
  assert.deepEqual(s.calls.at(-1), ['change', 'volume', 0.1]);
  s.key('\x1b[B'); s.key('\x1b[C');
  assert.deepEqual(s.calls.at(-1), ['change', 'speed', 1.05]); // 0.05x steps
  s.key('\x1b[B'); s.key('\r');
  assert.deepEqual(s.calls.at(-1), ['change', 'auto', true]);
  s.key('\x1b');
  assert.equal(s.closed(), true);
});

test('long output name stays inside the window without changing the saved device', () => {
  const s = setup();
  const name = 'Headset Earphone (@System32\\drivers\\bthhfenum.sys,#2;%1 Hands-Free%0;Bluetooth Headset)';
  s.state.settings.device = name;
  s.w.c.devices = () => ['Speakers', name];
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida');
  for (const cols of [80, 140, 180]) {
    const lines = s.w.render(cols);
    for (const line of lines) assert.ok(Array.from(line).length <= 72, line);
    const y = lines.findIndex(l => l.includes('Salida'));
    const row = lines[y];
    assert.match(row, /Headset Earphone.*…/);
    assert.equal(row.at(-1), '│');
    assert.equal(s.state.settings.device, name);
    const right = Array.from(row).lastIndexOf('▶');
    const left = Array.from(row).indexOf('◀');
    assert.ok(left > 0 && right > left && right < 71);
    s.w.handleMouse({type: 'click', button: 'left', x: right, y});
    assert.equal(s.state.settings.device, '');
    s.w.render(cols);
    s.w.handleMouse({type: 'click', button: 'left', x: left, y});
    assert.equal(s.state.settings.device, name);
    assert.deepEqual(s.calls.at(-1), ['change', 'device', name]);
  }
});

test('output cycling deduplicates discovered devices and keeps the absent saved choice', () => {
  const s = setup();
  s.w.c.devices = () => ['Speakers', 'Speakers'];
  s.state.settings.device = 'Headphones';
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida');
  assert.equal(s.w.mainRows()[s.w.row].value, 'Headphones');
  assert.equal(s.state.settings.device, 'Headphones');
  s.key('\x1b[D'); assert.equal(s.state.settings.device, 'Speakers');
  s.state.settings.device = 'Headphones';
  s.key('\x1b[C'); assert.equal(s.state.settings.device, '');
  // Deliberately selecting another output replaces the old saved choice, just like the client.
  s.key('\x1b[C'); assert.equal(s.state.settings.device, 'Speakers');
  s.key('\x1b[C'); assert.equal(s.state.settings.device, '');
});

test('Enter on output opens a filtered submenu; navigation only applies on confirmation', () => {
  const s = setup();
  s.w.c.devices = () => ['Speakers', 'Headphones', 'Headphones'];
  s.state.settings.device = 'Headphones';
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida');
  assert.match(s.text(), /Enter lista/);
  const before = structuredClone(s.state.settings);
  s.key('\r');
  assert.equal(s.w.page, 'devices');
  assert.deepEqual(s.state.settings, before);
  assert.deepEqual(s.calls, []);
  assert.match(s.text(), /Salida de audio/);
  assert.match(s.text(), /Predeterminada/);
  assert.equal(s.text().split('Headphones').length - 1, 1);
  assert.match(s.text(), /▶.*● Headphones/);
  s.key('\x1b[A');
  assert.deepEqual(s.state.settings, before);
  assert.match(s.text(), /▶.*Speakers/);
  s.key('\r');
  assert.equal(s.w.page, 'main');
  assert.equal(s.w.mainRows()[s.w.row].label, 'Salida');
  assert.deepEqual(s.state.settings, {...before, device: 'Speakers'});
  assert.deepEqual(s.calls, [['change', 'device', 'Speakers']]);
});

test('device refresh updates filtered and hidden choices without selecting or overlapping queries', async () => {
  const s = setup();
  let data = {devices: ['Speakers'], allDevices: ['Speakers']}, queries = 0, finish!: () => void;
  s.w.c.devices = (all = false) => all ? data.allDevices : data.devices;
  s.w.c.refreshDevices = () => new Promise(resolve => { queries++; finish = () => {
    data = {devices: ['Speakers', 'Headphones'], allDevices: ['Speakers', 'Headphones', 'Other API DAC']}; resolve(true);
  }; });
  s.state.settings.device = 'Speakers';
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida'); s.key('\r');
  s.key('\t'); s.key('\r');
  assert.doesNotMatch(s.text(), /Other API DAC/);
  s.click('[ Refrescar (R) ]'); s.key('r');
  assert.equal(queries, 1); assert.match(s.text(), /Actualizando/);
  assert.equal(s.state.settings.device, 'Speakers'); assert.deepEqual(s.calls, []);
  finish(); await new Promise(r => setImmediate(r));
  assert.match(s.text(), /Other API DAC/); assert.match(s.text(), /Refrescar/);
  s.click('[ Mostrar ocultos: sí ]');
  assert.match(s.text(), /Headphones/); assert.doesNotMatch(s.text(), /Other API DAC/);
  assert.equal(s.state.settings.device, 'Speakers'); assert.deepEqual(s.calls, []);
});

test('hidden outputs toggle preserves filtering by default and only changes the visible choices', () => {
  const s = setup();
  s.w.c.devices = (all = false) => all ? ['Speakers', 'Other API DAC'] : ['Speakers'];
  s.state.settings.device = 'Speakers';
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida');
  const before = structuredClone(s.state.settings);
  s.key('\r');
  assert.match(s.text(), /Mostrar ocultos: no/);
  assert.doesNotMatch(s.text(), /Other API DAC/);
  s.key('\t'); s.key('\r');
  assert.equal(s.w.page, 'devices');
  assert.match(s.text(), /Mostrar ocultos: sí/);
  assert.match(s.text(), /Other API DAC/);
  assert.deepEqual(s.state.settings, before); assert.deepEqual(s.calls, []);
  s.click('[ Mostrar ocultos: sí ]');
  assert.doesNotMatch(s.text(), /Other API DAC/);
  assert.deepEqual(s.state.settings, before); assert.deepEqual(s.calls, []);
  s.click('[ Mostrar ocultos: no ]');
  s.key('\t'); s.key('\x1b[B'); s.key('\r');
  assert.equal(s.w.page, 'main');
  assert.equal(s.state.settings.device, 'Other API DAC');
  assert.deepEqual(s.calls, [['change', 'device', 'Other API DAC']]);
});

test('output submenu Escape and Volver cancel; clicking an output applies and returns', () => {
  const s = setup();
  s.w.c.devices = () => ['Speakers'];
  s.state.settings.device = 'Disconnected headset';
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida');
  s.key('\r');
  assert.equal(s.w.page, 'devices');
  assert.match(s.text(), /Disconnected headset/);
  s.key('\x1b[A'); s.key('\x1b');
  assert.equal(s.w.page, 'main');
  assert.equal(s.state.settings.device, 'Disconnected headset');
  assert.deepEqual(s.calls, []);
  assert.equal(s.closed(), false);
  s.key('\r'); s.click('[ Volver ]');
  assert.equal(s.w.page, 'main');
  assert.deepEqual(s.calls, []);
  s.key('\r'); s.click('Speakers');
  assert.equal(s.w.page, 'main');
  assert.equal(s.state.settings.device, 'Speakers');
  assert.deepEqual(s.calls, [['change', 'device', 'Speakers']]);
});

test('all settings lists wrap up/down at both ends without applying a selection', () => {
  for (const page of ['main', 'voices', 'shortcuts', 'devices'] as const) {
    const s = setup();
    s.w.c.devices = () => ['Speakers', 'Headphones'];
    if (page === 'devices') s.w.openDevices(); else s.w.page = page;
    const field = page === 'main' ? 'row' : page === 'voices' ? 'pick' : page === 'shortcuts' ? 'scRow' : 'devicePick';
    const count = page === 'main' ? s.w.mainRows().length : page === 'voices' ? s.w.order().length : page === 'shortcuts' ? ACTIONS.length : 3;
    const before = structuredClone(s.state.settings);
    s.w[field] = 0;
    s.key('\x1b[A'); assert.equal(s.w[field], count - 1, page);
    s.key('\x1b[B'); assert.equal(s.w[field], 0, page);
    s.key('\x1b[B'); assert.equal(s.w[field], 1, page);
    s.key('\x1b[A'); assert.equal(s.w[field], 0, page);
    s.w[field] = count - 1;
    s.key('\x1b[B'); assert.equal(s.w[field], 0, page);
    s.key('\x1b[A'); assert.equal(s.w[field], count - 1, page);
    assert.deepEqual(s.state.settings, before, page);
    assert.deepEqual(s.calls, [], page);
    assert.equal(s.closed(), false);
  }
  const empty = setup(); empty.w.c.voices = () => []; empty.w.page = 'voices';
  empty.key('\x1b[A'); empty.key('\x1b[B'); assert.equal(empty.w.pick, 0);
  const single = setup(); single.w.openDevices();
  single.key('\x1b[A'); single.key('\x1b[B'); assert.equal(single.w.devicePick, 0);
});

test('output submenu bounds large lists and long names while saving the complete name', () => {
  const s = setup();
  const name = 'Headset Earphone ' + 'long device name '.repeat(8);
  s.w.c.devices = () => [...Array.from({length: 20}, (_, i) => `Device ${i}`), name];
  s.w.row = s.w.mainRows().findIndex(r => r.label === 'Salida');
  s.key('\r');
  assert.equal(s.w.page, 'devices');
  s.key('\x1b[A'); // First-to-last wrapping also scrolls the visible slice.
  assert.equal(s.w.devicePick, 21);
  for (const cols of [80, 140, 180]) {
    const lines = s.w.render(cols);
    assert.ok(lines.length <= 24);
    for (const line of lines) assert.ok(Array.from(line).length <= 72, line);
    assert.match(lines.join('\n'), /Headset Earphone.*…/);
    assert.doesNotMatch(lines.join('\n'), /Device 0\b/);
    assert.match(lines.join('\n'), /Enter elegir.*Esc cancelar/);
  }
  assert.equal(s.state.settings.device, '');
  assert.deepEqual(s.calls, []);
  s.key('\r');
  assert.equal(s.w.page, 'main');
  assert.equal(s.state.settings.device, name);
  assert.deepEqual(s.calls, [['change', 'device', name]]);
  // With no discovered outputs, Predeterminada is still selectable.
  s.w.c.devices = () => [];
  s.key('\r'); s.key('\x1b[A'); s.key('\r');
  assert.equal(s.state.settings.device, '');
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
  assert.equal(s.w.page, 'devices');
  assert.equal(s.state.settings.device, 'Speakers');
  s.key('\x1b');
  const lines = s.w.render(100), y = lines.findIndex(l => l.includes('Salida'));
  s.w.handleMouse({type: 'click', button: 'left', x: Array.from(lines[y]).lastIndexOf('▶'), y});
  assert.equal(s.state.settings.device, 'Headphones');
  s.key('\x1b[C');
  assert.equal(s.state.settings.device, '');
  s.key('\x1b[D');
  assert.equal(s.state.settings.device, 'Headphones');
  s.state.settings.audio = 'ssh';
  assert.ok(s.text().includes('(SSH: la elige el cliente)'));
  const before = s.calls.length;
  s.key('\r');
  assert.equal(s.w.page, 'main');
  assert.equal(s.calls.length, before);
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

test('Option B fixed name and accent columns, status symbols and legend', () => {
  const s = setup();
  s.click('[ Cambiar ]');
  const lines = s.w.render(100);
  const row = (name: string) => lines.find(l => l.includes(name))!;
  assert.match(row('lola'), /● lola\s+la de siempre\s+✓/);
  s.key('\t');
  const regina = s.w.render().find(l => l.includes('Regina'))!;
  assert.match(regina, /Regina\s+México\s+↓/);
  assert.equal(regina.indexOf('México'), row('lola').indexOf('la de siempre'));
  assert.equal(regina.indexOf('↓'), row('lola').indexOf('✓'));
  assert.ok(lines.findIndex(l => l.includes('lola')) < lines.findIndex(l => l.includes('rafael')));
  assert.match(s.text(), /✓ descargada  ↓ por descargar/);
  assert.doesNotMatch(s.text(), /Con cuenta gratis|\*|Estado|ES ·|CPU/);
});

test('Option B selected dictionary footer toggles by ←→ and click without choosing', () => {
  const s = setup();
  s.click('[ Cambiar ]');
  s.key('\t');
  assert.match(s.text(), /Diccionario: no \(←→\)/);
  s.key('\x1b[C');
  assert.match(s.text(), /Diccionario: sí \(←→\)/);
  s.key('\x1b[D');
  s.key('\t');
  assert.match(s.text(), /Diccionario: sí \(←→\)/);
  s.click('Diccionario:');
  assert.match(s.text(), /Diccionario: no \(←→\)/);
  assert.deepEqual(s.calls, [['dict', 'Iker'], ['dict', 'Iker'], ['dict', 'lola']]);
  assert.equal(s.w.page, 'voices');
  assert.ok(s.w.render(100).every(l => Array.from(l).length === 72));
});

test('voice table shows the active voice name in yellow (warning), also under the cursor', () => {
  const s = setup({theme: {fg: (st: string, t: string) => `<${st}>${t}</${st}>`}});
  s.key('\r');
  const lines = s.w.render(100);
  const row = (n: string) => lines.find(l => l.includes(n))!;
  assert.match(row('lola'), /<warning>lola\s*<\/warning>/);
  for (const n of ['rafael', 'ar-hombre-4310']) assert.ok(!row(n).includes(`<warning>${n}`), n);
  s.key('\x1b[B');
  assert.match(s.w.render(100).find(l => l.includes('lola'))!, /<warning>lola\s*<\/warning>/);
  assert.match(s.w.render(100).find(l => l.includes('rafael'))!, /<accent>rafael\s*<\/accent>/);
});

test('choosing by type: downloaded activates, downloadable confirms, account asks for the token first', async () => {
  const s = setup();
  s.click('[ Cambiar ]'); s.click('rafael');
  assert.ok(s.text().includes('[ Descargar y usar ]'));
  s.click('[ Descargar y usar ]');
  assert.deepEqual(s.calls.at(-1), ['choose', 'rafael', 'spanish']);
  await new Promise(resolve => setImmediate(resolve));
  s.click('[ Volver al menú ]');
  s.click('[ Cambiar ]'); s.key('\t'); s.click('Regina');
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
  s.click('[ Cambiar ]'); s.key('\t'); s.click('Regina');
  const lines = s.w.render(100);
  assert.ok(lines.every(l => Array.from(l).length === 72), 'every line fits the window');
  assert.ok(!lines.some(l => l.includes('https://')));
  assert.ok(lines.some(l => l.includes(' 3. Token «Read-Only»: huggingface.co/settings/tokens')), 'names the Hugging Face preset');
  assert.ok(lines.some(l => l.includes('Enter · Esc · clic en un enlace lo abre')));
  for (const link of ['huggingface.co/join', 'huggingface.co/gradium/phonon-40m-multilingual', 'huggingface.co/settings/tokens']) s.click(link);
  assert.deepEqual(s.calls, [['open', 'https://huggingface.co/join'], ['open', 'https://huggingface.co/gradium/phonon-40m-multilingual'],
    ['open', 'https://huggingface.co/settings/tokens']]);
  s.click('Crea una cuenta:');
  assert.equal(s.calls.length, 3, 'only the address is clickable');
  assert.ok(s.text().includes('Token:'), 'the guide stays open');
});

test('an invalid token shows the error and keeps the field without revealing it', () => {
  const s = setup();
  s.click('[ Cambiar ]'); s.key('\t'); s.click('Regina');
  for (const ch of 'bad') s.key(ch);
  s.key('\r');
  const text = s.text();
  assert.ok(text.includes('El token no es válido'));
  assert.ok(text.includes('Token: •••'));
  assert.ok(!s.calls.some(c => c[0] === 'token'));
});

test('with a saved token, account voices skip the guide', () => {
  const s = setup({token: true});
  s.click('[ Cambiar ]'); s.key('\t');
  assert.ok(s.w.render(100).find(l => l.includes('Regina'))!.includes('↓'));
  assert.ok(!s.text().includes('Con cuenta ✓'));
  s.click('Regina');
  assert.ok(s.text().includes('[ Descargar y usar ]'));
  assert.ok(!s.text().includes('Incluye también'), 'voices download separately');
  s.key(''); s.key('\t'); s.click('rafael');
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
  for (let i = 0; i < 5; i++) s.key('\x1b[B');
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
  for (let i = 0; i < 5; i++) s.key('\x1b[B');
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
  assert.equal(text.split('\n').filter(l => /Regina|lola/.test(l) && l.includes('↓')).length, 1);
  s.key('\t');
  assert.match(s.text(), /Regina\s+México\s+↓/);
  s.key('\t');
  assert.match(text.split('\n').find(l => l.includes('lola'))!, /● lola/);
  s.click('lola');
  assert.equal(s.w.page, 'download');
  assert.deepEqual(s.calls, []);
});

test('the main row names the active voice even when none was chosen', () => {
  const s = setup({settings: {...DEFAULTS}});
  assert.ok(s.text().includes('lola · la de siempre'));
});

test('Option B free account note appears only for the selected gated download', () => {
  const s = setup();
  s.click('[ Cambiar ]'); s.key('\t');
  assert.equal(s.w.render().filter(l => l.includes('Cuenta gratis de Hugging Face')).length, 1);
  s.key('\t');
  assert.doesNotMatch(s.text(), /Cuenta gratis de Hugging Face/);
  s.key('\x1b[A');
  s.state.token = true;
  assert.doesNotMatch(s.text(), /Cuenta gratis de Hugging Face/);
  s.state.token = false;
  s.w.c.voices = () => [{...ROWS[0], needsToken: false}];
  s.key('\x1b[B');
  assert.doesNotMatch(s.text(), /Cuenta gratis de Hugging Face/);
  s.w.c.voices = () => [{...ROWS[0], downloaded: true}];
  assert.doesNotMatch(s.text(), /Cuenta gratis de Hugging Face/);
});

test('voices-ready S13 a long error wraps inside the window on the token page and in the download dialog', async () => {
  const long = 'Hugging Face rechazó el token: revisa que esté completo y que aceptaste los términos en huggingface.co/gradium/phonon-40m-es. https://huggingface.co/gradium/phonon-40m-es/resolve/main/config.json?request_id=Root-1-6af0bbcc-3df83a047675b5ee065af9dc';
  const s = setup();
  s.w.choose(ROWS[0]); s.w.token = 'hf_wrong'; s.w.saveToken();
  (s.w.c as any).download = async () => { s.state.token = false; throw new Error(long); };
  s.w.confirm();
  await new Promise(resolve => setImmediate(resolve));
  const d = setup();
  d.w.choose(ROWS[2]);
  (d.w.c as any).download = async () => { throw new Error(long); };
  d.w.confirm();
  await new Promise(resolve => setImmediate(resolve));
  for (const lines of [s.w.render(100), d.w.render(100)]) {
    for (const l of lines) assert.ok(Array.from(l).length <= 72, l);
    assert.ok(lines.join('').replace(/[│\s]+/g, '').includes(long.replace(/\s+/g, '')), lines.join('\n'));
  }
});
