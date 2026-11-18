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
    downloadVoices: {
      input: {
        type: 'object', properties: {sessionID: {type: 'string'}},
        required: ['sessionID'], additionalProperties: false,
      },
      output: {
        type: 'array', items: {
          type: 'object', properties: {
            name: {type: 'string'}, voice: {type: 'string'}, model: {type: 'string'},
            kind: {type: 'string'}, note: {type: 'string'}, downloaded: {type: 'boolean'},
            needsToken: {type: 'boolean'},
          }, required: ['name', 'voice', 'model', 'kind', 'note', 'downloaded'],
        },
      },
    },
    downloadVoice: {
      input: {
        type: 'object', properties: {
          sessionID: {type: 'string'}, model: {type: 'string'}, voice: {type: 'string'},
          confirmed: {type: 'boolean', const: true},
        }, required: ['sessionID', 'model', 'voice', 'confirmed'], additionalProperties: false,
      },
      output: {
        type: 'object', properties: {
          id: {type: 'string'}, state: {type: 'string', enum: ['downloading', 'ready', 'error']},
          error: {type: 'string'},
        }, required: ['id', 'state'],
      },
    },
    downloadStatus: {
      input: {
        type: 'object', properties: {sessionID: {type: 'string'}, id: {type: 'string'}},
        required: ['sessionID', 'id'], additionalProperties: false,
      },
      output: {
        type: 'object', properties: {
          id: {type: 'string'}, state: {type: 'string', enum: ['downloading', 'ready', 'error']},
          error: {type: 'string'},
        }, required: ['id', 'state'],
      },
    },
    voices: {
      input: {
        type: 'object', properties: {sessionID: {type: 'string'}},
        required: ['sessionID'], additionalProperties: false,
      },
      output: {
        type: 'array', items: {
          type: 'object', properties: {
            name: {type: 'string'}, voice: {type: 'string'}, model: {type: 'string'},
            kind: {type: 'string'}, note: {type: 'string'}, downloaded: {type: 'boolean', const: true},
          }, required: ['name', 'voice', 'model', 'kind', 'note', 'downloaded'],
        },
      },
      errors: {
        server_unavailable: {type: 'object', additionalProperties: false},
      },
    },
    selectVoice: {
      input: {
        type: 'object', properties: {sessionID: {type: 'string'}, model: {type: 'string'}, voice: {type: 'string'}},
        required: ['sessionID', 'model', 'voice'], additionalProperties: false,
      },
      output: {type: 'null'},
    },
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
