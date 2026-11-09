import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ServerClient} from '../src/server.ts';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

test('scoped controls S3: shutdown stops only owned current and queued readings on a shared server', async () => {
  const stops: any[] = [], paths: string[] = [];
  let current = 'mine', queue = ['foreign-queued'];
  const client = new ServerClient({fetch: (async (url: any, init: any) => {
    const path = new URL(url).pathname; paths.push(path);
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (path === '/speak') { if (body.id !== current) queue.push(body.id); return Response.json({id: body.id}); }
    if (path === '/status') return Response.json({state: 'playing', id: current, queue});
    if (path === '/stop') { stops.push(body); queue = queue.filter(id => id !== body.id); if (body.id === current) current = queue.shift()!; }
    return Response.json({ok: true});
  }) as any});
  await client.ensure();
  await client.request('/speak', {id: 'mine', text: 'first'});
  await client.request('/speak', {id: 'mine-queued', text: 'second', policy: 'wait'});
  await client.shutdown();
  assert.deepEqual(stops, [{id: 'mine-queued'}, {id: 'mine'}]);
  assert.equal(current, 'foreign-queued');
  assert.ok(!paths.includes('/shutdown'));
  await client.shutdown(); assert.equal(stops.length, 2);
});

test('device discovery uses existing Python without starting TTS or making HTTP requests', async () => {
  const commands: any[] = [];
  const client = new ServerClient({root: '/tehablo', platform: 'win32', exists: p => p.includes('.venv-pocket-windows'),
    fetch: (async () => assert.fail('device discovery must not use HTTP')) as any,
    spawn: (() => assert.fail('device discovery must not start the server')) as any,
    execFile: (async (...args: any[]) => { commands.push(args); return {stdout: JSON.stringify({devices: ['Speakers'], allDevices: ['Speakers', 'Other API DAC']})}; }) as any});
  assert.deepEqual(await client.outputDevices(), {devices: ['Speakers'], allDevices: ['Speakers', 'Other API DAC']});
  assert.equal(client.spawned, false); assert.equal(commands.length, 1);
  assert.match(commands[0][0], /\.venv-pocket-windows[/\\]Scripts[/\\]python\.exe$/);
  assert.equal(commands[0][1][0], '-c'); assert.match(commands[0][1][1], /output_devices/);
  assert.doesNotMatch(commands[0][1][1], /ensure|create_server|audio_sink|OutputStream/);
  assert.match(commands[0][1][2], /[/\\]src$/);
  assert.equal(commands[0][2].timeout, 5000); assert.equal(commands[0][2].maxBuffer, 65536);
  assert.equal(commands[0][2].shell, undefined);
});

test('device discovery reports missing environments and invalid output without starting TTS', async () => {
  const missing = new ServerClient({exists: () => false});
  await assert.rejects(missing.outputDevices(), /entorno Python/);
  for (const stdout of ['invalid JSON', JSON.stringify({devices: [4], allDevices: []})]) {
    const client = new ServerClient({exists: () => true, execFile: (async () => ({stdout})) as any});
    await assert.rejects(client.outputDevices(), /dispositivos/);
    assert.equal(client.spawned, false);
  }
});

test('default root is two levels above extension, POSIX python, stop only after use',async()=>{
  const defaultClient=new ServerClient();
  assert.equal(defaultClient.root,process.env.TEHABLO_ROOT ?? resolve(fileURLToPath(new URL('../../..',import.meta.url))));
  let healthy=false; const commands:any[]=[]; const calls:string[]=[];
  const client=new ServerClient({root:'/tehablo',platform:'linux',fetch:(async(url:any)=>{
    calls.push(new URL(url).pathname); if(!healthy) throw Error('offline'); return Response.json({ok:true});
  }) as any,spawn:((...args:any[])=>{commands.push(args); healthy=true; return {once(){},unref(){},kill(){}};}) as any});
  await client.stop(); assert.equal(calls.length,0);
  await client.ensure(); assert.match(commands[0][0],/\.venv-pocket[/\\]bin[/\\]python$/);
  await client.shutdown(); assert.deepEqual(calls,['/health','/health']);
  client.beginSession(); await client.ensure(); await client.shutdown(); assert.equal(commands.length,1);
});

test('start arguments are passed to the spawned server, which is then marked as spawned here',async()=>{
  let healthy=false; const commands:any[]=[];
  const client=new ServerClient({root:'/tehablo',platform:'linux',fetch:(async()=>{ if(!healthy) throw Error('offline'); return Response.json({ok:true}); }) as any,
    spawn:((...args:any[])=>{commands.push(args); healthy=true; return {once(){},unref(){},kill(){}};}) as any, openLog:()=>{throw Error('no log');}});
  assert.equal(client.spawned,false);
  client.startArgs=['--model','phonon','--voice','Regina'];
  await client.ensure();
  assert.deepEqual(commands[0][1].slice(-6),['--port','8765','--model','phonon','--voice','Regina']);
  assert.equal(client.spawned,true);
  const reused=new ServerClient({fetch:(async()=>Response.json({ok:true})) as any});
  await reused.ensure(); assert.equal(reused.spawned,false);
});

