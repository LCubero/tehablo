import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createExtension } from './src/extension.ts';

export default function (pi: ExtensionAPI) {
  createExtension(pi);
}
