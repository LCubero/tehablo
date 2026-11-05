import { ACTIONS, SPEEDS, type Action, type Settings, type VoiceRow } from './settings.ts';
import { keyOf, label, usedByPi } from './shortcuts.ts';

export const ACTION_NAMES: Record<Action, string> = {
  power: 'Encender / apagar TTS', auto: 'Lectura automática sí/no', play: 'Escuchar la última respuesta',
  pause: 'Pausar / seguir', stop: 'Detener', settings: 'Abrir ajustes', copied: 'Leer lo copiado',
};

// Floating settings window opened from [ ≡ ] (approved prototype: .repo-harness/tmp/menu-proto/proto.ts).
// Keys come through Pi's injected keybindings, so no direct pi-tui import is needed.
export interface WindowState { settings: Settings; server: 'off' | 'loading' | 'ready'; token: boolean }
export interface Controller {
  state(): WindowState;
  /** The voice in use: the chosen one, else the server's, else the start voice. */
  active(): {model: string; voice: string};
  voices(): VoiceRow[];
  choose(row: VoiceRow): void;
  change(field: 'volume' | 'speed' | 'auto' | 'shortcutsOn' | 'toolbar' | 'policy', value: number | boolean | 'stop' | 'wait'): void;
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

export const VOLUMES = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
const W = 72, IN = W - 2;
// RAM while the model is loaded, measured in Fedora (docs/pruebas-de-voces.md); every Pocket voice shares one model.
const RAM: Record<string, string> = {phonon: '~0,3 GB', spanish: '~1 GB', spanish_24l: '~1,8 GB'};
const width = (t: string) => Array.from(t).length;
const fit = (t: string, n: number) => { const a = Array.from(t); return a.length > n ? a.slice(0, n - 1).join('') + '…' : t + ' '.repeat(n - a.length); };
const nearest = (list: number[], value: number) => list.reduce((best, v, i) => Math.abs(v - value) < Math.abs(list[best] - value) ? i : best, 0);

export class SettingsWindow {
  page: 'main' | 'voices' | 'download' | 'token' | 'shortcuts' = 'main';
  capturing = false; scRow = 0; scError = '';
  row = 0; col = 0; pick = 0; token = ''; error = '';
  target?: VoiceRow;
  hits: {y: number; x0: number; x1: number; fn: () => void}[] = [];
  c: Controller; th: Theme; kb: Keys; done: () => void; redraw: () => void;
  constructor(c: Controller, th: Theme, kb: Keys, done: () => void, redraw: () => void) {
    this.c = c; this.th = th; this.kb = kb; this.done = done; this.redraw = redraw;
  }

