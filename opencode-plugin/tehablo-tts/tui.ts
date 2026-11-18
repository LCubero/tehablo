import { Plugin } from '@opencode/plugin/tui';
import { createComputed, createRoot } from 'solid-js';
import { createTehabloTui } from './src/tui.ts';

export default Plugin.define({
  id: 'tehablo-tts',
  setup: (ctx) => createTehabloTui(ctx, {
    watchRoute: (changed) => createRoot((dispose) => {
      createComputed(() => {
        const route = ctx.ui.router.current();
        changed({type: route.type, sessionID: route.type === 'session' ? route.sessionID : undefined});
      });
      return dispose;
    }),
  }),
});
