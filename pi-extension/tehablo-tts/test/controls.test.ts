import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExtension} from '../src/extension.ts';

function setup() {
  const configs:any[]=[], notices:string[]=[], statuses:(string|undefined)[]=[], settings={volume:1,speed:1,error:null as string|null};
  const hooks:any={}, calls:string[]=[], entries:any[]=[{type:'message',id:'a',message:{role:'assistant',content:'Hola'}} ,{type:'custom',customType:'tehablo-tts',data:{messageId:'a',number:1}}];
  let renderer:any, command:any, state='playing', id:string|null='a', renders=0, fail=false, ready=true, ensures=0;
  const client:any={beginSession(){},ensure:async()=>{ensures++;},stop:async()=>{},shutdown:async()=>{},request:async(path:string)=>{calls.push(path);if(fail)throw Error('offline');if(path==='/health')return {...settings,ready};return {state,id};},action:async(path:string,body:any)=>{calls.push(path);if(path==='/config'){configs.push(body);Object.assign(settings,body);return {...settings,ready};}if(path==='/health')return {...settings,ready};if(path==='/pause')state='paused';if(path==='/resume')state='playing';return {state};}};
  const ctx:any={mode:'tui',sessionManager:{getBranch:()=>entries},ui:{notify(text:string){notices.push(text);},setStatus(_:string,text:string|undefined){renders++;statuses.push(text);}}};
  createExtension({on:(n:string,h:any)=>hooks[n]=h,registerCommand:(_:any,c:any)=>command=c.handler,registerEntryRenderer:(_:any,r:any)=>renderer=r} as any,client);
  hooks.session_start({},ctx);
  const card=renderer(entries[1],{}, {fg:(_:any,t:string)=>t});
  return {calls,card,configs,notices,statuses,line:()=>card.render(200)[0], command:(s:string)=>command(s,ctx),set:(s:string,i:string|null='a')=>{state=s;id=i;},setReady:(value:boolean)=>{ready=value;},setError:(value:string)=>{settings.error=value;},ensures:()=>ensures,close:()=>hooks.session_shutdown({},ctx),agentStart:()=>hooks.agent_start({},ctx),fail:()=>{fail=true;},renders:()=>renders};
}
const tick=()=>new Promise(r=>setTimeout(r,550));
const click=async(card:any,x:number)=>{card.handleMouse({type:'click',button:'left',x,y:0});await new Promise(r=>setImmediate(r));};
const clickAt=async(s:any,text:string,offset=0)=>{const line=s.line();assert.ok(line.includes(text),`${text} in ${line}`);await click(s.card,Array.from(line.slice(0,line.indexOf(text))).length+offset);};
const start=async(s:any)=>{await clickAt(s,'⏻ TTS');await tick();};

test('start button shows Iniciar, then Cargando, then Escuchar when the model is ready',async()=>{
  const s=setup();
  try {
    assert.equal(s.line(),'[ ⏻ TTS ]');assert.equal(s.calls.length,0);assert.equal(s.ensures(),0);
    s.setReady(false);
    await clickAt(s,'⏻ TTS');
    assert.equal(s.ensures(),1);assert.ok(s.calls.includes('/health'));
    assert.equal(s.line(),'[ Cargando… ]');assert.equal(s.statuses.at(-1),'TTS manual · cargando');
    const before=s.ensures();await click(s.card,2);assert.equal(s.ensures(),before);assert.ok(!s.calls.includes('/speak'));
    s.setReady(true);await tick();
    assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ]');assert.equal(s.statuses.at(-1),'TTS manual');
    assert.deepEqual(s.notices,[]);
  } finally {await s.close();}
});

test('model load failure cancels readiness polling and warns',async()=>{
  const s=setup();
  try {
    s.setReady(false);await clickAt(s,'⏻ TTS');
    assert.equal(s.line(),'[ Cargando… ]');
    s.setError('model load failed: broken model');await tick();
    assert.equal(s.line(),'[ ⏻ TTS ]');
    assert.equal(s.statuses.at(-1),'TTS manual');
    assert.deepEqual(s.notices,['TTS: el modelo no cargó: model load failed: broken model']);
    const count=s.calls.length;await tick();assert.equal(s.calls.length,count);
    assert.ok(!s.calls.includes('/speak'));
  } finally {await s.close();}
});

test('failed start returns to Iniciar and reports the error',async()=>{
  const s=setup();
  try {
    s.fail();await clickAt(s,'⏻ TTS');
    assert.equal(s.line(),'[ ⏻ TTS ]');assert.deepEqual(s.notices,['TTS: offline']);
  } finally {await s.close();}
});

