import { test } from 'node:test';

test('instance ownership waits for loser exit and rejects unchecked live-child health', async () => {
  for (const own of [false, true]) {
    let nonce = '', exit: any, waiting = false;
    const child = {once(event: string, cb: any) { if (event === 'exit') exit = cb; }, unref() {}};
    const client = new ServerClient({root: '/tehablo', port: '24123', exists: () => true, openLog: () => 1, closeLog: () => {},
      spawn: ((_python: string, args: string[]) => { nonce = args[args.indexOf('--instance') + 1]; assert.match(nonce, /^[0-9a-f]{32}$/); return child; }) as any,
      fetch: (async () => { if (!nonce) throw Error('refused'); return Response.json({service: 'tehablo', instance: own ? nonce : 'other'}); }) as any,
      delay: async () => { waiting = true; exit(3); }});
    await client.ensure();
    assert.equal(waiting, !own);
    assert.equal(client.spawned, own);
    assert.equal((client as any).child, own ? child : undefined);
    if (own) {
      (client as any).options.fetch = async () => Response.json({ok: true});
      await assert.rejects(client.ensure(), {message: `El servidor TTS no responde. Revisa ${client.logPath}.`});
    }
  }
});

test('port selection: later teHablo is reused and subsequent requests follow it', async () => {
  const urls: string[] = [];
  const client = new ServerClient({fetch: (async (url: any) => {
    urls.push(String(url)); return Response.json(new URL(url).port === '23768' ? {service: 'tehablo'} : {ok: true});
  }) as any, spawn: (() => assert.fail('must reuse')) as any});
  await client.ensure(); await client.request('/status');
  assert.equal(client.base, 'http://127.0.0.1:23768');
  assert.equal(urls.at(-1), client.base + '/status');
});

test('non-JSON, unsuccessful identity and timeout responses are skipped, never spawned on', async () => {
  for (const kind of ['non-json', 'http-error', 'timeout', 'null', 'wrong-service']) {
    const spawned: string[] = [];
    let ready = false;
    const client = new ServerClient({root: '/tehablo', exists: () => true, openLog: () => 1, closeLog: () => {},
      fetch: (async (url: any) => {
        const port = new URL(url).port;
        if (port === '23765') {
          if (kind === 'timeout') throw new DOMException('timed out', 'TimeoutError');
          if (kind === 'non-json') return new Response('not JSON');
          if (kind === 'null') return Response.json(null);
          if (kind === 'wrong-service') return Response.json({service: 'other'});
          return Response.json({service: 'tehablo'}, {status: 503});
        }
        if (port === '23766' && ready) return Response.json({service: 'tehablo'});
        throw new TypeError('connection refused');
      }) as any, spawn: ((_python: string, args: string[]) => {
        spawned.push(args[args.indexOf('--port') + 1]); ready = true;
        return {once() {}, unref() {}};
      }) as any});
    await client.ensure();
    assert.deepEqual(spawned, ['23766'], kind);
    assert.equal(client.base, 'http://127.0.0.1:23766');
  }
});

test('default first free port is 23765 and other exit codes retain the exact startup error', async () => {
  for (const code of [1, 2, null]) {
    const ports: string[] = [];
    const client = new ServerClient({root: '/tehablo', exists: () => true, openLog: () => 1, closeLog: () => {},
      fetch: (async () => {throw new TypeError('connection refused');}) as any,
      spawn: ((_python: string, args: string[]) => {
        ports.push(args[args.indexOf('--port') + 1]);
        return {once(event: string, cb: (code: number | null) => void) {
          if (event === 'exit') setImmediate(() => cb(code));
        }, unref() {}};
      }) as any, delay: () => new Promise(r => setImmediate(r))});
    await assert.rejects(client.ensure(), {message: `El servidor TTS se cerró al arrancar. Revisa ${client.logPath}.`});
    assert.deepEqual(ports, ['23765']);
  }
});

test('foreign candidates produce exact automatic and explicit errors without spawning', async () => {
  for (const port of [undefined, '24123']) {
    const seen: string[] = [];
    const client = new ServerClient({port, fetch: (async (url: any) => {
      seen.push(new URL(url).port); return Response.json({ok: true});
    }) as any, spawn: (() => assert.fail('foreign port')) as any});
    await assert.rejects(client.ensure(), {message: port
      ? `El puerto ${port} está ocupado por otro programa. Ciérralo o define otro TEHABLO_PORT.`
      : 'Los puertos 23765–23769 están ocupados por otros programas. Cierra alguno o define TEHABLO_PORT.'});
    assert.deepEqual(seen, port ? [port] : ['23765', '23766', '23767', '23768', '23769']);
  }
});

test('port collision race reuses the winner or skips a foreign winner', async () => {
  for (const winner of ['tehablo', 'foreign']) {
    let occupied = false, ready = false;
    const ports: string[] = [];
    const client = new ServerClient({root: '/tehablo', exists: () => true, openLog: () => 1, closeLog: () => {},
      fetch: (async (url: any) => {
        const port = new URL(url).port;
        if (port === '23765') return Response.json({ok: true});
        if (port === '23766' && occupied) return Response.json({service: winner});
        if (port === '23767' && ready) return Response.json({service: 'tehablo'});
        throw Error('connection refused');
      }) as any,
      spawn: ((_python: string, args: string[]) => {
        const port = args[args.indexOf('--port') + 1]; ports.push(port);
        assert.ok(['23766', '23767'].includes(port), `unexpected spawn port ${port}`);
        if (port === '23767') ready = true;
        return {once(event: string, cb: (code: number) => void) {
          if (event === 'exit' && port === '23766') setImmediate(() => {occupied = true; cb(3);});
        }, unref() {}};
      }) as any, delay: () => new Promise(r => setImmediate(r))});
    await client.ensure();
    assert.deepEqual(ports, winner === 'tehablo' ? ['23766'] : ['23766', '23767']);
    assert.equal(client.base, `http://127.0.0.1:${winner === 'tehablo' ? '23766' : '23767'}`);
  }
});
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createTehabloPlugin, sameLocation, type PluginContext } from '../src/plugin.ts';
import { createTehabloTui } from '../src/tui.ts';
import { tehabloRpc, type NoticePayload } from '../rpc.ts';
import { ServerClient as RealServerClient, resolveTehabloRoot } from '../src/server.ts';

// Spawned mock servers echo their CLI nonce, just like Python's /health.
class ServerClient extends RealServerClient {
  constructor(options: any = {}) {
    let nonce: string | undefined;
    const spawn = options.spawn, fetch = options.fetch;
    super({...options,
      ...(spawn && {spawn: (...args: any[]) => {
        nonce = args[1][args[1].indexOf('--instance') + 1];
        return spawn(...args);
      }}),
      ...(fetch && {fetch: async (...args: any[]) => {
        const response = await fetch(...args);
        if (!nonce || new URL(args[0]).pathname !== '/health') return response;
        try {
          const data = await response.clone().json();
          return data?.service === 'tehablo' && data.instance === undefined
            ? Response.json({...data, instance: nonce}, {status: response.status}) : response;
        } catch { return response; }
      }}),
    });
  }
}
import { DEFAULTS, saveVoiceSettings, type Settings } from '../src/settings.ts';
import { cleanText, finalAssistantText } from '../src/text.ts';

