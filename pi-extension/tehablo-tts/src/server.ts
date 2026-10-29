import { spawn as nodeSpawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Options = {
  root?: string; platform?: string; port?: string;
  fetch?: typeof fetch; spawn?: typeof nodeSpawn; delay?: (ms: number) => Promise<void>;
};

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
  private async start() {
    try { await this.request('/health'); return; } catch { /* Start only when unavailable. */ }
    if (this.closed) return;
    if (!this.child) {
      const python = join(this.root, '.venv-pocket', (this.options.platform ?? process.platform) === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const child = (this.options.spawn ?? nodeSpawn)(python, [join(this.root, 'src/tehablo_server.py'), '--port', new URL(this.base).port], {
        cwd: this.root, stdio: 'ignore', windowsHide: true, detached: true,
      });
      this.child = child;
      let spawnError: Error | undefined;
      child.once('error', error => { spawnError = error; });
      child.unref();
      for (let attempt = 0; attempt < 30 && !this.closed; attempt++) {
        if (spawnError) throw spawnError;
        try { await this.request('/health'); return; } catch { /* Bounded readiness polling. */ }
        await (this.options.delay ?? (ms => new Promise(r => setTimeout(r, ms))))(250);
      }
    } else {
      await this.request('/health'); return;
    }
    if (!this.closed) throw new Error('El servidor TTS no respondió a tiempo.');
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
