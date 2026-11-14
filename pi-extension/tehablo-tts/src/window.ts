import { ACTIONS, SPEEDS, RHYTHMS, type Action, type Settings, type VoiceRow } from './settings.ts';
import { keyOf, label, usedByPi } from './shortcuts.ts';

export const ACTION_NAMES: Record<Action, string> = {
  power: 'Encender / apagar TTS', auto: 'Lectura automática sí/no', play: 'Escuchar la última respuesta',
  pause: 'Pausar / seguir', stop: 'Detener', settings: 'Abrir ajustes', copied: 'Leer lo copiado',
};

// Floating settings window opened from [ ≡ ] (approved prototype: .repo-harness/tmp/menu-proto/proto.ts).
// Keys come through Pi's injected keybindings, so no direct pi-tui import is needed.
export interface WindowState { settings: Settings; server: 'off' | 'loading' | 'ready'; token: boolean; deviceError?: string }
export interface Controller {
  state(): WindowState;
  /** The voice in use: the chosen one, else the server's, else the start voice. */
  active(): {model: string; voice: string};
  voices(): VoiceRow[];
  devices?(includeHidden?: boolean): string[];
  /** Resolves false when this settings opening is no longer active. */
  refreshDevices?(): Promise<boolean>;
  sshCode(copy?: boolean): Promise<string>;
  choose(row: VoiceRow): void;
  download?(row: VoiceRow): Promise<void>;
  change(field: 'volume' | 'speed' | 'rhythm' | 'auto' | 'shortcutsOn' | 'toolbar' | 'indicator' | 'policy' | 'icons' | 'audio' | 'device', value: string | number | boolean | 'stop' | 'wait' | 'symbols' | 'text' | 'local' | 'ssh'): void;
  power(action: 'on' | 'off' | 'restart'): void;
  /** Throws an Error with a message safe to show (never the token). */
  saveToken(value: string): void;
  setShortcut(action: Action, key: string | undefined): void;
  /** Opens a fixed help address in the browser. */
  open(url: string): void;
  /** Whether pronunciation fixes (pronunciaciones.json) apply to this voice, and switching them, saved per voice. */
  dict(row: VoiceRow): boolean;
  toggleDict(row: VoiceRow): void;
}
interface Keys { matches(data: string, id: string): boolean; getResolvedBindings?(): Record<string, string | string[] | undefined> }
interface Theme { fg(style: string, text: string): string }
type Seg = {text: string; style?: string; fn?: () => void};

/** 10 % to 150 % in 10 % steps, the same as the toolbar. */
export const VOLUMES = Array.from({length: 15}, (_, i) => (i + 1) / 10);
const W = 72, IN = W - 2;
// RAM while the model is loaded, measured in Fedora (docs/pruebas-de-voces.md); every Pocket voice shares one model.
const ENGINE: Record<string, string> = {phonon: 'Phonon · 0,3 GB', spanish: 'Pocket · 1 GB', spanish_24l: 'spanish_24l · 1,8 GB'};
const width = (t: string) => Array.from(t).length;
const fit = (t: string, n: number) => { const a = Array.from(t); return a.length > n ? a.slice(0, n - 1).join('') + '…' : t + ' '.repeat(n - a.length); };
const nearest = (list: number[], value: number) => list.reduce((best, v, i) => Math.abs(v - value) < Math.abs(list[best] - value) ? i : best, 0);

