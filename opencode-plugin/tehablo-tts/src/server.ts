import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, linkSync, unlinkSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = ['23765', '23766', '23767', '23768', '23769'];
const OS_NAMES: Record<string, string> = { win32: 'windows', linux: 'linux', darwin: 'macos' };

export type ServerOptions = {
  root?: string; platform?: string; port?: string; exists?: (path: string) => boolean;
  fetch?: typeof fetch; spawn?: typeof nodeSpawn; delay?: (ms: number) => Promise<void>;
  openLog?: (path: string) => number; closeLog?: (fd: number) => void;
  codePath?: string;
};

/** Keep the previous run's crash evidence before truncating; backup failure never blocks startup. */
const openLogFile = (path: string) => {
  mkdirSync(join(path, '..'), {recursive: true});
  try { copyFileSync(path, join(path, '..', 'tehablo-server.prev.log')); } catch { /* Best effort, including the first start. */ }
  return openSync(path, 'w');
};

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

/** Resolve teHablo root: explicit option, TEHABLO_ROOT, or package-relative repo root when present. */
export function resolveTehabloRoot(
  explicitRoot?: string,
  envRoot = process.env.TEHABLO_ROOT,
  exists: (path: string) => boolean = existsSync,
  packageDir = resolve(fileURLToPath(new URL('../', import.meta.url)), '../..'),
): string {
  if (explicitRoot?.trim()) return resolve(explicitRoot.trim());
  if (envRoot?.trim()) return resolve(envRoot.trim());
  if (exists(join(packageDir, 'src', 'tehablo_server.py'))) return packageDir;
  return '';
}

export class ServerClient {
  root: string;
  base: string;
  private options: ServerOptions;
  private child?: ReturnType<typeof nodeSpawn>;
  private instance?: string;
  private starting?: Promise<void>;
  private closed = false;
  private readings = new Map<string, string | undefined>();
  private inFlight = new Set<string>();
  /** Extra arguments for the next spawned server, such as the saved model and voice. */
  startArgs: string[] = [];
  /** True when this client spawned the running server, so it already started with startArgs. */
  spawned = false;

  constructor(options: ServerOptions = {}) {
    this.options = options;
    this.root = resolveTehabloRoot(options.root, process.env.TEHABLO_ROOT, options.exists ?? existsSync);
    this.base = `http://127.0.0.1:${options.port ?? process.env.TEHABLO_PORT ?? CANDIDATES[0]}`;
  }

