import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExtension, memoryStore, readTable} from '../src/extension.ts';
import {mkdtempSync, writeFileSync, rmSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DEFAULTS} from '../src/settings.ts';

function setup(store=memoryStore()) {
  const windows:any[]=[], keyHandlers:any[]=[];
  const configs:any[]=[], notices:string[]=[], statuses:(string|undefined)[]=[], settings={volume:1,speed:1,error:null as string|null};
  const hooks:any={}, calls:string[]=[], entries:any[]=[{type:'message',id:'a',message:{role:'assistant',content:'Hola'}} ,{type:'custom',customType:'tehablo-tts',data:{messageId:'a',number:1}}];
  let renderer:any, command:any, state='playing', id:string|null='a', renders=0, fail=false, ready=true, ensures=0;
  const client:any={beginSession(){},ensure:async()=>{ensures++;},stop:async()=>{},shutdown:async()=>{},powerOff:async()=>{calls.push('/shutdown');},request:async(path:string)=>{calls.push(path);if(fail)throw Error('offline');if(path==='/health')return {...settings,ready};return {state,id,error:settings.error};},action:async(path:string,body:any)=>{calls.push(path);if(path==='/config'){configs.push(body);Object.assign(settings,body);return {...settings,ready};}if(path==='/health')return {...settings,ready};if(path==='/pause')state='paused';if(path==='/resume')state='playing';return {state};}};
  const ctx:any={mode:'tui',sessionManager:{getBranch:()=>entries},ui:{onTerminalInput:(h:any)=>{keyHandlers.push(h);return()=>{keyHandlers.splice(keyHandlers.indexOf(h),1);};},custom:async(factory:any,options:any)=>{const w=factory({requestRender(){}},{fg:(_:any,t:string)=>t},{matches:()=>false},()=>{});windows.push({w,options});},notify(text:string){notices.push(text);},setStatus(_:string,text:string|undefined){renders++;statuses.push(text);}}};
  createExtension({on:(n:string,h:any)=>hooks[n]=h,registerCommand:(_:any,c:any)=>command=c.handler,registerEntryRenderer:(_:any,r:any)=>renderer=r} as any,client,store);
  hooks.session_start({},ctx);
  const card=renderer(entries[1],{}, {fg:(_:any,t:string)=>t});
  return {store,windows,keyHandlers,press:(d:string)=>keyHandlers.map(h=>h(d)),client,calls,card,configs,notices,statuses,line:()=>card.render(200)[0], command:(s:string)=>command(s,ctx),set:(s:string,i:string|null='a')=>{state=s;id=i;},setReady:(value:boolean)=>{ready=value;},setError:(value:string)=>{settings.error=value;},ensures:()=>ensures,close:()=>hooks.session_shutdown({},ctx),agentStart:()=>hooks.agent_start({},ctx),fail:(value=true)=>{fail=value;},renders:()=>renders};
}
test('every start button column is clickable, including normal spaces and brackets',async()=>{
  for(let x=0;x<Array.from('[ ⏻ TTS ]').length;x++) {
    const s=setup();try {await click(s.card,x);assert.equal(s.ensures(),1,`column ${x}`);assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ] [.⚙ ]');}finally{await s.close();}
  }
});

test('expanded controls end with power off, release idle or playing server and allow restart',async()=>{
  for(const playing of [false,true]) {
    const s=setup();try {
      await clickAt(s,'⏻ TTS');if(playing)await s.command('play');
      assert.ok(!s.line().includes('[ ⏻ ]'));
      await clickAt(s,'[ ⋯ ]');assert.ok(s.line().endsWith('Vel [- 1.00x +] [ ⏻ ] [.⚙ ]'));
      await clickAt(s,'[ ⏻ ]');assert.deepEqual(s.calls.filter((p:string)=>p==='/shutdown'),['/shutdown']);
      assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');const count=s.calls.length;await tick();assert.equal(s.calls.length,count);
      await clickAt(s,'⏻ TTS');assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ] [.⚙ ]');
      await clickAt(s,'Escuchar');assert.ok(s.calls.includes('/speak'));assert.deepEqual(s.notices,[]);
    }finally{await s.close();}
  }
});

