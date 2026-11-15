import type { Rpc } from '@opencode/plugin';

export type NoticeKind = 'toast' | 'help';
export type NoticeVariant = 'info' | 'success' | 'warning' | 'error';

export interface NoticePayload {
  readonly sessionID: string;
  readonly kind: NoticeKind;
  readonly variant: NoticeVariant;
  readonly message: string;
  readonly [key: string]: unknown;
}

export const tehabloRpc = {
  id: 'tehablo-tts',
  methods: {},
  events: {
    notice: {
      schema: {
        type: 'object',
        properties: {
          sessionID: { type: 'string' },
          kind: { type: 'string', enum: ['toast', 'help'] },
          variant: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
          message: { type: 'string' },
        },
        required: ['sessionID', 'kind', 'variant', 'message'],
      },
    },
  },
} as const satisfies Rpc.PortableDefinition;