  async request(path: string, body?: unknown, sessionID?: string): Promise<any> {
    const id = (body as {id?: string} | undefined)?.id;
    const speaking = path === '/speak' && typeof id === 'string';
    if (speaking) { this.readings.set(id, sessionID); this.inFlight.add(id); }
    const observed = path === '/status' ? [...this.readings.keys()].filter(id => !this.inFlight.has(id)) : [];
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
    if (this.closed) throw new Error('Sesión TTS cerrada.');
    if (!this.starting) this.starting = this.start().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  /** Python candidates: .venv-pocket, then .venv-pocket-<os> so a dual boot can keep one environment per OS. */
  get logPath() { return join(this.root, 'logs', 'tehablo-server.log'); }

  pythonCandidates(): string[] {
    if (!this.root) return [];
    const platform = this.options.platform ?? process.platform;
    const binary = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const envs = ['.venv-pocket', ...(OS_NAMES[platform] ? [`.venv-pocket-${OS_NAMES[platform]}`] : [])];
    return envs.map(env => join(this.root, env, binary));
  }

  private assertConfigured(): string {
    const exists = this.options.exists ?? existsSync;
    if (!this.root || !exists(join(this.root, 'src', 'tehablo_server.py'))) {
      throw new Error('No se encontró la carpeta de teHablo. Configura options.tehabloRoot en opencode.json o la variable TEHABLO_ROOT.');
    }
    const candidates = this.pythonCandidates();
    const python = candidates.find(exists);
    if (!python) {
      const installer = (this.options.platform ?? process.platform) === 'win32' ? 'install.ps1' : './install.sh';
      throw new Error(`No se encontró el entorno Python de teHablo (${candidates.join(', ')}). Ejecuta ${installer} en ${this.root}.`);
    }
    return python;
  }

  private async probe(port: string): Promise<{service: 'tehablo'; instance?: string | null} | 'free' | 'foreign'> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(2000)});
    } catch (error) {
      return ['TimeoutError', 'AbortError'].includes((error as Error).name) ? 'foreign' : 'free';
    }
    try {
      const health = await response.json();
      return response.ok && health?.service === 'tehablo' ? health : 'foreign';
    }
    catch { return 'foreign'; }
  }
  private async start() {
    const explicit = this.options.port ?? process.env.TEHABLO_PORT;
    const ports = explicit === undefined ? CANDIDATES : [explicit];
    const states = await Promise.all(ports.map(port => this.probe(port)));
    if (this.closed) return;
    const reuse = states.findIndex(state => typeof state === 'object' && (!this.child || state.instance === this.instance));
    if (reuse !== -1) {
      this.base = `http://127.0.0.1:${ports[reuse]}`;
      this.spawned = !!this.child;
      return;
    }
    if (!this.child) {
      for (let index = 0; index < ports.length; index++) {
        if (states[index] !== 'free') continue;
        this.base = `http://127.0.0.1:${ports[index]}`;
        const python = this.assertConfigured();
        let log: number | undefined;
        try { log = (this.options.openLog ?? openLogFile)(this.logPath); } catch { /* Logging is best effort. */ }
        const instance = randomBytes(16).toString('hex');
        let child: ReturnType<typeof nodeSpawn>;
        try {
          child = (this.options.spawn ?? nodeSpawn)(python, ['-X', 'faulthandler', join(this.root, 'src', 'tehablo_server.py'), '--port', new URL(this.base).port, '--instance', instance, ...this.startArgs], {
            cwd: this.root, stdio: log === undefined ? 'ignore' : ['ignore', log, log], windowsHide: true, detached: true,
          });
        } finally {
          if (log !== undefined) (this.options.closeLog ?? closeSync)(log);
        }
        this.child = child;
        this.instance = instance;
        this.spawned = false;
        let spawnError: Error | undefined;
        let exited = false;
        let exitCode: number | null = null;
        child.once('error', error => { spawnError = error; });
        child.once('exit', code => { exited = true; exitCode = code; if (this.child === child) this.child = undefined; });
        child.unref?.();
        // No fixed timeout: startup time depends on the machine and disk, so wait while the process lives.
        while (!this.closed) {
          if (spawnError) {
            this.child = undefined;
            if ((spawnError as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new Error(`No se encontró el Python del entorno (${python}). Ejecuta el instalador de teHablo.`);
            }
            throw spawnError;
          }
          if (exited) {
            if (exitCode !== 3) throw new Error(`El servidor TTS se cerró al arrancar. Revisa ${this.logPath}.`);
            this.spawned = false;
            if (typeof await this.probe(ports[index]) === 'object') return;
            break;
          }
          const health = await this.probe(ports[index]);
          if (typeof health === 'object' && health.instance === instance && !exited) {
            this.spawned = true;
            return;
          }
          await (this.options.delay ?? (ms => new Promise(r => setTimeout(r, ms))))(250);
        }
        if (this.closed) return;
      }
      throw new Error(explicit === undefined
        ? 'Los puertos 23765–23769 están ocupados por otros programas. Cierra alguno o define TEHABLO_PORT.'
        : `El puerto ${explicit} está ocupado por otro programa. Ciérralo o define otro TEHABLO_PORT.`);
    } else {
      throw new Error(`El servidor TTS no responde. Revisa ${this.logPath}.`);
    }
  }

  async action(path: string, body?: unknown) {
    await this.ensure();
    if (this.closed) return;
    return this.request(path, body);
  }

  async stop(sessionID?: string) {
    const owned = () => [...this.readings.keys()].filter(id => sessionID === undefined || this.readings.get(id) === sessionID);
    if (!owned().length) return;
    const status = await this.request('/status');
    const ids = owned();
    for (const id of [...ids.filter(id => id !== status.id), ...ids.filter(id => id === status.id)])
      await this.request('/stop', {id});
  }

  async shutdown() {
    await this.close();
  }

  /** Only cancel this client's readings on unload; idle exit shuts down the shared Python server. */
  private async close() {
    if (this.closed) return;
    this.closed = true;
    await this.starting?.catch(() => {});
    let failure: unknown;
    try {
      await this.stop();
    } catch (error) { failure = error; }
    this.child = undefined;
    if (failure) throw failure;
  }
}
