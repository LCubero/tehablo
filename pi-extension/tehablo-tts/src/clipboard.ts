import { execFile } from 'node:child_process';

// Reads copied text with the tool each system already has; nothing is installed.
type Run = (command: string, args: string[]) => Promise<string | undefined>;
export const NO_CLIPBOARD = 'Por SSH se lee el portapapeles del servidor, que no tiene escritorio ni portapapeles.';

export function clipboardCommands(platform: string, env: Record<string, string | undefined>): [string, string[]][] {
  if (platform === 'win32')
    return [['powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw']]];
  if (platform === 'darwin') return [['pbpaste', []]];
  return [
    ...(env.WAYLAND_DISPLAY ? [['wl-paste', ['--no-newline', '--type', 'text']] as [string, string[]]] : []),
    ...(env.DISPLAY ? [['xclip', ['-selection', 'clipboard', '-out']], ['xsel', ['--clipboard', '--output']]] as [string, string[]][] : []),
  ];
}

/** Output of the command; undefined only when the tool is missing. Other failures (wl-paste with nothing copied) read as empty. */
const runCommand: Run = (command, args) => new Promise(resolve => {
  execFile(command, args, {encoding: 'utf8', timeout: 5000, windowsHide: true},
    (error, stdout) => resolve((error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? undefined : error ? '' : stdout));
});

export async function readClipboard(platform = process.platform, env: Record<string, string | undefined> = process.env, run: Run = runCommand): Promise<string> {
  const commands = clipboardCommands(platform, env);
  if (!commands.length) throw new Error(NO_CLIPBOARD);
  for (const [command, args] of commands) {
    const text = await run(command, args);
    if (text !== undefined) return text;
  }
  throw new Error('No se pudo leer el portapapeles: instala wl-clipboard o xclip.');
}
