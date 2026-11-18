import type { Rpc } from '@opencode/plugin';

export type NoticeKind = 'toast' | 'help' | 'menu';
export type NoticeVariant = 'info' | 'success' | 'warning' | 'error';

export interface NoticePayload {
  readonly sessionID: string;
  readonly kind: NoticeKind;
  readonly variant: NoticeVariant;
  readonly message: string;
  readonly auto?: boolean;
  readonly [key: string]: unknown;
}

export const tehabloRpc = {
  id: 'tehablo-tts',
  methods: {
    control: {
      input: {
        type: 'object',
        properties: {
          sessionID: { type: 'string' },
          action: { type: 'string', enum: ['play', 'stop', 'auto', 'help'] },
        },
        required: ['sessionID', 'action'],
        additionalProperties: false,
      },
      output: {type: 'null'},
    },
  },
  events: {
    notice: {
      schema: {
        type: 'object',
        properties: {
          sessionID: { type: 'string' },
          kind: { type: 'string', enum: ['toast', 'help', 'menu'] },
          auto: { type: 'boolean' },
          variant: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
          message: { type: 'string' },
        },
        required: ['sessionID', 'kind', 'variant', 'message'],
      },
    },
  },
} as const satisfies Rpc.PortableDefinition;