test('power off invalidates pending boot, readiness and playback responses',async()=>{
  for(const pending of ['boot','ready','poll']) {
    const s=setup();let resolve!:(value:any)=>void;
    try {
      await clickAt(s,'⏻ TTS');
      if(pending!=='boot')await s.command('play');
      await clickAt(s,'[ ⋯ ]');
      if(pending==='ready') {s.setReady(false);await clickAt(s,'% +]',2);}
      const request=s.client.request;
      s.client.request=async(path:string)=>path===(pending==='poll'?'/status':'/health')
        ? new Promise(r=>{resolve=r;}) : request(path);
      if(pending==='boot') {void s.command('play');await new Promise(r=>setImmediate(r));}
      else await tick();
      assert.equal(typeof resolve,'function');
      await clickAt(s,'[ ⏻ ]');const count=s.calls.length;
      resolve(pending==='poll'?{state:'playing',id:'a'}:{ready:true,volume:1.5,speed:1.5});
      await new Promise(r=>setImmediate(r));await tick();
      assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');assert.equal(s.calls.length,count);assert.deepEqual(s.notices.filter((n:string)=>n.startsWith('TTS:')),[]);
    }finally{await s.close();}
  }
});

for(const [command,path] of [['speed 1.25','/config'],['model spanish_24l','/config'],['voice lola','/config'],['voice','/voices'],['','/health'],['','/status']] as const) {
  test(`power off ignores pending command ${command || 'status'} at ${path}`,async()=>{
    const s=setup();let resolve!:(value:any)=>void;
    try {
      await clickAt(s,'⏻ TTS');await clickAt(s,'[ ⋯ ]');
      const action=s.client.action;
      s.client.action=async(p:string,body:any)=>p===path?new Promise(r=>{resolve=r;}):action(p,body);
      const pending=s.command(command);
      await new Promise(r=>setImmediate(r));assert.equal(typeof resolve,'function');
      await clickAt(s,'[ ⏻ ]');const count=s.calls.length;
      resolve({ready:true,volume:1.5,speed:1.25,model:'spanish_24l',voice:'lola',voices:['lola'],state:'idle'});
      await pending;
      assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');assert.equal(s.calls.length,count);assert.deepEqual(s.notices,[]);
    }finally{await s.close();}
  });
}

test('config and status commands still synchronize and report successful results',async()=>{
  const s=setup();try {
    const action=s.client.action;
    s.client.action=async(path:string,body:any)=>({...await action(path,body),model:'spanish',voice:'lola',voices:['lola']});
    for(const [command,body] of [['speed 1.25',{speed:1.25}],['model spanish_24l',{model:'spanish_24l'}],['voice lola',{voice:'lola'}]] as const) {
      await s.command(command);assert.deepEqual(s.configs.at(-1),body);
      assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ] [.⚙ ]');
      assert.equal(s.notices.at(-1),'Modelo: spanish · voz: lola · velocidad: 1.25 · volumen: 100 %');
    }
    await s.command('voice');assert.equal(s.notices.at(-1),'Voces: lola');
    await clickAt(s,'[ ⋯ ]');assert.match(s.line(),/Vel \[- 1\.25x \+\]/);
    await s.command('');assert.match(s.notices.at(-1)!,/^TTS: activado · automático: no\nServidor: playing · listo: sí\nModelo: spanish · voz: lola · velocidad: 1.25 · volumen: 100 %\n/);
    assert.deepEqual(s.calls.slice(-2),['/health','/status']);
  }finally{await s.close();}
});

const tick=()=>new Promise(r=>setTimeout(r,550));
const click=async(card:any,x:number)=>{card.handleMouse({type:'click',button:'left',x,y:0});await new Promise(r=>setImmediate(r));};
const clickAt=async(s:any,text:string,offset=0)=>{const line=s.line();assert.ok(line.includes(text),`${text} in ${line}`);await click(s.card,Array.from(line.slice(0,line.indexOf(text))).length+offset);};
const start=async(s:any)=>{await clickAt(s,'⏻ TTS');await tick();};

test('speech failure warns once and resets playback',async()=>{
  const s=setup();try {
    await s.command('play');s.set('idle',null);s.setError('speech failed: broken playback');
    await tick();
    assert.deepEqual(s.notices,['TTS: no se pudo reproducir: speech failed: broken playback']);
    assert.match(s.line(),/Escuchar/);
    const count=s.calls.length;await tick();assert.equal(s.calls.length,count);
    assert.equal(s.notices.length,1);
  }finally{await s.close();}
});

test('three consecutive status failures stop playback; success resets the count',async()=>{
  const s=setup();try {
    await s.command('play');s.fail();await tick();await tick();
    assert.deepEqual(s.notices,[]);assert.match(s.line(),/■/);
    s.fail(false);await tick();s.fail();await tick();await tick();
    assert.deepEqual(s.notices,[]);assert.match(s.line(),/■/);
    await tick();assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');
    assert.deepEqual(s.notices,['TTS: se perdió la conexión con el servidor. Revisa logs/tehablo-server.log.']);
    const count=s.calls.length;await tick();assert.equal(s.calls.length,count);assert.equal(s.notices.length,1);
  }finally{await s.close();}
});

