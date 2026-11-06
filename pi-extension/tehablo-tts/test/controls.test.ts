import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExtension, fileStore, memoryStore, readTable} from '../src/extension.ts';
import {mkdtempSync, writeFileSync, rmSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DEFAULTS} from '../src/settings.ts';
import {ServerClient} from '../src/server.ts';

function setup(store=memoryStore(),clipboard?:()=>Promise<string>,watchMs=0) {
  const windows:any[]=[], keyHandlers:any[]=[];
  const configs:any[]=[], notices:string[]=[], statuses:(string|undefined)[]=[], settings={volume:1,speed:1,error:null as string|null,fallback:null as string|null};
  const hooks:any={}, calls:string[]=[], entries:any[]=[{type:'message',id:'a',message:{role:'assistant',content:'Hola'}} ,{type:'custom',customType:'tehablo-tts',data:{messageId:'a',number:1}}];
  let renderer:any, command:any, state='playing', id:string|null='a', renders=0, fail=false, ready=true, ensures=0;
  const client:any={beginSession(){},ensure:async()=>{ensures++;},stop:async()=>{},shutdown:async()=>{},powerOff:async()=>{calls.push('/shutdown');},request:async(path:string)=>{calls.push(path);if(fail)throw Error('offline');if(path==='/health')return {...settings,ready};return {state,id,error:settings.error};},action:async(path:string,body:any)=>{calls.push(path);if(path==='/config'){configs.push(body);Object.assign(settings,body);return {...settings,ready};}if(path==='/health')return {...settings,ready};if(path==='/pause')state='paused';if(path==='/resume')state='playing';return {state};}};
  const ctx:any={mode:'tui',sessionManager:{getBranch:()=>entries},ui:{onTerminalInput:(h:any)=>{keyHandlers.push(h);return()=>{keyHandlers.splice(keyHandlers.indexOf(h),1);};},custom:(factory:any,options:any)=>new Promise<void>(resolve=>{const entry:any={options,closed:false};entry.renders=0;entry.w=factory({requestRender(){entry.renders++;}},{fg:(_:any,t:string)=>t},{matches:()=>false},()=>{entry.closed=true;resolve();});windows.push(entry);}),notify(text:string){notices.push(text);},setStatus(_:string,text:string|undefined){renders++;statuses.push(text);},setWidget(){}}};
  createExtension({appendEntry:(customType:string,data:any)=>entries.push({type:'custom',customType,data}),on:(n:string,h:any)=>hooks[n]=h,registerCommand:(_:any,c:any)=>command=c.handler,registerEntryRenderer:(_:any,r:any)=>renderer=r} as any,client,store,clipboard,watchMs);
  hooks.session_start({},ctx);
  const card=renderer(entries[1],{}, {fg:(_:any,t:string)=>t});
  return {entries,hooks,ctx,store,windows,keyHandlers,press:(d:string)=>keyHandlers.map(h=>h(d)),client,calls,card,configs,notices,statuses,line:()=>{const l=card.render(200)[0];if(l!==undefined)assert.equal(l[0],' ');return l?.slice(1);}, command:(s:string)=>command(s,ctx),set:(s:string,i:string|null='a')=>{state=s;id=i;},setReady:(value:boolean)=>{ready=value;},setError:(value:string)=>{settings.error=value;},setFallback:(value:string|null)=>{settings.fallback=value;},ensures:()=>ensures,close:()=>hooks.session_shutdown({},ctx),agentStart:()=>hooks.agent_start({},ctx),fail:(value=true)=>{fail=value;},renders:()=>renders};
}
for (const control of ['command', 'shortcut', 'toolbar'] as const) {
  test(`scoped controls S2: ${control} pause/resume never changes a foreign current reading`, async () => {
    const store = memoryStore();
    store.save({...store.load(), shortcutsOn: true, shortcuts: {pause: 'alt+p'}});
    const s = setup(store), actions: any[] = [];
    const action = s.client.action;
    s.client.action = async (path: string, body: any) => {
      if (path === '/pause' || path === '/resume') actions.push({path, body});
      return action(path, body);
    };
    const pause = async () => {
      if (control === 'command') await s.command('pause');
      if (control === 'shortcut') { s.press('\u001bp'); await new Promise(r => setImmediate(r)); }
      if (control === 'toolbar') await clickAt(s, s.line().includes('[ ‖ ]') ? '[ ‖ ]' : '[ ▶ ]');
    };
    try {
      await s.command('play');
      await pause();
      assert.deepEqual(actions, [{path: '/pause', body: {id: 'a'}}]);
      await pause();
      assert.deepEqual(actions[1], {path: '/resume', body: {id: 'a'}});
      s.set('playing', 'foreign');
      await pause(); // Ownership must be checked against fresh status, not the last poll.
      assert.equal(actions.length, 2);
    } finally { await s.close(); }
  });
}

for (const control of ['command', 'shortcut'] as const) {
  test(`scoped controls S4: ${control} stop cancels own queued copies before current, preserving foreign queue`, async () => {
    const store = memoryStore();
    store.save({...store.load(), policy: 'wait', shortcutsOn: true, shortcuts: {stop: 'alt+s'}});
    const s = setup(store), ids: string[] = [], stops: any[] = [];
    const request = s.client.request, action = s.client.action;
    let current = 'a', queue = ['foreign-queued'];
    s.client.request = async (path: string, body: any) => {
      if (path === '/speak') { ids.push(body.id); if (ids.length > 1) queue.push(body.id); return {id: body.id, ...(ids.length > 1 ? {state: 'queued'} : {})}; }
      if (path === '/status') return {state: 'playing', id: current, queue};
      return request(path, body);
    };
    s.client.action = async (path: string, body: any) => {
      if (path === '/stop') { stops.push(body); queue = queue.filter(id => id !== body.id); if (!body.id || current === body.id) current = 'foreign'; return {state: 'playing'}; }
      return action(path, body);
    };
    try {
      await s.command('play'); await s.command('play');
      if (control === 'command') await s.command('stop');
      else { s.press('\u001bs'); await new Promise(r => setImmediate(r)); }
      assert.deepEqual(stops, [{id: ids[1]}, {id: ids[0]}]);
      assert.equal(current, 'foreign'); assert.deepEqual(queue, ['foreign-queued']);
      assert.doesNotMatch(s.line(), /En espera|\[ ‖ \]/);
    } finally { await s.close(); }
  });
}

