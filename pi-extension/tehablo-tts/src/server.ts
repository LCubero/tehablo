import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OS_NAMES: Record<string, string> = { win32: 'windows', linux: 'linux', darwin: 'macos' };
const runFile = promisify(nodeExecFile);

type Options = {
  root?: string; platform?: string; port?: string; exists?: (path: string) => boolean;
  fetch?: typeof fetch; spawn?: typeof nodeSpawn; execFile?: typeof runFile; delay?: (ms: number) => Promise<void>;
  openLog?: (path: string) => number; closeLog?: (fd: number) => void;
  codePath?: string;
};

/** Truncates the log on every server start, so it holds only the latest run. */
const openLogFile = (path: string) => { mkdirSync(join(path, '..'), {recursive: true}); return openSync(path, 'w'); };

export function pairingCode(path = join(homedir(), '.tehablo', 'ssh-codigo')): string {
  mkdirSync(join(path, '..'), {recursive: true});
  if (!existsSync(path)) {
    const temporary = path + '.' + randomBytes(16).toString('hex');
    writeFileSync(temporary, randomBytes(16).toString('hex') + '\n', {flag: 'wx', mode: 0o600});
    try {
      try { linkSync(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { unlinkSync(temporary); }
  }
  const code = readFileSync(path, 'ascii').trim();
  if (!/^[0-9a-f]{32}$/.test(code)) throw new Error('Invalid SSH pairing code file');
  return code;
}

export class ServerClient {
  root: string;
  base: string;
  private options: Options;
  private child?: ReturnType<typeof nodeSpawn>;
  private starting?: Promise<void>;
  private closed = false;
  private ending = false;
  private poweringOff?: Promise<void>;
  private used = false;
  private readings = new Set<string>();
  private inFlight = new Set<string>();
  /** Extra arguments for the next spawned server, such as the saved model and voice. */
  startArgs: string[] = [];
  /** Hugging Face token for the next spawned server, kept only in memory and passed in its environment. */
  token?: string;
  /** True when this client spawned the running server, so it already started with startArgs. */
  spawned = false;
  constructor(options: Options = {}) {
    this.options = options;
    this.root = options.root ?? process.env.TEHABLO_ROOT ?? resolve(fileURLToPath(new URL('../', import.meta.url)), '../..');
    this.base = `http://127.0.0.1:${options.port ?? process.env.TEHABLO_PORT ?? '8765'}`;
  }
  beginSession() { this.closed = false; this.used = false; this.ending = false; }
  async request(path: string, body?: unknown): Promise<any> {
    const id = (body as {id?: string} | undefined)?.id;
    const speaking = path === '/speak' && typeof id === 'string';
    if (speaking) { this.readings.add(id); this.inFlight.add(id); }
    // A status snapshot cannot retire requests that were pending or started after it.
    const observed = path === '/status' ? [...this.readings].filter(id => !this.inFlight.has(id)) : [];
    try {
      const codePath = this.options.codePath;
      const response = await (this.options.fetch ?? globalThis.fetch)(this.base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {'Content-Type': 'application/json', get 'X-Tehablo-Codigo'() { return pairingCode(codePath); } },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (speaking) this.readings.delete(id);
        throw new Error(data.error ?? `Servidor: HTTP ${response.status}`);
      }
      if (path === '/stop') {
        if (id === undefined) this.readings.clear(); else this.readings.delete(id);
      }
      if (path === '/status') {
        const active = new Set([data.id, ...(data.queue ?? []), ...(data.promoted ?? [])]);
        for (const reading of observed)
          if (!active.has(reading) && !this.inFlight.has(reading)) this.readings.delete(reading);
      }
      return data;
    } finally {
      if (speaking) this.inFlight.delete(id);
    }
  }
  async ensure(): Promise<void> {
    await this.poweringOff;
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
  /** A fresh PortAudio table without starting TTS or disturbing its active output stream. */
  async outputDevices(): Promise<{devices: string[]; allDevices: string[]}> {
    const python = this.pythonCandidates().find(this.options.exists ?? existsSync);
    if (!python) throw new Error('No se encontró el entorno Python de teHablo.');
    const code = 'import sys,json; sys.path.insert(0,sys.argv[1]); from tehablo_server import output_devices; '
      + 'print(json.dumps({"devices":[d["name"] for d in output_devices()],"allDevices":[d["name"] for d in output_devices(True)]}))';
    try {
      const {stdout} = await (this.options.execFile ?? runFile)(python, ['-c', code, join(this.root, 'src')],
        {cwd: this.root, encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 65536});
      const result = JSON.parse(stdout);
      const names = (value: unknown) => Array.isArray(value) && value.every(name => typeof name === 'string');
      if (!names(result?.devices) || !names(result?.allDevices)) throw new Error('Invalid device response');
      return result;
    } catch {
      throw new Error('No se pudieron consultar los dispositivos de audio. Revisa el entorno Python de teHablo.');
    }
  }
  private async start() {
    try { await this.request('/health'); this.spawned = !!this.child; return; } catch { /* Start only when unavailable. */ }
    if (this.closed) return;
    if (!this.child) {
      const candidates = this.pythonCandidates();
      const python = candidates.find(this.options.exists ?? existsSync) ?? candidates[0];
      let log: number | undefined;
      try { log = (this.options.openLog ?? openLogFile)(this.logPath); } catch { /* Logging is best effort. */ }
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = (this.options.spawn ?? nodeSpawn)(python, [join(this.root, 'src/tehablo_server.py'), '--port', new URL(this.base).port, ...this.startArgs], {
          cwd: this.root, env: this.token ? {...process.env, HF_TOKEN: this.token} : undefined, stdio: log === undefined ? 'ignore' : ['ignore', log, log], windowsHide: true, detached: true,
        });
      } finally {
        if (log !== undefined) (this.options.closeLog ?? closeSync)(log);
      }
      this.child = child;
      this.spawned = true;
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
  async stop() {
    if (!this.readings.size) return;
    const status = await this.request('/status');
    const ids = [...this.readings];
    for (const id of [...ids.filter(id => id !== status.id), ...ids.filter(id => id === status.id)])
      await this.request('/stop', {id});
  }
  /** Turn the shared server off for every Pi session, without closing this one. */
  powerOff(): Promise<void> {
    if (!this.poweringOff) {
      // The shutdown response precedes process exit; do not reconnect to that dying server.
      const exited = this.child && new Promise<void>(resolve => this.child!.once('exit', () => resolve()));
      this.poweringOff = this.close(true).finally(async () => {
        await exited;
        this.poweringOff = undefined;
        if (!this.ending) this.beginSession();
      });
    }
    return this.poweringOff;
  }
  async shutdown() {
    this.ending = true;
    await this.poweringOff;
    await this.close();
  }
  /** Only explicit power off shuts down the shared server; session close leaves idle exit to Python. */
  private async close(shared = false) {
    if (this.closed) return;
    this.closed = true;
    await this.starting?.catch(() => {});
    let failure: unknown;
    try {
      if (shared && this.used) await this.request('/stop', {});
      else await this.stop();
    } catch (error) { failure = error; }
    if (shared) {
      try { await this.request('/shutdown', {}); }
      catch (error) {
        if (this.child) { this.child.kill(); failure = error; }
        // An external server that is not running is already off.
      }
    }
    this.child = undefined;
    if (failure) throw failure;
  }
}