test('start button shows Iniciar, then Cargando, then Escuchar when the model is ready',async()=>{
  const s=setup();
  try {
    assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');assert.equal(s.calls.length,0);assert.equal(s.ensures(),0);
    s.setReady(false);
    await clickAt(s,'⏻ TTS');
    assert.equal(s.ensures(),1);assert.ok(s.calls.includes('/health'));
    assert.equal(s.line(),'[ Cargando… ] [.⚙ ]');assert.equal(s.statuses.at(-1),'TTS manual · cargando');
    const before=s.ensures();await click(s.card,2);assert.equal(s.ensures(),before);assert.ok(!s.calls.includes('/speak'));
    s.setReady(true);await tick();
    assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ] [.⚙ ]');assert.equal(s.statuses.at(-1),'TTS manual');
    assert.deepEqual(s.notices,[]);
  } finally {await s.close();}
});

test('model load failure cancels readiness polling and warns',async()=>{
  const s=setup();
  try {
    s.setReady(false);await clickAt(s,'⏻ TTS');
    assert.equal(s.line(),'[ Cargando… ] [.⚙ ]');
    s.setError('model load failed: broken model');await tick();
    assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');
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
    assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');assert.deepEqual(s.notices,['TTS: offline']);
  } finally {await s.close();}
});

test('controls toggle shows and hides volume and speed',async()=>{
  const s=setup();
  try {
    await start(s);
    assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ] [.⚙ ]');
    await clickAt(s,'[ ⋯ ]',2);
    assert.equal(s.line(),'[ ▶ Escuchar ] [ → ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ] [.⚙ ]');
    await clickAt(s,'[ → ]',2);
    assert.equal(s.line(),'[ ▶ Escuchar ] [ ⋯ ] [.⚙ ]');assert.equal(s.configs.length,0);
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
    assert.equal(s.line(),'[ ‖ ] [ ■ ] [ ⋯ ] [.⚙ ]');
    const before=s.calls.length;
    await click(s.card,5);await click(s.card,199);assert.equal(s.calls.length,before);
    await click(s.card,2);assert.ok(s.calls.includes('/pause'));assert.equal(s.line(),'[ ▶ ] [ ■ ] [ ⋯ ] [.⚙ ]');
    await click(s.card,2);assert.ok(s.calls.includes('/resume'));assert.equal(s.line(),'[ ‖ ] [ ■ ] [ ⋯ ] [.⚙ ]');
    await clickAt(s,'[ ⋯ ]',2);assert.equal(s.line(),'[ ‖ ] [ ■ ] [ → ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ] [.⚙ ]');
    await click(s.card,8);assert.ok(s.calls.includes('/stop'));assert.equal(s.line(),'[ ▶ Escuchar ] [ → ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ] [.⚙ ]');
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
    await tick();assert.equal(s.line(),'[ ‖ ] [ ■ ] [ ⋯ ] [.⚙ ]');
  } finally {await s.close();}
});

test('no polling before playback or after lifecycle stop',async()=>{
 const s=setup();try {await tick();assert.equal(s.calls.length,0);await s.command('play');await tick();s.fail();await tick();await s.agentStart();assert.match(s.line(),/Escuchar/);const n=s.calls.length;await tick();assert.equal(s.calls.length,n);}finally{await s.close();}
});

test('[.⚙ ] opens the centered settings window with the server off; choices are saved, not sent',async()=>{
  const s=setup();try {
    assert.equal(s.line(),'[ ⏻ TTS ] [.⚙ ]');
    await clickAt(s,'[.⚙ ]');
    assert.equal(s.windows.length,1);assert.deepEqual(s.windows[0].options,{overlay:true,overlayOptions:{anchor:'center',width:72}});
    assert.equal(s.ensures(),0);
    const w=s.windows[0].w;
    w.c.change('volume',0.75);w.c.change('auto',true);
    w.c.choose({name:'Iker',voice:'Iker',model:'phonon',kind:'account',note:'España',downloaded:true});
    await tick();
    assert.equal(s.calls.length,0);assert.equal(s.ensures(),0);
    const saved=s.store.load();
    assert.deepEqual([saved.volume,saved.auto,saved.model,saved.voice],[0.75,true,'phonon','Iker']);
    assert.equal(s.statuses.at(-1),'TTS auto');
  }finally{await s.close();}
});

