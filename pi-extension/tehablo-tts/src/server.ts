import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OS_NAMES: Record<string, string> = { win32: 'windows', linux: 'linux', darwin: 'macos' };

type Options = {
  root?: string; platform?: string; port?: string; exists?: (path: string) => boolean;
  fetch?: typeof fetch; spawn?: typeof nodeSpawn; delay?: (ms: number) => Promise<void>;
  openLog?: (path: string) => number; closeLog?: (fd: number) => void;
};

/** Truncates the log on every server start, so it holds only the latest run. */
const openLogFile = (path: string) => { mkdirSync(join(path, '..'), {recursive: true}); return openSync(path, 'w'); };

export class ServerClient {
  root: string;
  base: string;
  private options: Options;
  private child?: ReturnType<typeof nodeSpawn>;
  private starting?: Promise<void>;
  private closed = false;
  private used = false;
  constructor(options: Options = {}) {
    this.options = options;
    this.root = options.root ?? process.env.TEHABLO_ROOT ?? resolve(fileURLToPath(new URL('../', import.meta.url)), '../..');
    this.base = `http://127.0.0.1:${options.port ?? process.env.TEHABLO_PORT ?? '8765'}`;
  }
  beginSession() { this.closed = false; this.used = false; }
  async request(path: string, body?: unknown): Promise<any> {
    const response = await (this.options.fetch ?? globalThis.fetch)(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `Servidor: HTTP ${response.status}`);
    return data;
  }
  async ensure(): Promise<void> {
    if (this.closed) throw new Error('Sesión TTS cerrada.');
    this.used = true;
    if (!this.starting) this.starting = this.start().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  /** Python candidates: .venv-pocket, then .venv-pocket-<os> so a dual boot can keep one environment per OS. */
  get logPath() { return join(this.root, 'logs', 'tehablo-server.log'); }
  pythonCandidates(): string[] {
    const platform = this.options.platform ?? process.platform;
    const binary = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const envs = ['.venv-pocket', ...(OS_NAMES[platform] ? [`.venv-pocket-${OS_NAMES[platform]}`] : [])];
    return envs.map(env => join(this.root, env, binary));
  }
  private async start() {
    try { await this.request('/health'); return; } catch { /* Start only when unavailable. */ }
    if (this.closed) return;
    if (!this.child) {
      const candidates = this.pythonCandidates();
      const python = candidates.find(this.options.exists ?? existsSync) ?? candidates[0];
      let log: number | undefined;
      try { log = (this.options.openLog ?? openLogFile)(this.logPath); } catch { /* Logging is best effort. */ }
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = (this.options.spawn ?? nodeSpawn)(python, [join(this.root, 'src/tehablo_server.py'), '--port', new URL(this.base).port], {
          cwd: this.root, stdio: log === undefined ? 'ignore' : ['ignore', log, log], windowsHide: true, detached: true,
        });
      } finally {
        if (log !== undefined) (this.options.closeLog ?? closeSync)(log);
      }
      this.child = child;
      let spawnError: Error | undefined;
      let exited = false;
      child.once('error', error => { spawnError = error; });
      // Forget a dead server so the next attempt starts a new one.
      child.once('exit', () => { exited = true; if (this.child === child) this.child = undefined; });
      child.unref();
      // No fixed timeout: startup time depends on the machine and disk, so wait while the process lives.
      while (!this.closed) {
        if (spawnError) {
          this.child = undefined;
          if ((spawnError as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`No se encontró el Python del entorno. Probé: ${candidates.join(', ')}. Crea uno de esos entornos (ver README).`);
          }
          throw spawnError;
        }
        if (exited) throw new Error(`El servidor TTS se cerró al arrancar. Revisa ${this.logPath}.`);
        try { await this.request('/health'); return; } catch { /* Not listening yet. */ }
        await (this.options.delay ?? (ms => new Promise(r => setTimeout(r, ms))))(250);
      }
    } else {
      await this.request('/health');
    }
  }
  async action(path: string, body?: unknown) {
    await this.ensure();
    if (this.closed) return;
    return this.request(path, body);
  }
  async stop() { if (this.used && !this.closed) await this.request('/stop', {}); }
  async shutdown() {
    if (this.closed) return;
    this.closed = true;
    await this.starting?.catch(() => {});
    let failure: unknown;
    if (this.used) { try { await this.request('/stop', {}); } catch (error) { failure = error; } }
    if (this.child) {
      try { await this.request('/shutdown', {}); }
      catch (error) { this.child.kill(); failure = error; }
      this.child = undefined;
    }
    if (failure) throw failure;
  }
}
