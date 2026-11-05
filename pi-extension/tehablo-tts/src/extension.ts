import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ServerClient } from './server.ts';
import { cleanText, finalText } from './text.ts';
import { readClipboard } from './clipboard.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, DEFAULTS, loadSettings, saveSettings, settingsDir, type Action, type Settings, type VoiceRow } from './settings.ts';
import { keyOf } from './shortcuts.ts';
import { checkToken, hasToken } from './token.ts';
import { openUrl } from './browser.ts';
import { SettingsWindow, type Controller } from './window.ts';

/** Settings (user folder), token presence and voice table (project); tests use memory. */
export interface Store { load(): Settings; save(s: Settings): void; hasToken(): boolean; table(): VoiceRow[] }
export const fileStore = (root: string, dir = settingsDir()): Store => ({
  load: () => loadSettings(dir, root), save: s => saveSettings(dir, s), hasToken: () => hasToken(root),
  table: () => readTable(join(root, 'src', 'voice_table.json')),
});
/** The shared voice list (src/voice_table.json), with an unknown download state. */
export function readTable(path: string): VoiceRow[] {
  try {
    if (!existsSync(path)) return [];
    return (JSON.parse(readFileSync(path, 'utf8')) as any[]).map(v => ({
      name: v.name, voice: v.source ? `${v.name}.safetensors` : v.name, model: v.model,
      kind: v.kind, note: v.note, downloaded: null, ...(v.default ? {default: true} : {}),
    }));
  } catch { return []; }
}
export const memoryStore = (table: VoiceRow[] = []): Store => {
  let saved: Settings = {...DEFAULTS, shortcuts: {}, voices: []};
  return {load: () => structuredClone(saved), save: s => { saved = structuredClone(s); }, hasToken: () => false,
    table: () => structuredClone(table)};
};

const ENTRY = 'tehablo-tts';
/** Every message from this extension starts with this prefix. */
const say = (c: ExtensionContext | undefined, text: string, level: 'info' | 'warning') => c?.ui.notify(`TTS teHablo: ${text}`, level);
interface Card { messageId: string; number: number }
const help = '/tts · auto · play [n] · copy · pause · stop · toolbar · menu · dict · status\n/tts enciende o apaga el servidor; play sin número lee la última respuesta y play 3 la tercera de la sesión; toolbar muestra u oculta la barra; menu abre los ajustes; dict activa o desactiva el diccionario de pronunciación (pronunciaciones.json) para la voz actual.';

