import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ServerClient } from './server.ts';
import { finalText } from './text.ts';

const ENTRY = 'tehablo-tts';
interface Card { messageId: string; number: number }
const help = '/tts on|off · auto on|off · play [n] · pause · resume · stop · voice [nombre] · model [spanish|spanish_24l] · speed [0.75-1.5]';

export function createExtension(pi: ExtensionAPI, client = new ServerClient()) {
  let enabled = true, auto = false, epoch = 0;
  let volume = 1, speed = 1;
  const speeds = [1, 1.1, 1.15, 1.25, 1.5];
  const speedLabel = (value: number) => `${value.toFixed(2)}x`;
  let context: ExtensionContext | undefined;
  let playback = {state: 'idle', id: null as string | null};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollEpoch = 0, started = false;
  // Server lifecycle shown by the start button; `open` shows the volume and speed controls.
  let server: 'off' | 'loading' | 'ready' = 'off', open = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined, readyEpoch = 0, readyTries = 0;
  const READY_TRIES = 240;
  const refresh = () => context?.ui.setStatus(ENTRY, enabled ? `TTS ${auto ? 'auto' : 'manual'}${server === 'loading' ? ' · cargando' : ''}` : undefined);
  const setServer = (value: typeof server) => { if (value !== server) { server = value; refresh(); } };
  const cancelReady = () => { readyEpoch++; if (readyTimer) clearTimeout(readyTimer); readyTimer = undefined; };
  const sync = (health: any) => {
    if (typeof health?.volume === 'number') volume = health.volume;
    if (typeof health?.speed === 'number') speed = health.speed;
    if (health?.ready === true) { cancelReady(); setServer('ready'); }
    else if (health?.ready === false) { if (server !== 'loading') readyTries = 0; setServer('loading'); waitReady(); }
    refresh();
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
        context?.ui.notify('TTS: el modelo no terminó de cargar.', 'warning');
        return;
      }
      try {
        const health = await client.request('/health');
        if (generation === readyEpoch) sync(health);
      } catch { if (generation === readyEpoch) setServer('off'); }
    }, 500);
    readyTimer.unref?.();
  };
  /** Starts the server when needed and reports its readiness. */
  const boot = async () => {
    if (server === 'off') { readyTries = 0; setServer('loading'); }
    try {
      await client.ensure();
      sync(await client.request('/health'));
    } catch (error) {
      cancelReady(); setServer('off');
      throw error;
    }
  };
  const setting = async (ctx: ExtensionContext, kind: string) => {
    sync(await client.action('/health'));
    const direction = kind.endsWith('+') ? 1 : -1;
    const field = kind.startsWith('volume') ? 'volume' : 'speed';
    const value = field === 'volume' ? Math.max(1, Math.min(15, Math.round(volume * 10) + direction)) / 10
      : direction > 0 ? (speeds.find(v => v > speed) ?? speed)
        : (speeds.findLast(v => v < speed) ?? speed);
    sync(await client.action('/config', {[field]: value}));
    ctx.ui.notify(field === 'volume' ? `Volumen: ${Math.round(volume * 100)} %` : `Velocidad: ${speedLabel(speed)}`, 'info');
  };
  const update = (state: string, id: string | null) => {
    if (state !== playback.state || id !== playback.id) { playback = {state, id}; refresh(); }
  };
  const cancelPoll = () => { pollEpoch++; if (timer) clearTimeout(timer); timer = undefined; };
  const resetPlayback = () => { cancelPoll(); started = false; update('idle', null); };
  const poll = () => {
    cancelPoll();
    if (!started || playback.state === 'idle') return;
    const generation = pollEpoch;
    timer = setTimeout(async () => {
      timer = undefined;
      try {
        const status = await client.request('/status');
        if (generation !== pollEpoch) return;
        update(status.state, status.id);
      } catch { /* Transient status failures must never escape into Pi. */ }
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
  const cards = (ctx: ExtensionContext): Card[] => ctx.sessionManager.getBranch()
    .filter((e: any) => e.type === 'custom' && e.customType === ENTRY).map((e: any) => e.data);
  const safe = async (ctx: ExtensionContext, operation: () => Promise<unknown> | unknown) => {
    try { await operation(); } catch (error) { ctx.ui.notify(`TTS: ${error instanceof Error ? error.message : String(error)}`, 'warning'); }
  };
  const speak = async (ctx: ExtensionContext, number?: string) => {
    if (!enabled) { ctx.ui.notify('Activa TTS con /tts on.', 'warning'); return; }
    const card = number ? cards(ctx).find(c => String(c.number) === number) : cards(ctx).at(-1);
    const entry: any = card && ctx.sessionManager.getBranch().find(e => e.id === card.messageId && e.type === 'message');
    const text = finalText(entry?.message);
    if (!text) { ctx.ui.notify('Respuesta no encontrada.', 'warning'); return; }
    const generation = epoch;
    await boot();
    if (generation !== epoch || !enabled) return;
    await client.request('/speak', {id: card!.messageId, text});
    if (generation !== epoch) return;
    started = true;
    update('generating', card!.messageId);
    poll();
  };
  pi.registerEntryRenderer<Card>(ENTRY, (entry, _options, theme) => {
    // Only single-column symbols, so click columns match Array.from lengths.
    const segments = () => {
      const active = playback.id === entry.data?.messageId && playback.state !== 'idle';
      if (!active && server === 'off') return [{text: '[ ⏻ TTS ]', action: 'start', gap: ''}];
      if (!active && server === 'loading') return [{text: '[ Cargando… ]', action: '', gap: ''}];
      const paused = playback.state === 'paused';
      return [
        ...(active
          ? [{text: paused ? '[ ▶ ]' : '[ ‖ ]', action: paused ? 'resume' : 'pause', gap: ' '}, {text: '[ ■ ]', action: 'stop', gap: ' '}]
          : [{text: '[ ▶ Escuchar ]', action: 'play', gap: ' '}]),
        {text: open ? '[ → ]' : '[ ⋯ ]', action: 'toggle', gap: open ? '  ' : ''},
        ...(open ? [
          {text: 'Vol', action: '', gap: ' '},
          {text: '[-', action: 'volume-', gap: ' '},
          {text: `${Math.round(volume * 100)}%`, action: '', gap: ' '},
          {text: '+]', action: 'volume+', gap: '  '},
          {text: 'Vel', action: '', gap: ' '},
          {text: '[-', action: 'speed-', gap: ' '},
          {text: speedLabel(speed), action: '', gap: ' '},
          {text: '+]', action: 'speed+', gap: ''},
        ] : []),
      ];
    };
    const label = () => context?.mode === 'tui' && enabled && entry.data && cards(context).some(c => c.messageId === entry.data!.messageId)
      ? segments().map(c => c.text + c.gap).join('') : '';
    return {
      render: (width: number) => label() && width > 0 ? [theme.fg('accent', Array.from(label()).slice(0, width).join(''))] : [],
      invalidate() {},
      handleMouse(event: {type: string; button: string; x: number; y: number}) {
        if (label() && event.type === 'click' && event.button === 'left' && event.y === 0 && event.x >= 0 && context) {
          let start = 0;
          for (const control of segments()) {
            const end = start + Array.from(control.text).length;
            if (control.action && event.x >= start && event.x < end) {
              if (control.action === 'toggle') { open = !open; refresh(); return {handled: true, render: true}; }
              void safe(context, () => control.action === 'play' ? speak(context!, String(entry.data!.number))
                : control.action === 'start' ? boot()
                  : /^(volume|speed)/.test(control.action) ? setting(context!, control.action) : action(control.action));
              return {handled: true, render: true};
            }
            start = end + control.gap.length;
          }
        }
      },
    };
  });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    resetPlayback();
    enabled = true; auto = false; volume = 1; speed = 1; epoch++; context = ctx;
    cancelReady(); server = 'off'; open = false;
    client.beginSession();
  });
  pi.on('agent_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    epoch++; resetPlayback();
    void safe(ctx, () => client.stop());
  });
  pi.on('session_shutdown', async (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    epoch++; resetPlayback(); cancelReady(); server = 'off'; context = undefined;
    await safe(ctx, () => client.shutdown());
  });
  pi.on('agent_settled', (event, ctx) => {
    if (ctx.mode !== 'tui' || !enabled || event.aborted) return;
    context = ctx;
    void safe(ctx, () => {
      const last: any = ctx.sessionManager.getBranch().filter((e: any) => e.type === 'message' && e.message.role === 'assistant').at(-1);
      if (!last || !finalText(last.message) || cards(ctx).some(c => c.messageId === last.id)) return;
      const number = Math.max(0, ...cards(ctx).map(c => c.number)) + 1;
      pi.appendEntry(ENTRY, {messageId: last.id, number});
      if (auto) return speak(ctx, String(number));
    });
  });
  pi.registerCommand('tts', {
    description: 'Leer respuestas con tehablo local',
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui') return;
      context = ctx;
      await safe(ctx, async () => {
        const [command = '', ...rest] = args.trim().split(/\s+/);
        const value = rest.join(' ');
        const info = (text: string) => ctx.ui.notify(text, 'info');
        const applied = (h: any) => { sync(h); info(`Modelo: ${h.model} · voz: ${h.voice} · velocidad: ${h.speed} · volumen: ${Math.round(volume * 100)} %`); };
        switch (command) {
          case 'on': enabled = true; refresh(); info('TTS activado.'); return;
          case 'off': enabled = false; epoch++; resetPlayback(); refresh(); await client.stop(); info('TTS desactivado.'); return;
          case 'auto':
            if (!['on', 'off'].includes(value)) { ctx.ui.notify('Uso: /tts auto on|off', 'warning'); return; }
            auto = value === 'on'; epoch++; refresh(); info(`Lectura automática: ${auto ? 'sí' : 'no'}`); return;
          case 'play': await speak(ctx, value); return;
          case 'stop': case 'pause': case 'resume': await action(command); return;
          case 'voice':
            if (!value) { const data = await client.action('/voices'); info(`Voces: ${data.voices.join(', ')}`); return; }
            applied(await client.action('/config', {voice: value})); return;
          case 'model': case 'speed':
            if (value) {
              applied(await client.action('/config', {[command]: command === 'speed' ? Number(value) : value})); return;
            }
        }
        const health = await client.action('/health');
        sync(health);
        const status = await client.action('/status');
        info(`TTS: ${enabled ? 'activado' : 'desactivado'} · automático: ${auto ? 'sí' : 'no'}\nServidor: ${status.state} · listo: ${health.ready ? 'sí' : 'no'}\nModelo: ${health.model} · voz: ${health.voice} · velocidad: ${health.speed} · volumen: ${Math.round(volume * 100)} %\n${help}`);
      });
    },
  });
}