async function waitUntil(condition: () => boolean, message = 'Condition timed out') {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function assertStable(count: () => number) {
  const expected = count();
  const deadline = Date.now() + 100;
  await waitUntil(() => {
    assert.equal(count(), expected);
    return Date.now() >= deadline;
  });
}

interface EventItem {
  type: string;
  location?: { directory?: string };
  data?: any;
}

function createHarness(options: {
  location?: string;
  tehabloRoot?: string;
  sessions?: Record<string, { id: string; parentID?: string; outcome?: string; location?: { directory?: string } }>;
  contexts?: Record<string, any[]>;
  initialStorage?: Record<string, unknown>;
  settings?: Partial<Settings>;
  health?: Record<string, unknown> | null;
  respond?: (path: string, body: any) => Promise<Response | undefined>;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tehablo-opencode-test-'));
  const codePath = join(dir, 'ssh-codigo');
  writeFileSync(codePath, '0123456789abcdef0123456789abcdef\n', 'ascii');

  const location = options.location ?? 'D:/repo/tehablo';
  const calls: Array<{ path: string; body: any }> = [];
  const notices: NoticePayload[] = [];
  let rpcHandlers: Record<string, (input: any, context?: {error: (type: string, message: string, data: unknown) => unknown}) => Promise<unknown>> = {};
  let rpcDisposed = false;
  const storage = new Map<string, unknown>(Object.entries(options.initialStorage ?? {}));
  const commands = new Map<string, (input: { sessionID: string; prompt: { text: string } }) => Promise<void>>();

  const queue: EventItem[] = [];
  let waiting: ((result: IteratorResult<EventItem>) => void) | undefined;
  let closed = false;

  const pushEvent = async (event: EventItem) => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve({ value: event, done: false });
    } else {
      queue.push(event);
    }
    await waitUntil(() => waiting !== undefined || closed);
  };

  const fetcher = async (url: any, init: any) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (options.health === null) throw new Error('Server offline');
    const response = await options.respond?.(path, body);
    if (response) return response;
    if (path === '/health') {
      return Response.json({ service: 'tehablo', ok: true, ready: true, model: 'spanish', voice: 'lola', volume: 0.5, speed: 1, rhythm: 0, audio: 'local', device: '', ...options.health });
    }
    if (path === '/status') {
      return Response.json({ id: calls.findLast(c => c.path === '/speak')?.body?.id ?? null, queue: [], promoted: [], state: 'playing' });
    }
    if (path === '/speak') {
      return Response.json({ id: body.id }, { status: 202 });
    }
    return Response.json({ ok: true, ready: true, model: 'spanish', voice: 'lola', volume: 0.5, speed: 1, rhythm: 0, audio: 'local', device: '' });
  };

  const client = new ServerClient({
    root: options.tehabloRoot ?? dir,
    codePath,
    fetch: fetcher as any,
    exists: () => true,
  });

  const ctx: PluginContext = {
    location: { directory: location },
    options: options.tehabloRoot ? { tehabloRoot: options.tehabloRoot } : {},
    command: {
      async transform(cb) {
        cb({
          add(def) {
            commands.set(def.name, def.execute);
          },
        });
      },
    },
    event: {
      subscribe(opts) {
        opts?.signal?.addEventListener('abort', () => {
          closed = true;
          if (waiting) {
            const resolve = waiting;
            waiting = undefined;
            resolve({ value: undefined as any, done: true });
          }
        }, { once: true });
        return {
          [Symbol.asyncIterator]() {
            return {
              next() {
                if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
                if (closed || opts?.signal?.aborted) return Promise.resolve({ value: undefined as any, done: true });
                return new Promise(resolve => { waiting = resolve; });
              },
            };
          },
        };
      },
    },
    session: {
      async get({ sessionID }) {
        return options.sessions?.[sessionID] ?? { id: sessionID, outcome: 'succeeded', location: { directory: location } };
      },
      async context({ sessionID }) {
        return options.contexts?.[sessionID] ?? [];
      },
    },
    rpc: {
      async register(_definition, handlers) {
        rpcHandlers = handlers;
        return {
          dispose() { rpcDisposed = true; },
          events: {
            async emit(_name, data) { notices.push(data); },
          },
        };
      },
    },
    storage: {
      async get(key) { return storage.get(key); },
      async set(key, value) { storage.set(key, value); },
    },
  };

  return {
    dir,
    client,
    ctx,
    calls,
    notices,
    rpcHandlers: () => rpcHandlers,
    isRpcDisposed: () => rpcDisposed,
    storage,
    commands,
    pushEvent,
    loadSettings: (): Settings => ({ ...DEFAULTS, ...options.settings }),
    cleanupDir: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('cleanText and finalAssistantText skip tool-call messages and strip markdown', () => {
  assert.equal(cleanText('## Hola\n\n```ts\nconst x = 1;\n```\n\nMira **esto**.'), 'Hola. Mira esto.');

  assert.equal(finalAssistantText([
    { id: 'm1', type: 'assistant', finish: 'tool-calls', content: [{ type: 'text', text: 'Buscando...' }, { type: 'tool' }] },
  ]), undefined);

  assert.deepEqual(finalAssistantText([
    { id: 'm1', type: 'assistant', finish: 'tool-calls', content: [{ type: 'text', text: 'Paso 1' }, { type: 'tool' }] },
    { id: 'm2', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Respuesta final.' }] },
  ]), { messageId: 'm2', text: 'Respuesta final.' });
});

const localVoice = {name: 'Facundo', model: 'spanish', voice: 'Facundo.safetensors', kind: 'source', note: 'Argentina', downloaded: true};

test('portable RPC declares an explicit serializable output for every method', () => {
  for (const [name, method] of Object.entries(tehabloRpc.methods)) {
    assert.ok('output' in method, `${name} must declare output before the host encodes its result`);
    assert.equal(typeof method.output, 'object');
  }
  for (const name of ['control', 'selectVoice']) {
    assert.deepEqual(tehabloRpc.methods[name].output, {type: 'null'});
  }
});

test('RPC exposes exactly the three plugin methods', () => {
  assert.deepEqual(Object.keys(tehabloRpc.methods), ['voices', 'selectVoice', 'control']);
});

test('menu exposes only the five documented actions and ignores unknown selections', async () => {
  let listener: any;
  const menus: any[] = [];
  const dispose = createTehabloTui({
    data: {listen(cb) {listener = cb; return () => {};}},
    client: {rpc: () => ({control: async () => assert.fail('No synthetic action')})},
    ui: {router: {current: () => ({type: 'session', sessionID: 'main'})}, toast: {show() {assert.fail('No toast');}},
      dialog: {select: async options => {menus.push(options); return 'rpc-identity';}, alert: async () => assert.fail('No alert')}},
  });
  try {
    listener({details: {type: 'rpc.tehablo-tts.notice', data: {sessionID: 'main', kind: 'menu', variant: 'info', message: '', auto: false}}});
    await new Promise(r => setImmediate(r));
    assert.deepEqual(menus[0].options.map((option: any) => option.value), ['play', 'stop', 'auto', 'help', 'voices']);
  } finally {dispose();}
});

test('Help emits once and returns a serializable acknowledgement without server effects', async () => {
  const h = createHarness();
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, settingsDirectory: h.dir});
  const args = [...h.client.startArgs];
  try {
    const result = await h.rpcHandlers().control({sessionID: 'main', action: 'help'});
    assert.equal(result, null);
    assert.deepEqual(JSON.parse(JSON.stringify({output: result})), {output: null});
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].kind, 'help');
    assert.match(h.notices[0].message, /Uso de \/tts:/);
    assert.doesNotMatch(h.notices[0].message, /DEBUG-tehablo-rpc/);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.client.startArgs, args);
    assert.throws(() => readFileSync(join(h.dir, 'settings.json')), {code: 'ENOENT'});
  } finally { await cleanup(); h.cleanupDir(); }
});

// Registered-handler checks only: this does not execute OpenCode's encoder.
function assertOutputShape(schema: any, value: any): void {
  assert.ok(schema, 'Every registered method needs an output schema');
  if (schema.type === 'null') return assert.equal(value, null);
  if (schema.type === 'array') {
    assert.ok(Array.isArray(value));
    for (const row of value) assertOutputShape(schema.items, row);
    return;
  }
  if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), key);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) assertOutputShape(child, value[key]);
    }
  } else assert.equal(typeof value, schema.type);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (Object.hasOwn(schema, 'const')) assert.equal(value, schema.const);
}