test('saved voice, volume and speed are applied once after the server starts',async()=>{
  const store=memoryStore();store.save({...DEFAULTS,model:'phonon',voice:'Iker',volume:0.75,speed:1.25});
  const s=setup(store);try {
    await start(s);
    assert.deepEqual(s.configs,[{model:'phonon',voice:'Iker',volume:0.75,speed:1.25}]);
    await tick();assert.equal(s.configs.length,1);
  }finally{await s.close();}
});

test('inline volume buttons and /tts commands keep the saved settings in sync',async()=>{
  const s=setup();try {
    await start(s);await clickAt(s,'[ ⋯ ]',2);await clickAt(s,'% +]',2);
    assert.equal(s.store.load().volume,1.1);
    await s.command('auto on');assert.equal(s.store.load().auto,true);
    await s.command('speed 1.25');assert.equal(s.store.load().speed,1.25);
  }finally{await s.close();}
});

test('shortcuts run their action only when enabled, are consumed, and stop after the session ends',async()=>{
  const store=memoryStore();store.save({...DEFAULTS,shortcutsOn:true,shortcuts:{stop:'ctrl+alt+s',settings:'ctrl+alt+o',auto:'alt+a'}});
  const s=setup(store);try {
    assert.equal(s.keyHandlers.length,1);
    assert.deepEqual(s.press('x'),[undefined]);
    s.press('\x1b\x13');await tick();assert.equal(s.ensures(),0);assert.equal(s.calls.length,0);
    await start(s);
    assert.deepEqual(s.press('\x1b\x13'),[{consume:true}]);await tick();
    assert.ok(s.calls.includes('/stop'));
    s.press('\x1ba');assert.equal(s.store.load().auto,true);assert.equal(s.statuses.at(-1),'TTS auto');
    s.press('\x1b\x0f');await new Promise(r=>setImmediate(r));assert.equal(s.windows.length,1);
    store.save({...store.load(),shortcutsOn:false});
  }finally{await s.close();}
  assert.equal(s.keyHandlers.length,0);
});

test('with shortcuts off nothing is intercepted',async()=>{
  const store=memoryStore();store.save({...DEFAULTS,shortcutsOn:false,shortcuts:{stop:'ctrl+alt+s'}});
  const s=setup(store);try {
    assert.deepEqual(s.press('\x1b\x13'),[undefined]);assert.equal(s.calls.length,0);
  }finally{await s.close();}
});

test('with the server off the window lists the shared table and marks the start voice',async()=>{
  const table=[{name:'lola',voice:'lola',model:'spanish',kind:'download',note:'la de siempre',downloaded:null,default:true},
    {name:'Regina',voice:'Regina',model:'phonon',kind:'account',note:'México',downloaded:null}];
  const s=setup(memoryStore(table));try {
    await clickAt(s,'[.⚙ ]');
    const w=s.windows[0].w;
    assert.deepEqual(w.c.voices().map((v:any)=>v.name),['lola','Regina']);
    assert.deepEqual(w.c.active(),{model:'spanish',voice:'lola'});
    w.c.choose(table[1]);assert.deepEqual(w.c.active(),{model:'phonon',voice:'Regina'});
  }finally{await s.close();}
});

test('the server voice and its download states are used once known',async()=>{
  const table=[{name:'lola',voice:'lola',model:'spanish',kind:'download',note:'la de siempre',downloaded:null,default:true}];
  const s=setup(memoryStore(table));try {
    const request=s.client.request;
    s.client.request=async(path:string,body:any)=>path==='/voices'?{voices:['lola'],catalog:[{...table[0],downloaded:true}]}:
      path==='/health'?{...await request(path,body),model:'spanish',voice:'other'}:request(path,body);
    await start(s);await clickAt(s,'[.⚙ ]');
    const w=s.windows[0].w;
    assert.equal(w.c.voices()[0].downloaded,true);
    assert.deepEqual(w.c.active(),{model:'spanish',voice:'other'});
  }finally{await s.close();}
});

test('the shared table maps included voices (with a source) to their .safetensors file', () => {
  const base = join(process.cwd(), '.repo-harness', 'tmp');
  mkdirSync(base, {recursive: true});
  const dir = mkdtempSync(join(base, 'table-'));
  try {
    const path = join(dir, 'voice_table.json');
    writeFileSync(path, JSON.stringify([
      {name: 'lola', model: 'spanish', kind: 'download', note: 'la de siempre', default: true},
      {name: 'Regina', model: 'phonon', kind: 'account', note: 'México'},
      {name: 'Facundo', model: 'spanish', kind: 'download', note: 'Argentina', source: 'ar-hombre-4310'}]));
    assert.deepEqual(readTable(path).map(v => v.voice), ['lola', 'Regina', 'Facundo.safetensors']);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
