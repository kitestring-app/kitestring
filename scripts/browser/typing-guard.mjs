import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';

const c = new Chrome();
let server, sequence = 0;
const ev = expression => c.evaluate(expression);
async function key(key, meta = false, type) {
  const code = key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key;
  const windowsVirtualKeyCode = key === ' ' ? 32 : key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0);
  for (const phase of type ? [type] : ['keyDown', 'keyUp']) {
    await c.send('Input.dispatchKeyEvent', { type: phase, key, code, windowsVirtualKeyCode, modifiers: meta ? 4 : 0, ...(phase === 'keyDown' && !meta ? {text:key === 'Enter' ? '\r' : key.length === 1 ? key : undefined} : {}) });
  }
}
async function seed(native, takeover, sound = true) {
  await ev(`(async () => {
    const s = await import('/src/state/settings.ts'), t = await import('/src/state/timer.ts'), e = await import('/src/state/timerEngine.ts');
    const a = await import('/src/audio/boundaryAlert.ts'), n = await import('/src/ui/timer/TransitionStore.tsx');
    await s.calmFoundationReady; await t.timerActions.stopSound(); n.transitionStore.dismiss();
    window.testModules = {s,t,e,a,n}; window.attentionCalls = 0;
    window.desktop = ${native ? '{armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){},attention(){window.attentionCalls++}}' : 'undefined'};
    s.settings.set({...s.DEFAULT_SETTINGS,dash:'focus',timer:{...s.DEFAULT_SETTINGS.timer,hardMode:false,interruptionPrompt:false,takeover:${takeover},bringToFront:${native},speak:false,notify:false,autoRun:'off',alertVolume:.5,focusDoneSound:${sound ? "'bell'" : "'none'"},breakOverSound:'none',ticking:'off'}});
    t.timer.set({...e.INITIAL_TIMER,segId:'guard-${++sequence}'});
  })()`);
  await c.waitFor("document.querySelector('.next-action') && !document.querySelector('.transition-screen') && !document.querySelector('.recovery-card')");
  await ev('document.activeElement?.blur()');
}
async function finish() {
  await ev(`(() => {const {t}=window.testModules;t.timerActions.start();t.timer.set({...t.timer.get(),startedAt:Date.now()-25*60000});t.timerActions.complete(t.timer.get().segId)})()`);
}
const snapshot = () => ev(`(() => {const {t,a,n}=window.testModules;const s=t.timer.get();return {segId:s.segId,segment:s.segment,startedAt:s.startedAt,elapsedBefore:s.elapsedBefore,notice:n.transitionStore.get()?.segId??null,ringing:a.boundaryAlert.get().ringing,silenced:a.boundaryAlert.get().silenced}})()`);
async function burst() {
  for (let i = 0; i < 20; i++) {
    await key([' ', 'r', 'n', 'Enter', 'Escape'][i % 5]);
    await delay(100);
  }
}
try {
  server = await createServer({ configLoader:'runner', server:{host:'127.0.0.1',port:0,hmr:false,watch:null}, clearScreen:false, logLevel:'error' });
  await server.listen(); c.origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await c.start();
  await c.send('Fetch.enable', {patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await c.send('Page.navigate', {url:c.origin});
  await c.waitFor("document.querySelector('.next-action')");
  for (const native of [false, true]) {
    // Normal shortcuts remain immediate when no alert has happened.
    await seed(native, false);
    if (native) await delay(1600);
    await key(' ');
    assert.notEqual((await snapshot()).startedAt, null);
    await key(' ');
    assert.equal((await snapshot()).startedAt, null);
    for (const takeover of [false, true]) {
      await seed(native, takeover); await finish();
      await c.waitFor(takeover ? "document.querySelector('.transition-screen[open]')" : "document.querySelector('.recovery-card')");
      if (takeover) assert.equal(await ev('document.activeElement.id'), 'transition-title');
      const before = await snapshot();
      assert.equal(before.ringing, true);
      if (native) assert.equal(await ev('window.attentionCalls'), 1);
      await burst();
      assert.deepEqual(await snapshot(), before, `typing changed alarm (native=${native}, takeover=${takeover})`);
      await delay(1100); await key('r');
      assert.deepEqual(await snapshot(), before, 'quiet window was not restarted');
      await delay(1600); await key(' ');
      assert.notEqual((await snapshot()).startedAt, null, 'Space should work after quiet');
      assert.equal((await snapshot()).ringing, false);
    }
    // Cmd+. bypasses the guard without answering the reminder.
    await seed(native, true); await finish();
    await c.waitFor("document.querySelector('.transition-screen[open]')");
    const beforeMute = await snapshot(); await key('.', true);
    assert.deepEqual(await snapshot(), {...beforeMute, ringing:false, silenced:true});
    // A focused Later button must not get Space's release, even after quiet.
    await seed(native, true); await finish();
    await c.waitFor("document.querySelector('.transition-screen[open]')");
    await ev("document.querySelector('.transition-screen .sr-only button:last-child').focus()");
    const held = await snapshot(); await key(' ', false, 'keyDown'); await delay(1600); await key(' ', false, 'keyUp');
    assert.deepEqual(await snapshot(), held);
    await key('Enter');
    assert.equal((await snapshot()).notice, null);
    assert.equal((await snapshot()).startedAt, null, 'focused Later must dismiss rather than start');
    // A key released in another app must not consume the first deliberate press.
    for (const value of [' ', 'Enter']) {
      await seed(native, true); await finish();
      await c.waitFor("document.querySelector('.transition-screen[open]')");
      await ev("document.querySelector('.transition-screen .sr-only button:last-child').focus()");
      await key(value, false, 'keyDown');
      assert.notEqual((await snapshot()).notice, null);
      await delay(1600); await key(value);
      assert.equal((await snapshot()).notice, null, 'first deliberate key after a lost release must dismiss');
      assert.equal((await snapshot()).startedAt, null, 'focused Later must not start the timer');
    }
    // Pointer activation remains immediate during the guard on both surfaces.
    await seed(native, true); await finish();
    await c.waitFor("document.querySelector('.transition-screen[open]')");
    await ev("document.querySelector('.transition-screen .sr-only button').click()");
    assert.equal((await snapshot()).notice, null); assert.notEqual((await snapshot()).startedAt, null);
    await seed(native, false, false);
    await ev('window.testModules.t.timerActions.start();window.testModules.t.timerActions.pause()');
    await c.waitFor("document.querySelector('.recovery-card')");
    await ev("document.querySelector('.recovery-buttons button').focus()");
    const recovery = await snapshot(); await burst();
    assert.deepEqual(await snapshot(), recovery, 'recovery keyboard activation escaped guard');
    await ev("document.querySelector('.recovery-buttons button').click()");
    assert.notEqual((await snapshot()).startedAt, null);
    // Native attention alone must guard even without sound or takeover.
    if (native) {
      await seed(native, false, false);
      await ev("window.testModules.s.settingsUpdate('timer',{autoRun:'always'})");
      await finish();
      await c.waitFor("!document.querySelector('.recovery-card') && !document.querySelector('.transition-screen')");
      const silent = await snapshot(); assert.equal(silent.ringing, false);
      assert.equal(await ev('window.attentionCalls'), 1);
      await key('n'); assert.deepEqual(await snapshot(), silent);
    }
  }
  // Register through main.tsx, then drive the same callback used by native IPC.
  await c.send('Page.addScriptToEvaluateOnNewDocument', {source:`window.desktop={onTimerRequest(callback){window.nativeTimerRequest=callback;return()=>{}}}`});
  await c.reload("document.querySelector('.next-action') && window.nativeTimerRequest");
  await c.waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (await import('/src/lib/store.ts')).canWriteClockStore('timer'); })");
  await seed(true, false); await finish();
  await c.waitFor("document.querySelector('.recovery-card')");
  const nativeBefore = await snapshot();
  for (const command of ['toggle','pause','skip','reset','stop','stopAndPause','beginEndHold','cancelEndHold']) {
    assert.equal((await ev(`window.nativeTimerRequest(${JSON.stringify(command)},'accelerator')`)).reason,'typing-guard');
    assert.deepEqual(await snapshot(),nativeBefore,`native ${command} escaped typing guard`);
  }
  assert.equal((await ev("window.nativeTimerRequest('stopSound','accelerator')")).ok,true);
  assert.equal((await snapshot()).ringing,false);
  assert.equal((await ev("window.nativeTimerRequest('toggle','pointer')")).ok,true);
  assert.notEqual((await snapshot()).startedAt,null,'native tray click should act immediately');
  await delay(1600);
  assert.equal((await ev("window.nativeTimerRequest('toggle','accelerator')")).ok,true);
  assert.equal((await snapshot()).startedAt,null,'native accelerator should act after quiet');
  c.assertHealthy();
  console.log('PASS: typing bursts, quiet reset, Cmd+., held Space, focused Later, clicks, recovery and native attention');
} finally {
  await c.close(); await server?.close();
}
