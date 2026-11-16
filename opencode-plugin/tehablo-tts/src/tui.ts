import type { NoticeKind, NoticeVariant } from '../rpc.ts';

export interface TuiContext {
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

function isNoticeData(value: unknown): value is {
  sessionID: string;
  kind: NoticeKind;
  variant: NoticeVariant;
  message: string;
} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionID === 'string'
    && (record.kind === 'toast' || record.kind === 'help')
    && (record.variant === 'info' || record.variant === 'success' || record.variant === 'warning' || record.variant === 'error')
    && typeof record.message === 'string';
}

/** Subscribe OpenCode TUI to teHablo notice events and render toast or help dialogs. */
export function createTehabloTui(ctx: TuiContext): () => void {
  return ctx.data.listen(({ details }) => {
    if (details.type !== NOTICE_EVENT || !isNoticeData(details.data)) return;
    const route = ctx.ui.router.current();
    if (route.type === 'session' && route.sessionID && route.sessionID !== details.data.sessionID) return;

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
}