export class SettingsWindow {
  page: 'main' | 'voices' | 'download' | 'token' | 'shortcuts' | 'code' | 'devices' = 'main';
  deviceOptions: string[] = []; devicePick = 0;
  showHiddenDevices = false; deviceToggleFocused = false; refreshingDevices = false;
  capturing = false; scRow = 0; scError = '';
  row = 0; col = 0; pick = 0; token = ''; error = '';
  target?: VoiceRow;
  notice = ''; downloading = false;
  code = ''; codeStatus = '';
  /** Copiar only copies and says so: the code is never shown for it. */
  async copyCode() {
    try { await this.c.sshCode(true); this.codeStatus = 'Copiado'; }
    catch { this.codeStatus = 'No se pudo copiar'; }
    this.redraw();
  }
  /** Ver opens its own window with the code; leaving it forgets the code. */
  async openCode() {
    this.codeStatus = '';
    try { this.code = await this.c.sshCode(); } catch { this.codeStatus = 'No se pudo leer el código'; return this.redraw(); }
    this.page = 'code'; this.col = 0; this.redraw();
  }
  closeCode() { this.page = 'main'; this.code = ''; this.col = 0; }
  openDevices() {
    const s = this.c.state().settings;
    this.deviceOptions = [...new Set(['', ...(this.c.devices?.(this.showHiddenDevices) ?? []), s.device])];
    this.devicePick = this.deviceOptions.indexOf(s.device);
    this.deviceToggleFocused = false;
    this.page = 'devices';
  }
  toggleHiddenDevices() {
    this.showHiddenDevices = !this.showHiddenDevices;
    this.openDevices();
    this.deviceToggleFocused = true;
  }
  async refreshDeviceList() {
    if (this.refreshingDevices || !this.c.refreshDevices) return;
    this.refreshingDevices = true; this.redraw();
    let active = false;
    try { active = await this.c.refreshDevices(); }
    finally { this.refreshingDevices = false; }
    if (!active) return;
    if (this.page === 'devices') {
      const picked = this.deviceOptions[this.devicePick], focused = this.deviceToggleFocused;
      this.openDevices();
      const index = this.deviceOptions.indexOf(picked);
      if (index >= 0) this.devicePick = index;
      this.deviceToggleFocused = focused;
    }
    this.redraw();
  }
  chooseDevice(index: number) {
    this.c.change('device', this.deviceOptions[index]);
    this.page = 'main';
  }
  /** Download dialog result: '' to confirm, 'done' when downloaded, 'error' to show notice and try again. */
  result: '' | 'done' | 'error' = '';
  hits: {y: number; x0: number; x1: number; fn: () => void}[] = [];
  c: Controller; th: Theme; kb: Keys; done: () => void; redraw: () => void;
  constructor(c: Controller, th: Theme, kb: Keys, done: () => void, redraw: () => void) {
    this.c = c; this.th = th; this.kb = kb; this.done = done; this.redraw = redraw;
  }

  private previousVoices: VoiceRow[] = [];
  private engine = '';
  engines() { return Object.keys(ENGINE).filter(model => this.c.voices().some(v => v.model === model)); }
  switchEngine(model: string) { this.engine = model; this.previousVoices = []; this.pick = 0; }
  order() {
    const engines = this.engines();
    if (!engines.includes(this.engine)) this.switchEngine(engines.includes(this.c.active().model) ? this.c.active().model : engines[0] ?? '');
    const selected = this.previousVoices[this.pick];
    const accent = (v: VoiceRow) => v.model === 'phonon' ? (v.note.includes('España') ? 0 : 1) : 0;
    const rank = (v: VoiceRow) => v.downloaded ? 0 : 1;
    const list = this.c.voices().filter(v => v.model === this.engine).map((v, i) => ({v, i})).sort((a, b) => accent(a.v) - accent(b.v) || rank(a.v) - rank(b.v) || a.i - b.i).map(x => x.v);
    const index = selected ? list.findIndex(v => v.model === selected.model && v.voice === selected.voice) : -1;
    if (index >= 0) this.pick = index;
    this.previousVoices = list;
    return list;
  }
  typeLabel(v: VoiceRow) {
    if (v.downloaded) return 'Descargada';
    if (v.kind === 'download') return v.downloaded === null ? 'Sin cuenta' : 'Para descargar';
    return this.c.state().token || v.needsToken === false ? 'Para descargar' : 'Con cuenta gratis';
  }
  isActive(v: VoiceRow) { const a = this.c.active(); return a.voice === v.voice && a.model === v.model; }
  home() { this.page = 'main'; this.col = 0; }
  choose(v: VoiceRow) {
    this.target = v;
    const token = this.c.state().token;
    if (v.downloaded) { this.c.choose(v); this.home(); }
    else if (v.kind === 'account' && v.needsToken !== false && !token) { this.token = ''; this.error = ''; this.page = 'token'; }
    else { this.page = 'download'; this.col = 0; this.result = ''; }
  }
  confirm() {
    if (!this.target) return;
    const voice = this.target;
    if (this.downloading) return;
    // The dialog stays open: «Descargando…», then «Descargada» (or the error) in the same place.
    this.downloading = true; this.result = ''; this.col = 0; this.notice = `Descargando ${voice.name}…`; this.redraw();
    void (async () => {
      try {
        if (!this.c.download) throw new Error('No se puede descargar: vuelve a cargar la extensión.');
        await this.c.download(voice);
        this.notice = `${voice.name} lista`; this.result = 'done';
      } catch (error) {
        this.notice = error instanceof Error ? error.message : String(error); this.result = 'error';
        // A refused token was dropped: ask for a new one on the token page, with the reason.
        if (voice.kind === 'account' && voice.needsToken !== false && !this.c.state().token) { this.token = ''; this.error = this.notice; this.page = 'token'; }
      }
      finally { this.downloading = false; this.redraw(); }
    })();
  }
  saveToken() {
    const value = this.token.trim();
    if (!value) return;
    try { this.c.saveToken(value); } catch (e) { this.error = e instanceof Error ? e.message : 'No se pudo usar el token.'; return; }
    this.token = ''; this.error = ''; this.page = 'download'; this.col = 0; this.result = '';
  }