test('scoped controls S4: power off interrupts a multi-reading stop without reconnecting', async () => {
  const s = setup(), pendingStop = deferred<any>(), stops: string[] = [];
  const action = s.client.action;
  s.client.action = async (path: string, body: any) => {
    if (path === '/stop') { stops.push(body.id); if (stops.length === 1) return pendingStop.promise; }
    return action(path, body);
  };
  try {
    await s.command('play'); await s.command('play');
    const stopping = s.command('stop'); await new Promise(r => setImmediate(r));
    assert.equal(stops.length, 1);
    await s.command('');
    pendingStop.resolve({state: 'idle'}); await stopping;
    assert.equal(stops.length, 1, 'the old stop must not ensure after power off');
  } finally { pendingStop.resolve({state: 'idle'}); await s.close(); }
});

test('scoped controls S4: auto toggle cannot abandon snapshotted stop ids', async () => {
  const s = setup(), pendingStop = deferred<any>(), stops: any[] = [];
  const action = s.client.action;
  s.client.action = async (path: string, body: any) => {
    if (path === '/stop') {
      stops.push(body);
      if (stops.length === 1) return pendingStop.promise;
    }
    return action(path, body);
  };
  try {
    await s.command('play'); await s.command('play'); await s.command('play');
    const stopping = s.command('stop'); await new Promise(r => setImmediate(r));
    assert.deepEqual(stops, [{id: 'a:tehablo:1'}]);
    await s.command('auto');
    pendingStop.resolve({state: 'playing'}); await stopping;
    assert.deepEqual(stops, [{id: 'a:tehablo:1'}, {id: 'a:tehablo:2'}, {id: 'a'}]);
  } finally { pendingStop.resolve({state: 'idle'}); await s.close(); }
});

test('scoped controls S3: session_shutdown preserves a foreign current reading and its queue', async () => {
  const s = setup(memoryStore(), async () => 'Copied'), stops: any[] = [];
  let queue = ['foreign-queued'];
  const real = new ServerClient({fetch: (async (url: any, init: any) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(init.body) : undefined;
    if (path === '/speak') { queue.push(body.id); return Response.json({id: body.id, state: 'queued'}); }
    if (path === '/status') return Response.json({state: 'playing', id: 'foreign', queue});
    if (path === '/stop') { stops.push(body); queue = queue.filter(id => id !== body.id); }
    assert.notEqual(path, '/shutdown');
    return Response.json({ready: true});
  }) as any});
  s.client.ensure = real.ensure.bind(real);
  s.client.request = real.request.bind(real);
  s.client.action = real.action.bind(real);
  s.client.shutdown = real.shutdown.bind(real);
  await s.command('play'); await s.command('copy');
  await s.close();
  assert.deepEqual(stops, [{id: 'a'}, {id: 'a:tehablo:1'}]);
  assert.deepEqual(queue, ['foreign-queued']);
});