test('RPC outputs match all three registered handlers without download selection effects', async () => {
  const remote = {...localVoice, name: 'Remote', voice: 'remote', downloaded: false};
  const h = createHarness({respond: async path => {
    if (path === '/voices') return Response.json({catalog: [localVoice, remote]});
  }});
  writeFileSync(join(h.dir, 'settings.json'), '{"voice":"lola","future":true}\n');
  h.client.ensure = async () => {};
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, settingsDirectory: h.dir, pollIntervalMs: 1e9});
  const invoke = async (method: keyof typeof tehabloRpc.methods, input: any) => {
    const value = await h.rpcHandlers()[method](input);
    assertOutputShape(tehabloRpc.methods[method].output, value);
    assert.deepEqual(JSON.parse(JSON.stringify({output: value})), {output: value});
  };
  try {
    for (const action of ['help', 'play', 'stop', 'auto', 'auto']) await invoke('control', {sessionID: 'main', action});
    await invoke('voices', {sessionID: 'main'});
    await invoke('selectVoice', {sessionID: 'main', model: localVoice.model, voice: localVoice.voice});
  } finally { await cleanup(); h.cleanupDir(); }
});

test('RPC malformed inputs preserve exact errors and settings hashes', async () => {
  const h = createHarness({initialStorage: {spokenIds: ['prior']}});
  writeFileSync(join(h.dir, 'settings.json'), '{"voice":"lola","future":true}\n');
  h.client.ensure = async () => assert.fail('Rejected input must not boot');
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, settingsDirectory: h.dir});
  const snapshot = () => ({
    hash: createHash('sha256').update(readFileSync(join(h.dir, 'settings.json'))).digest('hex'),
    calls: structuredClone(h.calls), notices: structuredClone(h.notices),
    storage: structuredClone([...h.storage]), args: [...h.client.startArgs],
  });
  const errors = {
    control: 'Acción de menú no válida.', selectVoice: 'Selección de voz no válida.',
    voices: 'Sesión no válida.',
  };
  try {
    for (const [method, message] of Object.entries(errors)) {
      for (const input of [null, [], {}, {sessionID: 0}, {sessionID: false}]) {
        const before = snapshot();
        await assert.rejects(() => h.rpcHandlers()[method](input), {name: 'Error', message});
        assert.deepEqual(snapshot(), before);
      }
    }
  } finally { await cleanup(); h.cleanupDir(); }
});

test('voice settings preserve legacy records and refuse malformed existing data', () => {
  const h = createHarness();
  try {
    const directory = join(h.dir, 'new-settings');
    const legacy = join(h.dir, 'tehablo-settings.json');
    writeFileSync(legacy, '{"voice":"lola","future":{"enabled":true}}');
    saveVoiceSettings(directory, {model: 'spanish', voice: 'rafael'}, h.dir);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')), {model: 'spanish', voice: 'rafael', future: {enabled: true}});
    for (const content of ['broken', '[]', 'null']) {
      writeFileSync(join(directory, 'settings.json'), content);
      assert.throws(() => saveVoiceSettings(directory, {model: 'spanish', voice: 'lola'}, h.dir));
      assert.equal(readFileSync(join(directory, 'settings.json'), 'utf8'), content);
    }
  } finally {h.cleanupDir();}
});

test('local voices list and revalidate downloaded pairs, preserving raw settings and later boot', async () => {
  let catalog = [localVoice, {...localVoice, voice: 'remote', downloaded: false}, {...localVoice, voice: 'unknown', downloaded: null}];
  const h = createHarness({respond: async path => path === '/voices' ? Response.json({voices: ['wrong'], catalog}) : undefined});
  const file = join(h.dir, 'settings.json');
  const original = {model: 'spanish', voice: 'lola', volume: 0.4, dict: {lola: false}, future: {key: ['keep']}, shortcuts: {custom: 'x'}};
  writeFileSync(file, JSON.stringify(original));
  h.client.ensure = async () => { throw new Error('Selector must not start server'); };
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, settingsDirectory: h.dir});
  try {
    assert.deepEqual(await h.rpcHandlers().voices({sessionID: 'main'}), [localVoice]);
    assert.equal(await h.rpcHandlers().selectVoice({sessionID: 'main', model: localVoice.model, voice: localVoice.voice}), null);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {...original, model: localVoice.model, voice: localVoice.voice});
    assert.deepEqual(h.calls.filter(c => c.path === '/config').map(c => c.body), [{model: localVoice.model, voice: localVoice.voice}]);
    assert.equal(h.notices.at(-1)?.variant, 'success');
    h.client.ensure = async () => {};
    await h.commands.get('tts')!({sessionID: 'main', prompt: {text: 'auto on'}});
    assert.deepEqual(h.client.startArgs.slice(0, 4), ['--model', 'spanish', '--voice', 'Facundo.safetensors']);
    catalog = catalog.map(row => ({...row, downloaded: false}));
    const saved = readFileSync(file, 'utf8');
    const configs = h.calls.filter(c => c.path === '/config').length;
    await assert.rejects(() => h.rpcHandlers().selectVoice({sessionID: 'main', model: 'spanish', voice: localVoice.voice}), /disponible/);
    assert.equal(readFileSync(file, 'utf8'), saved);
    assert.equal(h.calls.filter(c => c.path === '/config').length, configs);
    assert.ok(!h.calls.some(c => ['/prepare', '/speak'].includes(c.path)));
  } finally { await cleanup(); h.cleanupDir(); }
});

test('local voices refuse offline server and failed configuration without saving or starting', async () => {
  for (const offline of [true, false]) {
    const h = createHarness({health: offline ? null : {}, respond: async path => {
      if (path === '/voices') return Response.json({catalog: [localVoice]});
      if (path === '/config') return Response.json({error: 'Config rejected'}, {status: 400});
    }});
    const file = join(h.dir, 'settings.json');
    writeFileSync(file, '{"voice":"lola","future":42}');
    h.client.ensure = async () => { assert.fail('Must not start server'); };
    const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, settingsDirectory: h.dir});
    try {
      if (offline) await assert.rejects(() => h.rpcHandlers().voices({sessionID: 'main'}), /servidor/i);
      await assert.rejects(() => h.rpcHandlers().selectVoice({sessionID: 'main', model: 'spanish', voice: localVoice.voice}));
      assert.equal(readFileSync(file, 'utf8'), '{"voice":"lola","future":42}');
      assert.ok(!h.calls.some(c => ['/speak', '/prepare'].includes(c.path)));
      assert.ok(!h.notices.some(n => n.variant === 'success'));
    } finally { await cleanup(); h.cleanupDir(); }
  }
});

test('local voices declare the offline RPC error without startup or settings changes', async () => {
  assert.deepEqual(tehabloRpc.methods.voices.errors, {
    server_unavailable: {type: 'object', additionalProperties: false},
  });
  const h = createHarness({health: null});
  const file = join(h.dir, 'settings.json');
  writeFileSync(file, '{"voice":"lola","future":42}\n');
  const before = readFileSync(file);
  const args = [...h.client.startArgs];
  h.client.ensure = async () => assert.fail('Offline listing must not start the server');
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, settingsDirectory: h.dir});
  const declared = Object.assign(new Error('Se requiere un servidor teHablo disponible para elegir voces locales. No se ha iniciado el servidor.'), {
    type: 'server_unavailable', data: {},
  });
  const errors: unknown[] = [];
  try {
    await assert.rejects(() => h.rpcHandlers().voices({sessionID: 'main'}, {
      error(type: string, message: string, data: unknown) {
        errors.push({type, message, data});
        return declared;
      },
    }), error => error === declared);
    assert.deepEqual(errors, [{type: declared.type, message: declared.message, data: {}}]);
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(h.client.startArgs, args);
    assert.deepEqual(h.calls.map(call => call.path), ['/voices']);
    assert.deepEqual(h.notices, []);
  } finally { await cleanup(); h.cleanupDir(); }
});