test('a token is passed only in the environment of the spawned server, never as an argument',async()=>{
  for(const token of [undefined,'hf_secret']) {
    let healthy=false; const commands:any[]=[];
    const client=new ServerClient({root:'/tehablo',platform:'linux',fetch:(async()=>{ if(!healthy) throw Error('offline'); return Response.json({ok:true}); }) as any,
      spawn:((...args:any[])=>{commands.push(args); healthy=true; return {once(){},unref(){},kill(){}};}) as any, openLog:()=>{throw Error('no log');}});
    client.token=token;
    await client.ensure();
    assert.ok(!commands[0][1].includes('hf_secret'));
    if(token) assert.equal(commands[0][2].env.HF_TOKEN,'hf_secret');
    else assert.equal(commands[0][2].env,undefined);
  }
});

test('owner session close never shuts down or kills; explicit failed power off kills',async()=>{
  let healthy=false,kills=0; const exits: (()=>void)[]=[];
  const client=new ServerClient({fetch:(async(url:any)=>{
    if(!healthy || new URL(url).pathname==='/shutdown') throw Error('sin conexión');
    return Response.json({ok:true});
  }) as any,spawn:(()=>{healthy=true;return {once(event:string,cb:()=>void){if(event==='exit')exits.push(cb);},unref(){},kill(){kills++;for(const cb of exits)cb();}};}) as any});
  await client.ensure(); await client.shutdown(); assert.equal(kills,0);
  client.beginSession(); healthy=false; await client.ensure();
  await assert.rejects(client.powerOff(),/sin conexión/); assert.equal(kills,1);
});

test('power off releases the owned process and allows same-session restart; shutdown stays terminal',async()=>{
  let healthy=false,kills=0,exit=()=>{};const calls:string[]=[],spawned:any[]=[];
  const client=new ServerClient({root:'/tehablo',openLog:()=>1,closeLog:()=>{},
    fetch:(async(url:any)=>{const path=new URL(url).pathname;calls.push(path);if(!healthy)throw Error('offline');if(path==='/shutdown')setImmediate(()=>{healthy=false;exit();});return Response.json({ok:true});}) as any,
    spawn:((...args:any[])=>{spawned.push(args);healthy=true;return {once(event:string,callback:()=>void){if(event==='exit'){const previous=exit;exit=()=>{previous();callback();};}},unref(){},kill(){kills++;}};}) as any});
  await client.ensure();await client.powerOff();assert.deepEqual(calls.slice(-2),['/stop','/shutdown']);assert.equal(kills,0);
  assert.equal(healthy,false,'power off waits for process exit before allowing restart');
  await client.ensure();assert.equal(spawned.length,2);
  await client.shutdown();await assert.rejects(client.ensure(),/Sesión TTS cerrada\./);
});

test('power off during pending startup prevents stale spawn and can restart',async()=>{
  let release!:()=>void,checks=0,spawns=0;
  const client=new ServerClient({root:'/tehablo',openLog:()=>1,closeLog:()=>{},
    fetch:(async()=>{if(++checks===1) {await new Promise<void>(r=>{release=r;});throw Error('offline');}return Response.json({ok:true});}) as any,
    spawn:(()=>{spawns++;return {once(){},unref(){},kill(){}};}) as any});
  const boot=client.ensure();await new Promise(r=>setImmediate(r));
  const off=client.powerOff();release();await boot;await off;assert.equal(spawns,0);
  await client.ensure();await client.shutdown();
});

test('S12: completed, rejected and stopped readings are forgotten through status and shutdown', async () => {
  const stops: string[] = [];
  let status = {id: 'current', queue: ['queued']} as any;
  const client = new ServerClient({fetch: (async (url: any, init: any) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    if (path === '/speak' && body.id === 'rejected')
      return Response.json({error: 'full'}, {status: 400});
    if (path === '/speak' && body.id === 'network') throw Error('offline');
    if (path === '/status') return Response.json(status);
    if (path === '/stop') stops.push(body.id);
    return Response.json({ok: true});
  }) as any});
  for (const id of ['completed', 'stopped', 'current', 'queued'])
    await client.request('/speak', {id, text: id});
  await assert.rejects(client.request('/speak', {id: 'rejected', text: 'no'}), /full/);
  await assert.rejects(client.request('/speak', {id: 'network', text: 'no'}), /offline/);
  await client.request('/stop', {id: 'stopped'});
  await client.request('/status');
  status = {id: 'foreign', queue: ['queued']};
  await client.shutdown();
  assert.deepEqual(stops, ['stopped', 'queued']);
});

