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