test('local voices reject malformed selection and overlapping changes without modifying settings', async () => {
  let release: () => void = () => {};
  const h = createHarness({respond: async path => {
    if (path !== '/voices') return;
    await new Promise<void>(resolve => {release = resolve;});
    return Response.json({catalog: [localVoice]});
  }});
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, settingsDirectory: h.dir});
  try {
    for (const input of [null, {}, {sessionID: 1}, {sessionID: 'main', model: 'spanish'}, {sessionID: 'main', model: 'bad', voice: 'x'}]) {
      await assert.rejects(() => h.rpcHandlers().selectVoice(input));
      assert.deepEqual(h.calls, []);
    }
    const pending = h.rpcHandlers().selectVoice({sessionID: 'main', model: 'spanish', voice: localVoice.voice});
    await waitUntil(() => h.calls.length === 1);
    await assert.rejects(() => h.rpcHandlers().selectVoice({sessionID: 'main', model: 'spanish', voice: localVoice.voice}), /curso/);
    const closing = cleanup();
    release();
    await assert.rejects(() => pending, /cancelada/);
    await closing;
    assert.ok(!h.calls.some(c => c.path === '/config'));
  } finally { await cleanup(); h.cleanupDir(); }
});

test('voice submenu selects exact pairs and cancels on Escape, navigation, or unload', async () => {
  for (const outcome of ['select', 'cancel', 'navigate', 'unload', 'loading']) {
    let listener: any, changed: any, choose: any, finishList: any;
    const dialogs: any[] = [], applied: any[] = [], toasts: any[] = [];
    const dispose = createTehabloTui({
      data: {listen(cb) {listener = cb; return () => {}; }},
      client: {rpc: () => ({control: async () => assert.fail('Not a control action'),
        voices: async () => outcome === 'loading' ? new Promise(r => {finishList = r;}) : [localVoice],
        selectVoice: async input => {applied.push(input);}})},
      ui: {router: {current: () => ({type: 'session', sessionID: 'main'})}, toast: {show(n) {toasts.push(n);}},
        dialog: {alert: async () => {}, select: async options => {
          dialogs.push(options);
          return dialogs.length === 1 ? 'voices' : new Promise(r => {choose = r;});
        }}},
    }, {watchRoute(cb) {changed = cb; return () => {};}});
    try {
      listener({details: {type: 'rpc.tehablo-tts.notice', data: {sessionID: 'main', kind: 'menu', variant: 'info', message: '', auto: false}}});
      if (outcome === 'loading') {
        await waitUntil(() => !!finishList);
        changed({type: 'home'}); changed({type: 'session', sessionID: 'main'});
        finishList([localVoice]);
      } else {
        await waitUntil(() => dialogs.length === 2 || toasts.length > 0);
        assert.equal(dialogs.length, 2);
        assert.equal(dialogs[1].options[0].title, 'Facundo');
        if (outcome === 'navigate') {changed({type: 'home'}); changed({type: 'session', sessionID: 'main'});}
        if (outcome === 'unload') dispose();
        choose(outcome === 'cancel' ? undefined : dialogs[1].options[0].value);
      }
      await new Promise(r => setImmediate(r));
      assert.deepEqual(applied, outcome === 'select' ? [{sessionID: 'main', model: 'spanish', voice: 'Facundo.safetensors'}] : []);
      if (outcome === 'loading') assert.equal(dialogs.length, 1);
    } finally {dispose();}
  }
});

test('voice selector keeps the default route and opens the list without diagnostics', async () => {
  let listener: any;
  const calls: any[] = [], dialogs: any[] = [], alerts: any[] = [];
  const dispose = createTehabloTui({
    location: {directory: 'D:/private-project'},
    data: {listen(cb) {listener = cb; return () => {};}},
    client: {rpc: () => ({control: async () => assert.fail('Not a control action'),
      voices: async (input, options) => {calls.push({input, options}); return [localVoice];},
      selectVoice: async () => assert.fail('No selection')})},
    ui: {router: {current: () => ({type: 'session', sessionID: 'main'})}, toast: {show() {assert.fail('No toast');}},
      dialog: {alert: async options => {alerts.push(options);}, select: async options => {
        dialogs.push(options);
        return dialogs.length === 1 ? 'voices' : undefined;
      }}},
  });
  try {
    listener({details: {type: 'rpc.tehablo-tts.notice', data: {sessionID: 'main', kind: 'menu', variant: 'info', message: '', auto: false}}});
    await waitUntil(() => dialogs.length === 2 || alerts.length > 0);
    assert.deepEqual(alerts, []);
    assert.deepEqual(calls, [{input: {sessionID: 'main'}, options: undefined}]);
    assert.equal(dialogs[1].options[0].title, 'Facundo');
  } finally {dispose();}
});

test('menu control routing captures Location for all four actions and preserves missing-location defaults', async () => {
  for (const directory of ['D:/private-project', undefined, '', '   ']) {
    for (const action of ['play', 'stop', 'auto', 'help']) {
      let listener: any, clientReads = 0;
      const location = directory === undefined ? undefined : {directory};
      const calls: any[] = [], alerts: any[] = [], toasts: any[] = [];
      const dispose = createTehabloTui({
        location,
        get client() {
          const client = ++clientReads;
          return {rpc: () => ({control: async (input, options) => {calls.push({input, options, client});}})};
        },
        data: {listen(cb) {listener = cb; return () => {};}},
        ui: {router: {current: () => ({type: 'session', sessionID: 'main'})}, toast: {show(n) {toasts.push(n);}},
          dialog: {select: async () => {
            if (location) location.directory = 'D:/changed-project';
            return action;
          }, alert: async options => {alerts.push(options);}}},
      });
      try {
        listener({details: {type: 'rpc.tehablo-tts.notice', data: {sessionID: 'main', kind: 'menu', variant: 'info', message: '', auto: false}}});
        await waitUntil(() => calls.length > 0 || toasts.length > 0);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].input, {sessionID: 'main', action});
        assert.deepEqual(calls[0].options, directory?.trim() ? {location: {directory}} : undefined);
        assert.ok(calls[0].client > 1, 'read the current client after awaiting selection');
        assert.deepEqual(alerts, []);
        assert.deepEqual(toasts, []);
      } finally {dispose();}
    }
  }
});

test('menu control routing does not retry a scoped rejection or revive cancelled selections', async () => {
  for (const outcome of ['reject', 'cancel', 'navigate', 'unload']) {
    let listener: any, changed: any;
    const calls: any[] = [], toasts: any[] = [];
    const dispose = createTehabloTui({
      location: {directory: 'D:/private-project'},
      client: {rpc: () => ({control: async (input, options) => {
        calls.push({input, options});
        throw {type: 'rpc.unavailable', message: 'Test rejection'};
      }})},
      data: {listen(cb) {listener = cb; return () => {};}},
      ui: {router: {current: () => ({type: 'session', sessionID: 'main'})}, toast: {show(n) {toasts.push(n);}},
        dialog: {select: async () => {
          if (outcome === 'navigate') {changed({type: 'home'}); changed({type: 'session', sessionID: 'main'});}
          if (outcome === 'unload') dispose();
          return outcome === 'cancel' ? undefined : 'auto';
        }, alert: async () => assert.fail('No alert')}},
    }, {watchRoute(cb) {changed = cb; return () => {}; }});
    try {
      listener({details: {type: 'rpc.tehablo-tts.notice', data: {sessionID: 'main', kind: 'menu', variant: 'info', message: '', auto: false}}});
      await new Promise(r => setImmediate(r));
      assert.deepEqual(calls, outcome === 'reject' ? [
        {input: {sessionID: 'main', action: 'auto'}, options: {location: {directory: 'D:/private-project'}}},
      ] : []);
      assert.equal(toasts.length, outcome === 'reject' ? 1 : 0);
      if (toasts.length) assert.equal(toasts[0].message, 'rpc.unavailable: Test rejection');
    } finally {dispose();}
  }
});

