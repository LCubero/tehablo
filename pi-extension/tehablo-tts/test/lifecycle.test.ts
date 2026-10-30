import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ServerClient} from '../src/server.ts';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

test('default root is two levels above extension, POSIX python, stop only after use',async()=>{
  const defaultClient=new ServerClient();
  assert.equal(defaultClient.root,process.env.TEHABLO_ROOT ?? resolve(fileURLToPath(new URL('../../..',import.meta.url))));
  let healthy=false; const commands:any[]=[]; const calls:string[]=[];
  const client=new ServerClient({root:'/tehablo',platform:'linux',fetch:(async(url:any)=>{
    calls.push(new URL(url).pathname); if(!healthy) throw Error('offline'); return Response.json({ok:true});
  }) as any,spawn:((...args:any[])=>{commands.push(args); healthy=true; return {once(){},unref(){},kill(){}};}) as any});
  await client.stop(); assert.equal(calls.length,0);
  await client.ensure(); assert.match(commands[0][0],/\.venv-pocket[/\\]bin[/\\]python$/);
  await client.shutdown(); assert.deepEqual(calls.slice(-2),['/stop','/shutdown']);
  client.beginSession(); await client.ensure(); await client.shutdown(); assert.equal(commands.length,1);
});

test('failed graceful shutdown kills owned child and reports failure',async()=>{
  let healthy=false,kills=0;
  const client=new ServerClient({fetch:(async(url:any)=>{
    if(!healthy || new URL(url).pathname==='/shutdown') throw Error('sin conexión');
    return Response.json({ok:true});
  }) as any,spawn:(()=>{healthy=true;return {once(){},unref(){},kill(){kills++;}};}) as any});
  await client.ensure(); await assert.rejects(client.shutdown(),/sin conexión/); assert.equal(kills,1);
  await client.shutdown(); assert.equal(kills,1);
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
