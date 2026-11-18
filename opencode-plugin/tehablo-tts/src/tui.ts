import { tehabloRpc, type NoticeKind, type NoticeVariant } from '../rpc.ts';
import type { VoiceRow } from './settings.ts';

export interface TuiContext {
  readonly location?: {readonly directory: string};
  readonly client?: {
    readonly rpc: (definition: typeof tehabloRpc) => {
      readonly control: (input: { sessionID: string; action: string }, options?: {location: {directory: string}}) => Promise<unknown>;
      readonly voices?: (input: {sessionID: string}) => Promise<unknown>;
      readonly selectVoice?: (input: {sessionID: string; model: string; voice: string}) => Promise<unknown>;
      readonly downloadVoices?: (input: {sessionID: string}) => Promise<unknown>;
      readonly downloadVoice?: (input: {sessionID: string; model: string; voice: string; confirmed: true}) => Promise<unknown>;
      readonly downloadStatus?: (input: {sessionID: string; id: string}) => Promise<unknown>;
    };
  };
  readonly data: {
    readonly listen: (handler: (event: {
      readonly details: {
        readonly type: string;
        readonly data?: unknown;
      };
    }) => void) => () => void;
  };
  readonly ui: {
    readonly router: {
      readonly current: () => { readonly type: string; readonly sessionID?: string };
    };
    readonly toast: {
      readonly show: (options: {
        readonly title?: string;
        readonly message: string;
        readonly variant?: NoticeVariant;
        readonly duration?: number;
      }) => void;
    };
    readonly dialog: {
      readonly confirm?: (options: {
        readonly title: string;
        readonly message: string;
      }) => Promise<boolean>;
      readonly select?: (options: {
        readonly title: string;
        readonly options: Array<{ title: string; value: string; description?: string }>;
      }) => Promise<string | undefined>;
      readonly alert: (options: {
        readonly title: string;
        readonly message: string;
      }) => Promise<void>;
    };
  };
}

const NOTICE_EVENT = 'rpc.tehablo-tts.notice';
const TOAST_DURATION_MS: Record<NoticeVariant, number> = {
  info: 3000,
  success: 3500,
  warning: 5000,
  error: 6000,
};

function menuErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return String(error);
  const outer = error as Record<string, unknown>;
  let code: string | undefined;
  // Inspect only diagnostic fields, never serialize requests, headers or arbitrary payloads.
  for (const value of [outer, outer.error, outer.data]) {
    if (!value || typeof value !== 'object') continue;
    const detail = value as Record<string, unknown>;
    const tag = [detail.type, detail._tag].find(
      (value): value is string => typeof value === 'string' && /^[\w.:-]{1,80}$/.test(value),
    );
    code = tag ?? code;
    if (typeof detail.message === 'string' && detail.message.trim()) {
      return code ? `${code}: ${detail.message}` : detail.message;
    }
  }
  return code ?? 'No se pudo ejecutar la acción del menú: error sin mensaje legible.';
}

function isNoticeData(value: unknown): value is {
  sessionID: string;
  kind: NoticeKind;
  variant: NoticeVariant;
  message: string;
  auto?: boolean;
} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionID === 'string'
    && (record.kind === 'toast' || record.kind === 'help' || (record.kind === 'menu' && typeof record.auto === 'boolean'))
    && (record.variant === 'info' || record.variant === 'success' || record.variant === 'warning' || record.variant === 'error')
    && typeof record.message === 'string';
}