test('scoped controls S1: a replaced paused card returns to play while the foreign reading runs', async () => {
  const s = setup();
  try {
    await s.command('play'); await s.command('pause');
    assert.match(s.line(), /\[ ▶ \] \[ ■ \]/);
    s.set('playing', 'foreign'); await tick();
    assert.match(s.line(), /^\[ ▶ \] \[ ▶ copiado \]/);
    assert.doesNotMatch(s.line(), /\[ ■ \]/);
  } finally { await s.close(); }
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('copied pending S2/S3: immediate feedback, duplicate suppression and accepted queue', async () => {
  const clip = deferred<string>(), accepted = deferred<any>();
  let reads = 0, speaks = 0;
  const s = setup(memoryStore(), () => { reads++; return clip.promise; });
  const request = s.client.request;
  s.client.request = async (path: string, body: any) => path === '/speak'
    ? (speaks++, accepted.promise) : request(path, body);
  try {
    await s.command('');
    await clickAt(s, '[ ▶ copiado ]');
    assert.match(s.line(), /Preparando…/);
    assert.doesNotMatch(s.line(), /En espera/);
    await s.command('copy');
    assert.equal(reads, 1);
    clip.resolve('Copied');
    await new Promise(r => setImmediate(r));
    assert.match(s.line(), /Preparando…/);
    assert.equal(speaks, 1);
    accepted.resolve({state: 'queued'});
    await new Promise(r => setImmediate(r));
    assert.match(s.line(), /\[ ■ \] En espera/);
    assert.doesNotMatch(s.line(), /Preparando/);
  } finally { await s.close(); }
});

for (const ending of ['empty', 'clipboard error', 'speak error', 'off', 'stop', 'turn'] as const) {
  test(`copied pending S3: clears on ${ending}`, async () => {
    const clip = deferred<string>();
    const s = setup(memoryStore(), () => clip.promise);
    try {
      await s.command('');
      const pending = s.command('copy');
      assert.match(s.line(), /Preparando…/);
      if (ending === 'off') await s.command('');
      if (ending === 'stop') await s.command('stop');
      if (ending === 'turn') s.agentStart();
      if (ending === 'clipboard error') clip.reject(Error('clipboard unavailable'));
      else {
        if (ending === 'speak error') {
          const request = s.client.request;
          s.client.request = async (path: string, body: any) => {
            if (path === '/speak') throw Error('speak unavailable');
            return request(path, body);
          };
        }
        clip.resolve(ending === 'empty' ? '' : 'Copied');
      }
      await pending;
      assert.doesNotMatch(s.line() ?? '', /Preparando|En espera/);
      if (ending === 'empty') assert.ok(s.notices.includes('TTS teHablo: El portapapeles está vacío.'));
      if (ending.endsWith('error')) assert.ok(s.notices.some(n => n.includes('unavailable')));
      if (['off', 'stop', 'turn'].includes(ending)) assert.ok(!s.calls.includes('/speak'));
    } finally { await s.close(); }
  });
}

test('S1/S4: shared settings refresh the bar and open window on the existing tick while off', async () => {
  const dir = mkdtempSync(join(process.env.TEMP || '/tmp', 'tehablo-live-'));
  const store = fileStore(dir, dir), other = fileStore(dir, dir);
  store.save({...DEFAULTS, toolbar: true});
  let loads = 0;
  const load = store.load; store.load = () => { loads++; return load(); };
  const s = setup(store, undefined, 10);
  try {
    s.fail();
    const initialLoads = loads;
    await new Promise(r => setTimeout(r, 50));
    assert.equal(loads, initialLoads, 'unchanged ticks do not reload settings');
    await s.command('menu'); await new Promise(r => setImmediate(r));
    const before = s.windows[0].w.render(100).join('\n');
    const saved = other.load();
    const voices = [{name: 'Iker', voice: 'Iker', model: 'phonon', kind: 'account', note: '', downloaded: true}];
    other.save({...saved, toolbar: false, volume: 0.7, speed: 1.25, shortcutsOn: true, shortcuts: {stop: 'alt+s'},
      dict: {Iker: false}, voices, policy: 'wait', model: 'phonon', voice: 'Iker'});
    for (let i = 0; i < 50 && s.line() !== undefined; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(s.line(), undefined, 'toolbar visibility follows the shared file even while offline');
    const after = s.windows[0].w.render(100).join('\n');
    assert.notEqual(after, before);
    assert.match(after, /75 %/); // The window rounds to its existing volume steps.
    assert.match(after, /1.25x/);
    assert.match(after, /Iker/);
    assert.match(after, /Esperar/);
    assert.ok(s.windows[0].renders > 0, 'an open overlay is explicitly redrawn');
    const controller = s.windows[0].w.c;
    assert.deepEqual(controller.state().settings.shortcuts, {stop: 'alt+s'});
    assert.equal(controller.dict(voices[0]), false);
    assert.deepEqual(controller.voices(), voices);
    s.fail(false);
    other.save({...other.load(), toolbar: true, volume: 0.8, speed: 1.5});
    for (let i = 0; i < 50 && !s.line()?.includes('[ ⋯ ]'); i++) await new Promise(r => setTimeout(r, 10));
    await clickAt(s, '[ ⋯ ]');
    assert.match(s.line(), /80%/);
    assert.match(s.line(), /1.50x/);
    assert.equal(s.configs.length, 0);
    assert.equal(s.notices.length, 0);
  } finally { await s.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('S5: two sessions keep independent auto, including the open window and external reloads', async () => {
  const dir = mkdtempSync(join(process.env.TEMP || '/tmp', 'tehablo-auto-'));
  const a = setup(fileStore(dir, dir), undefined, 10), b = setup(fileStore(dir, dir), undefined, 10);
  try {
    await a.command('menu'); await b.command('menu'); await new Promise(r => setImmediate(r));
    a.windows[0].w.c.change('auto', true); await new Promise(r => setImmediate(r));
    assert.equal(a.windows[0].w.c.state().settings.auto, true);
    assert.equal(b.windows[0].w.c.state().settings.auto, false);
    const other = fileStore(dir, dir); const saved = other.load(); other.save({...saved, speed: 1.25});
    for (let i = 0; i < 50 && a.windows[0].w.c.state().settings.speed !== 1.25; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(a.windows[0].w.c.state().settings.speed, 1.25);
    assert.equal(a.windows[0].w.c.state().settings.auto, true);
    assert.equal(b.windows[0].w.c.state().settings.auto, false);
    b.windows[0].w.c.change('auto', true); await new Promise(r => setImmediate(r));
    a.windows[0].w.c.change('auto', false);
    assert.equal(b.windows[0].w.c.state().settings.auto, true);
  } finally { await a.close(); await b.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('a promoted copied reading shows playing controls even with another copy of the same card queued',async()=>{
  const store=memoryStore();store.save({...store.load(),policy:'wait'} as any);
  const s=setup(store,async()=>'Copied');const ids:string[]=[];
  let current='foreign',queue:string[]=[];
  const request=s.client.request;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak'){ids.push(body.id);queue.push(body.id);return {id:body.id,state:'queued'};}
    if(path==='/status')return {state:'playing',id:current,queue};
    return request(path,body);
  };
  try{
    await clickAt(s,'[ ⏻ TTS ]');
    await clickAt(s,'[ ▶ copiado ]');await s.command('copy');
    assert.notEqual(ids[0],ids[1]);assert.match(s.line(),/En espera/);
    current=ids[0];queue=[ids[1]];await tick();
    assert.doesNotMatch(s.line(),/En espera/);assert.match(s.line(),/\[ ‖ \]/);
    assert.equal(s.notices.filter(n=>n.includes('Suena')).length,1);
    current=ids[1];queue=[];await tick();
    current='foreign';await tick();
    await s.command('copy');assert.equal(ids[2],ids[0]);assert.match(s.line(),/En espera/);
    current=ids[2];queue=[];await tick();
    assert.doesNotMatch(s.line(),/En espera/);assert.match(s.line(),/\[ ‖ \]/);
    assert.equal(s.notices.filter(n=>n.includes('Suena')).length,3);
  }finally{await s.close();}
});

test('playing copied card stop scopes current and queued copies without stopping foreign readings',async()=>{
  const store=memoryStore();store.save({...store.load(),policy:'wait'} as any);
  const s=setup(store,async()=>'Copied');const ids:string[]=[],stops:any[]=[];
  let current='foreign',queue:string[]=['foreign-queued'];
  const request=s.client.request,action=s.client.action;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak'){ids.push(body.id);queue.push(body.id);return {id:body.id,state:'queued'};}
    if(path==='/status')return {state:'playing',id:current,queue};
    return request(path,body);
  };
  s.client.action=async(path:string,body:any)=>{
    if(path==='/stop'){
      stops.push({path,body});
      queue=queue.filter(id=>id!==body.id);
      if(current===body.id)current='foreign';
      return {state:'playing'};
    }
    return action(path,body);
  };
  try{
    await s.command('copy');await s.command('copy');
    current=ids[0];queue=['foreign-queued',ids[1]];await tick();
    assert.match(s.line(),/\[ ‖ \]/);assert.doesNotMatch(s.line(),/En espera/);
    await clickAt(s,'[ ■ ]');
    assert.deepEqual(stops,[{path:'/stop',body:{id:ids[1]}},{path:'/stop',body:{id:ids[0]}}]);
    assert.equal(current,'foreign');assert.deepEqual(queue,['foreign-queued']);
    assert.doesNotMatch(s.line(),/\[ ‖ \]|En espera/);
  }finally{await s.close();}
});

test('a status snapshot cannot discard ownership of a pending speak',async()=>{
  const store=memoryStore();store.save({...store.load(),policy:'wait'} as any);
  const s=setup(store);const ids:string[]=[],stopped:string[]=[];
  let release!:(v:any)=>void;
  const request=s.client.request,action=s.client.action;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak'){
      ids.push(body.id);
      return ids.length===1?{id:body.id}:new Promise(r=>{release=r;});
    }
    if(path==='/status')return {state:'playing',id:ids[0]};
    return request(path,body);
  };
  s.client.action=async(path:string,body:any)=>{if(path==='/stop')stopped.push(body.id);return action(path,body);};
  try{
    await s.command('play');const pending=s.command('play');await new Promise(r=>setImmediate(r));
    await tick();release({id:ids[1],state:'queued'});await pending;
    assert.match(s.line(),/En espera/);
    await s.agentStart();await new Promise(r=>setImmediate(r));
    assert.ok(stopped.includes(ids[1]));assert.ok(stopped.includes(ids[0]));
  }finally{await s.close();}
});

test('a queued read completed between polls still notifies once, ignoring foreign promotions',async()=>{
  const s=setup();let idle=false;
  const request=s.client.request;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak')return {id:body.id,state:'queued'};
    if(path==='/status')return {state:idle?'idle':'playing',id:idle?null:'foreign',queue:idle?[]:['a'],promoted:idle?['foreign','a']:['foreign']};
    return request(path,body);
  };
  try{
    await s.command('play');await tick();assert.equal(s.notices.length,0);
    idle=true;await tick();await tick();
    assert.deepEqual(s.notices,['TTS teHablo: Suena la lectura en espera.']);
    assert.doesNotMatch(s.line(),/En espera/);
  }finally{await s.close();}
});

test('replaying a finished queued card waits for its new promotion, not stale history',async()=>{
  const s=setup();let state='playing',id:string|null='foreign',queue=['a'],promoted:string[]=[];
  const request=s.client.request;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak')return {id:body.id,state:'queued'};
    if(path==='/status')return {state,id,queue,promoted};
    return request(path,body);
  };
  try{
    await s.command('play');assert.match(s.line(),/En espera/);
    state='idle';id=null;queue=[];promoted=['a'];await tick();
    assert.equal(s.notices.length,1);assert.doesNotMatch(s.line(),/En espera/);
    state='playing';id='foreign';queue=['a'];
    await clickAt(s,'[ ▶ ]');assert.match(s.line(),/En espera/);
    // Even a stale snapshot must not announce an id that is still in the queue.
    await tick();assert.match(s.line(),/En espera/);assert.equal(s.notices.length,1);
    promoted=[];await tick();assert.match(s.line(),/En espera/);assert.equal(s.notices.length,1);
    id='a';queue=[];promoted=['a'];await tick();await tick();
    assert.equal(s.notices.length,2);assert.doesNotMatch(s.line(),/En espera/);
  }finally{await s.close();}
});

test('wait requests cover play, copied buttons, commands and auto; queue warns and starts once',async()=>{
  const store=memoryStore();store.save({...store.load(),policy:'wait'} as any);
  const s=setup(store,async()=>'Copied');const bodies:any[]=[];
  let queue=['a'], current='foreign', overflow=false;
  const request=s.client.request;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak'){bodies.push(body);if(overflow)throw Error('Cola llena');return {id:body.id,state:'queued'};}
    if(path==='/status')return {state:'playing',id:current,queue};
    return request(path,body);
  };
  try {
    await s.command('play 1');assert.match(s.line(),/^\[ ■ \] En espera/);
    await tick();assert.match(s.line(),/En espera/);assert.equal(s.notices.length,0);
    queue=[];current='a';await tick();await tick();
    assert.deepEqual(s.notices,['TTS teHablo: Suena la lectura en espera.']);
    await s.command('stop');
    await clickAt(s,'[ ▶ ]');await s.command('stop');
    await clickAt(s,'[ ▶ copiado ]');await s.command('stop');
    await s.command('copy');await s.command('stop');
    await s.command('auto');
    s.entries.push({type:'message',id:'b',message:{role:'assistant',content:'Automatic'}});
    await s.hooks.agent_settled({aborted:false},s.ctx);await new Promise(r=>setImmediate(r));
    assert.equal(bodies.length,5);assert.ok(bodies.every(b=>b.policy==='wait'));
    overflow=true;await s.command('play');assert.match(s.notices.at(-1)!,/Cola llena/);
  }finally{await s.close();}
});

test('queued card stop cancels only its id; agent_start only stops own readings under both policies',async()=>{
  for(const policy of ['stop','wait']) {
    const store=memoryStore();store.save({...store.load(),policy} as any);
    const s=setup(store);const stopped:any[]=[];
    const request=s.client.request,action=s.client.action;
    s.client.request=async(path:string,body:any)=>path==='/speak'?{state:'queued',id:body.id}:request(path,body);
    s.client.action=async(path:string,body:any)=>{if(path==='/stop')stopped.push(body);return action(path,body);};
    try {
      await s.command('play');await clickAt(s,'[ ■ ]');
      assert.deepEqual(stopped,[{id:'a'}]);
      await s.command('play');await s.agentStart();await new Promise(r=>setImmediate(r));
      assert.deepEqual(stopped,[{id:'a'},{id:'a'}]);
      assert.ok(stopped.every(b=>typeof b.id==='string'));
    }finally{await s.close();}
  }
});

test('repeated reads of one card have distinct ids and queued cancellation preserves current',async()=>{
  const store=memoryStore();store.save({...store.load(),policy:'wait'} as any);
  const s=setup(store);const ids:string[]=[],stopped:any[]=[];
  const request=s.client.request,action=s.client.action;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak'){ids.push(body.id);return {id:body.id,...(ids.length>1?{state:'queued'}:{})};}
    if(path==='/status')return {state:'playing',id:ids[0],queue:ids.slice(1)};
    return request(path,body);
  };
  s.client.action=async(path:string,body:any)=>{if(path==='/stop')stopped.push(body);return action(path,body);};
  try{
    await s.command('play');await s.command('play');assert.notEqual(ids[0],ids[1]);
    await tick();assert.match(s.line(),/En espera/);assert.equal(s.notices.filter(n=>n.includes('Suena')).length,0);
    await clickAt(s,'[ ■ ]');assert.deepEqual(stopped,[{id:ids[1]}]);
    await s.agentStart();await new Promise(r=>setImmediate(r));assert.deepEqual(stopped.at(-1),{id:ids[0]});
  }finally{await s.close();}
});

test('switching to stop preserves a queued read of the same card with its own id',async()=>{
  const store=memoryStore();store.save({...store.load(),policy:'wait'} as any);
  const s=setup(store);const ids:string[]=[],stopped:any[]=[];
  const request=s.client.request,action=s.client.action;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak'){ids.push(body.id);return {id:body.id,...(ids.length===1?{state:'queued'}:{})};}
    return request(path,body);
  };
  s.client.action=async(path:string,body:any)=>{if(path==='/stop')stopped.push(body);return action(path,body);};
  try{
    await s.command('play');await s.command('menu');await new Promise(r=>setImmediate(r));
    s.windows[0].w.c.change('policy','stop');await s.command('play');
    assert.notEqual(ids[0],ids[1]);assert.match(s.line(),/En espera/);
    await clickAt(s,'[ ■ ]');assert.deepEqual(stopped,[{id:ids[0]}]);
  }finally{await s.close();}
});

test('agent_start cancels a speak response that arrives after the new turn',async()=>{
  const s=setup();const stopped:any[]=[];let release!:(v:any)=>void;
  const request=s.client.request,action=s.client.action;
  s.client.request=async(path:string,body:any)=>path==='/speak'?new Promise(r=>{release=r;}):request(path,body);
  s.client.action=async(path:string,body:any)=>{if(path==='/stop')stopped.push(body);return action(path,body);};
  try{
    const pending=s.command('play');await new Promise(r=>setImmediate(r));
    await s.agentStart();release({id:'a'});await pending;await new Promise(r=>setImmediate(r));
    assert.ok(stopped.some(b=>b.id==='a'));assert.ok(stopped.every(b=>b.id));
    assert.doesNotMatch(s.line(),/■/);
  }finally{await s.close();}
});

test('absent status queue means empty, including cancellation by another session',async()=>{
  const s=setup();let polls=0;
  const request=s.client.request;
  s.client.request=async(path:string,body:any)=>{
    if(path==='/speak')return {state:'queued',id:body.id};
    if(path==='/status'){polls++;return {state:'playing',id:'foreign'};}
    return request(path,body);
  };
  try{
    await s.command('play');assert.match(s.line(),/En espera/);
    await tick();assert.doesNotMatch(s.line(),/En espera/);
    const before=polls;await tick();assert.equal(polls,before);
    assert.equal(s.notices.length,0);
  }finally{await s.close();}
});

test('late speak after power off does not ensure or restart the server',async()=>{
  const s=setup();let release!:(v:any)=>void;
  const request=s.client.request;
  s.client.request=async(path:string,body:any)=>path==='/speak'?new Promise(r=>{release=r;}):request(path,body);
  const action=s.client.action;
  s.client.action=async(path:string,body:any)=>{if(path==='/stop')await s.client.ensure();return action(path,body);};
  try{
    await s.command('');await clickAt(s,'[ ⋯ ]');
    const pending=s.command('play');await new Promise(r=>setImmediate(r));
    await clickAt(s,'[ ⏻ ]');const before=s.ensures();release({id:'a'});await pending;
    assert.equal(s.ensures(),before);assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
  }finally{await s.close();}
});

test('settings menu toolbar toggle saves and gives the same notice as the command',async()=>{
  const s=setup();try{
    await s.command('menu');await new Promise(r=>setImmediate(r));
    s.windows[0].w.c.change('toolbar',false);
    assert.equal(s.line(),undefined);assert.equal(s.store.load().toolbar,false);
    assert.equal(s.notices.at(-1),'TTS teHablo: Barra oculta.');
    s.windows[0].w.c.change('toolbar',true);
    assert.ok(s.line());assert.equal(s.notices.at(-1),'TTS teHablo: Barra visible.');
    s.windows[0].w.c.change('policy','wait');assert.equal((s.store.load() as any).policy,'wait');
  }finally{await s.close();}
});

test('every start button column is clickable, including normal spaces and brackets',async()=>{
  for(let x=0;x<Array.from('[ ⏻ TTS ]').length;x++) {
    const s=setup();try {await click(s.card,x);assert.equal(s.ensures(),1,`column ${x}`);assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');}finally{await s.close();}
  }
});

test('expanded controls end with power off, release idle or playing server and allow restart',async()=>{
  for(const playing of [false,true]) {
    const s=setup();try {
      await clickAt(s,'⏻ TTS');if(playing)await s.command('play');
      assert.ok(!s.line().includes('[ ⏻ ]'));
      await clickAt(s,'[ ⋯ ]');assert.ok(s.line().endsWith('Vel [- 1.00x +] [ ⏻ ]'));
      await clickAt(s,'[ ⏻ ]');assert.deepEqual(s.calls.filter((p:string)=>p==='/shutdown'),['/shutdown']);
      assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');const count=s.calls.length;await tick();assert.equal(s.calls.length,count);
      await clickAt(s,'⏻ TTS');assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
      await clickAt(s,'[ ▶ ]');assert.ok(s.calls.includes('/speak'));assert.deepEqual(s.notices,[]);
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
      assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');assert.equal(s.calls.length,count);assert.deepEqual(s.notices.filter((n:string)=>n.startsWith('TTS:')),[]);
    }finally{await s.close();}
  }
});

for(const [command,path] of [['status','/health'],['status','/status']] as const) {
  test(`power off ignores pending command ${command} at ${path}`,async()=>{
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
      assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');assert.equal(s.calls.length,count);assert.deepEqual(s.notices,[]);
    }finally{await s.close();}
  });
}

test('/tts toggles the server like the bar; status, menu, copy, pause, toolbar; removed commands only show usage',async()=>{
  const s=setup(memoryStore(),async()=>'Texto copiado');try {
    s.set('idle',null);
    await s.command('');assert.equal(s.ensures(),1);assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
    await s.command('auto');assert.equal(s.statuses.at(-1),'TTS auto');assert.equal(s.store.load().auto,false);
    await s.command('');assert.ok(s.calls.includes('/shutdown'));assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');assert.equal(s.statuses.at(-1),'TTS off');assert.equal(s.store.load().auto,false);
    await s.command('');assert.equal(s.ensures(),2);
    await s.command('status');assert.match(s.notices.at(-1)!,/^TTS teHablo: Barra visible · automático: no\nServidor: idle · listo: sí\n/);
    assert.match(s.notices.at(-1)!,/\/tts · auto · play \[n\] · copy · pause · stop · toolbar · menu · dict · status/);
    await s.command('copy');assert.ok(s.calls.includes('/speak'));
    s.set('playing','a');await s.command('pause');assert.equal(s.calls.at(-1),'/pause');
    s.set('paused','a');await tick();await s.command('pause');assert.equal(s.calls.at(-1),'/resume');
    await s.command('menu');await new Promise(r=>setImmediate(r));assert.equal(s.windows.length,1);s.windows[0].w.c.power('restart');
    await s.command('play');s.set('playing','a');await tick();const stops=s.calls.filter((p:string)=>p==='/stop').length;
    await s.command('toolbar');assert.equal(s.line(),undefined);assert.equal(s.notices.at(-1),'TTS teHablo: Barra oculta.');
    await tick();assert.equal(s.calls.filter((p:string)=>p==='/stop').length,stops);
    await s.command('toolbar');assert.match(s.line(),/^\[ ‖ \] \[ ■ \]/);assert.equal(s.notices.at(-1),'TTS teHablo: Barra visible.');
    for(const removed of ['on','off','voice','voice lola','model spanish','speed 1.25','resume']) {
      const n=s.calls.length;await s.command(removed);
      assert.match(s.notices.at(-1)!,/^TTS teHablo: Uso: \/tts · auto · play \[n\]/,removed);assert.equal(s.calls.length,n,removed);
    }
  }finally{await s.close();}
});

const tick=()=>new Promise(r=>setTimeout(r,550));
const click=async(card:any,x:number)=>{card.handleMouse({type:'click',button:'left',x:x+1,y:0});await new Promise(r=>setImmediate(r));};
const clickAt=async(s:any,text:string,offset=0)=>{const line=s.line();assert.ok(line.includes(text),`${text} in ${line}`);await click(s.card,Array.from(line.slice(0,line.indexOf(text))).length+offset);};
const start=async(s:any)=>{await clickAt(s,'⏻ TTS');await tick();};

test('speech failure warns once and resets playback',async()=>{
  const s=setup();try {
    await s.command('play');s.set('idle',null);s.setError('speech failed: broken playback');
    await tick();
    assert.deepEqual(s.notices,['TTS teHablo: No se pudo reproducir: speech failed: broken playback']);
    assert.match(s.line(),/^\[ ▶ \] \[ ▶ copiado \]/);
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
    await tick();assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
    assert.deepEqual(s.notices,['TTS teHablo: Se perdió la conexión con el servidor (/status: offline). Revisa logs/tehablo-server.log.']);
    const count=s.calls.length;await tick();assert.equal(s.calls.length,count);assert.equal(s.notices.length,1);
  }finally{await s.close();}
});

test('start button shows Iniciar, then Cargando, then play when the model is ready',async()=>{
  const s=setup();
  try {
    assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');assert.equal(s.calls.length,0);assert.equal(s.ensures(),0);
    s.setReady(false);
    await clickAt(s,'⏻ TTS');
    assert.equal(s.ensures(),1);assert.ok(s.calls.includes('/health'));
    assert.equal(s.line(),'[ Cargando… ] [ ≡ ]');assert.equal(s.statuses.at(-1),'TTS manual · cargando');
    const before=s.ensures();await click(s.card,2);assert.equal(s.ensures(),before);assert.ok(!s.calls.includes('/speak'));
    s.setReady(true);await tick();
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');assert.equal(s.statuses.at(-1),'TTS manual');
    assert.deepEqual(s.notices,[]);
  } finally {await s.close();}
});

test('model load failure cancels readiness polling and warns',async()=>{
  const s=setup();
  try {
    s.setReady(false);await clickAt(s,'⏻ TTS');
    assert.equal(s.line(),'[ Cargando… ] [ ≡ ]');
    s.setError('model load failed: broken model');await tick();
    assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
    assert.equal(s.statuses.at(-1),'TTS off');
    assert.deepEqual(s.notices,['TTS teHablo: El modelo no cargó: model load failed: broken model']);
    const count=s.calls.length;await tick();assert.equal(s.calls.length,count);
    assert.ok(!s.calls.includes('/speak'));
  } finally {await s.close();}
});

test('a voice that falls back to lola warns once with its name',async()=>{
  const s=setup();
  try {
    s.setReady(false);await clickAt(s,'⏻ TTS');
    s.setFallback('Iker');s.setReady(true);await tick();
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
    await s.command('status');await tick();
    assert.deepEqual(s.notices.filter(n=>n.includes('lola')),['TTS teHablo: Iker no cargó; se usa lola. Detalle en logs/tehablo-server.log.']);
  } finally {await s.close();}
});

test('failed start returns to Iniciar and reports the error',async()=>{
  const s=setup();
  try {
    s.fail();await clickAt(s,'⏻ TTS');
    assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');assert.deepEqual(s.notices,['TTS teHablo: offline']);
  } finally {await s.close();}
});

test('controls toggle shows and hides volume and speed',async()=>{
  const s=setup();
  try {
    await start(s);
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
    await clickAt(s,'[ ⋯ ]',2);
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ → ] : [ ≡ ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ]');
    await clickAt(s,'[ → ]',2);
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');assert.equal(s.configs.length,0);
  } finally {await s.close();}
});

