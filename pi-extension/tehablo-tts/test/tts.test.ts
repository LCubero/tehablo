import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExtension, memoryStore } from '../src/extension.ts';
import { ServerClient } from '../src/server.ts';
import { cleanText } from '../src/text.ts';

function setup(mode = 'tui', clipboard?: () => Promise<string>) {
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
  const ctx: any = {mode, sessionManager:{getBranch:()=>entries}, ui:{notify:(...args:any[])=>notices.push(args), setStatus(){}, setWidget(){}}};
  const pi: any = {on:(n:any,h:any)=>hooks[n]=h, registerCommand:(n:any,c:any)=>commands[n]=c,
    registerEntryRenderer:(n:any,r:any)=>renderers[n]=r,
    appendEntry:(customType:any,data:any)=>entries.push({type:'custom',customType,data})};
  createExtension(pi, client, memoryStore(), clipboard);
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
test('table rows become sentences without alignment rows or empty cells',()=>{
  assert.equal(cleanText('| Texto | Se lee |\n|---|---|\n| `test` | "testtech" |'),
    'Texto, Se lee. test, "testtech"');
  assert.equal(cleanText('| A | B |\n| :--- | ---: |\n| uno | | dos |\n| a\\|b | c |'),
    'A, B. uno, dos. a b, c');
});
test('underscore emphasis is removed but intra-word underscores survive',()=>{
  assert.equal(cleanText('_italic_ __bold__ _a_ __b__ test_tech snake_case_name `test_tech` **clara** ~~fin~~'),
    'italic bold a b test_tech snake_case_name test_tech clara fin');
  assert.equal(cleanText('| Texto | Se lee |\n|---|---|\n| `test_tech` | "testtech" |'),
    'Texto, Se lee. test_tech, "testtech"');
});
test('separators headings and lists retain cleaning with a table',()=>{
  assert.equal(cleanText('# Hola\n---\n- uno\n| A | B |\n|---|---|\n| dos | tres |\n> fin'),
    'Hola. uno. A, B. dos, tres. fin');
});
test('bare URLs survive cleaning; Markdown labels and code rules remain',()=>{
  assert.equal(cleanText('Ver https://github.com/LCubero/tehablo. y www.example.org'),
    'Ver https://github.com/LCubero/tehablo. y www.example.org');
  assert.equal(cleanText('[guía](https://example.org) ```https://hidden.org``` <b>fin</b>'), 'guía fin');
});
test('manual controls and numbered/latest playback; off hides controls',async()=>{
  const s=setup(); await s.finish(); await s.finish('Segunda');
  assert.equal(s.cards().length,2); assert.equal(s.calls.length,0);
  const component=s.renderers['tehablo-tts'](s.cards()[0],{}, {fg:(_:any,t:any)=>t});
  assert.equal(component.render(100)[0],' [ ⏻ TTS ] [ ≡ ]');assert.doesNotMatch(component.render(100)[0],/\/tts|\b1\b(?!\.\d)/);
  await s.command('play 1'); assert.deepEqual(s.calls.at(-1),['/speak',{id:'0',text:'Hola mundo'}]);
  await s.command('play'); assert.equal(s.calls.at(-1)[1].text,'Segunda');
  assert.equal(component.render(100)[0],' [ ▶ ] [ ▶ copiado ] [ ⋯ ]');
  await s.command('toolbar'); assert.deepEqual(component.render(100),[]);
});
test('auto toggles, skips errors/aborts/empty; new prompt stops',async()=>{
  const s=setup(); await s.command('auto on'); await s.finish();
  assert.equal(s.calls.filter(c=>c[0]==='/speak').length,1);
  await s.command('auto off'); await s.finish('Manual'); await s.finish('Error','error'); await s.finish('```x```');
  assert.equal(s.calls.filter(c=>c[0]==='/speak').length,1);
  await s.emit('agent_settled',{aborted:true}); assert.equal(s.cards().length,2);
  await s.emit('agent_start'); assert.equal(s.calls.at(-1)[0],'/stop');
});
test('[ Leer copiado ] reads the copied text in that bar; an empty or unreadable clipboard only warns',async()=>{
  let copied:any='**Hola** copiado';
  const s=setup('tui',async()=>{ if(copied instanceof Error) throw copied; return copied; });
  await s.finish(); await s.command('play'); await s.command('stop');
  const component=s.renderers['tehablo-tts'](s.cards()[0],{}, {fg:(_:any,t:any)=>t});
  const press=async()=>{const line=component.render(100)[0]; assert.ok(line.includes('[ ▶ copiado ]'),line);
    component.handleMouse({type:'click',button:'left',x:Array.from(line.slice(0,line.indexOf('▶ copiado'))).length,y:0});
    await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));};
  await press(); assert.deepEqual(s.calls.at(-1),['/speak',{id:'0',text:'Hola copiado'}]);
  assert.match(component.render(100)[0],/^ \[ ‖ \] \[ ■ \]/);
  await s.command('stop'); const speaks=()=>s.calls.filter(c=>c[0]==='/speak').length; const before=speaks();
  copied='  '; await press(); assert.deepEqual(s.notices.at(-1),['TTS TeHablo: El portapapeles está vacío.','warning']);
  copied=new Error('No se pudo leer el portapapeles: instala wl-clipboard o xclip.'); await press();
  assert.deepEqual(s.notices.at(-1),['TTS TeHablo: No se pudo leer el portapapeles: instala wl-clipboard o xclip.','warning']);
  assert.equal(speaks(),before);
});
test('before the first response the bar shows above the editor, and a hidden bar stays hidden on reopen',async()=>{
  const s=setup(), widgets:any={}, theme={fg:(_:any,t:any)=>t};
  s.ctx.ui.setWidget=(key:string,content:any)=>{widgets[key]=content;}; s.ctx.ui.onTerminalInput=()=>()=>{};
  const startBar=()=>widgets['tehablo-tts']?.({},theme).render(100);
  await s.emit('session_start');
  assert.deepEqual(startBar(),[' [ ⏻ TTS ] [ ≡ ]','']);
  // Nothing to read yet, so the start bar offers only the copied text.
  await s.command(''); assert.deepEqual(startBar(),[' [ ▶ copiado ] [ ⋯ ]','']);
  await s.finish(); assert.equal(widgets['tehablo-tts'],undefined); assert.equal(s.cards().length,1);
  await s.command('toolbar'); await s.emit('session_start');
  const component=s.renderers['tehablo-tts'](s.cards()[0],{},theme);
  assert.deepEqual(component.render(100),[]); assert.equal(widgets['tehablo-tts'],undefined);
  await s.command('toolbar'); assert.equal(component.render(100)[0],' [ ⏻ TTS ] [ ≡ ]');
});
test('a hidden toolbar only hides the bar: auto reading and play still work',async()=>{
  const s=setup(); await s.command('toolbar'); await s.command('auto'); await s.finish();
  assert.equal(s.calls.filter(c=>c[0]==='/speak').length,1);
  await s.command('play 1'); assert.equal(s.calls.filter(c=>c[0]==='/speak').length,2);
  assert.ok(!s.calls.some(c=>c[0]==='/stop'));
});
test('/tts auto alone toggles auto reading',async()=>{
  const s=setup(); await s.command('auto'); assert.equal(s.notices.at(-1)[0],'TTS TeHablo: Lectura automática: sí');
  await s.finish(); assert.equal(s.calls.filter(c=>c[0]==='/speak').length,1);
  await s.command('auto'); assert.equal(s.notices.at(-1)[0],'TTS TeHablo: Lectura automática: no');
  await s.finish('Manual'); assert.equal(s.calls.filter(c=>c[0]==='/speak').length,1);
  await s.command('auto x'); assert.equal(s.notices.at(-1)[0],'TTS TeHablo: Uso: /tts auto');
});
test('playback endpoints and status',async()=>{
  const s=setup(); await s.command('pause'); await s.command('stop'); assert.equal(s.calls.length,0);
  await s.finish(); await s.command('play'); await s.command('stop'); assert.equal(s.calls.at(-1)[0],'/stop');
  await s.command('status'); assert.match(s.notices.at(-1)[0],/spanish.*voz/s);
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
