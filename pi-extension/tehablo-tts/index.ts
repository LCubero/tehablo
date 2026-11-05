import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createExtension } from './src/extension.ts';

export default function (pi: ExtensionAPI) {
  // Watch the shared server every 2 s so this bar follows other Pi sessions.
  createExtension(pi, undefined, undefined, undefined, 2000);
}
