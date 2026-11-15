import { Plugin } from '@opencode/plugin';
import { createTehabloPlugin } from './src/plugin.ts';

export default Plugin.define({
  id: 'tehablo-tts',
  setup: (ctx) => createTehabloPlugin(ctx, {
    onError: (error) => console.error('[tehablo-tts]', error),
  }),
});
