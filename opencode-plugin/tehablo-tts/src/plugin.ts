import { tehabloRpc, type NoticeKind, type NoticePayload, type NoticeVariant } from '../rpc.ts';
import { ServerClient, type ServerOptions } from './server.ts';
import { DEFAULTS, loadSettings, settingsDir, type Settings } from './settings.ts';
import { cleanText, finalAssistantText } from './text.ts';

const SPOKEN_KEY = 'spokenIds';
const MAX_SPOKEN_IDS = 100;

export interface PluginContext {
  readonly location: { readonly directory: string };
  readonly options: Readonly<Record<string, any>>;
  readonly command: {
    readonly transform: (cb: (editor: {
      add(def: {
        readonly name: string;
        readonly description?: string;
        readonly execute: (input: {
          readonly sessionID: string;
          readonly prompt: { readonly text: string };
        }) => Promise<void>;
      }): void;
    }) => void) => Promise<unknown>;
  };
  readonly event: {
    readonly subscribe: (options?: {
      readonly types?: ReadonlyArray<string>;
      readonly signal?: AbortSignal;
    }) => AsyncIterable<{
      readonly type: string;
      readonly location?: { readonly directory?: string };
      readonly data?: any;
    }>;
  };
  readonly session: {
    readonly get: (input: { readonly sessionID: string }) => Promise<{
      readonly id: string;
      readonly parentID?: string;
      readonly outcome?: string;
      readonly location?: { readonly directory?: string };
    }>;
    readonly context: (input: { readonly sessionID: string }) => Promise<readonly any[]>;
  };
  readonly rpc?: {
    readonly register: (
      definition: typeof tehabloRpc,
      handlers: Record<string, never>,
    ) => Promise<{
      readonly dispose: () => Promise<void> | void;
      readonly events: { readonly emit: (name: 'notice', data: NoticePayload) => Promise<void> };
    }>;
  };
  readonly storage: {
    readonly get: (key: string) => Promise<unknown>;
    readonly set: (key: string, value: any) => Promise<void>;
  };
}

export interface PluginDeps {
  client?: ServerClient;
  clientOptions?: ServerOptions;
  loadSettings?: () => Settings;
  onError?: (error: unknown) => void;
  pollIntervalMs?: number;
}

const HELP_TEXT = [
  'Uso de /tts:',
  '/tts play   lee la última respuesta',
  '/tts stop   detiene las lecturas actuales y en espera',
  '/tts auto   activa o desactiva la lectura automática',
  '/tts help   muestra esta ayuda y el estado actual',
].join('\n');

function normalizeDir(dir: string | undefined, platform = process.platform): string {
  if (!dir) return '';
  const cleaned = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? cleaned.toLowerCase() : cleaned;
}

export function sameLocation(sessionDir: string | undefined, pluginDir: string, platform = process.platform): boolean {
  if (!sessionDir) return true;
  return normalizeDir(sessionDir, platform) === normalizeDir(pluginDir, platform);
}

function parseCommandArgs(rawText: string): [string, string] {
  const stripped = rawText.trim().replace(/^\/tts(?:\s+|$)/i, '').trim();
  if (!stripped) return ['', ''];
  const [sub = '', arg = ''] = stripped.split(/\s+/);
  return [sub.toLowerCase(), arg.toLowerCase()];
}

