import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ServerClient, pairingCode} from '../src/server.ts';

test('ServerClient authenticates every request and reuses the private code', async () => {
  const dir = resolve('.repo-harness/tmp/t11-check');
  mkdirSync(dir, {recursive: true});
  const codePath = resolve(dir, `node-code-${process.pid}`);
  const code = pairingCode(codePath);
  assert.equal(pairingCode(codePath), code);
  assert.equal(readFileSync(codePath, 'ascii').trim(), code);
  const seen: string[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.headers['x-tehablo-codigo'], code);
    seen.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    res.end('{}');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const client = new ServerClient({port: String((server.address() as any).port), codePath});
    await client.request('/health');
    await client.request('/status');
    await client.request('/config', {audio: 'ssh'});
    assert.deepEqual(seen, ['/health', '/status', '/config']);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
