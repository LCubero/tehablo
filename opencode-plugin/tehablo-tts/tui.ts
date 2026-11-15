import { Plugin } from '@opencode/plugin/tui';
import { createTehabloTui } from './src/tui.ts';

export default Plugin.define({
  id: 'tehablo-tts',
  setup: (ctx) => createTehabloTui(ctx),
});