/** Create the Phase 1 OpenCode teHablo TTS plugin and return its unload cleanup handler. */
export async function createTehabloPlugin(ctx: PluginContext, deps: PluginDeps = {}): Promise<() => Promise<void>> {
  const explicitRoot = typeof ctx.options?.tehabloRoot === 'string' ? ctx.options.tehabloRoot : undefined;
  const client = deps.client ?? new ServerClient({root: explicitRoot, ...deps.clientOptions});
  const readSettings = deps.loadSettings ?? (() => loadSettings(settingsDir(), client.root || undefined, DEFAULTS));

  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  let settings = readSettings();
  let auto = false;
  let applied = false;
  let epoch = 0;
  let readingSeq = 0;
  let disposed = false;
  let pollEpoch = 0;
  let pollFailures = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const spokenIds = new Set<string>();
  const pendingText = new Map<string, { messageId: string; text: string }>();
  const controller = new AbortController();

  const loadSpoken = (async () => {
    try {
      const saved = await ctx.storage.get(SPOKEN_KEY);
      if (Array.isArray(saved)) {
        for (const id of saved) if (typeof id === 'string') spokenIds.add(id);
      }
    } catch { /* Storage errors never block plugin startup. */ }
  })();

  const saveSpoken = async () => {
    while (spokenIds.size > MAX_SPOKEN_IDS) {
      const oldest = spokenIds.values().next().value;
      if (oldest === undefined) break;
      spokenIds.delete(oldest);
    }
    try { await ctx.storage.set(SPOKEN_KEY, [...spokenIds]); }
    catch { /* Storage persistence is best effort. */ }
  };

  const rpc = await ctx.rpc?.register(tehabloRpc, {}).catch(() => undefined);

  const notify = async (
    sessionID: string,
    message: string,
    opts: { kind?: NoticeKind; variant?: NoticeVariant } = {},
  ) => {
    const payload: NoticePayload = {
      sessionID,
      kind: opts.kind ?? 'toast',
      variant: opts.variant ?? 'info',
      message,
    };
    if (rpc) {
      try {
        await rpc.events.emit('notice', payload);
        return;
      } catch { /* Fall back to log if RPC emission fails. */ }
    }
    console.info(`TTS teHablo: ${message}`);
  };

  const dictEnabled = (current: Settings, model: string, voice: string) =>
    Object.hasOwn(current.dict, voice) ? current.dict[voice] : model !== 'phonon';

  const applySaved = async (health: any, current: Settings, generation: number) => {
    const body: Record<string, unknown> = {};
    if (!client.spawned && current.model && current.model !== health.model) body.model = current.model;
    if (!client.spawned && current.voice && (body.model || current.voice !== health.voice)) body.voice = current.voice;
    if (typeof health?.volume === 'number' && current.volume !== health.volume) body.volume = current.volume;
    if (typeof health?.speed === 'number' && current.speed !== health.speed) body.speed = current.speed;
    if (current.rhythm !== (health?.rhythm ?? 0)) body.rhythm = current.rhythm;
    if (current.audio !== health?.audio) body.audio = current.audio;
    if (current.audio === 'local' && current.device !== (health?.device ?? '')) body.device = current.device;
    if (!Object.keys(body).length) return health;
    if (generation !== epoch || disposed) return health;
    return client.action('/config', body);
  };

  const boot = async (generation = epoch): Promise<any> => {
    settings = readSettings();
    client.startArgs = [
      ...(settings.model ? ['--model', settings.model, ...(settings.voice ? ['--voice', settings.voice] : [])] : []),
      '--audio',
      settings.audio,
    ];
    await client.ensure();
    if (generation !== epoch || disposed) return undefined;
    const health = await client.request('/health');
    if (generation !== epoch || disposed) return undefined;
    if (typeof health?.error === 'string' && health.error.length > 0) {
      throw new Error(`El modelo no cargó: ${health.error}`);
    }
    if (!applied) {
      const updated = await applySaved(health, settings, generation);
      if (generation === epoch && !disposed) applied = true;
      return updated;
    }
    return health;
  };

  const cancelPoll = () => {
    pollEpoch++;
    pollFailures = 0;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  };

  const schedulePoll = (expectedEpoch = pollEpoch) => {
    if (disposed || expectedEpoch !== pollEpoch) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      pollTimer = undefined;
      if (disposed || expectedEpoch !== pollEpoch) return;
      try {
        const status = await client.request('/status');
        if (disposed || expectedEpoch !== pollEpoch) return;
        pollFailures = 0;
        const queueEmpty = !Array.isArray(status?.queue) || status.queue.length === 0;
        if ((status?.state === 'idle' || status?.state === 'error') && queueEmpty) {
          cancelPoll();
          return;
        }
      } catch {
        if (disposed || expectedEpoch !== pollEpoch) return;
        if (++pollFailures >= 3) {
          cancelPoll();
          return;
        }
      }
      if (!disposed && expectedEpoch === pollEpoch) schedulePoll(expectedEpoch);
    }, pollIntervalMs);
    pollTimer.unref?.();
  };

  const startPolling = () => {
    cancelPoll();
    schedulePoll(pollEpoch);
  };

  const play = async (messageId: string, text: string, allowRepeat: boolean) => {
    const generation = epoch;
    const health = await boot(generation);
    if (generation !== epoch || disposed) return;
    const model = typeof health?.model === 'string' ? health.model : (settings.model || 'spanish');
    const voice = typeof health?.voice === 'string' ? health.voice : (settings.voice || 'lola');
    const readingId = allowRepeat ? `${messageId}:tehablo:${++readingSeq}` : messageId;
    await client.request('/speak', {
      id: readingId,
      text,
      lexicon: dictEnabled(settings, model, voice),
      ...(settings.policy === 'wait' ? {policy: 'wait'} : {}),
    });
    if (generation !== epoch || disposed) return;
    startPolling();
  };

  const resolveLatestResponse = async (sessionID: string): Promise<{ messageId: string; text: string } | undefined> => {
    let contextFailed = false;
    try {
      const messages = await ctx.session.context({sessionID});
      const candidate = finalAssistantText(messages);
      if (candidate) return candidate;
      if (messages.some(m => m?.type === 'assistant')) return undefined;
    } catch {
      contextFailed = true;
    }
    const fallback = pendingText.get(sessionID);
    if (!fallback) return undefined;
    const cleaned = cleanText(fallback.text);
    return cleaned ? {messageId: fallback.messageId, text: cleaned} : undefined;
  };

  const handleIdle = async (sessionID: string) => {
    await loadSpoken;
    if (!auto || disposed) return;
    const info = await ctx.session.get({sessionID});
    if (info.parentID != null || !sameLocation(info.location?.directory, ctx.location.directory)) {
      pendingText.delete(sessionID);
      return;
    }
    if (info.outcome && info.outcome !== 'succeeded') {
      pendingText.delete(sessionID);
      return;
    }
    const candidate = await resolveLatestResponse(sessionID);
    pendingText.delete(sessionID);
    if (!candidate || spokenIds.has(candidate.messageId)) return;

    spokenIds.add(candidate.messageId);
    try {
      await play(candidate.messageId, candidate.text, false);
      await saveSpoken();
    } catch (error) {
      spokenIds.delete(candidate.messageId);
      deps.onError?.(error);
      await notify(sessionID, error instanceof Error ? error.message : String(error), {variant: 'warning'});
    }
  };

  await ctx.command.transform(editor => {
    editor.add({
      name: 'tts',
      description: 'Controla la lectura en voz alta con teHablo (play, stop, auto, help).',
      execute: async (input) => {
        const [sub, arg] = parseCommandArgs(input.prompt.text);
        if (sub === 'play') {
          const candidate = await resolveLatestResponse(input.sessionID);
          if (!candidate) {
            await notify(input.sessionID, 'No hay una respuesta final para leer.', {variant: 'warning'});
            return;
          }
          try {
            await play(candidate.messageId, candidate.text, true);
          } catch (error) {
            await notify(input.sessionID, error instanceof Error ? error.message : String(error), {variant: 'warning'});
          }
          return;
        }
        if (sub === 'stop') {
          epoch++;
          cancelPoll();
          try {
            await client.stop();
            await notify(input.sessionID, 'Lectura detenida.', {variant: 'info'});
          } catch (error) {
            await notify(input.sessionID, error instanceof Error ? error.message : String(error), {variant: 'warning'});
          }
          return;
        }
        if (sub === 'auto') {
          const next = arg === 'on' ? true : arg === 'off' ? false : !auto;
          auto = next;
          epoch++;
          if (!auto) {
            await notify(input.sessionID, 'Lectura automática desactivada.', {variant: 'info'});
            return;
          }
          try {
            await boot(epoch);
            await notify(input.sessionID, 'Lectura automática activada.', {variant: 'success'});
          } catch (error) {
            auto = false;
            await notify(input.sessionID, error instanceof Error ? error.message : String(error), {variant: 'warning'});
          }
          return;
        }
        const statusLine = `Estado: lectura automática ${auto ? 'activada' : 'desactivada'}.`;
        if (sub === '' || sub === 'help' || sub === 'ayuda' || sub === 'status') {
          await notify(input.sessionID, `${statusLine}\n${HELP_TEXT}`, {kind: 'help', variant: 'info'});
          return;
        }
        await notify(input.sessionID, `Subcomando desconocido "${sub}".\n${HELP_TEXT}`, {kind: 'help', variant: 'warning'});
      },
    });
  });

  const eventLoop = (async () => {
    try {
      for await (const event of ctx.event.subscribe({
        types: [
          'session.text.ended',
          'session.execution.succeeded',
          'session.execution.failed',
          'session.execution.interrupted',
          'session.idle',
        ],
        signal: controller.signal,
      })) {
        if (disposed || controller.signal.aborted) break;
        if (event.location?.directory && !sameLocation(event.location.directory, ctx.location.directory)) continue;
        const sessionID = event.data?.sessionID;
        if (typeof sessionID !== 'string') continue;

        if (event.type === 'session.text.ended') {
          const messageId = event.data?.assistantMessageID;
          const text = event.data?.text;
          if (typeof messageId === 'string' && typeof text === 'string' && text.trim()) {
            pendingText.set(sessionID, {messageId, text});
          }
        } else if (event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') {
          pendingText.delete(sessionID);
        } else if (event.type === 'session.execution.succeeded' || event.type === 'session.idle') {
          try {
            await handleIdle(sessionID);
          } catch (error) {
            if (!controller.signal.aborted && !disposed) deps.onError?.(error);
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && !disposed) deps.onError?.(error);
    }
  })();

  return async () => {
    disposed = true;
    epoch++;
    cancelPoll();
    controller.abort();
    await eventLoop;
    await Promise.resolve(rpc?.dispose()).catch(() => {});
    await client.shutdown().catch(() => {});
  };
}
