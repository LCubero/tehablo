import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExtension} from '../src/extension.ts';

function setup() {
  const configs:any[]=[], notices:string[]=[], settings={volume:1,speed:1};
  const hooks:any={}, calls:string[]=[], entries:any[]=[{type:'message',id:'a',message:{role:'assistant',content:'Hola'}} ,{type:'custom',customType:'tehablo-tts',data:{messageId:'a',number:1}}];
  let renderer:any, command:any, state='playing', id:string|null='a', renders=0, fail=false;
  const client:any={beginSession(){},ensure:async()=>{},stop:async()=>{},shutdown:async()=>{},request:async(path:string)=>{calls.push(path);if(fail && path==='/status')throw Error('offline');return {state,id};},action:async(path:string,body:any)=>{calls.push(path);if(path==='/config'){configs.push(body);Object.assign(settings,body);return {...settings};}if(path==='/health')return {...settings};if(path==='/pause')state='paused';if(path==='/resume')state='playing';return {state};}};
  const ctx:any={mode:'tui',sessionManager:{getBranch:()=>entries},ui:{notify(text:string){notices.push(text);},setStatus(){renders++;}}};
  createExtension({on:(n:string,h:any)=>hooks[n]=h,registerCommand:(_:any,c:any)=>command=c.handler,registerEntryRenderer:(_:any,r:any)=>renderer=r} as any,client);
  hooks.session_start({},ctx);
  const card=renderer(entries[1],{}, {fg:(_:any,t:string)=>t});
  return {calls,card,configs,notices, command:(s:string)=>command(s,ctx),set:(s:string,i:string|null='a')=>{state=s;id=i;},close:()=>hooks.session_shutdown({},ctx),agentStart:()=>hooks.agent_start({},ctx),fail:()=>{fail=true;},renders:()=>renders};
}
test('volume and speed buttons, gaps, limits and command synchronization',async()=>{
 const s=setup();
 const press=async(label:string)=>{const line=s.card.render(200)[0];await click(s.card,Array.from(line.slice(0,line.indexOf(label))).length+2);};
 try {
  assert.match(s.card.render(200)[0],/\[ Vol − \] 100 % \[ Vol \+ \].*\[ Vel − \] 1x \[ Vel \+ \]/);
  await press('[ Vol − ]');assert.deepEqual(s.configs.at(-1),{volume:.9});assert.ok(s.notices.includes('Volumen: 90 %'));
  await press('[ Vol + ]');assert.deepEqual(s.configs.at(-1),{volume:1});
  await press('[ Vel − ]');assert.deepEqual(s.configs.at(-1),{speed:.9});
  await press('[ Vel + ]');assert.deepEqual(s.configs.at(-1),{speed:1});
  const n=s.configs.length;
  for(const value of ['100 %','1x']){const line=s.card.render(200)[0];await click(s.card,Array.from(line.slice(0,line.indexOf(value))).length);}
  assert.equal(s.configs.length,n);
  for(let i=0;i<20;i++)await press('[ Vol − ]');assert.equal(s.configs.at(-1).volume,.1);
  for(let i=0;i<20;i++)await press('[ Vol + ]');assert.equal(s.configs.at(-1).volume,1.5);
  for(let i=0;i<8;i++)await press('[ Vel − ]');assert.equal(s.configs.at(-1).speed,.75);
  for(let i=0;i<8;i++)await press('[ Vel + ]');assert.equal(s.configs.at(-1).speed,1.5);
  await s.command('speed 1.25');assert.match(s.card.render(200)[0],/1.25x/);
  await click(s.card,2);assert.ok(s.calls.includes('/speak'));
 }finally{await s.close();}
});
const tick=()=>new Promise(r=>setTimeout(r,550));
const click=async(card:any,x:number)=>{card.handleMouse({type:'click',button:'left',x,y:0});await new Promise(r=>setImmediate(r));};
test('active states, pause/resume/stop clicks and command fallbacks',async()=>{
  const s=setup();
  try {
    assert.match(s.card.render(150)[0],/Escuchar/);
    await s.command('play 1'); await tick();
    assert.match(s.card.render(150)[0],/Pausar.*Detener/);assert.doesNotMatch(s.card.render(150)[0],/\/tts/);
    const before=s.calls.length;
    await click(s.card,12);await click(s.card,149);assert.equal(s.calls.length,before);
    await click(s.card,2);assert.ok(s.calls.includes('/pause'));assert.match(s.card.render(150)[0],/Continuar/);
    await click(s.card,2);assert.ok(s.calls.includes('/resume'));assert.match(s.card.render(150)[0],/Pausar/);
    await click(s.card,17);assert.ok(s.calls.includes('/stop'));assert.match(s.card.render(150)[0],/Escuchar/);
    for(const state of ['loading','generating','playing','paused']) {
      s.set(state);await s.command('play 1');await tick();
      assert.match(s.card.render(150)[0],state==='paused'?/Continuar/:/Pausar/);
    }
    s.set('playing','other');await tick();assert.match(s.card.render(150)[0],/Escuchar/);
    s.set('idle',null);await tick();const count=s.calls.length;await tick();assert.equal(s.calls.length,count);
    assert.ok(s.renders()>0);
  } finally {await s.close();}
});
test('no polling before playback or after lifecycle stop',async()=>{
 const s=setup();try {await tick();assert.equal(s.calls.length,0);await s.command('play');await tick();s.fail();await tick();await s.agentStart();assert.match(s.card.render(150)[0],/Escuchar/);const n=s.calls.length;await tick();assert.equal(s.calls.length,n);}finally{await s.close();}
});
