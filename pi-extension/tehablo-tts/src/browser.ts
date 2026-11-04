import { spawn } from 'node:child_process';

// Opens a link with the tool each system already has; no shell, so the address is never parsed as a command.
export const browserCommand = (platform: string) => platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';

/** Best effort: if no browser opens, the address is still on screen to type. */
export function openUrl(url: string, platform = process.platform) {
  try {
    const child = spawn(browserCommand(platform), [url], {detached: true, stdio: 'ignore', windowsHide: true});
    child.on('error', () => {});
    child.unref();
  } catch {}
}
