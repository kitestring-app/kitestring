import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';

const owner = new Chrome(), follower = new Chrome();
let server, target;
const modules = `(async () => {
  const t=await import('/src/state/timer.ts'), p=await import('/src/lib/store.ts'),
    s=await import('/src/state/settings.ts'), h=await import('/src/state/stats.ts'),
    e=await import('/src/state/timerEngine.ts'), b=await import('/src/lib/backup.ts'), db=await import('/src/lib/db.ts');
  await t.timerHydrationReady; await s.calmFoundationReady; await p.flushReadyStores();
  window.m={t,p,s,h,e,b,db};
})()`;
try {
  server = await createServer({ configLoader:'runner', server:{host:'127.0.0.1',port:0,hmr:false,watch:null}, clearScreen:false, logLevel:'error' });
  await server.listen(); owner.origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await owner.start();
  await owner.send('Network.enable'); await owner.send('Network.setBlockedURLs', {urls:['https://*']});
  await owner.send('Page.navigate', {url:owner.origin});
  await owner.waitFor("document.querySelector('.next-action')");
  await owner.evaluate(modules);
  await owner.waitFor('m.p.canWriteClockStore("timer")');

  target = await owner.send('Target.createTarget', {url:'about:blank'});
  const port = new URL(owner.socket.url).port;
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  follower.socket = new WebSocket(pages.find(p=>p.id===target.targetId).webSocketDebuggerUrl);
  follower.socket.addEventListener('message', ({data}) => {
    const message=JSON.parse(String(data));
    if (message.method==='Runtime.exceptionThrown') follower.errors.push(message.params);
    const request=follower.pending.get(message.id); if (!request) return;
    clearTimeout(request.timeout); follower.pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await new Promise((resolve,reject)=>{follower.socket.addEventListener('open',resolve,{once:true});follower.socket.addEventListener('error',reject,{once:true});});
  await follower.send('Page.enable'); await follower.send('Runtime.enable');
  await follower.send('Network.enable'); await follower.send('Network.setBlockedURLs', {urls:['https://*']});
  // Reproduce missed persistence broadcasts while retaining real command/reply IPC.
  await follower.send('Page.addScriptToEvaluateOnNewDocument', {source:`
    window.dropWrites=false; window.droppedWrites=0;
    window.BroadcastChannel=class extends BroadcastChannel {
      addEventListener(type,listener,options) {
        super.addEventListener(type,type==='message'?event=>{
          if(window.dropWrites && event.data?.type==='write'){window.droppedWrites++;return;}
          listener.call(this,event);
        }:listener,options);
      }
    };
  `});
  await follower.send('Page.navigate', {url:owner.origin});
  await follower.waitFor("document.querySelector('.next-action')"); await follower.evaluate(modules);
  assert.equal(await follower.evaluate('m.p.canWriteClockStore("timer")'), false);

  for (const mode of ['same-segment-stale-busy-idle','stale-running-idle','stale-paused-idle','stale-paused-running','stale-paused-paused','running','paused','paused-hard','frozen-zero','stale-busy','idle']) {
    const staleBusyIdle = mode === 'same-segment-stale-busy-idle';
    const changedSegment = mode.startsWith('stale-') && mode !== 'stale-busy';
    const idle = mode === 'idle' || mode.endsWith('-idle');
    const running = mode === 'running' || mode.endsWith('-running');
    await follower.evaluate('window.dropWrites=false');
    const segId=await owner.evaluate(`(async()=>{
      const {t,p,s,h,e}=m;
      s.settings.set({...s.DEFAULT_SETTINGS,timer:{...s.DEFAULT_SETTINGS.timer,hardMode:false,notify:false,speak:false,takeover:false,bringToFront:false,interruptionPrompt:false,autoRun:'off',focusDoneSound:'none',breakOverSound:'none'}});
      t.timer.set({...e.INITIAL_TIMER,segId:'owner-${mode}'});
      t.timerActions.start(); t.timerActions.reset();
      h.stats.set({chunks:[],tasksDone:[]});
      ${mode==='stale-busy'||changedSegment||staleBusyIdle ? `t.timerActions.start(); t.timer.set({...t.timer.get(),startedAt:${mode==='stale-running-idle' ? 'Date.now()-1000' : 'null'},elapsedBefore:1000,creditedUpTo:1000});
      h.stats.set({chunks:[{id:'old-owner',segId:t.timer.get().segId,kind:'focus',segment:'focus',start:Date.now()-1000,ms:1000,completed:false}],tasksDone:[]});` : ''}
      await p.flushReadyStores(); return t.timer.get().segId;
    })()`);
    await follower.waitFor(`m.t.timer.get().segId===${JSON.stringify(segId)}`);
    await follower.evaluate('window.dropWrites=true; window.droppedWrites=0; window.stale=structuredClone(m.t.timer.get()); window.oldChunks=structuredClone(m.h.stats.get().chunks)');
    const before=await owner.evaluate(`(async()=>{
      const {t,p,h}=m;
      ${changedSegment ? 't.timerActions.stop();' : ''}
      ${staleBusyIdle ? 't.timer.set({...t.timer.get(),startedAt:null,elapsedBefore:0,creditedUpTo:0,frozen:false,frozenTotal:null});' : ''}
      ${idle ? '' : `t.timerActions.start();
      t.timer.set({...t.timer.get(),startedAt:${running ? 'Date.now()-5000' : 'null'},elapsedBefore:${running||mode==='frozen-zero' ? 0 : 2000},creditedUpTo:${mode==='frozen-zero' ? 0 : 2000},frozen:true,hardLocked:${mode==='paused-hard'}});`}
      h.stats.set({chunks:[{id:'owner-new',segId:t.timer.get().segId,kind:'focus',segment:'focus',start:Date.now()-2000,ms:2000,completed:false}],tasksDone:[]});
      await p.flushReadyStores(); return {timer:structuredClone(t.timer.get()),chunks:h.stats.get().chunks};
    })()`);
    await follower.waitFor('window.droppedWrites>0');
    const replica=await follower.evaluate('({timer:m.t.timer.get(),chunks:m.h.stats.get().chunks})');
    if(mode!=='idle') assert.notDeepEqual(replica.timer,before.timer,'the follower must actually be stale');
    if(changedSegment) assert.notEqual(replica.timer.segId,before.timer.segId,'owner must have advanced to a different segment');
    assert.notDeepEqual(replica.chunks,before.chunks,'the follower must have stale accounting');
    const fileStats = {chunks:[
      {id:'imported-other',segId:'archive',kind:'focus',segment:'focus',start:Date.now()-10000,ms:3000,completed:true},
      ...(changedSegment ? [{id:'imported-stale',segId:replica.timer.segId,kind:'focus',segment:'focus',start:Date.now()-10000,ms:99,completed:false}] : []),
      {id:'imported-conflict',segId:before.timer.segId,kind:'focus',segment:'focus',start:Date.now()-10000,ms:99,completed:false},
    ],tasksDone:[{taskId:'imported-task',at:Date.now()-10000}]};
    const kept=await follower.evaluate(`m.b.restoreBackup(m.b.parseBackup(JSON.stringify({format:m.b.BACKUP_FORMAT,version:2,sections:['settings','focus'],data:{settings:{...m.s.DEFAULT_SETTINGS,extras:{...m.s.DEFAULT_SETTINGS.extras,displayName:'Do not import'}},
      timer:{...m.e.INITIAL_TIMER,segId:'imported-${mode}'},notes:'Imported ${mode}',stats:${JSON.stringify(fileStats)}}})),async()=>{throw Error('follower must not prepare metadata')},['focus'])`);
    const after=await owner.evaluate(`(async()=>{
      await m.p.flushReadyStores();return {timer:m.t.timer.get(),stats:m.h.stats.get(),diskTimer:await m.db.dbGet('timer'),diskStats:await m.db.dbGet('stats'),notes:await m.db.dbGet('notes')};
    })()`);
    assert.equal(after.notes,`Imported ${mode}`);
    assert.deepEqual(after.diskStats,after.stats);
    assert.deepEqual(after.diskTimer,after.timer);
    assert.equal(await owner.evaluate('m.s.settings.get().extras.displayName'), await follower.evaluate('m.s.DEFAULT_SETTINGS.extras.displayName'));
    if(idle) {
      assert.equal(after.timer.segId,`imported-${mode}`,'idle owner must receive the file timer');
      assert.deepEqual(after.stats,fileStats,'idle owner must receive all file history unchanged');
      assert.equal(kept,false,'the owner decides whether its timer was kept');
    } else {
      assert.deepEqual(after.timer,before.timer,`${mode} owner timer was overwritten`);
      assert.deepEqual(after.stats.chunks,[...fileStats.chunks.filter(c=>c.segId!==before.timer.segId),...before.chunks]);
      assert.deepEqual(after.stats.tasksDone,fileStats.tasksDone);
      assert.equal(kept,true,'the importing follower must report that the owner kept its timer');
    }
    console.log(`PASS: stale follower import ${mode}`);
  }
  owner.assertHealthy(); follower.assertHealthy();
} finally {
  if(target) await owner.send('Target.closeTarget',{targetId:target.targetId}).catch(()=>{});
  await follower.close(); await owner.close(); await server?.close();
}