test('volume and speed buttons, limits and command synchronization',async()=>{
  const s=setup();
  const volDown=()=>clickAt(s,'Vol [-',5), volUp=()=>clickAt(s,'% +]',2), velDown=()=>clickAt(s,'Vel [-',5), velUp=()=>clickAt(s,'x +]',2);
  try {
    await start(s);await clickAt(s,'[ ⋯ ]',2);
    await volDown();assert.deepEqual(s.configs.at(-1),{volume:.9});assert.match(s.line(),/Vol \[- 90% \+\]/);
    await volUp();assert.deepEqual(s.configs.at(-1),{volume:1});
    await velUp();assert.deepEqual(s.configs.at(-1),{speed:1.1});assert.match(s.line(),/Vel \[- 1\.10x \+\]/);assert.deepEqual(s.notices,[],'the bar already shows volume and speed');
    await velUp();assert.deepEqual(s.configs.at(-1),{speed:1.15});
    await velDown();await velDown();assert.deepEqual(s.configs.at(-1),{speed:1});
    const n=s.configs.length;
    for(const [text,offset] of [['Vol [-',0],['100%',0],['100%',3],['Vel [-',0],['1.00x',0]] as const)await clickAt(s,text,offset);
    assert.equal(s.configs.length,n);
    for(let i=0;i<20;i++)await volDown();assert.equal(s.configs.at(-1).volume,.1);
    for(let i=0;i<20;i++)await volUp();assert.equal(s.configs.at(-1).volume,1.5);
    for(let i=0;i<8;i++)await velDown();assert.equal(s.configs.at(-1).speed,1);
    for(let i=0;i<8;i++)await velUp();assert.equal(s.configs.at(-1).speed,1.5);
    await clickAt(s,'[ ▶ ]');assert.ok(s.calls.includes('/speak'));
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
    await clickAt(s,'[ ⋯ ]',2);assert.equal(s.line(),'[ ‖ ] [ ■ ] [ → ] : [ ≡ ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ]');
    await click(s.card,8);assert.ok(s.calls.includes('/stop'));assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ → ] : [ ≡ ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ]');
    for(const state of ['loading','generating','playing','paused']) {
      s.set(state);await s.command('play 1');await tick();
      assert.match(s.line(),state==='paused'?/^\[ ▶ \] \[ ■ \]/:/^\[ ‖ \] \[ ■ \]/);
    }
    s.set('playing','other');await tick();assert.match(s.line(),/^\[ ▶ \] \[ ▶ copiado \]/);
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
 const s=setup();try {await tick();assert.equal(s.calls.length,0);await s.command('play');await tick();s.fail();await tick();await s.agentStart();assert.match(s.line(),/^\[ ▶ \] \[ ▶ copiado \]/);const n=s.calls.length;await tick();assert.equal(s.calls.length,n);}finally{await s.close();}
});

