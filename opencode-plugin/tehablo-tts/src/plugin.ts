import { tehabloRpc, type NoticeKind, type NoticePayload, type NoticeVariant } from '../rpc.ts';
import { ServerClient, type ServerOptions } from './server.ts';
import { DEFAULTS, MODELS, loadSettings, readSettingsRecord, saveVoiceSettings, settingsDir, type Settings, type VoiceRow } from './settings.ts';
import { cleanText, finalAssistantText } from './text.ts';

const SPOKEN_KEY = 'spokenIds';
const MAX_SPOKEN_IDS = 100;

interface RpcHandlerContext {
  readonly error: (type: string, message: string, data: Record<string, never>) => unknown;
}

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
      handlers: Record<string, (input: any, context?: RpcHandlerContext) => Promise<unknown>>,
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
  settingsDirectory?: string;
}

const HELP_TEXT = [
  'Uso de /tts:',
  '/tts menu   abre el menú de controles',
  'En el menú: Elegir voz local (requiere servidor disponible; sin descargas).',
  'En el menú: Descargar voz (confirmación; no cambia la voz seleccionada).',
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

function downloadJob(value: any): {id: string; state: string; error?: string} {
  if (!value || typeof value.id !== 'string' || !value.id
    || !['downloading', 'ready', 'error'].includes(value.state)) {
    throw new Error('El servidor no devolvió un estado de descarga válido.');
  }
  return {id: value.id, state: value.state, ...(typeof value.error === 'string' ? {error: value.error} : {})};
}

/** Create the Phase 1 OpenCode teHablo TTS plugin and return its unload cleanup handler. */
export async function createTehabloPlugin(ctx: PluginContext, deps: PluginDeps = {}): Promise<() => Promise<void>> {
  const explicitRoot = typeof ctx.options?.tehabloRoot === 'string' ? ctx.options.tehabloRoot : undefined;
  const client = deps.client ?? new ServerClient({root: explicitRoot, ...deps.clientOptions});
  const directory = deps.settingsDirectory ?? settingsDir();
  const readSettings = deps.loadSettings ?? (() => loadSettings(directory, client.root || undefined, DEFAULTS));

  const pollIntervalMs = deps.pollIntervalMs ?? 500;
  let settings = readSettings();
  let auto = false;
  let applied = false;
  let epoch = 0;
  let readingSeq = 0;
  let disposed = false;
  let selectingVoice = false;
  let submittingDownload = false;
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

  let rpc: Awaited<ReturnType<NonNullable<PluginContext['rpc']>['register']>> | undefined;

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
      ...(opts.kind === 'menu' ? { auto } : {}),
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

  const play = async (sessionID: string, messageId: string, text: string, allowRepeat: boolean, generation = epoch) => {
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
    }, sessionID);
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
    const generation = epoch;
    await loadSpoken;
    if (!auto || disposed || generation !== epoch) return;
    const info = await ctx.session.get({sessionID});
    if (!auto || disposed || generation !== epoch) return;
    if (info.parentID != null || !sameLocation(info.location?.directory, ctx.location.directory)) {
      pendingText.delete(sessionID);
      return;
    }
    if (info.outcome && info.outcome !== 'succeeded') {
      pendingText.delete(sessionID);
      return;
    }
    const candidate = await resolveLatestResponse(sessionID);
    if (!auto || disposed || generation !== epoch) return;
    pendingText.delete(sessionID);
    if (!candidate || spokenIds.has(candidate.messageId)) return;

    spokenIds.add(candidate.messageId);
    try {
      await play(sessionID, candidate.messageId, candidate.text, false, generation);
      await saveSpoken();
    } catch (error) {
      spokenIds.delete(candidate.messageId);
      deps.onError?.(error);
      await notify(sessionID, error instanceof Error ? error.message : String(error), {variant: 'warning'});
    }
  };

  const executeCommand = async (input: { sessionID: string; prompt: { text: string } }) => {
        if (disposed) return;
        const [sub, arg] = parseCommandArgs(input.prompt.text);
        if (sub === 'menu') {
          if (arg) {
            await notify(input.sessionID, 'El comando /tts menu no admite argumentos.\n' + HELP_TEXT, {kind: 'help', variant: 'warning'});
            return;
          }
          await notify(input.sessionID, `Lectura automática ${auto ? 'activada' : 'desactivada'}.`, {kind: 'menu'});
          return;
        }
        if (sub === 'play') {
          const candidate = await resolveLatestResponse(input.sessionID);
          if (!candidate) {
            await notify(input.sessionID, 'No hay una respuesta final para leer.', {variant: 'warning'});
            return;
          }
          try {
            await play(input.sessionID, candidate.messageId, candidate.text, true);
          } catch (error) {
            await notify(input.sessionID, error instanceof Error ? error.message : String(error), {variant: 'warning'});
          }
          return;
        }
        if (sub === 'stop') {
          epoch++;
          cancelPoll();
          try {
            await client.stop(input.sessionID);
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
  };

  const localVoices = async (context?: RpcHandlerContext): Promise<VoiceRow[]> => {
    if (disposed) throw new Error('Selección cancelada.');
    let result: any;
    try { result = await client.request('/voices'); }
    catch {
      const message = 'Se requiere un servidor teHablo disponible para elegir voces locales. No se ha iniciado el servidor; inícialo con /tts play o /tts auto.';
      throw context ? context.error('server_unavailable', message, {}) : new Error(message);
    }
    if (disposed) throw new Error('Selección cancelada.');
    if (!Array.isArray(result?.catalog)) throw new Error('El servidor no devolvió un catálogo de voces válido.');
    return result.catalog.filter((row: any) => row?.downloaded === true && MODELS.includes(row.model)
      && ['name', 'voice', 'model', 'kind', 'note'].every(key => typeof row[key] === 'string'));
  };

  const downloadCatalog = async (): Promise<VoiceRow[]> => {
    if (disposed) throw new Error('Descarga cancelada.');
    let result: any;
    try { result = await client.request('/voices'); }
    catch { throw new Error('Se requiere un servidor teHablo disponible para descargar voces. No se ha iniciado el servidor; inícialo con /tts play o /tts auto.'); }
    if (disposed) throw new Error('Descarga cancelada.');
    if (!Array.isArray(result?.catalog)) throw new Error('El servidor no devolvió un catálogo de voces válido.');
    return result.catalog.filter((row: any) => typeof row?.downloaded === 'boolean' && MODELS.includes(row.model)
      && ['name', 'voice', 'model', 'kind', 'note'].every(key => typeof row[key] === 'string'));
  };

  rpc = await ctx.rpc?.register(tehabloRpc, {
    downloadVoices: async (input: any) => {
      if (!input || typeof input.sessionID !== 'string') throw new Error('Sesión no válida.');
      return downloadCatalog();
    },
    downloadVoice: async (input: any) => {
      if (!input || typeof input.sessionID !== 'string' || !MODELS.includes(input.model)
        || typeof input.voice !== 'string' || !input.voice || input.confirmed !== true) {
        throw new Error('Se requiere confirmar una voz válida antes de descargar.');
      }
      if (submittingDownload) throw new Error('Ya hay una solicitud de descarga en curso.');
      submittingDownload = true;
      try {
        const rows = await downloadCatalog();
        const row = rows.find(row => row.model === input.model && row.voice === input.voice);
        if (!row) throw new Error('La voz ya no está en el catálogo.');
        if (row.downloaded) throw new Error('La voz ya está disponible localmente.');
        if (row.model === 'phonon' && row.needsToken !== false) {
          throw new Error('El modelo Phonon debe estar descargado. Este menú no solicita tokens ni reinicia el servidor.');
        }
        if (disposed) throw new Error('Descarga cancelada.');
        // An older server rejects select:false; never retry with legacy selection semantics.
        return downloadJob(await client.request('/prepare', {model: row.model, voice: row.name, select: false}));
      } finally { submittingDownload = false; }
    },
    downloadStatus: async (input: any) => {
      if (!input || typeof input.sessionID !== 'string' || typeof input.id !== 'string' || !input.id) {
        throw new Error('Identificador de descarga no válido.');
      }
      if (disposed) throw new Error('Descarga cancelada.');
      const health = await client.request('/health');
      if (disposed) throw new Error('Descarga cancelada.');
      const job = downloadJob(health?.preparation);
      if (job.id !== input.id) throw new Error('Otra descarga reemplazó el trabajo observado; no se afirma que haya terminado.');
      return job;
    },
    voices: async (input: any, context) => {
      if (!input || typeof input.sessionID !== 'string') throw new Error('Sesión no válida.');
      return localVoices(context);
    },
    selectVoice: async (input: any) => {
      if (!input || typeof input.sessionID !== 'string' || !MODELS.includes(input.model)
        || typeof input.voice !== 'string' || !input.voice) throw new Error('Selección de voz no válida.');
      if (selectingVoice) throw new Error('Ya hay un cambio de voz en curso.');
      if (disposed) throw new Error('Selección cancelada.');
      selectingVoice = true;
      try {
        const rows = await localVoices();
        const row = rows.find(row => row.model === input.model && row.voice === input.voice);
        if (!row) throw new Error('La voz y su modelo ya no están disponibles localmente.');
        readSettingsRecord(directory, client.root || undefined);
        if (disposed) throw new Error('Selección cancelada.');
        epoch++;
        const pair = {model: row.model, voice: row.voice};
        await client.request('/config', pair);
        if (disposed) throw new Error('Selección cancelada.');
        try { saveVoiceSettings(directory, pair, client.root || undefined); }
        catch (error) { throw new Error(`La voz se aplicó al servidor, pero no se pudo guardar: ${error instanceof Error ? error.message : String(error)}`); }
        settings = {...settings, ...pair};
        client.startArgs = ['--model', pair.model, '--voice', pair.voice, '--audio', settings.audio];
        await notify(input.sessionID, `Voz seleccionada: ${row.name} (${row.model}).`, {variant: 'success'});
        return null;
      } finally { selectingVoice = false; }
    },
    control: async (input: unknown) => {
      const value = input as { sessionID?: unknown; action?: unknown } | null;
      if (!value || typeof value.sessionID !== 'string' || typeof value.action !== 'string'
        || !['play', 'stop', 'auto', 'help'].includes(value.action)) throw new Error('Acción de menú no válida.');
      await executeCommand({sessionID: value.sessionID, prompt: {text: value.action}});
      return null;
    },
  }).catch(() => undefined);

  await ctx.command.transform(editor => {
    editor.add({
      name: 'tts',
      description: 'Controla la lectura en voz alta con teHablo (menu, play, stop, auto, help).',
      execute: executeCommand,
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
    await client.shutdown().catch(() => {});
    await eventLoop;
    await Promise.resolve(rpc?.dispose()).catch(() => {});
  };
}
