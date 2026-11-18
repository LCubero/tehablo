import { tehabloRpc, type NoticeKind, type NoticeVariant } from '../rpc.ts';

export interface TuiContext {
  readonly location?: {readonly directory: string};
  readonly client?: {
    readonly rpc: (definition: typeof tehabloRpc) => {
      readonly control: (input: { sessionID: string; action: string }, options?: {location: {directory: string}}) => Promise<unknown>;
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
} = {}): () => void {
  let disposed = false;
  let menuOpen = false;
  let invalidateOnNavigation: (() => void) | undefined;
  let stopWatching: (() => void) | undefined;
  const openMenu = async (sessionID: string, auto: boolean) => {
    if (menuOpen) return;
    if (!ctx.ui.dialog.select || !ctx.client) {
      await ctx.ui.dialog.alert({title: 'teHablo TTS', message: 'El menú no está disponible en este cliente. Usa /tts help para ver los comandos.'});
      return;
    }
    menuOpen = true;
    let invalidated = false;
    const checkRoute = (route: {type: string; sessionID?: string}) => {
      if (route.type !== 'session' || route.sessionID !== sessionID) invalidated = true;
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
        ],
      });
      const route = ctx.ui.router.current();
      if (disposed || invalidated || !action || !['play', 'stop', 'auto', 'help'].includes(action)
        || route.type !== 'session' || route.sessionID !== sessionID) return;
      const api = ctx.client.rpc(tehabloRpc);
      const input = {sessionID, action};
      if (controlDirectory?.trim()) await api.control(input, {location: {directory: controlDirectory}});
      else await api.control(input);
    } catch (error) {
      if (!disposed) ctx.ui.toast.show({title: 'teHablo TTS', message: menuErrorMessage(error), variant: 'warning'});
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
  return () => { disposed = true; stopWatching?.(); stopWatching = undefined; unsubscribe(); };
}