/** Subscribe OpenCode TUI to teHablo notice events and render toast or help dialogs. */
export function createTehabloTui(ctx: TuiContext, deps: {
  watchRoute?: (changed: (route: {type: string; sessionID?: string}) => void) => () => void;
  downloadPollIntervalMs?: number;
  downloadPollLimit?: number;
} = {}): () => void {
  let disposed = false;
  let menuOpen = false;
  let invalidateOnNavigation: (() => void) | undefined;
  let stopWatching: (() => void) | undefined;
  let stopWaiting: (() => void) | undefined;
  const openMenu = async (sessionID: string, auto: boolean) => {
    if (menuOpen) return;
    if (!ctx.ui.dialog.select || !ctx.client) {
      await ctx.ui.dialog.alert({title: 'teHablo TTS', message: 'El menú no está disponible en este cliente. Usa /tts help para ver los comandos.'});
      return;
    }
    menuOpen = true;
    let invalidated = false;
    let downloading = false;
    const checkRoute = (route: {type: string; sessionID?: string}) => {
      if (route.type !== 'session' || route.sessionID !== sessionID) {
        invalidated = true;
        stopWaiting?.();
      }
    };
    const cancelled = () => {
      checkRoute(ctx.ui.router.current());
      return disposed || invalidated;
    };
    invalidateOnNavigation = () => checkRoute(ctx.ui.router.current());
    try {
      const controlDirectory = ctx.location?.directory;
      stopWatching = deps.watchRoute?.(checkRoute);
      const action = await ctx.ui.dialog.select({
        title: `teHablo · lectura automática ${auto ? 'activada' : 'desactivada'}`,
        options: [
          {title: 'Leer última respuesta', value: 'play'},
          {title: 'Detener lectura', value: 'stop'},
          {title: auto ? 'Desactivar lectura automática' : 'Activar lectura automática', value: 'auto'},
          {title: 'Ayuda y estado', value: 'help'},
          {title: 'Elegir voz local', value: 'voices'},
          {title: 'Descargar voz', value: 'downloads'},
        ],
      });
      const route = ctx.ui.router.current();
      if (disposed || invalidated || !action || !['play', 'stop', 'auto', 'help', 'voices', 'downloads'].includes(action)
        || route.type !== 'session' || route.sessionID !== sessionID) return;
      if (action === 'downloads') {
        downloading = true;
        const api = ctx.client.rpc(tehabloRpc);
        if (!api.downloadVoices || !api.downloadVoice || !api.downloadStatus || !ctx.ui.dialog.confirm) {
          throw new Error('La descarga confirmada no está disponible en este cliente o servidor.');
        }
        const catalog = await api.downloadVoices({sessionID});
        if (cancelled()) return;
        if (!Array.isArray(catalog)) throw new Error('Catálogo de voces no válido.');
        const rows: VoiceRow[] = catalog.filter(row => row?.downloaded === false
          && typeof row.name === 'string' && typeof row.voice === 'string' && typeof row.model === 'string');
        if (!rows.length) throw new Error('No hay voces pendientes de descargar.');
        const selected = await ctx.ui.dialog.select({title: 'Descargar voz', options: rows.map((row, index) => ({
          title: row.name, value: String(index),
          description: `${row.model} · ${row.model === 'phonon' && row.needsToken !== false ? 'requiere modelo ya descargado' : row.note}`,
        }))});
        if (cancelled() || selected === undefined) return;
        const row = rows.find((_, index) => String(index) === selected);
        if (!row) return;
        if (row.model === 'phonon' && row.needsToken !== false) {
          throw new Error('El modelo Phonon debe estar descargado. Este menú no solicita tokens ni reinicia el servidor.');
        }
        const confirmed = await ctx.ui.dialog.confirm({
          title: `Descargar ${row.name} (${row.model})`,
          message: 'Usará red y espacio en disco; puede retrasar lecturas mientras trabaja. No cambiará la voz seleccionada. Cerrar o salir deja de observar, pero no cancela la descarga del servidor.',
        });
        if (cancelled() || confirmed !== true) return;
        const job = await api.downloadVoice({sessionID, model: row.model, voice: row.voice, confirmed: true}) as {id?: string};
        if (cancelled()) return;
        if (typeof job?.id !== 'string' || !job.id) throw new Error('El servidor no devolvió una descarga válida.');
        ctx.ui.toast.show({title: 'teHablo TTS', message: 'Descarga iniciada; la voz seleccionada no cambia.', variant: 'info'});
        const deadline = Date.now() + 15 * 60_000;
        for (let attempt = 0; attempt < (deps.downloadPollLimit ?? 900) && Date.now() < deadline; attempt++) {
          const status = await api.downloadStatus({sessionID, id: job.id}) as {id?: string; state?: string; error?: string};
          if (cancelled()) return;
          if (status?.id !== job.id) throw new Error('Otra descarga reemplazó el trabajo observado.');
          if (status.state === 'error') throw new Error(status.error || 'La descarga falló; puede haber archivos parciales en caché.');
          if (status.state === 'ready') {
            await api.downloadVoices({sessionID});
            if (cancelled()) return;
            ctx.ui.toast.show({title: 'teHablo TTS', message: 'Descarga completada; catálogo actualizado. La voz seleccionada no cambió.', variant: 'success'});
            return;
          }
          if (status.state !== 'downloading') throw new Error('Estado de descarga no válido.');
          if (attempt + 1 < (deps.downloadPollLimit ?? 900)) {
            await new Promise<void>(resolve => {
              const timer = setTimeout(() => {stopWaiting = undefined; resolve();}, deps.downloadPollIntervalMs ?? 1000);
              stopWaiting = () => {clearTimeout(timer); stopWaiting = undefined; resolve();};
            });
            if (cancelled()) return;
          }
        }
        throw new Error('Se dejó de observar tras 15 minutos; la descarga puede continuar en el servidor. Abre el menú para actualizar el catálogo.');
      }
      if (action === 'voices') {
        const api = ctx.client.rpc(tehabloRpc);
        if (!api.voices || !api.selectVoice) throw new Error('El selector de voces no está disponible en este servidor.');
        const rows = await api.voices({sessionID});
        checkRoute(ctx.ui.router.current());
        if (disposed || invalidated) return;
        if (!Array.isArray(rows)) throw new Error('Catálogo de voces no válido.');
        const local: VoiceRow[] = rows.filter(row => row?.downloaded === true && typeof row.name === 'string'
          && typeof row.model === 'string' && typeof row.voice === 'string');
        if (!local.length) throw new Error('No hay voces y modelos descargados disponibles.');
        const selected = await ctx.ui.dialog.select({title: 'Elegir voz local', options: local.map((row, index) => ({
          title: row.name, value: String(index), description: `${row.model} · ${row.note}`,
        }))});
        checkRoute(ctx.ui.router.current());
        if (disposed || invalidated || selected === undefined) return;
        const row = local.find((_, index) => String(index) === selected);
        if (row) await api.selectVoice({sessionID, model: row.model, voice: row.voice});
        return;
      }
      const api = ctx.client.rpc(tehabloRpc);
      const input = {sessionID, action};
      if (controlDirectory?.trim()) await api.control(input, {location: {directory: controlDirectory}});
      else await api.control(input);
    } catch (error) {
      if (!disposed && !(downloading && invalidated)) ctx.ui.toast.show({title: 'teHablo TTS', message: menuErrorMessage(error), variant: 'warning'});
    } finally {
      stopWatching?.();
      stopWatching = undefined;
      invalidateOnNavigation = undefined;
      menuOpen = false;
    }
  };
  const unsubscribe = ctx.data.listen(({ details }) => {
    invalidateOnNavigation?.();
    if (details.type !== NOTICE_EVENT || !isNoticeData(details.data)) return;
    const route = ctx.ui.router.current();
    if (route.type === 'session' && route.sessionID && route.sessionID !== details.data.sessionID) return;

    if (details.data.kind === 'menu') {
      if (route.type === 'session' && route.sessionID === details.data.sessionID) void openMenu(details.data.sessionID, details.data.auto!);
      return;
    }

    if (details.data.kind === 'help') {
      void ctx.ui.dialog.alert({ title: 'teHablo TTS', message: details.data.message }).catch(() => {});
      return;
    }

    ctx.ui.toast.show({
      title: 'teHablo TTS',
      message: details.data.message,
      variant: details.data.variant,
      duration: TOAST_DURATION_MS[details.data.variant],
    });
  });
  return () => { disposed = true; stopWaiting?.(); stopWatching?.(); stopWatching = undefined; unsubscribe(); };
}