test('S12: lost speak responses retain ownership until status reconciles it', async () => {
  for (const location of ['current', 'queue', 'promoted', 'absent']) {
    const stops: string[] = [];
    const client = new ServerClient({fetch: (async (url: any, init: any) => {
      const path = new URL(url).pathname;
      if (path === '/speak') {
        // Accepted server-side, but the response never reaches the client.
        throw new Error('connection reset after acceptance');
      }
      if (path === '/status') return Response.json({
        id: location === 'current' ? 'accepted' : 'foreign',
        queue: location === 'queue' ? ['accepted'] : [],
        promoted: location === 'promoted' ? ['accepted'] : [],
      });
      if (path === '/stop') stops.push(JSON.parse(init.body).id);
      return Response.json({ok: true});
    }) as any});
    await assert.rejects(client.request('/speak', {id: 'accepted', text: 'hello'}), /connection reset/);
    await client.shutdown();
    assert.deepEqual(stops, location === 'absent' ? [] : ['accepted'], location);
  }
});

test('S12: an explicit speak rejection retires ownership without waiting for status', async () => {
  const calls: string[] = [];
  const client = new ServerClient({fetch: (async (url: any) => {
    calls.push(new URL(url).pathname);
    return Response.json({error: 'queue full'}, {status: 400});
  }) as any});
  await assert.rejects(client.request('/speak', {id: 'rejected', text: 'hello'}), /queue full/);
  await client.shutdown();
  assert.deepEqual(calls, ['/speak']);
});

test('S12: status cannot forget a speak request still in flight', async () => {
  let release!: () => void;
  const stops: string[] = [];
  const client = new ServerClient({fetch: (async (url: any, init: any) => {
    const path = new URL(url).pathname;
    if (path === '/speak') await new Promise<void>(resolve => { release = resolve; });
    if (path === '/status') return Response.json({id: null});
    if (path === '/stop') stops.push(JSON.parse(init.body).id);
    return Response.json({ok: true});
  }) as any});
  const speaking = client.request('/speak', {id: 'pending', text: 'hello'});
  await client.request('/status');
  const stopping = client.stop();
  await stopping;
  release(); await speaking;
  assert.deepEqual(stops, ['pending']);
});

test('S12: a stale status response cannot forget a speak accepted while it was in flight', async () => {
  let release!: () => void;
  const stops: string[] = [];
  let delayed = true;
  const client = new ServerClient({fetch: (async (url: any, init: any) => {
    const path = new URL(url).pathname;
    if (path === '/status' && delayed) {
      delayed = false;
      await new Promise<void>(resolve => { release = resolve; });
      return Response.json({id: null});
    }
    if (path === '/status') return Response.json({id: 'new'});
    if (path === '/stop') stops.push(JSON.parse(init.body).id);
    return Response.json({ok: true});
  }) as any});
  const stale = client.request('/status');
  await client.request('/speak', {id: 'new', text: 'hello'});
  release(); await stale;
  await client.shutdown();
  assert.deepEqual(stops, ['new']);
});

const slash=(path:string)=>path.replaceAll('\\','/');

function spawnRecorder(spawned:any[],onSpawn:()=>void,error?:Error){
  return ((...args:any[])=>{spawned.push(args); onSpawn(); return {once(_:string,cb:(e:Error)=>void){ if(error) cb(error); },unref(){},kill(){}};}) as any;
}

test('dual boot: Windows falls back to .venv-pocket-windows when .venv-pocket holds Linux',async()=>{
  let healthy=false; const spawned:any[]=[];
  const client=new ServerClient({root:'E:/tehablo',platform:'win32',
    exists:(path:string)=>path.replaceAll('\\','/').endsWith('/.venv-pocket-windows/Scripts/python.exe'),
    fetch:(async()=>{ if(!healthy) throw Error('offline'); return Response.json({ok:true}); }) as any,
    spawn:spawnRecorder(spawned,()=>{healthy=true;}), delay:async()=>{}});
  await client.ensure();
  assert.equal(slash(spawned[0][0]),'E:/tehablo/.venv-pocket-windows/Scripts/python.exe');
});

test('dual boot: .venv-pocket wins over the OS-named environment when both exist',async()=>{
  let healthy=false; const spawned:any[]=[];
  const client=new ServerClient({root:'/tehablo',platform:'linux',exists:()=>true,
    fetch:(async()=>{ if(!healthy) throw Error('offline'); return Response.json({ok:true}); }) as any,
    spawn:spawnRecorder(spawned,()=>{healthy=true;}), delay:async()=>{}});
  await client.ensure();
  assert.ok(slash(spawned[0][0]).endsWith('/tehablo/.venv-pocket/bin/python'));
});