test('[ ≡ ] opens the centered settings window with the server off; choices are saved, not sent',async()=>{
  const s=setup();try {
    assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
    await clickAt(s,'[ ≡ ]');
    assert.equal(s.windows.length,1);assert.deepEqual(s.windows[0].options,{overlay:true,overlayOptions:{anchor:'center',width:72}});
    assert.equal(s.ensures(),0);
    const w=s.windows[0].w;
    w.c.change('volume',0.75);
    w.c.choose({name:'Iker',voice:'Iker',model:'phonon',kind:'account',note:'España',downloaded:true});
    await tick();
    assert.equal(s.calls.length,0);assert.equal(s.ensures(),0);
    const saved=s.store.load();
    assert.deepEqual([saved.volume,saved.model,saved.voice],[0.75,'phonon','Iker']);
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

test('a server started here gets the saved model and voice at launch, so no reload drops the first reading',async()=>{
  const store=memoryStore();store.save({...DEFAULTS,model:'phonon',voice:'Regina',volume:0.75,speed:1.25});
  const s=setup(store);s.client.ensure=async function(){this.spawned=true;};try {
    await start(s);
    assert.deepEqual(s.client.startArgs,['--model','phonon','--voice','Regina']);
    assert.deepEqual(s.configs,[{volume:0.75,speed:1.25}]);
  }finally{await s.close();}
});

test('turning auto reading on starts a stopped server, also with the bar hidden; off or already running does not',async()=>{
  for(const how of ['command','shortcut','window']) {
    const store=memoryStore();store.save({...DEFAULTS,shortcutsOn:true,shortcuts:{auto:'alt+a'}});
    const s=setup(store);try {
      if(how==='command')await s.command('auto on');
      if(how==='shortcut')s.press('\x1ba');
      if(how==='window'){await clickAt(s,'[ ≡ ]');s.windows[0].w.c.change('auto',true);}
      await new Promise(r=>setImmediate(r));
      assert.equal(s.store.load().auto,false,how);assert.equal(s.statuses.at(-1),'TTS auto',how);
      assert.equal(s.ensures(),1,how);assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ] auto',how);
      await s.command('auto off');await s.command('auto on');assert.equal(s.ensures(),1,how);
    }finally{await s.close();}
  }
  const s=setup();try {await s.command('toolbar');await s.command('auto on');assert.equal(s.ensures(),1);}finally{await s.close();}
});

test('open controls: [ → ] closes them, ":" only separates, and the menu sits before Vol',async()=>{
  const s=setup();try {
    await start(s);assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
    await clickAt(s,'[ ⋯ ]');const open='[ ▶ ] [ ▶ copiado ] [ → ] : [ ≡ ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ]';assert.equal(s.line(),open);
    await clickAt(s,' : ',1);assert.equal(s.line(),open);assert.equal(s.calls.length,1);
    await clickAt(s,'[ → ]');assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
    await clickAt(s,'[ ⋯ ]');await clickAt(s,'[ ≡ ]');await new Promise(r=>setImmediate(r));assert.equal(s.windows.length,1);
  }finally{await s.close();}
});

test('the menu button closes the open settings window instead of opening another',async()=>{
  const s=setup();try {
    await clickAt(s,'[ ≡ ]');await new Promise(r=>setImmediate(r));assert.equal(s.windows.length,1);
    await clickAt(s,'[ ≡ ]');await new Promise(r=>setImmediate(r));assert.equal(s.windows.length,1);assert.equal(s.windows[0].closed,true);
    await clickAt(s,'[ ≡ ]');await new Promise(r=>setImmediate(r));assert.equal(s.windows.length,2);
  }finally{await s.close();}
});

test('the bar shows a small auto mark while auto reading is on in this session',async()=>{
  const s=setup();try {
    s.set('idle',null);await start(s);
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
    await s.command('auto on');assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ] auto');
    await clickAt(s,'[ ⋯ ]');assert.match(s.line(),/\[ ⏻ \] auto$/);
    await clickAt(s,'[ → ]');await s.command('auto off');assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
  }finally{await s.close();}
});

test('turning the server off also turns auto reading off; restart keeps it',async()=>{
  for(const how of ['button','shortcut','window','restart']) {
    const store=memoryStore();store.save({...DEFAULTS,shortcutsOn:true,shortcuts:{power:'alt+p'}});
    const s=setup(store);try {
      await s.command('auto on');assert.equal(s.statuses.at(-1),'TTS auto',how);
      if(how==='button'){await clickAt(s,'[ ⋯ ]');await clickAt(s,'[ ⏻ ]');}
      if(how==='shortcut'){s.press('\x1bp');await new Promise(r=>setImmediate(r));}
      if(how==='window'||how==='restart'){await clickAt(s,'[ ⋯ ]');await clickAt(s,'[ ≡ ]');s.windows[0].w.c.power(how==='window'?'off':'restart');await new Promise(r=>setImmediate(r));}
      assert.ok(s.calls.includes('/shutdown'),how);
      const auto=how==='restart';
      assert.equal(s.store.load().auto,false,how);assert.equal(s.statuses.at(-1),auto?'TTS auto':'TTS off',how);
    }finally{await s.close();}
  }
});

test('inline volume buttons and /tts commands keep the saved settings in sync',async()=>{
  const s=setup();try {
    await start(s);await clickAt(s,'[ ⋯ ]',2);await clickAt(s,'% +]',2);
    assert.equal(s.store.load().volume,1.1);
    await s.command('auto on');assert.equal(s.store.load().auto,false);assert.equal(s.statuses.at(-1),'TTS auto');
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
    assert.ok(!s.calls.includes('/stop'), 'no own readings to stop');
    s.press('\x1ba');assert.equal(s.store.load().auto,false);assert.equal(s.statuses.at(-1),'TTS auto');
    s.press('\x1b\x0f');await new Promise(r=>setImmediate(r));assert.equal(s.windows.length,1);
    store.save({...store.load(),shortcutsOn:false});
  }finally{await s.close();}
  assert.equal(s.keyHandlers.length,0);
});

test('the copied-text shortcut reads the clipboard in the latest bar',async()=>{
  const store=memoryStore();store.save({...DEFAULTS,shortcutsOn:true,shortcuts:{copied:'alt+c'}});
  const s=setup(store,async()=>'Texto copiado');try {
    s.set('idle',null);
    assert.deepEqual(s.press('\x1bc'),[{consume:true}]);await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
    assert.ok(s.calls.includes('/speak'));assert.match(s.line(),/^\[ ‖ \] \[ ■ \]/);
  }finally{await s.close();}
});

test('powering off while the clipboard is still being read does not restart the server or read',async()=>{
  let release!:(text:string)=>void;
  const s=setup(memoryStore(),()=>new Promise<string>(r=>{release=r;}));try {
    await start(s);const ensures=s.ensures();
    await clickAt(s,'[ ▶ copiado ]');
    await clickAt(s,'[ ⋯ ]');await clickAt(s,'[ ⏻ ]');
    release('Texto copiado');await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
    assert.ok(!s.calls.includes('/speak'));assert.equal(s.ensures(),ensures);assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
  }finally{await s.close();}
});

test('Pi start or /reload shows TTS off at once, and a stopped server never keeps auto reading',async()=>{
  const store=memoryStore();store.save({...DEFAULTS,auto:true});
  const s=setup(store);try {
    assert.equal(s.statuses.at(-1),'TTS off');assert.equal(s.store.load().auto,true, 'startup does not write session auto to the store');
    await s.command('auto');assert.equal(s.statuses.at(-1),'TTS auto');
    await s.command('auto');assert.equal(s.statuses.at(-1),'TTS manual');
  }finally{await s.close();}
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
    await clickAt(s,'[ ≡ ]');
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
    await start(s);await clickAt(s,'[ ⋯ ]');await clickAt(s,'[ ≡ ]');
    const w=s.windows[0].w;
    assert.equal(w.c.voices()[0].downloaded,true);
    assert.deepEqual(w.c.active(),{model:'spanish',voice:'other'});
  }finally{await s.close();}
});