test('controls toggle shows and hides volume and speed',async()=>{
  const s=setup();
  try {
    await start(s);
    assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ]');
    await clickAt(s,'[ ⋯ ]',2);
    assert.equal(s.line(),'[ ▶ Escuchar ] [ → ]  Vol [- 100% +]  Vel [- 1.00x +]');
    await clickAt(s,'[ → ]',2);
    assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ]');assert.equal(s.configs.length,0);
  } finally {await s.close();}
});

test('volume and speed buttons, limits and command synchronization',async()=>{
  const s=setup();
  const volDown=()=>clickAt(s,'Vol [-',5), volUp=()=>clickAt(s,'% +]',2), velDown=()=>clickAt(s,'Vel [-',5), velUp=()=>clickAt(s,'x +]',2);
  try {
    await start(s);await clickAt(s,'[ ⋯ ]',2);
    await volDown();assert.deepEqual(s.configs.at(-1),{volume:.9});assert.ok(s.notices.includes('Volumen: 90 %'));assert.match(s.line(),/Vol \[- 90% \+\]/);
    await volUp();assert.deepEqual(s.configs.at(-1),{volume:1});
    await velUp();assert.deepEqual(s.configs.at(-1),{speed:1.1});assert.ok(s.notices.includes('Velocidad: 1.10x'));
    await velUp();assert.deepEqual(s.configs.at(-1),{speed:1.15});
    await velDown();await velDown();assert.deepEqual(s.configs.at(-1),{speed:1});
    const n=s.configs.length;
    for(const [text,offset] of [['Vol [-',0],['100%',0],['100%',3],['Vel [-',0],['1.00x',0]] as const)await clickAt(s,text,offset);
    assert.equal(s.configs.length,n);
    for(let i=0;i<20;i++)await volDown();assert.equal(s.configs.at(-1).volume,.1);
    for(let i=0;i<20;i++)await volUp();assert.equal(s.configs.at(-1).volume,1.5);
    for(let i=0;i<8;i++)await velDown();assert.equal(s.configs.at(-1).speed,1);
    for(let i=0;i<8;i++)await velUp();assert.equal(s.configs.at(-1).speed,1.5);
    await s.command('speed 1.25');assert.match(s.line(),/Vel \[- 1\.25x \+\]/);
    await s.command('speed 0.9');await velDown();assert.equal(s.configs.at(-1).speed,.9);await velUp();assert.equal(s.configs.at(-1).speed,1);
    await clickAt(s,'Escuchar');assert.ok(s.calls.includes('/speak'));
  } finally {await s.close();}
});

test('active states use icons, pause/resume/stop clicks and command fallbacks',async()=>{
  const s=setup();
  try {
    await start(s);
    await s.command('play 1'); await tick();
    assert.equal(s.line(),'[ ‖ ] [ ■ ] [ ⋯ ]');
    const before=s.calls.length;
    await click(s.card,5);await click(s.card,199);assert.equal(s.calls.length,before);
    await click(s.card,2);assert.ok(s.calls.includes('/pause'));assert.equal(s.line(),'[ ▶ ] [ ■ ] [ ⋯ ]');
    await click(s.card,2);assert.ok(s.calls.includes('/resume'));assert.equal(s.line(),'[ ‖ ] [ ■ ] [ ⋯ ]');
    await clickAt(s,'[ ⋯ ]',2);assert.equal(s.line(),'[ ‖ ] [ ■ ] [ → ]  Vol [- 100% +]  Vel [- 1.00x +]');
    await click(s.card,8);assert.ok(s.calls.includes('/stop'));assert.equal(s.line(),'[ ▶ Escuchar ] [ → ]  Vol [- 100% +]  Vel [- 1.00x +]');
    for(const state of ['loading','generating','playing','paused']) {
      s.set(state);await s.command('play 1');await tick();
      assert.match(s.line(),state==='paused'?/^\[ ▶ \] \[ ■ \]/:/^\[ ‖ \] \[ ■ \]/);
    }
    s.set('playing','other');await tick();assert.match(s.line(),/^\[ ▶ Escuchar \]/);
    s.set('idle',null);await tick();const count=s.calls.length;await tick();assert.equal(s.calls.length,count);
    assert.ok(s.renders()>0);
  } finally {await s.close();}
});

test('play from a stopped server starts it without pressing Iniciar',async()=>{
  const s=setup();
  try {
    await s.command('play 1');assert.equal(s.ensures(),1);assert.ok(s.calls.includes('/speak'));
    await tick();assert.equal(s.line(),'[ ‖ ] [ ■ ] [ ⋯ ]');
  } finally {await s.close();}
});

test('no polling before playback or after lifecycle stop',async()=>{
 const s=setup();try {await tick();assert.equal(s.calls.length,0);await s.command('play');await tick();s.fail();await tick();await s.agentStart();assert.match(s.line(),/Escuchar/);const n=s.calls.length;await tick();assert.equal(s.calls.length,n);}finally{await s.close();}
});