test('missing environment reports every path tried instead of a bare ENOENT',async()=>{
  const spawned:any[]=[];
  const client=new ServerClient({root:'E:/tehablo',platform:'win32',exists:()=>false,
    fetch:(async()=>{ throw Error('offline'); }) as any,
    spawn:spawnRecorder(spawned,()=>{},Object.assign(new Error('spawn ENOENT'),{code:'ENOENT'})), delay:async()=>{}});
  await assert.rejects(client.ensure(),(error:Error)=>{
    assert.match(error.message,/No se encontró el Python del entorno/);
    assert.ok(slash(error.message).includes('E:/tehablo/.venv-pocket/Scripts/python.exe'));
    assert.ok(slash(error.message).includes('E:/tehablo/.venv-pocket-windows/Scripts/python.exe'));
    return true;
  });
  assert.equal(spawned.length,1);
});

/** Fake child that exits right after spawning, like a Python server that crashes on startup. */
function exitingSpawn(spawned:any[]){
  return ((...args:any[])=>{spawned.push(args); return {once(event:string,cb:(code:number)=>void){ if(event==='exit') setImmediate(()=>cb(1)); },unref(){},kill(){}};}) as any;
}

test('slow startup: waits past 30 health checks while the process lives',async()=>{
  let checks=0; const spawned:any[]=[];
  const client=new ServerClient({root:'/tehablo',platform:'linux',exists:()=>true,
    fetch:(async()=>{ if(++checks<=60) throw Error('offline'); return Response.json({ok:true}); }) as any,
    spawn:spawnRecorder(spawned,()=>{}), delay:async()=>{}});
  await client.ensure();
  assert.equal(spawned.length,1);
  assert.equal(checks,61);
});

test('a server that exits on startup fails at once and names the log',async()=>{
  const spawned:any[]=[]; const opened:string[]=[]; const closed:number[]=[];
  const client=new ServerClient({root:'E:/tehablo',platform:'win32',exists:()=>true,
    fetch:(async()=>{ throw Error('offline'); }) as any,
    openLog:(path:string)=>{opened.push(path);return 7;}, closeLog:(fd:number)=>{closed.push(fd);},
    spawn:exitingSpawn(spawned), delay:()=>new Promise(r=>setTimeout(r,1))});
  await assert.rejects(client.ensure(),(error:Error)=>{
    assert.match(slash(error.message),/^El servidor TTS se cerró al arrancar\. Revisa E:\/tehablo\/logs\/tehablo-server\.log\.$/);
    return true;
  });
  assert.deepEqual(opened.map(slash),['E:/tehablo/logs/tehablo-server.log']);
  assert.deepEqual(spawned[0][2].stdio,['ignore',7,7]);
  assert.deepEqual(closed,[7]);
});

test('after the server exits, the next attempt starts a new one',async()=>{
  const spawned:any[]=[];
  const client=new ServerClient({root:'/tehablo',platform:'linux',exists:()=>true,
    fetch:(async()=>{ throw Error('offline'); }) as any,
    spawn:exitingSpawn(spawned), delay:()=>new Promise(r=>setTimeout(r,1))});
  await assert.rejects(client.ensure(),/se cerró al arrancar/);
  await assert.rejects(client.ensure(),/se cerró al arrancar/);
  assert.equal(spawned.length,2);
});

test('an unwritable log falls back to ignored output',async()=>{
  let healthy=false; const spawned:any[]=[];
  const client=new ServerClient({root:'/tehablo',platform:'linux',exists:()=>true,
    fetch:(async()=>{ if(!healthy) throw Error('offline'); return Response.json({ok:true}); }) as any,
    openLog:()=>{throw Error('EACCES');}, spawn:spawnRecorder(spawned,()=>{healthy=true;}), delay:async()=>{}});
  await client.ensure();
  assert.equal(spawned[0][2].stdio,'ignore');
});

test('power off shuts down a server another Pi session started; closing this session leaves it running',async()=>{
  for(const end of ['powerOff','shutdown'] as const) {
    const calls:string[]=[];let spawns=0;
    const client=new ServerClient({root:'/tehablo',platform:'linux',fetch:(async(url:any)=>{calls.push(new URL(url).pathname);return Response.json({ok:true,ready:true});}) as any,
      spawn:(()=>{spawns++;return {once(){},unref(){},kill(){}};}) as any});
    await client.ensure();assert.equal(spawns,0);
    await client[end]();
    assert.deepEqual(calls.slice(-2),end==='powerOff'?['/stop','/shutdown']:['/health'],end);
  }
});
