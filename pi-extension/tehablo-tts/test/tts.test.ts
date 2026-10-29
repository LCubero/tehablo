import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExtension } from '../src/extension.ts';
import { ServerClient } from '../src/server.ts';
import { cleanText } from '../src/text.ts';

function setup(mode = 'tui') {
  const hooks: any = {}, commands: any = {}, renderers: any = {};
  const entries: any[] = [], calls: any[] = [], notices: any[] = [];
  const fetcher = async (url: any, init: any) => {
    const path = new URL(url).pathname;
    const body = init?.body && JSON.parse(init.body);
    calls.push([path, body]);
    if (path === '/config' && body.speed > 1.5) return new Response(JSON.stringify({error:'Velocidad fuera de rango'}), {status:400});
    return Response.json({ok:true, ready:true, state:'idle', model:'spanish', voice:'voz', speed:1, voices:['voz']});
  };
  const client = new ServerClient({fetch:fetcher as any});
  const ctx: any = {mode, sessionManager:{getBranch:()=>entries}, ui:{notify:(...args:any[])=>notices.push(args), setStatus(){}}};
  const pi: any = {on:(n:any,h:any)=>hooks[n]=h, registerCommand:(n:any,c:any)=>commands[n]=c,
    registerEntryRenderer:(n:any,r:any)=>renderers[n]=r,
    appendEntry:(customType:any,data:any)=>entries.push({type:'custom',customType,data})};
  createExtension(pi, client);
  const emit = async (name:string,event:any={})=>{ await hooks[name](event,ctx); await new Promise(resolve=>setImmediate(resolve)); };
  const command = (args:string)=>commands.tts.handler(args,ctx);
  const finish = async (text='**Hola** [mundo](https://example.org)', stopReason='stop')=>{
    entries.push({type:'message',id:String(entries.length),message:{role:'assistant',stopReason,content:[{type:'text',text}]}});
    await emit('agent_settled',{aborted:false});
  };
  const cards = ()=>entries.filter(e=>e.type==='custom');
  return {calls,notices,emit,command,finish,cards,renderers,ctx};
}
test('clean Markdown, code, links, empty and length',()=>{
  assert.equal(cleanText('# Hola\n```ts\nx()\n```\n- [mundo](https://x.org) y `voz` **clara**'),'Hola. mundo y voz clara');
  assert.equal(cleanText('```solo código```'),'');
  assert.ok(cleanText('a '.repeat(4000)).length<=3000);
});
test('manual controls and numbered/latest playback; off hides controls',async()=>{
  const s=setup(); await s.finish(); await s.finish('Segunda');
  assert.equal(s.cards().length,2); assert.equal(s.calls.length,0);
  const component=s.renderers['tehablo-tts'](s.cards()[0],{}, {fg:(_:any,t:any)=>t});
  assert.match(component.render(100)[0],/\[ ▶ Escuchar \]/);assert.doesNotMatch(component.render(100)[0],/\/tts|\b1\b/);
  await s.command('play 1'); assert.deepEqual(s.calls.at(-1),['/speak',{id:'0',text:'Hola mundo'}]);
  await s.command('play'); assert.equal(s.calls.at(-1)[1].text,'Segunda');
  await s.command('off'); assert.deepEqual(component.render(100),[]);
});
test('auto toggles, skips errors/aborts/empty; new prompt stops',async()=>{
  const s=setup(); await s.command('auto on'); await s.finish();
  assert.equal(s.calls.filter(c=>c[0]==='/speak').length,1);
  await s.command('auto off'); await s.finish('Manual'); await s.finish('Error','error'); await s.finish('```x```');
  assert.equal(s.calls.filter(c=>c[0]==='/speak').length,1);
  await s.emit('agent_settled',{aborted:true}); assert.equal(s.cards().length,2);
  await s.emit('agent_start'); assert.equal(s.calls.at(-1)[0],'/stop');
});
test('playback endpoints, server config error and voices/status',async()=>{
  const s=setup(); for(const c of ['pause','resume','stop']) {await s.command(c); assert.equal(s.calls.at(-1)[0],'/'+c);}
  await s.command('speed 2'); assert.match(s.notices.at(-1)[0],/Velocidad fuera de rango/); assert.equal(s.notices.at(-1)[1],'warning');
  await s.command('voice'); assert.equal(s.calls.at(-1)[0],'/voices');
  await s.command('model spanish_24l'); assert.deepEqual(s.calls.at(-1),['/config',{model:'spanish_24l'}]);
  await s.command(''); assert.match(s.notices.at(-1)[0],/spanish.*voz/s);
});
test('non-interactive modes do nothing',async()=>{
  for(const mode of ['rpc','json','print']) {const s=setup(mode); await s.finish(); await s.command('play'); await s.emit('agent_start'); await s.emit('session_shutdown'); assert.equal(s.calls.length,0); assert.equal(s.cards().length,0);}
});
test('event and command failures become warnings, never escape Pi',async()=>{
  const s=setup();
  const original=s.ctx.sessionManager.getBranch;
  s.ctx.sessionManager.getBranch=()=>{throw Error('historial no disponible');};
  await s.emit('agent_settled',{aborted:false});
  assert.match(s.notices.at(-1)[0],/historial no disponible/);
  await s.command('play'); assert.equal(s.notices.at(-1)[1],'warning');
  s.ctx.sessionManager.getBranch=original;
});
test('health failure spawns once with computed Windows root/python; shutdown owns only child',async()=>{
  let healthy=false, killed=0; const spawned:any[]=[]; const calls:string[]=[];
  const options:any={root:'E:/tehablo', platform:'win32', fetch:async(url:string)=>{calls.push(new URL(url).pathname); if(!healthy) throw Error('offline'); return Response.json({ok:true});}, spawn:(...args:any[])=>{spawned.push(args); healthy=true; return {once(){},unref(){},kill(){killed++;}};}, delay:async()=>{}};
  const c=new ServerClient(options); await Promise.all([c.ensure(),c.ensure()]);
  assert.equal(spawned.length,1); assert.match(spawned[0][0],/E:[/\\]tehablo[/\\]\.venv-pocket[/\\]Scripts[/\\]python.exe$/);
  assert.match(spawned[0][1][0],/src[/\\]tehablo_server.py$/);
  await c.shutdown(); assert.ok(calls.includes('/shutdown')); assert.equal(killed,0);
  calls.length=0; const external=new ServerClient(options); await external.ensure(); await external.shutdown(); assert.ok(!calls.includes('/shutdown'));
});