export function createExtension(pi: ExtensionAPI, client = new ServerClient(), store: Store = client.root ? fileStore(client.root) : memoryStore(),
  clipboard: () => Promise<string> = () => readClipboard(), watchMs = 0) {
  let settings: Settings = store.load();
  let applied = false, windowOpen = false;
  let closeWindow: (() => void) | undefined, redrawWindow: (() => void) | undefined;
  let current: {model: string; voice: string} | undefined;
  let stopKeys: (() => void) | undefined;
  const activeVoice = () => {
    if (current) return current;
    if (settings.voice) return {model: settings.model || 'spanish', voice: settings.voice};
    const start = store.table().find(v => (v as any).default);
    return start ? {model: start.model, voice: start.voice} : {model: 'spanish', voice: 'lola'};
  };
  // Pronunciation fixes were tuned listening to Pocket, so Phonon voices start without them.
  const dictFor = (voice: string, model: string) => Object.hasOwn(settings.dict, voice) ? settings.dict[voice] : model !== 'phonon';
  const dictEnabled = () => { const {voice, model} = activeVoice(); return dictFor(voice, model); };
  const toggleDict = (voice: string, model: string) => {
    const enabled = !dictFor(voice, model);
    settings = {...settings, dict: {...settings.dict, [voice]: enabled}}; persist();
    return enabled;
  };
  const persist = () => { try { store.save(settings); } catch { /* Settings are best effort. */ } };
  // barVisible only hides the bar (/tts toolbar); reading, auto and shortcuts keep working.
  let barVisible = true, auto = false, epoch = 0;
  let volume = 1, speed = 1;
  const speeds = [1, 1.1, 1.15, 1.25, 1.5];
  const speedLabel = (value: number) => `${value.toFixed(2)}x`;
  let context: ExtensionContext | undefined;
  let playback = {state: 'idle', id: null as string | null};
  const owned = new Map<string, string>(), queued = new Set<string>(), inFlight = new Set<string>();
  let readingNumber = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollEpoch = 0, started = false, pollFailures = 0;
  // Server lifecycle shown by the start button; `open` shows the volume and speed controls.
  let server: 'off' | 'loading' | 'ready' = 'off', open = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined, readyEpoch = 0, readyTries = 0;
  let warnedFallback: string | undefined;
  const READY_TRIES = 240;
  // Status line: "TTS off" while the server is off, else "TTS manual" or "TTS auto".
  const refresh = () => context?.ui.setStatus(ENTRY, server === 'off' ? 'TTS off'
    : `TTS ${auto ? 'auto' : 'manual'}${server === 'loading' ? ' · cargando' : ''}`);
  const setServer = (value: typeof server) => { if (value !== server) { server = value; refresh(); } };
  const cancelReady = () => { readyEpoch++; if (readyTimer) clearTimeout(readyTimer); readyTimer = undefined; };
  const sync = (health: any) => {
    if (typeof health?.volume === 'number') volume = health.volume;
    if (typeof health?.speed === 'number') speed = health.speed;
    if (typeof health?.model === 'string' && typeof health?.voice === 'string') current = {model: health.model, voice: health.voice};
    // The server replaced a voice that did not load with lola; say it once, not on every poll.
    const failed = typeof health?.fallback === 'string' && health.fallback ? health.fallback : undefined;
    if (failed && failed !== warnedFallback) say(context, `${failed} no cargó; se usa lola. Detalle en logs/tehablo-server.log.`, 'warning');
    if (health && 'fallback' in health) warnedFallback = failed;
    if (health?.ready === true && !applied) { applied = true; void applySaved(health); }
    if (typeof health?.error === 'string' && health.error.length > 0) {
      cancelReady(); setServer('off');
      say(context, `El modelo no cargó: ${health.error}`, 'warning');
    }
    else if (health?.ready === true) {
      cancelReady();
      // An open window learns the download states as soon as the server can tell them.
      if (server !== 'ready' && windowOpen) { setServer('ready'); void refreshVoices().then(() => redrawWindow?.(), () => {}); }
      setServer('ready');
    }
    else if (health?.ready === false) { if (server !== 'loading') readyTries = 0; setServer('loading'); waitReady(); }
    refresh();
  };
  /** Sends the saved voice, volume and speed to a freshly started server. */
  const applySaved = async (health: any) => {
    const generation = epoch;
    const body: Record<string, unknown> = {};
    // A server spawned here already started with the saved model and voice (startArgs); asking again
    // would reload the model, drop a queued reading, and retry a Phonon that just fell back to lola.
    if (!client.spawned && settings.model && settings.model !== health.model) body.model = settings.model;
    if (!client.spawned && settings.voice && (body.model || settings.voice !== health.voice)) body.voice = settings.voice;
    if (typeof health.volume === 'number' && settings.volume !== health.volume) body.volume = settings.volume;
    if (typeof health.speed === 'number' && settings.speed !== health.speed) body.speed = settings.speed;
    if (!Object.keys(body).length) return;
    try {
      const result = await client.action('/config', body);
      if (generation === epoch) sync(result);
    } catch (error) {
      if (generation === epoch) say(context, `No se aplicaron los ajustes guardados: ${error instanceof Error ? error.message : String(error)}`, 'warning');
    }
  };
  /** Polls /health until the model is loaded, bounded to READY_TRIES attempts of 500 ms. */
  const waitReady = () => {
    if (readyTimer) return;
    const generation = readyEpoch;
    readyTimer = setTimeout(async () => {
      readyTimer = undefined;
      if (generation !== readyEpoch || server !== 'loading') return;
      if (++readyTries > READY_TRIES) {
        setServer('off');
        say(context, 'El modelo no terminó de cargar.', 'warning');
        return;
      }
      try {
        const health = await client.request('/health');
        if (generation === readyEpoch) sync(health);
      } catch { if (generation === readyEpoch) setServer('off'); }
    }, 500);
    readyTimer.unref?.();
  };
  /** Other Pi sessions share the server, so the bar watches /health to show when one of them turns it on or off.
   * Only the state changes, after two equal observations; it never starts the server, applies settings or warns. */
  let watchTimer: ReturnType<typeof setTimeout> | undefined, watchEpoch = 0, booting = 0;
  let seen: typeof server | undefined, seenCount = 0, seenEpoch = 0;
  const stopWatch = () => { watchEpoch++; if (watchTimer) clearTimeout(watchTimer); watchTimer = undefined; seen = undefined; };
  const watch = () => {
    stopWatch();
    if (!watchMs) return;
    const generation = watchEpoch;
    const next = () => {
      watchTimer = setTimeout(async () => {
        watchTimer = undefined;
        const before = epoch;
        let observed: typeof server;
        try {
          const health = await client.request('/health');
          observed = typeof health?.error === 'string' && health.error ? 'off' : health?.ready === true ? 'ready' : 'loading';
        } catch { observed = 'off'; }
        if (generation !== watchEpoch) return;
        // This session's own boot, readiness wait or power off owns the state meanwhile.
        // A power off or other action since the last observation starts the count again, so a dying
        // server that still answers once cannot turn the bar back on.
        if (before !== seenEpoch) { seen = undefined; seenEpoch = before; }
        if (before !== epoch || booting || readyTimer) seen = undefined;
        else {
          seenCount = observed === seen ? seenCount + 1 : 1; seen = observed;
          if (seenCount >= 2 && observed !== server) {
            if (observed === 'off') { resetPlayback(); open = false; }
            setServer(observed);
          }
        }
        next();
      }, watchMs);
      watchTimer.unref?.();
    };
    next();
  };
  /** Starts the server when needed and reports its readiness. */
  const boot = async () => {
    booting++;
    try { await bootOnce(); } finally { booting--; }
  };
  const bootOnce = async () => {
    const generation = epoch;
    if (server === 'off') { readyTries = 0; applied = false; setServer('loading'); }
    client.startArgs = settings.model ? ['--model', settings.model, ...(settings.voice ? ['--voice', settings.voice] : [])] : [];
    try {
      await client.ensure();
      if (generation !== epoch) return;
      const health = await client.request('/health');
      if (generation === epoch) sync(health);
    } catch (error) {
      if (generation !== epoch) return;
      cancelReady(); setServer('off');
      throw error;
    }
  };
  /** Auto reading needs the server, so turning it on also starts a stopped one. */
  const setAuto = (value: boolean) => {
    auto = value; settings = {...settings, auto}; persist(); epoch++; refresh();
    return auto && server === 'off' ? boot() : undefined;
  };
  const setting = async (ctx: ExtensionContext, kind: string) => {
    const generation = epoch;
    const health = await client.action('/health');
    if (generation !== epoch) return;
    sync(health);
    const direction = kind.endsWith('+') ? 1 : -1;
    const field = kind.startsWith('volume') ? 'volume' : 'speed';
    const value = field === 'volume' ? Math.max(1, Math.min(15, Math.round(volume * 10) + direction)) / 10
      : direction > 0 ? (speeds.find(v => v > speed) ?? speed)
        : (speeds.findLast(v => v < speed) ?? speed);
    const configured = await client.action('/config', {[field]: value});
    if (generation !== epoch) return;
    if (typeof configured?.[field] === 'number') { settings = {...settings, [field]: configured[field]}; persist(); }
    sync(configured);
    say(ctx, field === 'volume' ? `Volumen: ${Math.round(volume * 100)} %` : `Velocidad: ${speedLabel(speed)}`, 'info');
  };
  const update = (state: string, id: string | null) => {
    if (state !== playback.state || id !== playback.id) { playback = {state, id}; refresh(); }
  };
  const cancelPoll = () => { pollEpoch++; if (timer) clearTimeout(timer); timer = undefined; };
  const resetPlayback = () => { cancelPoll(); owned.clear(); queued.clear(); started = false; pollFailures = 0; update('idle', null); };
  const powerOff = async () => {
    epoch++; resetPlayback(); cancelReady();
    open = false; volume = settings.volume; speed = settings.speed;
    setServer('off'); refresh();
    await client.powerOff();
  };
  /** Turning the server off on purpose also ends auto reading; restarts keep it. */
  const turnOff = () => { setAuto(false); return powerOff(); };
  const poll = () => {
    cancelPoll();
    if (!started) return;
    const generation = pollEpoch;
    timer = setTimeout(async () => {
      timer = undefined;
      try {
        const status = await client.request('/status');
        if (generation !== pollEpoch) return;
        pollFailures = 0;
        const promoted = Array.isArray(status.promoted) ? status.promoted : [];
        const queue = Array.isArray(status.queue) ? status.queue : [];
        for (const id of queued) if (owned.has(id) && (id === status.id || (!queue.includes(id) && promoted.includes(id)))) {
          queued.delete(id);
          say(context, 'Suena la lectura en espera.', 'info');
        }
        for (const id of owned.keys()) if (!inFlight.has(id) && id !== status.id && !queue.includes(id)) { owned.delete(id); queued.delete(id); }
        if (status.state === 'idle' && !queued.size && !inFlight.size) {
          if (typeof status.error === 'string' && status.error.length > 0)
            say(context, `No se pudo reproducir: ${status.error}`, 'warning');
          resetPlayback();
          return;
        }
        if (!owned.size) { resetPlayback(); return; }
        update(status.state, status.id);
      } catch {
        if (generation !== pollEpoch) return;
        if (++pollFailures >= 3) {
          resetPlayback(); setServer('off');
          say(context, 'Se perdió la conexión con el servidor. Revisa logs/tehablo-server.log.', 'warning');
          return;
        }
      }
      if (generation === pollEpoch) poll();
    }, 500);
    timer.unref?.();
  };
  const action = async (kind: string) => {
    if (kind === 'stop') { epoch++; resetPlayback(); }
    const generation = epoch;
    const result = await client.action('/' + kind, {});
    if (generation === epoch && kind !== 'stop' && started) { update(result?.state ?? (kind === 'pause' ? 'paused' : 'playing'), playback.id); poll(); }
  };
  const cancelReading = async (id: string) => {
    await client.action('/stop', {id});
    queued.delete(id); owned.delete(id);
    if (playback.id === id) update('idle', null);
    if (!owned.size) resetPlayback(); else poll();
  };
  const setToolbar = (visible: boolean, ctx: ExtensionContext) => {
    barVisible = visible; settings = {...settings, toolbar: visible}; persist(); refresh(); showStart(ctx);
    say(ctx, visible ? 'Barra visible.' : 'Barra oculta.', 'info');
  };
  const cards = (ctx: ExtensionContext): Card[] => ctx.sessionManager.getBranch()
    .filter((e: any) => e.type === 'custom' && e.customType === ENTRY).map((e: any) => e.data);
  const safe = async (ctx: ExtensionContext, operation: () => Promise<unknown> | unknown) => {
    try { await operation(); } catch (error) { say(ctx, `${error instanceof Error ? error.message : String(error)}`, 'warning'); }
  };
  const speak = async (ctx: ExtensionContext, number?: string) => {
    const card = number ? cards(ctx).find(c => String(c.number) === number) : cards(ctx).at(-1);
    const entry: any = card && ctx.sessionManager.getBranch().find(e => e.id === card.messageId && e.type === 'message');
    const text = finalText(entry?.message);
    if (!text) { say(ctx, 'Respuesta no encontrada.', 'warning'); return; }
    return play(card!.messageId, text);
  };
  /** Reads text in the bar of message `id`, so its pause and stop buttons control it.
   * `generation` is taken before any wait, so a stop or power off in between cancels the reading. */
  const play = async (id: string, text: string, generation = epoch) => {
    if (generation !== epoch) return;
    await boot();
    if (generation !== epoch) return;
    const reading = owned.has(id) || inFlight.has(id) ? `${id}:tehablo:${++readingNumber}` : id;
    owned.set(reading, id);
    inFlight.add(reading);
    let result: any;
    try {
      result = await client.request('/speak', {id: reading, text, lexicon: dictEnabled(), ...(settings.policy === 'wait' ? {policy: 'wait'} : {})});
    } catch (error) { owned.delete(reading); throw error; }
    finally { inFlight.delete(reading); }
    if (generation !== epoch) {
      // Never start a server just to cancel a response that arrived after power off or shutdown.
      try { await client.request('/stop', {id: reading}); } catch { /* Already off. */ }
      return;
    }
    owned.set(reading, id);
    started = true;
    pollFailures = 0;
    if (result?.state === 'queued') queued.add(reading);
    else queued.delete(reading);
    update(result?.state === 'queued' ? 'queued' : 'generating', reading);
    poll();
  };
  /** Reads the copied text; Pi cannot see the terminal's mouse selection, so the user copies it first. */
  const speakCopied = async (ctx: ExtensionContext, id?: string) => {
    const target = id ?? cards(ctx).at(-1)?.messageId;
    if (!target) return;
    const generation = epoch;
    const text = cleanText(await clipboard());
    if (generation !== epoch) return;
    if (!text) { say(ctx, 'El portapapeles está vacío.', 'warning'); return; }
    return play(target, text, generation);
  };
  /** Live server changes when it runs; settings are always saved and applied on the next start. */
  const configure = async (body: Record<string, unknown>) => {
    if (server !== 'ready') return;
    const generation = epoch;
    const result = await client.action('/config', body);
    if (generation === epoch) sync(result);
  };
  const refreshVoices = async () => {
    if (server !== 'ready') return;
    const data = await client.request('/voices');
    if (Array.isArray(data?.catalog)) { settings = {...settings, voices: data.catalog as VoiceRow[]}; persist(); }
  };
  const openSettings = async (ctx: ExtensionContext) => {
    if (ctx.mode !== 'tui') return;
    // Clicks outside the overlay still reach the bar, so [ ≡ ] closes an open window instead of opening another.
    if (windowOpen) { closeWindow?.(); return; }
    windowOpen = true;
    try { await refreshVoices(); } catch { /* Keep the last known voices. */ }
    const warn = (error: unknown) => say(ctx, `${error instanceof Error ? error.message : String(error)}`, 'warning');
    const run = (operation: () => Promise<unknown>) => { void operation().catch(warn); };
    const controller: Controller = {
      state: () => ({settings, server, token: !!client.token || store.hasToken()}),
      // Shared table order and notes; download states from the server once known.
      voices: () => {
        const known = new Map(settings.voices.map(v => [v.name, v]));
        const table = store.table();
        return table.length ? table.map(v => ({...v, downloaded: known.get(v.name)?.downloaded ?? null})) : settings.voices;
      },
      active: () => {
        if (settings.voice) return {model: settings.model || current?.model || 'spanish', voice: settings.voice};
        if (current) return current;
        const start = store.table().find(v => (v as any).default);
        return start ? {model: start.model, voice: start.voice} : {model: 'spanish', voice: 'lola'};
      },
      dict: row => dictFor(row.voice, row.model),
      toggleDict: row => { toggleDict(row.voice, row.model); },
      choose: row => { settings = {...settings, model: row.model, voice: row.voice}; persist(); run(() => configure({model: row.model, voice: row.voice})); },
      change: (field, value) => {
        settings = {...settings, [field]: value}; persist();
        if (field === 'toolbar') setToolbar(value as boolean, ctx);
        if (field === 'auto') { const starting = setAuto(value as boolean); if (starting) run(() => starting); }
        if (field === 'volume') volume = value as number;
        if (field === 'speed') speed = value as number;
        if (field === 'volume' || field === 'speed') run(() => configure({[field]: value}));
      },
      power: action => run(async () => {
        if (action === 'off') await turnOff();
        if (action === 'restart') await powerOff();
        if (action !== 'off') await boot();
      }),
      // Only needed to download an account voice, so it stays in memory and is never written.
      saveToken: value => {
        checkToken(value);
        client.token = value;
        // A running or loading server got its environment at spawn, so it restarts to see the token.
        if (server !== 'off') run(async () => { await powerOff(); await boot(); });
      },
      setShortcut: (name, key) => {
        const shortcuts = {...settings.shortcuts};
        if (key) shortcuts[name] = key; else delete shortcuts[name];
        settings = {...settings, shortcuts}; persist();
      },
      open: url => openUrl(url),
    };
    try {
      await ctx.ui.custom<void>((tui: any, theme: any, keybindings: any, done: () => void) => {
        closeWindow = done; redrawWindow = () => tui.requestRender();
        return new SettingsWindow(controller, theme, keybindings, () => done(), () => tui.requestRender()) as any;
      }, {overlay: true, overlayOptions: {anchor: 'center', width: 72}} as any);
    } finally { windowOpen = false; closeWindow = undefined; redrawWindow = undefined; }
  };
  const shortcut = async (ctx: ExtensionContext, name: Action) => {
    switch (name) {
      case 'power': return server === 'off' ? boot() : turnOff();
      case 'auto':
      {
        const starting = setAuto(!auto);
        say(ctx, `Lectura automática: ${auto ? 'sí' : 'no'}`, 'info'); return starting;
      }
      case 'play': return speak(ctx);
      case 'pause': if (playback.state !== 'idle') return action(playback.state === 'paused' ? 'resume' : 'pause'); return;
      case 'stop': if (server !== 'off') return action('stop'); return;
      case 'settings': return openSettings(ctx);
      case 'copied': return speakCopied(ctx);
    }
  };
  /** Shortcuts are read from raw input; only matched combinations are consumed. */
  const listenKeys = (ctx: ExtensionContext) => {
    stopKeys?.();
    stopKeys = ctx.ui.onTerminalInput?.(data => {
      if (!settings.shortcutsOn || windowOpen) return undefined;
      const key = keyOf(data);
      const name = key ? ACTIONS.find(a => settings.shortcuts[a] === key) : undefined;
      if (!name) return undefined;
      void safe(ctx, () => shortcut(ctx, name));
      return {consume: true};
    });
  };
  // Before the first response there is no entry to draw the bar on, so it shows above the editor.
  const START: Card = {messageId: 'tehablo-start', number: 0};
  const showStart = (ctx: ExtensionContext) => ctx.ui.setWidget(ENTRY, barVisible && !cards(ctx).length
    ? (_tui: any, theme: any) => bar(START, () => !!context && !cards(context).length, theme) : undefined);
  pi.registerEntryRenderer<Card>(ENTRY, (entry, _options, theme) =>
    bar(entry.data!, () => !!entry.data && !!context && cards(context).some(c => c.messageId === entry.data!.messageId), theme));
  /** The bar of one response (`card`), or of the start bar while there is none; `current` says whether to draw it. */
  function bar(card: Card, current: () => boolean, theme: any) {
    // Only single-column symbols, so click columns match Array.from lengths (≡ replaced ⚙, which some terminals draw two columns wide).
    // The menu [ ≡ ] shows next to the start button when off, and inside the open controls when on.
    const segments = () => {
      const waiting = [...queued].find(id => owned.get(id) === card.messageId);
      const active = (owned.get(playback.id!) ?? playback.id) === card.messageId && playback.state !== 'idle' && !waiting;
      const menu = {text: '[ ≡ ]', action: 'settings', gap: ''};
      if (!active && !waiting && server === 'off') return [{text: '[ ⏻ TTS ]', action: 'start', gap: ' '}, menu];
      if (!active && !waiting && server === 'loading') return [{text: '[ Cargando… ]', action: '', gap: ' '}, menu];
      const paused = playback.state === 'paused';
      const lead = waiting ? [{text: '[ ■ ]', action: 'cancelQueued', gap: ' '}, {text: 'En espera', action: '', gap: ' '}]
        : active
        ? [{text: paused ? '[ ▶ ]' : '[ ‖ ]', action: paused ? 'resume' : 'pause', gap: ' '}, {text: '[ ■ ]', action: 'stop', gap: ' '}]
        : [...(card === START ? [] : [{text: '[ ▶ ]', action: 'play', gap: ' '}]), {text: '[ ▶ copiado ]', action: 'copied', gap: ' '}];
      return [
        ...lead,
        {text: open ? '[ → ]' : '[ ⋯ ]', action: 'toggle', gap: open ? ' ' : ''},
        ...(open ? [
          // ":" only separates the close button from the menu and the sound controls.
          {text: ':', action: '', gap: ' '},
          {...menu, gap: '  '},
          {text: 'Vol', action: '', gap: ' '},
          {text: '[-', action: 'volume-', gap: ' '},
          {text: `${Math.round(volume * 100)}%`, action: '', gap: ' '},
          {text: '+]', action: 'volume+', gap: '  '},
          {text: 'Vel', action: '', gap: ' '},
          {text: '[-', action: 'speed-', gap: ' '},
          {text: speedLabel(speed), action: '', gap: ' '},
          {text: '+]', action: 'speed+', gap: ' '},
          {text: '[ ⏻ ]', action: 'powerOff', gap: ''},
        ] : []),
      ];
    };
    const label = () => context?.mode === 'tui' && barVisible && current()
      ? segments().map(c => c.text + c.gap).join('') : '';
    // One column of padding, like Pi's own transcript text; the start bar also leaves a blank line above the editor.
    return {
      render: (width: number) => label() && width > 1
        ? [theme.fg('accent', ' ' + Array.from(label()).slice(0, width - 1).join('')), ...(card === START ? [''] : [])] : [],
      invalidate() {},
      handleMouse(event: {type: string; button: string; x: number; y: number}) {
        if (label() && event.type === 'click' && event.button === 'left' && event.y === 0 && event.x >= 1 && context) {
          let start = 1;
          for (const control of segments()) {
            const end = start + Array.from(control.text).length;
            if (control.action && event.x >= start && event.x < end) {
              if (control.action === 'toggle') { open = !open; refresh(); return {handled: true, render: true}; }
              if (control.action === 'settings') { void safe(context, () => openSettings(context!)); return {handled: true, render: true}; }
              void safe(context, () => control.action === 'play' ? speak(context!, String(card.number))
                : control.action === 'copied' ? speakCopied(context!, card.messageId)
                : control.action === 'cancelQueued' ? cancelReading([...queued].find(id => owned.get(id) === card.messageId)!)
                : control.action === 'powerOff' ? turnOff()
                  : control.action === 'start' ? boot()
                  : /^(volume|speed)/.test(control.action) ? setting(context!, control.action) : action(control.action));
              return {handled: true, render: true};
            }
            start = end + control.gap.length;
          }
        }
      },
    };
  }
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    resetPlayback();
    settings = store.load(); applied = false;
    // The server starts off, and an off server has no auto reading (turning auto on starts it).
    barVisible = settings.toolbar; auto = false; if (settings.auto) { settings = {...settings, auto: false}; persist(); } volume = settings.volume; speed = settings.speed; epoch++; context = ctx;
    cancelReady(); server = 'off'; open = false;
    refresh(); showStart(ctx);
    listenKeys(ctx);
    client.beginSession();
    watch();
  });
  pi.on('agent_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    const ids = [...owned.keys()];
    epoch++; resetPlayback();
    void safe(ctx, async () => { for (const id of ids) await client.action('/stop', {id}); });
  });
  pi.on('session_shutdown', async (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    epoch++; resetPlayback(); cancelReady(); stopWatch(); server = 'off'; context = undefined;
    stopKeys?.(); stopKeys = undefined;
    await safe(ctx, () => client.shutdown());
  });
  pi.on('agent_settled', (event, ctx) => {
    if (ctx.mode !== 'tui' || event.aborted) return;
    context = ctx;
    void safe(ctx, () => {
      const last: any = ctx.sessionManager.getBranch().filter((e: any) => e.type === 'message' && e.message.role === 'assistant').at(-1);
      if (!last || !finalText(last.message) || cards(ctx).some(c => c.messageId === last.id)) return;
      const number = Math.max(0, ...cards(ctx).map(c => c.number)) + 1;
      pi.appendEntry(ENTRY, {messageId: last.id, number});
      showStart(ctx);
      if (auto) return speak(ctx, String(number));
    });
  });
  pi.registerCommand('tts', {
    description: 'Leer respuestas con teHablo local',
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui') return;
      context = ctx;
      await safe(ctx, async () => {
        const [command = '', ...rest] = args.trim().split(/\s+/);
        const value = rest.join(' ');
        const generation = epoch;
        const info = (text: string) => say(ctx, text, 'info');
        switch (command) {
          // Plain /tts turns the server on or off, like [ ⏻ TTS ] and [ ⏻ ] in the bar.
          case '': return server === 'off' ? boot() : turnOff();
          case 'toolbar':
            setToolbar(!barVisible, ctx);
            return;
          case 'auto':
            // Plain /tts auto toggles; on/off still work for anyone who already types them.
            if (!['', 'on', 'off'].includes(value)) { say(ctx, 'Uso: /tts auto', 'warning'); return; }
            {
              const starting = setAuto(value ? value === 'on' : !auto);
              info(`Lectura automática: ${auto ? 'sí' : 'no'}`); await starting; return;
            }
          case 'dict': {
            if (rest.length) { say(ctx, 'Uso: /tts dict', 'warning'); return; }
            const {voice, model} = activeVoice();
            const enabled = toggleDict(voice, model);
            info(`Dict (diccionario de pronunciación) para ${voice}: ${enabled ? 'sí' : 'no'}`);
            return;
          }
          case 'play': await speak(ctx, value); return;
          case 'copy': await speakCopied(ctx); return;
          case 'pause': if (playback.state !== 'idle') await action(playback.state === 'paused' ? 'resume' : 'pause'); return;
          case 'stop': if (server !== 'off') await action('stop'); return;
          // Not awaited: the window stays open until closed, and the command should return now.
          case 'menu': void safe(ctx, () => openSettings(ctx)); return;
          case 'status': break;
          default: say(ctx, `Uso: ${help}`, 'warning'); return;
        }
        const health = await client.action('/health');
        if (generation !== epoch) return;
        sync(health);
        const status = await client.action('/status');
        if (generation !== epoch) return;
        info(`Barra ${barVisible ? 'visible' : 'oculta'} · automático: ${auto ? 'sí' : 'no'}\nServidor: ${status.state} · listo: ${health.ready ? 'sí' : 'no'}\nModelo: ${health.model} · voz: ${health.voice} · velocidad: ${health.speed} · volumen: ${Math.round(volume * 100)} %\nDict (diccionario de pronunciación): ${dictEnabled() ? 'sí' : 'no'}\n${help}`);
      });
    },
  });
}