  capture(data: string) {
    if (this.key(data) === 'esc') { this.capturing = false; this.scError = ''; return; }
    const key = keyOf(data);
    const action = ACTIONS[this.scRow];
    const shortcuts = this.c.state().settings.shortcuts;
    const other = ACTIONS.find(a => a !== action && shortcuts[a] === key);
    if (!key) this.scError = 'Usa Ctrl o Alt con una letra o un número.';
    else if (usedByPi(this.kb, key)) this.scError = `Pi ya usa ${label(key)}.`;
    else if (other) this.scError = `Ya la usa «${ACTION_NAMES[other]}».`;
    else { this.c.setShortcut(action, key); this.capturing = false; this.scError = ''; }
  }

  mainRows() {
    const {settings: s, server} = this.c.state(), on = server !== 'off';
    const active = this.c.voices().find(v => this.isActive(v));
    const vol = nearest(VOLUMES, s.volume), spd = nearest(SPEEDS, s.speed);
    const move = (list: number[], i: number, d: number) => list[Math.min(list.length - 1, Math.max(0, i + d))];
    return [
      {section: 'Voz y sonido', label: 'Voz', text: active ? `${active.name} · ${active.note}` : this.c.active().voice, buttons: [['[ Cambiar ]', () => { this.page = 'voices'; this.switchEngine(''); }]]},
      {label: 'Volumen', value: `${Math.round(s.volume * 100)} %`, step: (d: number) => this.c.change('volume', move(VOLUMES, vol, d))},
      {label: 'Velocidad', value: `${s.speed.toFixed(2)}x`, step: (d: number) => this.c.change('speed', move(SPEEDS, spd, d))},
      ...(this.c.active().model === 'phonon' ? [{label: 'Ritmo de Phonon',
        value: (s.rhythm > 0 ? '+' : '') + String(s.rhythm).replace('.', ','),
        status: '− más rápido · + más pausado',
        step: (d: number) => this.c.change('rhythm', move(RHYTHMS, nearest(RHYTHMS, s.rhythm), d))}] : []),
      {section: 'Lectura', label: 'Lectura automática', value: s.auto ? 'sí' : 'no', step: () => this.c.change('auto', !s.auto)},
      {label: 'Si llega otra lectura', value: s.policy === 'wait' ? 'Esperar' : 'Detener', step: () => this.c.change('policy', s.policy === 'wait' ? 'stop' : 'wait')},
      {section: 'Interfaz', label: 'Atajos de teclado', value: s.shortcutsOn ? 'activados' : 'desactivados', step: () => this.c.change('shortcutsOn', !s.shortcutsOn),
        buttons: [['[ Editar ]', () => { this.page = 'shortcuts'; this.scRow = 0; this.col = 0; this.capturing = false; this.scError = ''; }]]},
      {label: 'Barra de controles', value: s.toolbar ? 'visible' : 'oculta', step: () => this.c.change('toolbar', !s.toolbar)},
      {label: 'Indicador de estado', value: s.indicator ? 'visible' : 'oculto', step: () => this.c.change('indicator', !s.indicator)},
      {label: 'Iconos', value: s.icons === 'text' ? 'Texto' : 'Símbolos', step: () => this.c.change('icons', s.icons === 'text' ? 'symbols' : 'text')},
      {section: 'Audio y servidor', label: 'Audio', value: s.audio === 'ssh' ? 'SSH' : 'Local', step: () => this.c.change('audio', s.audio === 'ssh' ? 'local' : 'ssh'),
        // With SSH the pairing code sits right of the value: Enter copies it at once, a click on Ver shows it.
        ...(s.audio === 'ssh' ? {status: this.codeStatus, buttons: [
          ['[ Copiar ]', () => { void this.copyCode(); }],
          ['[ Ver ]', () => { void this.openCode(); }],
        ]} : {})},
      s.audio === 'ssh'
        ? {label: 'Salida', text: '(SSH: la elige el cliente)'}
        : {label: 'Salida', value: s.device || 'Predeterminada', step: (d: number) => {
          const devices = [...new Set(['', ...(this.c.devices?.(this.showHiddenDevices) ?? []), s.device])];
          const i = Math.max(0, devices.indexOf(s.device));
          this.c.change('device', devices[(i + d + devices.length) % devices.length]);
        }},
      {label: on ? 'Servidor ● activo' : 'Servidor ○ apagado', buttons: [
        [on ? '[ Apagar ]' : '[ Encender ]', () => { this.c.power(on ? 'off' : 'on'); this.col = 0; }],
        ['[ Reiniciar ]', on ? () => this.c.power('restart') : undefined],
      ]},
    ] as any[];
  }