test('menu re-captures the TUI Location on each invocation instead of reusing a stale directory', async () => {
  const location = {directory: 'D:/first-project'};
  const calls: any[] = [], answers: (string | undefined)[] = [undefined, 'play'];
  let listener: any;
  const dispose = createTehabloTui({
    location,
    client: {rpc: () => ({control: async (...args: any[]) => {calls.push(args);}})},
    data: {listen(cb) {listener = cb; return () => {};}},
    ui: {router: {current: () => ({type: 'session', sessionID: 'main'})}, toast: {show() {}},
      dialog: {select: async () => answers.shift(), alert: async () => assert.fail('No alert')}},
  });
  const open = () => listener({details: {type: 'rpc.tehablo-tts.notice',
    data: {sessionID: 'main', kind: 'menu', variant: 'info', message: '', auto: false}}});
  try {
    open();
    await new Promise(r => setImmediate(r));
    assert.deepEqual(calls, []);
    location.directory = 'D:/second-project';
    open();
    await waitUntil(() => calls.length > 0);
    assert.deepEqual(calls, [[{sessionID: 'main', action: 'play'}, {location: {directory: 'D:/second-project'}}]]);
  } finally {dispose();}
});

test('menu does not silently ignore explicit arguments', async () => {
  const h = createHarness();
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, loadSettings: h.loadSettings});
  try {
    for (const text of ['/tts menu --help', '/tts menu play', '/tts menu extra argument']) {
      h.notices.length = 0;
      await h.commands.get('tts')!({sessionID: 'main', prompt: {text}});
      assert.equal(h.notices.at(-1)?.kind, 'help', text);
      assert.equal(h.notices.at(-1)?.variant, 'warning', text);
      assert.match(h.notices.at(-1)!.message, /\/tts menu/);
      assert.deepEqual(h.calls, []);
      assert.equal(h.storage.size, 0);
    }
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('control rejects malformed actions without side effects', async () => {
  const h = createHarness({initialStorage: {spokenIds: ['prior']}});
  const cleanup = await createTehabloPlugin(h.ctx, {client: h.client, loadSettings: h.loadSettings});
  try {
    for (const input of [null, {}, [], {sessionID: 'main'}, {sessionID: 'main', action: ''},
      {sessionID: 'main', action: 'menu'}, {sessionID: 'main', action: 'auto on'}, {sessionID: 0, action: 'play'}]) {
      await assert.rejects(() => h.rpcHandlers().control(input), {message: 'Acción de menú no válida.'});
      assert.deepEqual(h.calls, []);
      assert.deepEqual(h.notices, []);
      assert.deepEqual([...h.storage], [['spokenIds', ['prior']]]);
    }
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('menu actions preserve legacy action results including automatic reading', async () => {
  const options = {contexts: {main: [{id: 'm', type: 'assistant', finish: 'stop',
    content: [{type: 'text', text: 'Respuesta.'}]}]}, settings: {volume: 0.4, speed: 1.25}};
  const old = createHarness(options);
  const menu = createHarness(options);
  const a = await createTehabloPlugin(old.ctx, {client: old.client, loadSettings: old.loadSettings, pollIntervalMs: 1e9});
  const b = await createTehabloPlugin(menu.ctx, {client: menu.client, loadSettings: menu.loadSettings, pollIntervalMs: 1e9});
  try {
    for (const action of ['play', 'play', 'stop', 'auto', 'help', 'auto']) {
      await old.commands.get('tts')!({sessionID: 'main', prompt: {text: action}});
      await menu.rpcHandlers().control({sessionID: 'main', action});
      await old.pushEvent({type: 'session.idle', data: {sessionID: 'main'}});
      await menu.pushEvent({type: 'session.idle', data: {sessionID: 'main'}});
      assert.deepEqual(menu.calls, old.calls);
      assert.deepEqual(menu.notices, old.notices);
      assert.deepEqual([...menu.storage], [...old.storage]);
    }
    assert.deepEqual(menu.storage.get('spokenIds'), ['m']);
    assert.ok(menu.calls.some(c => c.path === '/config'));
  } finally {
    await a();
    await b();
    old.cleanupDir();
    menu.cleanupDir();
  }
});

test('returning to the original session does not revive a stale menu', async () => {
  let listener: any;
  let select: (value: string) => void = () => {};
  let route = {type: 'session', sessionID: 'main'};
  const actions: unknown[] = [];
  const dispose = createTehabloTui({
    data: {listen(handler) {listener = handler; return () => {listener = undefined; };}},
    client: {rpc: () => ({control: async input => {actions.push(input);}})},
    ui: {
      router: {current: () => route}, toast: {show() {}},
      dialog: {alert: async () => {}, select: async () => new Promise<string>(r => {select = r;})},
    },
  });
  try {
    listener({details: {type: 'rpc.tehablo-tts.notice', data: {
      sessionID: 'main', kind: 'menu', variant: 'info', message: 'Estado', auto: false,
    }}});
    route = {type: 'session', sessionID: 'other'};
    listener({details: {type: 'rpc.tehablo-tts.notice', data: {
      sessionID: 'other', kind: 'toast', variant: 'info', message: 'Otro estado',
    }}});
    await new Promise(r => setImmediate(r));
    route = {type: 'session', sessionID: 'main'};
    select('play');
    await new Promise(r => setImmediate(r));
    assert.deepEqual(actions, []);
  } finally {
    dispose();
  }
});

test('route watcher invalidates a menu without server events and is disposed', async () => {
  let listener: any;
  let selected: (value: string) => void = () => {};
  let changed: (route: {type: string; sessionID?: string}) => void = () => {};
  let stopped = 0;
  const actions: unknown[] = [];
  const dispose = createTehabloTui({
    data: {listen(handler) {listener = handler; return () => {}; }},
    client: {rpc: () => ({control: async input => {actions.push(input);}})},
    ui: {
      router: {current: () => ({type: 'session', sessionID: 'main'})},
      toast: {show() {}},
      dialog: {alert: async () => {}, select: async () => new Promise<string>(r => {selected = r;})},
    },
  }, {watchRoute(handler) {changed = handler; return () => {stopped++;};}});
  try {
    listener({details: {type: 'rpc.tehablo-tts.notice', data: {
      sessionID: 'main', kind: 'menu', variant: 'info', message: 'Estado', auto: false,
    }}});
    changed({type: 'session', sessionID: 'other'});
    changed({type: 'session', sessionID: 'main'});
    selected('play');
    await new Promise(r => setImmediate(r));
    assert.deepEqual(actions, []);
    assert.equal(stopped, 1);
  } finally {
    dispose();
  }
  assert.equal(stopped, 1);
});

test('/tts menu opens without booting and its RPC actions reuse existing commands', async () => {
  const h = createHarness({ contexts: {
    main: [{ id: 'menu-message', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Desde el menú.' }] }],
  } });
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  try {
    await h.commands.get('tts')!({ sessionID: 'main', prompt: { text: '/tts menu' } });
    assert.equal(h.notices.at(-1)?.kind, 'menu');
    assert.equal(h.notices.at(-1)?.auto, false);
    assert.equal(h.calls.length, 0);
    const control = h.rpcHandlers().control;
    assert.equal(typeof control, 'function');
    for (const action of ['play', 'stop', 'auto', 'help']) {
      await control({ sessionID: 'main', action });
    }
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 1);
    assert.equal(h.calls.filter(c => c.path === '/stop').length, 1);
    assert.match(h.notices.at(-1)!.message, /lectura automática activada/);
    await assert.rejects(() => control({ sessionID: 'main', action: 'invalid' }));
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('native menu shows structured rejection diagnostics without dumping private fields or changing legacy errors', async () => {
  const privateFields = {headers: {authorization: 'private-token'}, input: {code: 'private-pairing-code'}};
  const unreadable: any = {...privateFields};
  unreadable.self = unreadable;
  const cases = [
    {error: {type: 'server_unavailable', message: 'Se requiere un servidor teHablo disponible para elegir voces locales.'}, text: 'server_unavailable: Se requiere un servidor teHablo disponible para elegir voces locales.'},
    {error: {type: 'rpc.not_found', message: 'RPC is not registered', ...privateFields}, text: 'rpc.not_found: RPC is not registered'},
    {error: {error: {_tag: 'InvalidRequestError', message: 'Invalid RPC request'}, ...privateFields}, text: 'InvalidRequestError: Invalid RPC request'},
    {error: {data: {message: 'Connection unavailable'}, ...privateFields}, text: 'Connection unavailable'},
    {error: {_tag: 'RpcUnavailable', ...privateFields}, text: 'RpcUnavailable'},
    {error: unreadable, text: 'No se pudo ejecutar la acción del menú: error sin mensaje legible.'},
    {error: new Error('Legacy failure'), text: 'Legacy failure', legacy: true},
    {error: 'Legacy rejection', text: 'Legacy rejection', legacy: true},
  ];
  for (const item of cases) {
    for (const action of item.legacy ? ['play', 'stop', 'auto', 'help', 'voices'] : ['help']) {
      let listener: any;
      const toasts: any[] = [], calls: string[] = [];
      const reject = async (method: string) => {calls.push(method); throw item.error;};
      const dispose = createTehabloTui({
        data: {listen(cb) {listener = cb; return () => {}; }},
        client: {rpc: () => ({
          control: async input => {assert.equal(input.action, action); return reject('control');},
          voices: async () => reject('voices'),
          selectVoice: async () => assert.fail('Diagnostics must not select'),
        })},
        ui: {router: {current: () => ({type: 'session', sessionID: 'main'})},
          toast: {show(n) {toasts.push(n);}},
          dialog: {
            select: async () => action,
            alert: async () => assert.fail('Failure is not a Help dialog'),
          }},
      });
      try {
        listener({details: {type: 'rpc.tehablo-tts.notice', data: {
          sessionID: 'main', kind: 'menu', variant: 'info', message: '', auto: false,
        }}});
        await waitUntil(() => toasts.length === 1);
        assert.equal(toasts[0].message, item.text);
        assert.equal(toasts[0].variant, 'warning');
        assert.deepEqual(calls, [action === 'voices' ? 'voices' : 'control']);
      } finally {dispose();}
    }
  }
});

test('native menu dispatches only an explicit selection in the same live session', async () => {
  let listener: any;
  let resolveSelection: (value?: string) => void = () => {};
  let route = { type: 'session', sessionID: 'main' };
  const selections: any[] = [];
  const actions: any[] = [];
  const dispose = createTehabloTui({
    data: { listen(handler) { listener = handler; return () => { listener = undefined; }; } },
    client: { rpc: () => ({ control: async (input: any) => { actions.push(input); } }) },
    ui: {
      router: { current: () => route },
      toast: { show() {} },
      dialog: {
        alert: async () => {},
        select: async (options: any) => {
          selections.push(options);
          return new Promise<string | undefined>(resolve => { resolveSelection = resolve; });
        },
      },
    },
  });
  const open = () => listener({ details: { type: 'rpc.tehablo-tts.notice', data: {
    sessionID: 'main', kind: 'menu', variant: 'info', message: 'Estado', auto: false,
  } } });
  try {
    open();
    assert.deepEqual(selections[0].options.map((o: any) => o.value), ['play', 'stop', 'auto', 'help', 'voices']);
    assert.match(selections[0].options[2].title, /Activar/);
    resolveSelection(undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(actions.length, 0);
    open();
    resolveSelection('play');
    await waitUntil(() => actions.length === 1);
    assert.deepEqual(actions[0], { sessionID: 'main', action: 'play' });
    open();
    route = { type: 'session', sessionID: 'other' };
    resolveSelection('stop');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(actions.length, 1);
    route = { type: 'session', sessionID: 'main' };
    open();
    dispose();
    resolveSelection('auto');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(actions.length, 1);
  } finally {
    dispose();
  }
});

test('resolveTehabloRoot honors explicit root, TEHABLO_ROOT, and repo fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tehablo-root-test-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'tehablo_server.py'), '# stub\n');

    assert.equal(resolveTehabloRoot(dir, undefined), dir);
    assert.equal(resolveTehabloRoot(undefined, dir), dir);
    assert.equal(resolveTehabloRoot(undefined, '', () => false, dir), '');
    assert.equal(resolveTehabloRoot(undefined, '', (p) => p.endsWith('tehablo_server.py'), dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ServerClient reports clear error when tehabloRoot or Python venv is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tehablo-missing-test-'));
  try {
    const noRoot = new ServerClient({ root: '', exists: () => false, fetch: (async () => { throw new Error('down'); }) as any });
    await assert.rejects(() => noRoot.ensure(), /options\.tehabloRoot|TEHABLO_ROOT/);

    const missingVenv = new ServerClient({
      root: dir,
      exists: (p) => p.endsWith('tehablo_server.py'),
      fetch: (async () => { throw new Error('down'); }) as any,
    });
    await assert.rejects(() => missingVenv.ensure(), /entorno Python/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sameLocation normalizes Windows slashes and casing', () => {
  assert.equal(sameLocation('D:\\Documentos\\tehablo\\', 'd:/documentos/tehablo', 'win32'), true);
  assert.equal(sameLocation('/tmp/a', '/tmp/b', 'linux'), false);
});

test('auto reading starts off, activates on /tts auto, deduplicates, and filters subagents and other projects', async () => {
  const h = createHarness({
    sessions: {
      main: { id: 'main', outcome: 'succeeded', location: { directory: 'D:\\repo\\tehablo' } },
      child: { id: 'child', parentID: 'main', outcome: 'succeeded', location: { directory: 'D:/repo/tehablo' } },
      other: { id: 'other', outcome: 'succeeded', location: { directory: 'D:/repo/other' } },
    },
    contexts: {
      main: [{ id: 'msg-1', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Primera respuesta.' }] }],
      child: [{ id: 'msg-child', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Subagente.' }] }],
      other: [{ id: 'msg-other', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Otro proyecto.' }] }],
    },
  });

  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  try {
    const tts = h.commands.get('tts')!;
    assert.ok(tts);

    // Off by default: idle must not speak.
    await h.pushEvent({ type: 'session.idle', data: { sessionID: 'main' } });
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 0);

    // Enable auto reading.
    await tts({ sessionID: 'main', prompt: { text: '/tts auto' } });
    assert.ok(h.notices.some(n => n.kind === 'toast' && n.variant === 'success' && n.message.includes('Lectura automática activada')));

    // Subagent and other project must be ignored.
    await h.pushEvent({ type: 'session.idle', data: { sessionID: 'child' } });
    await h.pushEvent({ type: 'session.idle', data: { sessionID: 'other' } });
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 0);

    // Main session speaks once and deduplicates repeated idle for same assistantMessageID.
    await h.pushEvent({ type: 'session.idle', data: { sessionID: 'main' } });
    await h.pushEvent({ type: 'session.idle', data: { sessionID: 'main' } });
    const speaks = h.calls.filter(c => c.path === '/speak');
    assert.equal(speaks.length, 1);
    assert.equal(speaks[0].body.id, 'msg-1');
    assert.equal(speaks[0].body.text, 'Primera respuesta.');
    assert.equal(speaks[0].body.lexicon, true);
    assert.deepEqual(h.storage.get('spokenIds'), ['msg-1']);
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('deduplication persists across plugin reload via ctx.storage', async () => {
  const h = createHarness({
    initialStorage: { spokenIds: ['msg-1'] },
    contexts: {
      main: [{ id: 'msg-1', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Ya leída.' }] }],
    },
  });
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  try {
    await h.commands.get('tts')!({ sessionID: 'main', prompt: { text: 'auto on' } });
    await h.pushEvent({ type: 'session.idle', data: { sessionID: 'main' } });
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 0);
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('/tts play, /tts stop, /tts help, and cleanup leave shared server alive', async () => {
  const h = createHarness({
    contexts: {
      main: [{ id: 'msg-9', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Hola mundo.' }] }],
    },
  });
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  try {
    const tts = h.commands.get('tts')!;
    await tts({ sessionID: 'main', prompt: { text: '/tts help' } });
    assert.equal(h.notices.at(-1)?.kind, 'help');
    assert.equal(h.notices.at(-1)?.variant, 'info');
    assert.ok(h.notices.at(-1)?.message.includes('/tts play'));
    assert.equal(h.calls.length, 0);

    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });
    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });
    const speaks = h.calls.filter(c => c.path === '/speak');
    assert.equal(speaks.length, 2);
    assert.equal(speaks[0].body.id, 'msg-9:tehablo:1');
    assert.equal(speaks[1].body.id, 'msg-9:tehablo:2');

    await tts({ sessionID: 'main', prompt: { text: '/tts stop' } });
    const stops = h.calls.filter(c => c.path === '/stop');
    assert.equal(stops.length, 1);
    assert.deepEqual(stops[0].body, { id: 'msg-9:tehablo:2' });
  } finally {
    await cleanup();
    assert.equal(h.isRpcDisposed(), true);
    assert.equal(h.calls.some(c => c.path === '/shutdown'), false);
    h.cleanupDir();
  }
});

test('policy wait queues readings and /tts stop cancels queued before active', async () => {
  const h = createHarness({
    settings: { policy: 'wait' },
    contexts: {
      main: [{ id: 'msg-10', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'En cola.' }] }],
    },
  });
  const baseFetch = h.client['options'].fetch!;
  h.client['options'].fetch = async (url: any, init: any) => {
    const path = new URL(url).pathname;
    if (path === '/status') {
      h.calls.push({ path, body: undefined });
      return Response.json({ id: 'msg-10:tehablo:1', queue: ['msg-10:tehablo:2'], promoted: [], state: 'playing' });
    }
    return baseFetch(url, init);
  };
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  try {
    const tts = h.commands.get('tts')!;
    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });
    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });
    await tts({ sessionID: 'main', prompt: { text: '/tts stop' } });
    const speaks = h.calls.filter(c => c.path === '/speak');
    assert.equal(speaks[0].body.policy, 'wait');
    const stops = h.calls.filter(c => c.path === '/stop').map(c => c.body.id);
    assert.deepEqual(stops, ['msg-10:tehablo:2', 'msg-10:tehablo:1']);
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('session stop preserves other sessions and unload cancels remaining owned readings', async () => {
  const h = createHarness({ settings: { policy: 'wait' }, contexts: {
    alpha: [{ id: 'a', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Alpha.' }] }],
    beta: [{ id: 'b', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Beta.' }] }],
  } });
  const pending: string[] = [];
  let active: string | undefined;
  const baseFetch = h.client['options'].fetch!;
  h.client['options'].fetch = async (url: any, init: any) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (path === '/status') {
      h.calls.push({ path, body });
      return Response.json({ id: active, queue: [...pending], promoted: [], state: 'playing' });
    }
    if (path === '/speak') {
      if (active) pending.push(body.id); else active = body.id;
    }
    if (path === '/stop') {
      assert.equal(typeof body?.id, 'string', 'stop must always be targeted');
      if (active === body.id) active = pending.shift();
      else {
        const index = pending.indexOf(body.id);
        if (index >= 0) pending.splice(index, 1);
      }
    }
    return baseFetch(url, init);
  };
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  const stops = () => h.calls.filter(c => c.path === '/stop').map(c => c.body.id);
  const command = (sessionID: string, text: string) => h.commands.get('tts')!({ sessionID, prompt: { text } });
  try {
    await command('alpha', 'play');
    await command('beta', 'play');
    await command('alpha', 'play');
    await command('beta', 'play');
    // A separate client's queued reading must survive both operations.
    pending.push('external');
    await command('alpha', 'stop');
    assert.deepEqual(stops(), ['a:tehablo:3', 'a:tehablo:1']);
    assert.equal(active, 'b:tehablo:2');
    assert.deepEqual(pending, ['b:tehablo:4', 'external']);
    await command('alpha', 'stop');
    assert.equal(stops().length, 2);
    await cleanup();
    assert.deepEqual(stops(), ['a:tehablo:3', 'a:tehablo:1', 'b:tehablo:4', 'b:tehablo:2']);
    assert.equal(active, 'external');
    assert.deepEqual(pending, []);
    assert.equal(h.calls.some(c => c.path === '/shutdown'), false);
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('saved settings apply before the first /speak even when /health reports ready=false', async () => {
  const h = createHarness({
    health: { ready: false, volume: 1, speed: 1, rhythm: 0, audio: 'local', device: '' },
    settings: { volume: 0.4, speed: 1.25, rhythm: 0.2, device: 'Headphones' },
    contexts: {
      main: [{ id: 'msg-11', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Ajustes en frío.' }] }],
    },
  });
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  try {
    const tts = h.commands.get('tts')!;
    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });
    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });

    const configs = h.calls.filter(c => c.path === '/config');
    assert.equal(configs.length, 1);
    assert.deepEqual(configs[0].body, {
      volume: 0.4,
      speed: 1.25,
      rhythm: 0.2,
      device: 'Headphones',
    });

    const configIdx = h.calls.findIndex(c => c.path === '/config');
    const firstSpeakIdx = h.calls.findIndex(c => c.path === '/speak');
    assert.ok(configIdx !== -1 && firstSpeakIdx !== -1 && configIdx < firstSpeakIdx);
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('createTehabloTui renders toast and help alert only for matching session and unsubscribes on dispose', () => {
  const toasts: Array<{ title?: string; message: string; variant?: string }> = [];
  const alerts: Array<{ title: string; message: string }> = [];
  let listener: ((event: { details: { type: string; data?: unknown } }) => void) | undefined;
  let route: { type: string; sessionID?: string } = { type: 'session', sessionID: 's1' };

  const dispose = createTehabloTui({
    data: {
      listen(handler) {
        listener = handler;
        return () => { listener = undefined; };
      },
    },
    ui: {
      router: { current: () => route },
      toast: { show: (opts) => toasts.push(opts) },
      dialog: { alert: async (opts) => { alerts.push(opts); } },
    },
  });

  listener?.({ details: { type: 'rpc.tehablo-tts.notice', data: { sessionID: 's2', kind: 'toast', variant: 'info', message: 'Otro tab' } } });
  assert.equal(toasts.length, 0);

  listener?.({ details: { type: 'rpc.tehablo-tts.notice', data: { sessionID: 's1', kind: 'toast', variant: 'success', message: 'Lectura automática activada.' } } });
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, 'teHablo TTS');
  assert.equal(toasts[0].variant, 'success');

  listener?.({ details: { type: 'rpc.tehablo-tts.notice', data: { sessionID: 's1', kind: 'help', variant: 'info', message: 'Uso de /tts' } } });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, 'teHablo TTS');
  assert.equal(alerts[0].message, 'Uso de /tts');

  route = { type: 'home' };
  listener?.({ details: { type: 'rpc.tehablo-tts.notice', data: { sessionID: 's1', kind: 'toast', variant: 'info', message: 'En inicio' } } });
  assert.equal(toasts.length, 2);

  dispose();
  assert.equal(listener, undefined);
});

test('session.execution.succeeded triggers auto reading, respects session location, and deduplicates with session.idle', async () => {
  const h = createHarness({
    sessions: {
      main: { id: 'main', outcome: 'succeeded', location: { directory: 'D:\\repo\\tehablo' } },
      child: { id: 'child', parentID: 'main', outcome: 'succeeded', location: { directory: 'D:/repo/tehablo' } },
      other: { id: 'other', outcome: 'succeeded', location: { directory: 'D:/repo/other' } },
    },
    contexts: {
      main: [{ id: 'msg-v2', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Listo en v2.' }] }],
      child: [{ id: 'msg-child', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Subagente.' }] }],
      other: [{ id: 'msg-other', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Otro proyecto.' }] }],
    },
  });

  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  try {
    const tts = h.commands.get('tts')!;
    await tts({ sessionID: 'main', prompt: { text: '/tts auto' } });

    await h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'child' } });
    await h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'other' } });
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 0);

    await h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'main' } });
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 1);

    await h.pushEvent({ type: 'session.idle', data: { sessionID: 'main' } });

    const speaks = h.calls.filter(c => c.path === '/speak');
    assert.equal(speaks.length, 1);
    assert.equal(speaks[0].body.id, 'msg-v2');
    assert.equal(speaks[0].body.text, 'Listo en v2.');
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('eventLoop survives handleIdle errors and clears pendingText on session.execution.failed', async () => {
  const errors: unknown[] = [];
  const h = createHarness({
    sessions: {
      main: { id: 'main', outcome: 'succeeded', location: { directory: 'D:/repo/tehablo' } },
    },
    contexts: {
      main: [{ id: 'msg-ok', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Recuperado.' }] }],
    },
  });
  const baseGet = h.ctx.session.get;
  h.ctx.session.get = async ({ sessionID }) => {
    if (sessionID === 'missing') throw new Error('Session not found');
    return baseGet({ sessionID });
  };

  const cleanup = await createTehabloPlugin(h.ctx, {
    client: h.client,
    loadSettings: h.loadSettings,
    onError: (err) => errors.push(err),
  });
  try {
    const tts = h.commands.get('tts')!;
    await tts({ sessionID: 'main', prompt: { text: '/tts auto' } });

    await h.pushEvent({ type: 'session.text.ended', data: { sessionID: 'main', assistantMessageID: 'msg-fail', text: 'Fallido' } });
    await h.pushEvent({ type: 'session.execution.failed', data: { sessionID: 'main' } });
    await h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'missing' } });

    // Remove context so fallback would speak if failed turn had not cleared pendingText.
    h.ctx.session.context = async () => [];
    await h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'main' } });
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 0);

    // Next real turn still triggers despite the earlier 'missing' session error.
    h.ctx.session.context = async () => [{ id: 'msg-ok', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Recuperado.' }] }];
    await h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'main' } });

    assert.equal(errors.length, 1);
    const speaks = h.calls.filter(c => c.path === '/speak');
    assert.equal(speaks.length, 1);
    assert.equal(speaks[0].body.id, 'msg-ok');
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('unload finishes while a spawned server never becomes healthy', async () => {
  const h = createHarness({ contexts: {
    main: [{ id: 'msg-boot', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Waiting.' }] }],
  } });
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  let releaseDelay: (() => void) | undefined;
  let bootWaiting = false;
  try {
    await h.commands.get('tts')!({ sessionID: 'main', prompt: { text: '/tts auto' } });
    h.client['options'].fetch = (async (url: any) => {
      h.calls.push({ path: new URL(url).pathname, body: undefined });
      throw new Error('Server offline');
    }) as any;
    h.client['options'].openLog = () => { throw new Error('No log'); };
    h.client['options'].spawn = (() => ({ once() {}, unref() {}, kill() { assert.fail('Shared server must stay alive'); } })) as any;
    h.client['options'].delay = () => {
      bootWaiting = true;
      return new Promise(resolve => { releaseDelay = resolve; });
    };
    const event = h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'main' } });
    await waitUntil(() => bootWaiting);
    let finished = false;
    const unloading = cleanup().then(() => { finished = true; });
    // Release the startup delay only after cleanup has had a chance to close the client.
    await Promise.resolve();
    releaseDelay!();
    await waitUntil(() => finished, 'Unload did not finish during server startup');
    await unloading;
    await event;
    await assertStable(() => h.calls.filter(c => c.path === '/health').length);
    assert.equal(h.calls.some(c => c.path === '/shutdown' || c.path === '/stop'), false);
  } finally {
    const closing = h.client.shutdown();
    releaseDelay?.();
    await closing;
    await cleanup();
    h.cleanupDir();
  }
});

test('auto off cancels an idle handler waiting for session lookup', async () => {
  const h = createHarness({ contexts: {
    main: [{ id: 'msg-race', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Stale.' }] }],
  } });
  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings });
  let resolveSession: ((info: { id: string }) => void) | undefined;
  h.ctx.session.get = () => new Promise(resolve => { resolveSession = resolve; });
  try {
    const tts = h.commands.get('tts')!;
    await tts({ sessionID: 'main', prompt: { text: '/tts auto' } });
    const event = h.pushEvent({ type: 'session.execution.succeeded', data: { sessionID: 'main' } });
    await waitUntil(() => resolveSession !== undefined);
    await tts({ sessionID: 'main', prompt: { text: '/tts auto' } });
    resolveSession!({ id: 'main' });
    await event;
    assert.equal(h.calls.filter(c => c.path === '/speak').length, 0);
  } finally {
    resolveSession?.({ id: 'main' });
    await cleanup();
    h.cleanupDir();
  }
});

test('polls /status while reading is active and stops once idle', async () => {
  const h = createHarness({
    contexts: {
      main: [{ id: 'msg-long', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Texto largo.' }] }],
    },
  });
  const states = [
    { id: 'msg-long:tehablo:1', queue: [], promoted: [], state: 'generating' },
    { id: 'msg-long:tehablo:1', queue: [], promoted: [], state: 'playing' },
    { id: 'msg-long:tehablo:1', queue: [], promoted: [], state: 'paused' },
    { id: null, queue: ['msg-long:tehablo:1'], promoted: [], state: 'idle' },
    { id: null, queue: [], promoted: [], state: 'idle' },
  ];
  let idx = 0;
  const baseFetch = h.client['options'].fetch!;
  h.client['options'].fetch = async (url: any, init: any) => {
    if (new URL(url).pathname === '/status') {
      h.calls.push({ path: '/status', body: undefined });
      const reply = states[Math.min(idx, states.length - 1)];
      idx++;
      return Response.json(reply);
    }
    return baseFetch(url, init);
  };

  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings, pollIntervalMs: 10 });
  try {
    await h.commands.get('tts')!({ sessionID: 'main', prompt: { text: '/tts play' } });
    await waitUntil(() => idx >= states.length);

    const statusCountAtIdle = h.calls.filter(c => c.path === '/status').length;
    assert.equal(statusCountAtIdle, 5);

    await assertStable(() => h.calls.filter(c => c.path === '/status').length);
    assert.equal(h.calls.filter(c => c.path === '/status').length, 5);
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});

test('/tts stop and repeated /status failures halt keepalive polling', async () => {
  const h = createHarness({
    contexts: {
      main: [{ id: 'msg-stop', type: 'assistant', finish: 'stop', content: [{ type: 'text', text: 'Lectura.' }] }],
    },
  });
  let failStatus = false;
  const baseFetch = h.client['options'].fetch!;
  h.client['options'].fetch = async (url: any, init: any) => {
    if (new URL(url).pathname === '/status') {
      h.calls.push({ path: '/status', body: undefined });
      if (failStatus) throw new Error('server down');
      return Response.json({ id: 'msg-stop:tehablo:1', queue: [], promoted: [], state: 'playing' });
    }
    return baseFetch(url, init);
  };

  const cleanup = await createTehabloPlugin(h.ctx, { client: h.client, loadSettings: h.loadSettings, pollIntervalMs: 10 });
  try {
    const tts = h.commands.get('tts')!;
    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });
    await waitUntil(() => h.calls.filter(c => c.path === '/status').length >= 2);
    assert.ok(h.calls.filter(c => c.path === '/status').length >= 2);

    await tts({ sessionID: 'main', prompt: { text: '/tts stop' } });
    const countAfterStop = h.calls.filter(c => c.path === '/status').length;
    await assertStable(() => h.calls.filter(c => c.path === '/status').length);
    assert.equal(h.calls.filter(c => c.path === '/status').length, countAfterStop);

    failStatus = true;
    await tts({ sessionID: 'main', prompt: { text: '/tts play' } });
    await waitUntil(() => h.calls.filter(c => c.path === '/status').length - countAfterStop >= 3);
    await assertStable(() => h.calls.filter(c => c.path === '/status').length);
    assert.equal(h.calls.filter(c => c.path === '/status').length - countAfterStop, 3);
  } finally {
    await cleanup();
    h.cleanupDir();
  }
});
