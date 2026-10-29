import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';

const baseline = process.argv.includes('--web-baseline');
const shots = resolve(process.env.TITLEBAR_SHOTS_DIR || '.agents/jobs/73-evidence/' + (baseline ? 'web-before' : 'candidate'));
const looks = ['classic', 'glass', 'sketch', 'companion', 'sunrise'];
const c = new Chrome();
const results = [];
const startup = [];
const overlays = [];
let server;
const ev = source => c.evaluate(source);
async function settle() {
  await ev(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
}
async function click(selector) {
  const point = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
try {
  await mkdir(shots, { recursive: true });
  server = await createServer({ configLoader: 'runner', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  c.origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await c.start();
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await c.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const RealDate = Date;
    globalThis.Date = new Proxy(RealDate, {
      construct(t,a) { return Reflect.construct(t,a.length?a:[1793006640000]); },
      get(t,p) { return p==='now'?()=>1793006640000:Reflect.get(t,p); }
    });
    Math.random = () => .42;
    const mode = new URLSearchParams(location.search).get('native');
    if (mode) {
      let full = false;
      window.__fullscreenAnswered = false;
      let listener;
      window.__nativeFullscreen = value => { full=value; listener?.(value); };
      window.desktop = {
        platform: mode === 'linux' ? 'linux' : 'darwin', mini: mode === 'mini',
        getFullScreen: mode === 'missing' ? undefined : () => new Promise((resolve, reject) => {
          window.__resolveFullscreen = value => { window.__fullscreenAnswered = true; resolve(value); };
          window.__rejectFullscreen = error => { window.__fullscreenAnswered = true; reject(error); };
        }),
        onFullScreenChange: callback => { listener=callback; return () => { listener=undefined; }; },
        floatTimer: async () => { window.__floatRequested=true; return true; },
        toggleFullScreen: async () => { window.__nativeFullscreen(!full); return full; },
      };
    }
    // Observe the first React commit, before any deferred bridge answer can arrive.
    const firstFrame = new MutationObserver(() => {
      if (!document.querySelector('.app')) return;
      firstFrame.disconnect();
      requestAnimationFrame(() => {
        window.__firstFrame = {
          inset: document.documentElement.classList.contains('mac-titlebar'),
          drag: !!document.querySelector('.native-titlebar'),
          unanswered: !window.__fullscreenAnswered,
        };
      });
    });
    firstFrame.observe(document, {childList:true,subtree:true});
    addEventListener('DOMContentLoaded', () => {
      const s=document.createElement('style');
      s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.append(s);
    });
  ` });
  for (const mode of baseline ? ['web'] : ['web', 'mac', 'fullscreen', 'linux', 'mini', 'race', 'race-windowed', 'null', 'rejected', 'pending', 'missing']) {
    await c.send('Page.navigate', { url: 'about:blank' });
    await c.waitFor("location.href === 'about:blank'");
    await c.send('Storage.clearDataForOrigin', { origin: c.origin, storageTypes: 'all' });
    await c.send('Page.navigate', { url: c.origin + (mode === 'web' ? '' : `/?native=${mode}`) });
    await c.waitFor("document.querySelector('.center') && document.readyState === 'complete'");
    await ev(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts')]).then(async ([s,t])=>{ await s.calmFoundationReady; await t.timerHydrationReady; })`);
    if (!baseline) {
      await c.waitFor('window.__firstFrame');
      const first = await ev('window.__firstFrame');
      const native = !['web', 'linux', 'mini'].includes(mode);
      assert.equal(first.inset, native, `${mode} first frame inset before bridge answer`);
      assert.equal(first.drag, native, `${mode} first frame drag strip before bridge answer`);
      if (native && mode !== 'missing') {
        assert.equal(first.unanswered, true, `${mode} first frame precedes bridge answer`);
        await c.waitFor('window.__resolveFullscreen');
        assert.equal(await ev('window.__fullscreenAnswered'), false, `${mode} bridge read is pending`);
      }
      if (mode === 'race' || mode === 'race-windowed') {
        await ev('window.__nativeFullscreen(true)');
        await c.waitFor("!document.documentElement.classList.contains('mac-titlebar')");
        if (mode === 'race-windowed') {
          await ev('window.__nativeFullscreen(false)');
          await c.waitFor("document.documentElement.classList.contains('mac-titlebar')");
        }
        await ev(`window.__resolveFullscreen(${mode === 'race-windowed'})`);
      } else if (mode === 'rejected') await ev("window.__rejectFullscreen(new Error('Bridge unavailable'))");
      else if (native && !['pending', 'missing'].includes(mode)) {
        await ev(`window.__resolveFullscreen(${mode === 'fullscreen' ? 'true' : mode === 'null' ? 'null' : 'false'})`);
      }
      await settle();
      const expected = native && !['fullscreen', 'race'].includes(mode);
      assert.equal(await ev("document.documentElement.classList.contains('mac-titlebar')"), expected, `${mode} inset after bridge result or newest event`);
      startup.push({mode,first,inset:expected});
    }
    for (const [width,height] of [[720,540],[1280,820]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      for (const look of looks) for (const dash of ['home','focus','ambient']) {
        await ev(`import('/src/state/settings.ts').then(s=>{const next=structuredClone(s.DEFAULT_SETTINGS); next.dash=${JSON.stringify(dash)}; next.appearance.look=${JSON.stringify(look)};next.clock.format='24';next.extras={...next.extras,reduceMotion:true,disableAnimated:true,preventSleep:false};s.settings.set(next);})`);
        await c.waitFor(`document.documentElement.dataset.look === ${JSON.stringify(look)}`);
        await settle();
        if (!baseline) {
          const layout = await ev(`(() => {
            const root=document.documentElement, drag=document.querySelector('.native-titlebar');
            const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
            const controls=[...document.querySelectorAll('.app button,.app a,.app input,.app textarea,.app select')].filter(e=>e.getBoundingClientRect().height && getComputedStyle(e).visibility!=='hidden');
            const bad=controls.filter(e=>{const r=rect(e);return r.top<28&&r.bottom>0}).map(e=>e.getAttribute('aria-label')||e.textContent);
            const center=document.querySelector('.center'), cr=rect(center), top=rect(document.querySelector('.topbar')), bottom=rect(document.querySelector('.bottombar'));
            const unreachable=[];
            for(const b of center.querySelectorAll('button,input,textarea')) { if(!b.getBoundingClientRect().height)continue;b.scrollIntoView({block:'nearest',behavior:'instant'});const r=rect(b);if(r.top<cr.top-.5||r.bottom>cr.bottom+.5)unreachable.push(b.textContent); }
            center.scrollTop=0;
            return {inset:root.classList.contains('mac-titlebar'),drag:drag?rect(drag):null,region:drag?getComputedStyle(drag).webkitAppRegion:null,bad,unreachable,overlap:cr.top<top.bottom-.5||cr.bottom>bottom.top+.5,pageScroll:root.scrollHeight>innerHeight||root.scrollWidth>innerWidth,noDrag:controls.every(e=>getComputedStyle(e).webkitAppRegion==='no-drag')};
          })()`);
          const mac = !['web', 'fullscreen', 'linux', 'mini', 'race'].includes(mode);
          assert.equal(layout.inset, mac, `${mode} inset`);
          if (mac) {
            assert.deepEqual(layout.drag, {left:0,right:width,top:0,bottom:28,width,height:28});
            assert.equal(layout.region,'drag');assert.deepEqual(layout.bad,[]);assert.equal(layout.noDrag,true);
          } else assert.equal(layout.drag,null);
          assert.deepEqual(layout.unreachable,[],`${mode}/${look}/${dash} unreachable`);
          assert.equal(layout.overlap,false,`${mode}/${look}/${dash} bar overlap`);
          assert.equal(layout.pageScroll,false,`${mode}/${look}/${dash} page overflow`);
          results.push({mode,width,height,look,dash,...layout});
        }
        if (mode === 'web' || mode === 'mac') {
          const name=`${mode}-${width}x${height}-${look}-${dash}.png`;
          const directory=mode==='mac'?shots+'-mac':shots;
          await mkdir(directory,{recursive:true});
          await writeFile(`${directory}/${name}`,await c.png());
        }
        if (!baseline && mode === 'mac') {
          // Real hit testing, including the Focus floating control, not DOM click().
          await click('[aria-label="Settings (S)"]');
          await c.waitFor("document.querySelector('.drawer')");
          assert.equal(await ev(`getComputedStyle(document.querySelector('.settings-close')).webkitAppRegion`),'no-drag');
          assert.equal(await ev(`[...document.querySelectorAll('.drawer button')].filter(b=>b.getBoundingClientRect().height).every(b=>b.getBoundingClientRect().top>=28)`),true);
          assert.equal(await ev(`document.elementFromPoint(120,10).classList.contains('native-titlebar')`),true);
          const regions = {settings: await ev('getComputedStyle(document.elementFromPoint(640,10)).webkitAppRegion')};
          await click('.settings-close'); await c.waitFor("!document.querySelector('.drawer')");
          await click('[data-panel="tasks"]'); await c.waitFor("document.querySelector('.tasks-panel')");
          regions.tasks = await ev('getComputedStyle(document.elementFromPoint(640,10)).webkitAppRegion');
          await click('.tasks-close'); await c.waitFor("!document.querySelector('.tasks-panel')");
          await ev(`import('/src/ui/timer/TransitionStore.tsx').then(n=>n.transitionStore.show({segId:${JSON.stringify(`${look}-${width}-${dash}`)},ended:'focus',at:Date.now(),nextSegId:'next',breakSegment:'short',breakRound:1,snoozes:0,autoStarted:true}))`);
          await c.waitFor("document.querySelector('.transition-screen[open]')");
          regions.transition = await ev('getComputedStyle(document.elementFromPoint(640,10)).webkitAppRegion');
          overlays.push({width,height,look,dash,...regions});
          assert.deepEqual(regions, {settings:'no-drag',tasks:'no-drag',transition:'no-drag'}, 'overlay regions at (640,10)');
          await ev('new Promise(resolve=>setTimeout(resolve,450))');
          await c.send('Input.dispatchMouseEvent', {type:'mousePressed',x:640,y:10,button:'left',clickCount:1});
          await c.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:640,y:10,button:'left',clickCount:1});
          await c.waitFor("!document.querySelector('.transition-screen')");
          assert.equal(await ev("getComputedStyle(document.querySelector('.native-titlebar')).webkitAppRegion"), 'drag', 'drag restored after overlays close');
          if(dash==='focus') {
            await ev(`import('/src/state/intent.ts').then(i=>i.updateIntent({action:'A long action '.repeat(35),why:'Keep going',cue:'After tea '.repeat(45),reward:'A short walk'}))`);
            await ev(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('timer',{interruptionPrompt:false,takeover:false,speak:false,notify:false,autoRun:'off',alertSound:'none'}))`);
            await ev(`import('/src/state/timer.ts').then(t=>{t.timerActions.start();t.timer.set({...t.timer.get(),startedAt:Date.now()-2000});t.timerActions.pause();})`);
            await c.waitFor("document.querySelector('.recovery-card')");await settle();
            const recovery=await ev(`(() => {const center=document.querySelector('.center'),cr=center.getBoundingClientRect(),bad=[];for(const b of center.querySelectorAll('button')){if(!b.getBoundingClientRect().height)continue;b.scrollIntoView({block:'nearest',behavior:'instant'});const r=b.getBoundingClientRect();if(r.top<cr.top-.5||r.bottom>cr.bottom+.5)bad.push(b.textContent);}center.scrollTop=0;return bad;})()`);
            assert.deepEqual(recovery,[],`${look}/${width} recovery controls`);
            await ev(`import('/src/state/timer.ts').then(t=>t.timerActions.stop())`);
            await c.waitFor("document.querySelector('.stopped-card')");
            await ev("document.querySelector('.stopped-card [aria-label=Close]').click()");
            await c.waitFor("!document.querySelector('.recovery-card')");
            await click('[aria-label="Floating timer"]'); assert.equal(await ev('window.__floatRequested'),true);
            await click('.topbar .seg button:first-child'); await c.waitFor("document.querySelector('[aria-label=Clock]')");
            await click('.topbar .seg button:nth-child(2)'); await c.waitFor("document.querySelector('.focus-center')");
          }
          await ev('window.__nativeFullscreen(true)');await c.waitFor("!document.documentElement.classList.contains('mac-titlebar') && !document.querySelector('.native-titlebar')");
          await ev('window.__nativeFullscreen(false)');await c.waitFor("document.documentElement.classList.contains('mac-titlebar') && document.querySelector('.native-titlebar')");
        }
      }
    }
  }
  c.assertHealthy();
  await writeFile(`${shots}/geometry.json`,JSON.stringify(results,null,2)+'\n');
  await writeFile(`${shots}/startup.json`,JSON.stringify(startup,null,2)+'\n');
  await writeFile(`${shots}/overlays.json`,JSON.stringify(overlays,null,2)+'\n');
  console.log(`PASS: ${baseline?'web baseline captured':results.length+' titlebar layout cases; native fullscreen, hit targets and scroll reachability'}`);
} finally { await c.close(); await server?.close(); }