test('an open window gets the download states when the server becomes ready',async()=>{
  const table=[{name:'lola',voice:'lola',model:'spanish',kind:'download',note:'la de siempre',downloaded:null,default:true}];
  const s=setup(memoryStore(table));try {
    const request=s.client.request;
    s.client.request=async(path:string,body:any)=>path==='/voices'?{voices:['lola'],catalog:[{...table[0],downloaded:true}]}:request(path,body);
    s.setReady(false);
    await clickAt(s,'⏻ TTS');await clickAt(s,'[ ≡ ]');
    const w=s.windows[0].w;
    assert.equal(w.c.voices()[0].downloaded,null);
    s.setReady(true);await tick();
    assert.equal(w.c.voices()[0].downloaded,true);
  }finally{await s.close();}
});

test('a token typed in the window is kept only in memory for the next server start',async()=>{
  const store=memoryStore();
  const s=setup(store);try {
    await start(s);await clickAt(s,'[ ⋯ ]');await clickAt(s,'[ ≡ ]');
    const w=s.windows[0].w;
    assert.equal(w.c.state().token,false);
    assert.throws(()=>w.c.saveToken('hf bad'),{message:'El token no es válido: copia el token completo de Hugging Face.'});
    assert.equal(s.client.token,undefined);
    w.c.saveToken('hf_secret');
    assert.equal(s.client.token,'hf_secret');
    assert.equal(w.c.state().token,true);
    await tick();
    assert.ok(s.calls.includes('/shutdown'));
    assert.ok(!JSON.stringify(store.load()).includes('hf_secret'));
  }finally{await s.close();}
});

