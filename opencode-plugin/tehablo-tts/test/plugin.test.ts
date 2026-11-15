import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTehabloPlugin, sameLocation, type PluginContext } from '../src/plugin.ts';
import { createTehabloTui } from '../src/tui.ts';
import type { NoticePayload } from '../rpc.ts';
import { ServerClient, resolveTehabloRoot } from '../src/server.ts';
import { DEFAULTS, type Settings } from '../src/settings.ts';
import { cleanText, finalAssistantText } from '../src/text.ts';

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
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tehablo-opencode-test-'));
  const codePath = join(dir, 'ssh-codigo');
  writeFileSync(codePath, '0123456789abcdef0123456789abcdef\n', 'ascii');

  const location = options.location ?? 'D:/repo/tehablo';
  const calls: Array<{ path: string; body: any }> = [];
  const notices: NoticePayload[] = [];
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
    await new Promise(r => setTimeout(r, 15));
  };

  const fetcher = async (url: any, init: any) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, body });
    if (options.health === null) throw new Error('Server offline');
    if (path === '/health') {
      return Response.json({ ok: true, ready: true, model: 'spanish', voice: 'lola', volume: 0.5, speed: 1, rhythm: 0, audio: 'local', device: '', ...options.health });
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
      async register() {
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
