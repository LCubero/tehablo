import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ServerClient } from './server.ts';
import { finalText } from './text.ts';

const ENTRY = 'tehablo-tts';
interface Card { messageId: string; number: number }
const help = '/tts on|off · auto on|off · play [n] · pause · resume · stop · voice [nombre] · model [spanish|spanish_24l] · speed [0.75-1.5]';

export function createExtension(pi: ExtensionAPI, client = new ServerClient()) {
  let enabled = true, auto = false, epoch = 0;
  let context: ExtensionContext | undefined;
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
    await client.ensure();
    if (generation !== epoch || !enabled) return;
    await client.request('/speak', {id: card!.messageId, text});
  };
  pi.registerEntryRenderer<Card>(ENTRY, (entry, _options, theme) => {
    const label = () => context?.mode === 'tui' && enabled && entry.data && cards(context).some(c => c.messageId === entry.data!.messageId)
      ? `[ ▶ Escuchar ]  /tts play ${entry.data.number}` : '';
    return {
      render: (width: number) => label() && width > 0 ? [theme.fg('accent', Array.from(label()).slice(0, width).join(''))] : [],
      invalidate() {},
      handleMouse(event: {type: string; button: string; x: number; y: number}) {
        if (label() && event.type === 'click' && event.button === 'left' && event.y === 0 && event.x >= 0 && event.x < 14 && context) {
          void safe(context, () => speak(context!, String(entry.data!.number)));
          return {handled: true, render: true};
        }
      },
    };
  });
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    enabled = true; auto = false; epoch++; context = ctx;
    client.beginSession();
  });
  pi.on('agent_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    epoch++;
    void safe(ctx, () => client.stop());
  });
  pi.on('session_shutdown', async (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    epoch++; context = undefined;
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
        const applied = (h: any) => info(`Modelo: ${h.model} · voz: ${h.voice} · velocidad: ${h.speed}`);
        switch (command) {
          case 'on': enabled = true; info('TTS activado.'); return;
          case 'off': enabled = false; epoch++; await client.stop(); info('TTS desactivado.'); return;
          case 'auto':
            if (!['on', 'off'].includes(value)) { ctx.ui.notify('Uso: /tts auto on|off', 'warning'); return; }
            auto = value === 'on'; epoch++; info(`Lectura automática: ${auto ? 'sí' : 'no'}`); return;
          case 'play': await speak(ctx, value); return;
          case 'stop': epoch++; await client.action('/stop', {}); return;
          case 'pause': case 'resume': await client.action('/' + command, {}); return;
          case 'voice':
            if (!value) { const data = await client.action('/voices'); info(`Voces: ${data.voices.join(', ')}`); return; }
            applied(await client.action('/config', {voice: value})); return;
          case 'model': case 'speed':
            if (value) {
              applied(await client.action('/config', {[command]: command === 'speed' ? Number(value) : value})); return;
            }
        }
        const health = await client.action('/health');
        const status = await client.action('/status');
        info(`TTS: ${enabled ? 'activado' : 'desactivado'} · automático: ${auto ? 'sí' : 'no'}\nServidor: ${status.state} · listo: ${health.ready ? 'sí' : 'no'}\nModelo: ${health.model} · voz: ${health.voice} · velocidad: ${health.speed}\n${help}`);
      });
    },
  });
}