  key(data: string) {
    const m = (id: string) => this.kb.matches(data, id);
    if (m('tui.select.up')) return 'up';
    if (m('tui.select.down')) return 'down';
    if (m('tui.select.confirm')) return 'enter';
    if (m('tui.select.cancel')) return 'esc';
    if (m('tui.editor.cursorLeft')) return 'left';
    if (m('tui.editor.cursorRight')) return 'right';
    if (m('tui.editor.deleteCharBackward')) return 'back';
    return '';
  }
  text(data: string) {
    const pasted = data.replace(/\x1b\[20[01]~/g, '');
    if (pasted !== data) return pasted.replace(/\s/g, '');
    const kitty = /^\x1b\[(\d+)(?:;1)?u$/.exec(data);
    if (kitty) { const ch = String.fromCodePoint(Number(kitty[1])); return ch > ' ' ? ch : ''; }
    return data.length === 1 && data > ' ' ? data : '';
  }

  handleInput(data: string) {
    if (/^\x1b\[[\d;:]*:3u$/.test(data)) return; // kitty key release
    const k = this.key(data);
    if (this.page === 'shortcuts') {
      if (this.capturing) this.capture(data);
      else if (k === 'esc') this.home();
      else if (k === 'up') { this.scRow = (this.scRow - 1 + ACTIONS.length) % ACTIONS.length; this.col = 0; }
      else if (k === 'down') { this.scRow = (this.scRow + 1) % ACTIONS.length; this.col = 0; }
      else if (k === 'left' || k === 'right') this.col = k === 'right' && this.c.state().settings.shortcuts[ACTIONS[this.scRow]] ? 1 : 0;
      else if (k === 'back' || (k === 'enter' && this.col === 1 && this.c.state().settings.shortcuts[ACTIONS[this.scRow]])) {
        this.c.setShortcut(ACTIONS[this.scRow], undefined); this.col = 0;
      } else if (k === 'enter') { this.col = 0; this.capturing = true; this.scError = ''; }
      this.redraw();
      return;
    }
    if (this.page === 'code') {
      const actions = [() => { void this.copyCode(); }, () => this.closeCode(), () => this.done()];
      if (k === 'esc') this.closeCode();
      else if (k === 'left' || k === 'right') this.col = Math.max(0, Math.min(2, this.col + (k === 'right' ? 1 : -1)));
      else if (k === 'enter') { const run = actions[this.col]; if (this.col === 2) { run(); return; } run(); }
      this.redraw();
      return;
    }
    if (this.page === 'devices') {
      if (k === 'esc') this.page = 'main';
      else if (data.toLowerCase() === 'r') { void this.refreshDeviceList(); }
      else if (data === '\t') this.deviceToggleFocused = !this.deviceToggleFocused;
      else if (k === 'up' || k === 'down') {
        if (this.deviceToggleFocused) this.deviceToggleFocused = false;
        else this.devicePick = (this.devicePick + (k === 'down' ? 1 : -1) + this.deviceOptions.length) % this.deviceOptions.length;
      } else if (k === 'enter') {
        if (this.deviceToggleFocused) this.toggleHiddenDevices();
        else this.chooseDevice(this.devicePick);
      }
      this.redraw();
      return;
    }
    if (this.page === 'main') {
      const rows = this.mainRows(), r = rows[this.row];
      if (k === 'esc') { this.done(); return; }
      if (k === 'up') { this.row = (this.row - 1 + rows.length) % rows.length; this.col = 0; }
      else if (k === 'down') { this.row = (this.row + 1) % rows.length; this.col = 0; }
      else if ((k === 'left' || k === 'right') && r.step) r.step(k === 'right' ? 1 : -1);
      // Tab moves between the buttons of a row whose ←→ already change its value (Audio SSH: Copiar, Ver).
      else if (data === '	' && r.buttons) {
        const usable = r.buttons.map((b: any, i: number) => b[1] ? i : -1).filter((i: number) => i >= 0);
        this.col = usable[(usable.indexOf(this.col) + 1) % usable.length] ?? 0;
      }
      else if ((k === 'left' || k === 'right') && r.buttons) {
        const usable = r.buttons.map((b: any, i: number) => b[1] ? i : -1).filter((i: number) => i >= 0);
        this.col = usable[Math.max(0, Math.min(usable.length - 1, usable.indexOf(this.col) + (k === 'right' ? 1 : -1)))] ?? 0;
      } else if (k === 'enter') {
        if (r.label === 'Salida' && r.step) this.openDevices();
        else if (r.buttons && (!r.step || r.label !== 'Lectura automática')) r.buttons[this.col]?.[1]?.();
        else r.step?.(1);
      }
    } else if (this.page === 'voices') {
      const list = this.order();
      if (k === 'esc') this.home();
      else if (data === '\t' || data === '\x1b[9u') { const engines = this.engines(); this.switchEngine(engines[(engines.indexOf(this.engine) + 1) % engines.length] ?? ''); }
      else if (k === 'up') this.pick = list.length ? (this.pick - 1 + list.length) % list.length : 0;
      else if (k === 'down') this.pick = list.length ? (this.pick + 1) % list.length : 0;
      else if (k === 'enter' && list[this.pick]) this.choose(list[this.pick]);
      else if ((k === 'left' || k === 'right') && list[this.pick]) this.c.toggleDict(list[this.pick]);
    } else if (this.page === 'download') {
      const done = this.result === 'done' && !this.downloading;
      if (k === 'esc') { if (done || this.downloading) this.home(); else this.page = 'voices'; }
      else if (this.downloading) { /* Wait: Esc goes back to the menu, the download goes on. */ }
      else if (k === 'left' || k === 'right') this.col = k === 'right' ? 1 : 0;
      else if (k === 'enter' && done) { if (this.col === 0) { this.done(); return; } this.home(); }
      else if (k === 'enter') { if (this.col === 0) this.confirm(); else this.page = 'voices'; }
    } else {
      if (k === 'esc') this.page = 'voices';
      else if (k === 'enter') this.saveToken();
      else if (k === 'back') this.token = this.token.slice(0, -1);
      else if (!k) this.token += this.text(data);
    }
    this.redraw();
  }

  handleMouse(ev: {type: string; button: string; x: number; y: number}) {
    if (ev.type === 'click' && ev.button === 'left') {
      const hit = this.hits.find(h => h.y === ev.y && ev.x >= h.x0 && ev.x < h.x1);
      if (hit) { hit.fn(); this.redraw(); }
    }
    return {handled: true, render: true};
  }

  render(_width = W): string[] {
    const th = this.th, out: string[] = [];
    this.hits = [];
    const line = (segs: Seg[] = []) => {
      let x = 1, body = '';
      for (const g of segs) {
        if (g.fn) this.hits.push({y: out.length, x0: x, x1: x + width(g.text), fn: g.fn});
        body += g.style ? th.fg(g.style, g.text) : g.text;
        x += width(g.text);
      }
      out.push(th.fg('border', '│') + body + ' '.repeat(Math.max(0, IN - (x - 1))) + th.fg('border', '│'));
    };
    // A long error is split by words over several lines, so it never runs past the border.
    const errorLines = (text: string) => {
      if (!text) { line(); return; }
      let current = '';
      const max = IN - 2;
      // A word longer than a line (a URL, an id) is cut into pieces that fit.
      const words = text.split(/\s+/).flatMap(w => Array.from({length: Math.ceil(Array.from(w).length / max) || 1},
        (_, k) => Array.from(w).slice(k * max, (k + 1) * max).join('')));
      for (const word of words) {
        if (current && width(current) + 1 + width(word) > max) { line([{text: ' ' + current, style: 'error'}]); current = word; }
        else current = current ? `${current} ${word}` : word;
      }
      line([{text: ' ' + current, style: 'error'}]);
    };
    const titles = {shortcuts: ' Atajos de teclado ', main: ' teHablo · Ajustes ', code: ' Código SSH ', devices: ' Salida de audio ', voices: ' Elegir voz ', download: ' Descargar voz ', token: ' Activar voces con cuenta gratis '};
    const title = titles[this.page], left = Math.floor((IN - width(title)) / 2);
    out.push(th.fg('border', '╭' + '─'.repeat(left)) + th.fg('accent', title) + th.fg('border', '─'.repeat(IN - left - width(title)) + '╮'));
    line();
    if (this.page === 'shortcuts') {
      const shortcuts = this.c.state().settings.shortcuts;
      line([{text: '   ' + fit('Acción', 30) + fit('Atajo', 14), style: 'dim'}]);
      line([{text: '   ' + '─'.repeat(IN - 4), style: 'dim'}]);
      ACTIONS.forEach((a, i) => {
        const sel = i === this.scRow, change = () => { this.scRow = i; this.col = 0; this.capturing = true; this.scError = ''; };
        const segs: Seg[] = [{text: sel ? ' ▶ ' : '   ', style: 'accent'}, {text: fit(ACTION_NAMES[a], 30), style: sel ? 'accent' : undefined},
          {text: fit(sel && this.capturing ? '…' : label(shortcuts[a]), 14), style: shortcuts[a] ? 'success' : 'dim'},
          {text: '[ Cambiar ]', style: sel && this.col === 0 ? 'accent' : undefined, fn: change}];
        if (shortcuts[a]) segs.push({text: ' '}, {text: '[ Quitar ]', style: sel && this.col === 1 ? 'accent' : undefined,
          fn: () => { this.scRow = i; this.col = 0; this.c.setShortcut(a, undefined); }});
        line(segs);
      });
      line();
      line(this.capturing ? [{text: ' Presiona la combinación (Ctrl o Alt + letra o número) · Esc cancela', style: 'warning'}] : []);
      line(this.scError ? [{text: ' ' + this.scError, style: 'error'}] : []);
      line([{text: ' '}, {text: '[ Volver ]', style: 'accent', fn: () => this.home()}, {text: '   ↑↓ fila · ←→ botón · Enter · ⌫ quitar · Esc', style: 'dim'}]);
    } else if (this.page === 'code') {
      line([{text: ' Código de vinculación de este servidor:'}]);
      line();
      line([{text: '   ' + this.code, style: 'accent'}]);
      line();
      line([{text: ' Escríbelo en el cliente de tu computadora («Vincular servidor»).', style: 'dim'}]);
      line([{text: ' No lo compartas.', style: 'dim'}]);
      line(this.codeStatus ? [{text: ' ' + this.codeStatus, style: 'dim'}] : []);
      const buttons: [string, () => void][] = [['[ Copiar ]', () => { void this.copyCode(); }], ['[ Volver ]', () => this.closeCode()], ['[ Cerrar ]', () => this.done()]];
      line([{text: ' '}, ...buttons.flatMap(([text, fn], j) => [{text, style: this.col === j ? 'accent' : undefined, fn}, {text: ' '}]),
        {text: '  ←→ elegir · Enter · Esc', style: 'dim'}]);
    } else if (this.page === 'main') {
      this.mainRows().forEach((r: any, i: number) => {
        if (r.section) line([{text: '   ' + r.section, style: 'dim'}]);
        const sel = i === this.row;
        const segs: Seg[] = [{text: sel ? ' ▶ ' : '   ', style: 'accent'}, {text: fit(r.label, 22), style: sel ? 'accent' : undefined}];
        if (r.text) segs.push({text: fit(r.text, 30) + ' ', style: sel ? 'accent' : 'dim'});
        // Keep the output's full saved name; only its display must fit between the arrows.
        const value = r.step && r.label === 'Salida' ? fit(r.value, Math.min(width(r.value), IN - 31)) : r.value;
        if (r.step) segs.push({text: '◀', style: 'accent', fn: () => { this.row = i; r.step(-1); }},
          {text: ` ${value} `, style: sel ? 'accent' : 'dim', fn: () => { this.row = i; if (r.label === 'Salida') this.openDevices(); else r.step(1); }},
          {text: '▶', style: 'accent', fn: () => { this.row = i; r.step(1); }}, {text: '  '});
        (r.buttons ?? []).forEach((b: any, j: number) => {
          const enabled = !!b[1];
          segs.push({text: b[0], style: !enabled ? 'dim' : sel && this.col === j ? 'accent' : undefined,
            fn: enabled ? () => { this.row = i; this.col = j; b[1](); } : undefined}, {text: ' '});
        });
        if (r.status) segs.push({text: r.status, style: 'dim'});
        line(segs);
      });
      line(this.downloading && this.notice ? [{text: ' ' + this.notice}] : []);
      const enter = this.mainRows()[this.row]?.label === 'Salida' && this.c.state().settings.audio === 'local' ? 'Enter lista' : 'Enter';
      line([{text: ' '}, {text: '[ Cerrar ]', style: 'accent', fn: () => this.done()}, {text: `   ↑↓ elegir · ←→ cambiar · Tab botón · ${enter} · Esc`, style: 'dim'}]);
    } else if (this.page === 'devices') {
      line([{text: this.deviceToggleFocused ? ' ▶ ' : '   ', style: 'accent'},
        {text: `[ Mostrar ocultos: ${this.showHiddenDevices ? 'sí' : 'no'} ]`, style: this.deviceToggleFocused ? 'accent' : undefined, fn: () => this.toggleHiddenDevices()},
        {text: ' '}, {text: this.refreshingDevices ? '[ Actualizando… ]' : '[ Refrescar (R) ]', style: this.refreshingDevices ? 'dim' : 'accent',
          fn: !this.refreshingDevices && this.c.refreshDevices ? () => { void this.refreshDeviceList(); } : undefined}]);
      // Keep a long list inside the existing window; keyboard navigation scrolls the slice.
      const start = Math.max(0, this.devicePick - 9);
      this.deviceOptions.slice(start, start + 10).forEach((device, j) => {
        const i = start + j, sel = i === this.devicePick && !this.deviceToggleFocused;
        const current = device === this.c.state().settings.device;
        const choose = () => this.chooseDevice(i);
        line([{text: sel ? ' ▶ ' : '   ', style: 'accent', fn: choose},
          {text: fit(`${current ? '●' : ' '} ${device || 'Predeterminada'}`, IN - 4), style: sel ? 'accent' : undefined, fn: choose}]);
      });
      line();
      line([{text: ` ${this.devicePick + 1}/${this.deviceOptions.length} · ● actual`, style: 'dim'}]);
      if (this.c.state().deviceError) errorLines(this.c.state().deviceError!);
      line([{text: ' '}, {text: '[ Volver ]', style: 'accent', fn: () => { this.page = 'main'; }},
        {text: '   ↑↓ mover · Tab filtro · Enter elegir · Esc cancelar', style: 'dim'}]);
    } else if (this.page === 'voices') {
      const list = this.order(), start = Math.max(0, this.pick - 9);
      line([{text: ' '}, ...this.engines().flatMap(model => [{
        text: model === this.engine ? `[ ${ENGINE[model]} ]` : ENGINE[model],
        style: model === this.engine ? 'accent' : 'dim', fn: () => this.switchEngine(model),
      }, {text: '  '}]), {text: this.engines().length < 3 ? 'Tab cambia' : '', style: 'dim'}]);
      if (this.engine === 'phonon') line([{text: ' el que menos gasta y suena muy bien', style: 'dim'}]);
      list.slice(start, start + 10).forEach((v, j) => {
        const i = start + j;
        const sel = i === this.pick, pickIt = () => { this.pick = i; this.choose(v); };
        const style = v.downloaded ? 'dim' : v.kind === 'account' && !this.c.state().token ? 'warning' : 'dim';
        line([{text: sel ? ' ▶ ' : '   ', style: 'accent', fn: pickIt},
          {text: this.isActive(v) ? '● ' : '  ', style: 'warning', fn: pickIt},
          {text: fit(v.name, 18), style: this.isActive(v) ? 'warning' : sel ? 'accent' : undefined, fn: pickIt},
          {text: fit(v.note, 21), fn: pickIt},
          {text: v.downloaded ? '✓' : '↓', style, fn: pickIt}]);
      });
      line([{text: ` ${list.length ? this.pick + 1 : 0}/${list.length} `, style: 'dim'},
        {text: '[ Anterior ]', fn: () => { this.pick = Math.max(0, this.pick - 10); }}, {text: ' '},
        {text: '[ Siguiente ]', fn: () => { this.pick = Math.min(Math.max(0, list.length - 1), this.pick + 10); }}]);
      line([{text: '✓ descargada  ↓ por descargar'.padStart(IN - 1), style: 'dim'}]);
      const selected = list[this.pick];
      if (selected) {
        line([{text: ` Diccionario: ${this.c.dict(selected) ? 'sí' : 'no'} (←→)`, style: 'dim', fn: () => this.c.toggleDict(selected)}]);
        if (!selected.downloaded && selected.kind === 'account' && selected.needsToken !== false && !this.c.state().token)
          line([{text: ' Cuenta gratis de Hugging Face para descargar (una vez)', style: 'dim'}]);
      }
      line([{text: ' '}, {text: '[ Volver ]', style: 'accent', fn: () => this.home()}, {text: '   ↑↓ elegir · Enter usar · Tab motor · Esc', style: 'dim'}]);
    } else if (this.page === 'download') {
      const v = this.target!;
      if (this.downloading || this.result === 'done') {
        line([{text: this.downloading ? ` Descargando ${v.name}…` : ` ${v.name} (${v.note}): Descargada.`, style: this.downloading ? undefined : 'dim'}]);
        line([{text: this.downloading ? ' Esc vuelve al menú; la descarga sigue.' : ' Ya funciona sin internet.', style: 'dim'}]);
        line();
        line(this.downloading ? [] : [{text: ' '}, {text: '[ Cerrar ]', style: this.col === 0 ? 'accent' : undefined, fn: () => this.done()},
          {text: ' '}, {text: '[ Volver al menú ]', style: this.col === 1 ? 'accent' : undefined, fn: () => this.home()}]);
        out.push(th.fg('border', '╰' + '─'.repeat(IN) + '╯'));
        return out;
      }
      line([{text: ` ${v.name} (${v.note}) no está descargada.`}]);
      line([{text: ' Se descarga 1 sola vez al usarla y luego funciona sin internet.', style: 'dim'}]);
      if (v.model === 'phonon') {
        line([{text: ' Solo baja esta voz (~256 KB); el token es solo para el modelo.', style: 'dim'}]);
        line([{text: ' Si tenías phonon-40m-es: nuevo modelo, 75 MB con token, una vez.', style: 'dim'}]);
      }
      errorLines(this.result === 'error' ? this.notice : '');
      line([{text: ' '}, {text: '[ Descargar y usar ]', style: this.col === 0 ? 'accent' : undefined, fn: () => this.confirm()},
        {text: ' '}, {text: '[ Volver ]', style: this.col === 1 ? 'accent' : undefined, fn: () => { this.page = 'voices'; }}]);
    } else {
      const v = this.target!;
      // Short addresses keep every line inside the window; a click opens the full https link.
      const link = (step: string, path: string) =>
        line([{text: step}, {text: `huggingface.co/${path}`, style: 'accent', fn: () => this.c.open(`https://huggingface.co/${path}`)}]);
      line([{text: ` ${v.name} viene de Hugging Face y pide una cuenta gratis.`}]);
      line([{text: v.model === 'phonon' ? ' El token solo descarga el modelo; cada voz baja sin cuenta.' : ' El token solo hace falta para descargarla; luego funciona sin él.'}]);
      if (v.model === 'phonon') line([{text: ' Si tenías phonon-40m-es: nuevo modelo, 75 MB con token, una vez.', style: 'dim'}]);
      line();
      link(' 1. Crea una cuenta:   ', 'join');
      link(' 2. Acepta términos:   ', v.model === 'phonon' ? 'gradium/phonon-40m-multilingual' : 'kyutai/pocket-tts');
      link(' 3. Token «Read-Only»: ', 'settings/tokens');
      line([{text: ' 4. Pégalo aquí (no se guarda; solo se usa en esta sesión):'}]);
      line();
      line([{text: ' Token: '}, {text: '•'.repeat(Math.min(50, width(this.token))) + '▏', style: 'accent'}]);
      errorLines(this.error);
      line();
      line([{text: ' '}, {text: '[ Usar ]', style: 'accent', fn: () => this.saveToken()}, {text: ' '},
        {text: '[ Volver ]', style: 'accent', fn: () => { this.page = 'voices'; }}, {text: '   Enter · Esc · clic en un enlace lo abre', style: 'dim'}]);
    }
    out.push(th.fg('border', '╰' + '─'.repeat(IN) + '╯'));
    return out;
  }
  invalidate() {}
}