  order() {
    const rank = (v: VoiceRow) => v.downloaded ? 0 : v.kind === 'download' ? 1 : 2;  // unknown counts as not downloaded
    return this.c.voices().map((v, i) => ({v, i})).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map(x => x.v);
  }
  typeLabel(v: VoiceRow) {
    if (v.downloaded) return 'Descargada';
    if (v.kind === 'download') return v.downloaded === null ? 'Sin cuenta' : 'Para descargar';
    return this.c.state().token ? 'Para descargar' : 'Con cuenta gratis';
  }
  isActive(v: VoiceRow) { const a = this.c.active(); return a.voice === v.voice && a.model === v.model; }
  home() { this.page = 'main'; this.row = 0; this.col = 0; }
  choose(v: VoiceRow) {
    this.target = v;
    const token = this.c.state().token;
    if (v.downloaded || (v.downloaded === null && (v.kind === 'download' || token))) { this.c.choose(v); this.home(); }
    else if (v.kind === 'account' && !token) { this.token = ''; this.error = ''; this.page = 'token'; }
    else { this.page = 'download'; this.col = 0; }
  }
  confirm() { if (this.target) this.c.choose(this.target); this.home(); }
  saveToken() {
    const value = this.token.trim();
    if (!value) return;
    try { this.c.saveToken(value); } catch (e) { this.error = e instanceof Error ? e.message : 'No se pudo usar el token.'; return; }
    this.token = ''; this.error = ''; this.page = 'download'; this.col = 0;
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
      {label: 'Voz', text: active ? `${active.name} · ${active.note}` : this.c.active().voice, buttons: [['[ Cambiar ]', () => { this.page = 'voices'; this.pick = 0; }]]},
      {label: 'Volumen', value: `${Math.round(VOLUMES[vol] * 100)} %`, step: (d: number) => this.c.change('volume', move(VOLUMES, vol, d))},
      {label: 'Velocidad', value: `${SPEEDS[spd].toFixed(2)}x`, step: (d: number) => this.c.change('speed', move(SPEEDS, spd, d))},
      {label: 'Lectura automática', value: s.auto ? 'sí' : 'no', step: () => this.c.change('auto', !s.auto)},
      {label: 'Atajos de teclado', value: s.shortcutsOn ? 'activados' : 'desactivados', step: () => this.c.change('shortcutsOn', !s.shortcutsOn),
        buttons: [['[ Editar ]', () => { this.page = 'shortcuts'; this.scRow = 0; this.capturing = false; this.scError = ''; }]]},
      {label: 'Si llega otra lectura', value: s.policy === 'wait' ? 'Esperar' : 'Detener', step: () => this.c.change('policy', s.policy === 'wait' ? 'stop' : 'wait')},
      {label: 'Barra de controles', value: s.toolbar ? 'visible' : 'oculta', step: () => this.c.change('toolbar', !s.toolbar)},
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
      else if (k === 'up') this.scRow = Math.max(0, this.scRow - 1);
      else if (k === 'down') this.scRow = Math.min(ACTIONS.length - 1, this.scRow + 1);
      else if (k === 'enter') { this.capturing = true; this.scError = ''; }
      else if (k === 'back') this.c.setShortcut(ACTIONS[this.scRow], undefined);
      this.redraw();
      return;
    }
    if (this.page === 'main') {
      const rows = this.mainRows(), r = rows[this.row];
      if (k === 'esc') { this.done(); return; }
      if (k === 'up') { this.row = Math.max(0, this.row - 1); this.col = 0; }
      else if (k === 'down') { this.row = Math.min(rows.length - 1, this.row + 1); this.col = 0; }
      else if ((k === 'left' || k === 'right') && r.step) r.step(k === 'right' ? 1 : -1);
      else if ((k === 'left' || k === 'right') && r.buttons) {
        const usable = r.buttons.map((b: any, i: number) => b[1] ? i : -1).filter((i: number) => i >= 0);
        this.col = usable[Math.max(0, Math.min(usable.length - 1, usable.indexOf(this.col) + (k === 'right' ? 1 : -1)))] ?? 0;
      } else if (k === 'enter') {
        if (r.buttons && (!r.step || r.label !== 'Lectura automática')) r.buttons[this.col]?.[1]?.();
        else r.step?.(1);
      }
    } else if (this.page === 'voices') {
      const list = this.order();
      if (k === 'esc') this.home();
      else if (k === 'up') this.pick = Math.max(0, this.pick - 1);
      else if (k === 'down') this.pick = Math.min(list.length - 1, this.pick + 1);
      else if (k === 'enter' && list[this.pick]) this.choose(list[this.pick]);
      else if ((k === 'left' || k === 'right') && list[this.pick]) this.c.toggleDict(list[this.pick]);
    } else if (this.page === 'download') {
      if (k === 'esc') this.page = 'voices';
      else if (k === 'left' || k === 'right') this.col = k === 'right' ? 1 : 0;
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
    const titles = {shortcuts: ' Atajos de teclado ', main: ' teHablo · Ajustes ', voices: ' Elegir voz ', download: ' Descargar voz ', token: ' Activar voces con cuenta gratis '};
    const title = titles[this.page], left = Math.floor((IN - width(title)) / 2);
    out.push(th.fg('border', '╭' + '─'.repeat(left)) + th.fg('accent', title) + th.fg('border', '─'.repeat(IN - left - width(title)) + '╮'));
    line();
    if (this.page === 'shortcuts') {
      const shortcuts = this.c.state().settings.shortcuts;
      line([{text: '   ' + fit('Acción', 30) + fit('Atajo', 14), style: 'dim'}]);
      line([{text: '   ' + '─'.repeat(IN - 4), style: 'dim'}]);
      ACTIONS.forEach((a, i) => {
        const sel = i === this.scRow, change = () => { this.scRow = i; this.capturing = true; this.scError = ''; };
        const segs: Seg[] = [{text: sel ? ' ▶ ' : '   ', style: 'accent'}, {text: fit(ACTION_NAMES[a], 30), style: sel ? 'accent' : undefined},
          {text: fit(sel && this.capturing ? '…' : label(shortcuts[a]), 14), style: shortcuts[a] ? 'success' : 'dim'},
          {text: '[ Cambiar ]', style: sel ? 'accent' : undefined, fn: change}];
        if (shortcuts[a]) segs.push({text: ' '}, {text: '[ Quitar ]', fn: () => { this.scRow = i; this.c.setShortcut(a, undefined); }});
        line(segs);
      });
      line();
      line(this.capturing ? [{text: ' Presiona la combinación (Ctrl o Alt + letra o número) · Esc cancela', style: 'warning'}] : []);
      line(this.scError ? [{text: ' ' + this.scError, style: 'error'}] : []);
      line([{text: ' '}, {text: '[ Volver ]', style: 'accent', fn: () => this.home()}, {text: '   ↑↓ elegir · Enter cambiar · ⌫ quitar · Esc', style: 'dim'}]);
    } else if (this.page === 'main') {
      this.mainRows().forEach((r: any, i: number) => {
        const sel = i === this.row;
        const segs: Seg[] = [{text: sel ? ' ▶ ' : '   ', style: 'accent'}, {text: fit(r.label, 21), style: sel ? 'accent' : undefined}];
        if (r.text) segs.push({text: fit(r.text, 30) + ' ', style: sel ? 'accent' : 'dim'});
        if (r.step) segs.push({text: '◀', style: 'accent', fn: () => { this.row = i; r.step(-1); }},
          {text: ` ${r.value} `, style: sel ? 'accent' : 'dim', fn: () => { this.row = i; r.step(1); }},
          {text: '▶', style: 'accent', fn: () => { this.row = i; r.step(1); }}, {text: '  '});
        (r.buttons ?? []).forEach((b: any, j: number) => {
          const enabled = !!b[1];
          segs.push({text: b[0], style: !enabled ? 'dim' : sel && this.col === j ? 'accent' : undefined,
            fn: enabled ? () => { this.row = i; this.col = j; b[1](); } : undefined}, {text: ' '});
        });
        line(segs);
      });
      line();
      line([{text: ' '}, {text: '[ Cerrar ]', style: 'accent', fn: () => this.done()}, {text: '   ↑↓ elegir · ←→ cambiar · Enter · Esc', style: 'dim'}]);
    } else if (this.page === 'voices') {
      line([{text: '   ' + fit('Voz', 31) + fit('Estado', 19) + fit('RAM aprox.', 11) + 'Dict', style: 'dim'}]);
      line([{text: '   ' + '─'.repeat(IN - 4), style: 'dim'}]);
      this.order().forEach((v, i) => {
        const sel = i === this.pick, pickIt = () => { this.pick = i; this.choose(v); };
        const style = v.downloaded ? 'success' : v.kind === 'account' && !this.c.state().token ? 'warning' : 'dim';
        line([{text: sel ? ' ▶ ' : '   ', style: 'accent', fn: pickIt},
          {text: fit(`${this.isActive(v) ? '●' : ' '} ${v.name}${v.kind === 'account' ? ' *' : ''} (${v.note})`, 31), style: this.isActive(v) ? 'warning' : sel ? 'accent' : undefined, fn: pickIt},
          {text: fit(this.typeLabel(v), 19), style, fn: pickIt},
          {text: fit(RAM[v.model] ?? '', 11), style: 'dim', fn: pickIt},
          // A click here switches this voice's pronunciation fixes without choosing the voice.
          {text: fit(this.c.dict(v) ? 'sí' : 'no', 6), style: sel ? 'accent' : 'dim', fn: () => { this.pick = i; this.c.toggleDict(v); }}]);
      });
      line([{text: '   * necesita una cuenta gratis de Hugging Face (1 sola vez)', style: 'dim'}]);
      line([{text: ' '}, {text: '[ Volver ]', style: 'accent', fn: () => this.home()}, {text: '   ↑↓ elegir · Enter usar · ←→ dict · Esc', style: 'dim'}]);
    } else if (this.page === 'download') {
      const v = this.target!;
      line([{text: ` ${v.name} (${v.note}) no está descargada.`}]);
      line([{text: ' Se descarga 1 sola vez al usarla y luego funciona sin internet.', style: 'dim'}]);
      // Every Phonon voice lives in one model file, so one download brings them all (Pocket voices download one by one).
      const also = v.model === 'phonon' ? this.c.voices().filter(o => o.model === 'phonon' && o.voice !== v.voice) : [];
      if (also.length) line([{text: ` Incluye también: ${also.map(o => `${o.name} (${o.note})`).join(', ')}.`, style: 'dim'}]);
      line();
      line([{text: ' '}, {text: '[ Descargar y usar ]', style: this.col === 0 ? 'accent' : undefined, fn: () => this.confirm()},
        {text: ' '}, {text: '[ Volver ]', style: this.col === 1 ? 'accent' : undefined, fn: () => { this.page = 'voices'; }}]);
    } else {
      const v = this.target!;
      // Short addresses keep every line inside the window; a click opens the full https link.
      const link = (step: string, path: string) =>
        line([{text: step}, {text: `huggingface.co/${path}`, style: 'accent', fn: () => this.c.open(`https://huggingface.co/${path}`)}]);
      line([{text: ` ${v.name} viene de Hugging Face y pide una cuenta gratis.`}]);
      line([{text: ' El token solo hace falta para descargarla; luego funciona sin él.'}]);
      line();
      link(' 1. Crea una cuenta:        ', 'join');
      link(' 2. Acepta los términos:    ', v.model === 'phonon' ? 'gradium/phonon-40m-es' : 'kyutai/pocket-tts');
      link(' 3. Token «Read-Only»:      ', 'settings/tokens');
      line([{text: ' 4. Pégalo aquí (no se guarda; solo se usa en esta sesión):'}]);
      line();
      line([{text: ' Token: '}, {text: '•'.repeat(Math.min(50, width(this.token))) + '▏', style: 'accent'}]);
      line(this.error ? [{text: ' ' + this.error, style: 'error'}] : []);
      line();
      line([{text: ' '}, {text: '[ Usar ]', style: 'accent', fn: () => this.saveToken()}, {text: ' '},
        {text: '[ Volver ]', style: 'accent', fn: () => { this.page = 'voices'; }}, {text: '   Enter · Esc · clic en un enlace lo abre', style: 'dim'}]);
    }
    out.push(th.fg('border', '╰' + '─'.repeat(IN) + '╯'));
    return out;
  }
  invalidate() {}
}