test('a token typed while the server loads also restarts it, so the new server gets the token',async()=>{
  const s=setup();try {
    s.setReady(false);
    await clickAt(s,'⏻ TTS');await clickAt(s,'[ ≡ ]');
    s.windows[0].w.c.saveToken('hf_secret');
    await tick();
    assert.ok(s.calls.includes('/shutdown'));
    assert.ok(s.ensures()>=2);
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

test('the bar follows another Pi session turning the shared server on and off, without starting it or warning',async()=>{
  const s=setup(memoryStore(),undefined,40);const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  try {
    s.set('idle',null);assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
    await wait(200);
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');assert.equal(s.statuses.at(-1),'TTS manual');assert.equal(s.ensures(),0);
    s.fail();await wait(200);
    assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');assert.equal(s.statuses.at(-1),'TTS off');
    assert.deepEqual(s.notices,[]);assert.equal(s.ensures(),0);
    assert.ok(s.calls.every((p:string)=>p==='/health'),s.calls.join());
  }finally{await s.close();}
  const n=s.calls.length;await new Promise(r=>setTimeout(r,150));assert.equal(s.calls.length,n);
});

test('a new session shows the shared server state at once, without starting it or warning',async()=>{
  const s=setup(memoryStore(),undefined,1000);
  try {
    s.set('idle',null);assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
    await new Promise(r=>setTimeout(r,50));
    assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');assert.equal(s.ensures(),0);assert.deepEqual(s.notices,[]);
    assert.deepEqual(s.calls,['/health']);
  }finally{await s.close();}
});

test('a dying server answering once after power off does not turn the bar back on',async()=>{
  const s=setup(memoryStore(),undefined,40);const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  try {
    s.set('idle',null);await wait(200);assert.equal(s.line(),'[ ▶ ] [ ▶ copiado ] [ ⋯ ]');
    await clickAt(s,'[ ⋯ ]');
    const request=s.client.request;let answers=1;
    s.client.request=async(path:string)=>{if(path==='/health'&&answers--<=0)throw Error('offline');return request(path);};
    await clickAt(s,'[ ⏻ ]');const from=s.statuses.length;
    await wait(300);
    assert.deepEqual(s.statuses.slice(from-1),['TTS off']);assert.equal(s.line(),'[ ⏻ TTS ] [ ≡ ]');
  }finally{await s.close();}
});
