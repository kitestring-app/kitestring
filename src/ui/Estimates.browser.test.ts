// Disposable headless Chrome only; no installed app or personal profile.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from '../../scripts/golden.mjs';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe.skipIf(process.env.PHONE_BROWSER !== '1')('task estimates and recorded active time', () => {
  const chrome = new Chrome(); let server: ViteDevServer;
  const page = (body: string) => chrome.evaluate(`(async()=>{
    const s=await import('/src/state/settings.ts'), k=await import('/src/state/tasks.ts'),
    t=await import('/src/state/timer.ts'), h=await import('/src/state/stats.ts'); ${body}
  })()`);
  beforeAll(async () => {
    server = await createServer({ configLoader: 'runner', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' });
    await server.listen(); const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('No server');
    chrome.origin = `http://127.0.0.1:${address.port}`; await chrome.start();
    await chrome.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await chrome.send('Page.navigate', { url: chrome.origin });
    await chrome.waitFor("document.querySelector('.next-action')");
    await chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return import('/src/lib/store.ts').then(s=>s.canWriteClockStore('timer'))})");
    await page(`await s.calmFoundationReady; s.settingsUpdate('timer', {...s.CALM_PATCH,display:'hidden'});
      s.settingsUpdate('extras',{reduceMotion:true});
      k.tasks.set([{id:'old',title:'Draft project outline',done:true,etaMin:20,createdAt:Date.now()},
        {id:'new',title:'Draft project outline',done:false,createdAt:Date.now()}]);
      h.stats.set({chunks:[{id:'work',taskId:'old',kind:'focus',segment:'focus',start:Date.now()-900000,ms:900000,completed:false}],tasksDone:[]});`);
    await chrome.evaluate("document.querySelector('[data-panel=tasks]').click()");
    await chrome.waitFor("document.querySelector('.tasks-panel:not([hidden])')");
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });
  it('shows neutral comparisons and history, accepts custom and preset guesses in every look without overflow', async () => {
    const shots = process.env.SHOTS_DIR ?? join(tmpdir(), '81-estimates-shots'); await mkdir(shots, { recursive: true });
    for (const look of ['classic','glass','sketch','companion','sunrise']) {
      await page(`s.settingsUpdate('appearance',{look:'${look}'});`);
      await chrome.waitFor("document.querySelector('[data-task-id=old] .task-comparison')");
      expect(await chrome.evaluate("document.querySelector('[data-task-id=old] .task-comparison').textContent")).toContain('Guess: about 20 min');
      expect(await chrome.evaluate("document.querySelector('[data-task-id=old] .task-comparison').textContent")).toContain('Recorded active time: 15 min');
      await chrome.evaluate("document.querySelector('[aria-label=\"Estimate for Draft project outline\"][aria-haspopup=dialog]').click()");
      await chrome.waitFor("document.querySelector('.tasks-popover')");
      expect(await chrome.evaluate("document.querySelector('.tasks-popover').textContent")).toContain('Similar completed tasks');
      await chrome.evaluate("[...document.querySelectorAll('.tasks-popover button')].find(b=>b.textContent==='Remove estimate').focus()");
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      expect(await chrome.evaluate("document.activeElement.tagName")).toBe('SUMMARY');
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      expect(await chrome.evaluate("document.querySelector('.tasks-popover details').open")).toBe(true);
      await chrome.evaluate(`(()=>{const el=document.querySelector('[aria-label="Custom estimate in minutes"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'37');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await chrome.evaluate("document.querySelector('.tasks-custom-eta').requestSubmit()");
      await chrome.waitFor("import('/src/state/tasks.ts').then(k=>k.tasks.get().find(t=>t.id==='new').etaMin===37)");
      expect(await chrome.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
      expect(await chrome.evaluate("document.querySelector('.tasks-summary').textContent")).not.toMatch(/remaining|Done by|current focus progress/);
      await writeFile(join(shots, `${look}-phone.png`), await chrome.png());
    }
    await page("k.updateTask('old',{etaMin:undefined});");
    await chrome.waitFor("document.querySelector('[data-task-id=old] .task-comparison')?.textContent.includes('No guess')");
    expect(await chrome.evaluate("document.querySelector('[data-task-id=old] .task-comparison').textContent")).toContain('Recorded active time: 15 min');
    // Complete while running: the task-change subscriber banks the current partial focus.
    await page(`t.timerActions.start();t.timer.set({...t.timer.get(),startedAt:Date.now()-120000});k.toggleTaskGroup('new');`);
    await chrome.waitFor("document.querySelector('[data-task-id=new] .task-comparison')?.textContent.includes('2 min')");
    await page(`t.timerActions.stop();`);
    await chrome.evaluate("document.querySelector('[aria-label=\"Estimate for Draft project outline\"]').click()");
    await chrome.waitFor("document.querySelector('.tasks-popover')");
    await chrome.evaluate("[...document.querySelectorAll('.tasks-estimates button')].find(b=>b.textContent==='20').click()");
    await chrome.waitFor("!document.querySelector('.tasks-popover')");
    expect(await chrome.evaluate("document.activeElement.getAttribute('aria-label')")).toBe('Estimate for Draft project outline');
    chrome.assertHealthy();
  }, 30000);
  it('keeps expanded similar-task history inside the viewport near the bottom row', async () => {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: true });
    await page(`s.settingsUpdate('appearance',{look:'classic'});
      const title='Draft project outline with detailed notes for the next planning review and concrete examples from earlier chapters';
      k.tasks.set([...Array.from({length:8},(_,i)=>({id:'filler-'+i,title:'Open task '+i,done:false,createdAt:i})),
        {id:'target',title,done:false,createdAt:10},
        ...Array.from({length:3},(_,i)=>({id:'history-'+i,title:title+' version '+i,done:true,etaMin:20,createdAt:i}))]);
      h.stats.set({tasksDone:[],chunks:Array.from({length:3},(_,i)=>({id:'chunk-'+i,taskId:'history-'+i,kind:'focus',segment:'focus',start:0,ms:60000,completed:false}))});`);
    await chrome.waitFor("document.querySelector('[data-task-id=target] .task-eta')");
    await chrome.evaluate("document.querySelector('[data-task-id=target] .task-eta').scrollIntoView({block:'end'})");
    await chrome.evaluate("document.querySelector('[data-task-id=target] .task-eta').click()");
    await chrome.waitFor("document.querySelector('.tasks-popover details')");
    await chrome.evaluate("document.querySelector('.tasks-popover details').open=true");
    await chrome.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const bounds = await chrome.evaluate("(()=>{const r=document.querySelector('.tasks-popover').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()");
    expect(bounds.top).toBeGreaterThanOrEqual(8);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height - 8);
    await chrome.evaluate("document.querySelector('.tasks-popover li:last-child').scrollIntoView({block:'nearest'})");
    expect(await chrome.evaluate("(()=>{const row=document.querySelector('.tasks-popover li:last-child').getBoundingClientRect();return row.top>=8 && row.bottom<=innerHeight-8;})()")).toBe(true);
    chrome.assertHealthy();
  }, 30000);

  it('ignores queued unchanged scroll and resize events, but closes when geometry changes', async () => {
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await chrome.waitFor("!document.querySelector('.tasks-popover')");
    await chrome.evaluate("document.querySelector('[data-task-id=target] .task-eta').click()");
    await chrome.waitFor("document.querySelector('.tasks-popover')");
    await chrome.evaluate("document.querySelector('.tasks-body').dispatchEvent(new Event('scroll'))");
    await chrome.evaluate("new Promise(r=>requestAnimationFrame(r))");
    expect(await chrome.evaluate("!!document.querySelector('.tasks-popover')")).toBe(true);
    await chrome.evaluate("window.dispatchEvent(new Event('resize'))");
    await chrome.evaluate("new Promise(r=>requestAnimationFrame(r))");
    expect(await chrome.evaluate("!!document.querySelector('.tasks-popover')")).toBe(true);
    expect(await chrome.evaluate("(()=>{const e=document.querySelector('.tasks-body'),before=e.scrollTop;e.scrollTop=before>0?before-1:before+1;return e.scrollTop!==before})()")).toBe(true);
    await chrome.waitFor("!document.querySelector('.tasks-popover')");
    await chrome.evaluate("document.querySelector('[data-task-id=target] .task-eta').click()");
    await chrome.waitFor("document.querySelector('.tasks-popover')");
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 321, height: 820, deviceScaleFactor: 1, mobile: true });
    await chrome.waitFor("!document.querySelector('.tasks-popover')");
  });

  it.each(['null guess','empty history'])('handles %s without misleading text or empty spacing', async scenario => {
    await page("k.tasks.set([{id:'missing',title:'Unmatched topic',done:true,etaMin:null,createdAt:1},{id:'open',title:'Different activity',done:false,createdAt:2}]);");
    await chrome.waitFor("document.querySelector('[data-task-id=missing] .task-comparison')");
    if(scenario==='null guess'){
      await page("await (await import('/src/lib/store.ts')).flushReadyStores();");
      await chrome.reload("document.querySelector('.next-action')");
      await chrome.evaluate("document.querySelector('[data-panel=tasks]').click()");
      await chrome.waitFor("document.querySelector('[data-task-id=missing] .task-comparison')");
      expect(await chrome.evaluate("document.querySelector('[data-task-id=missing] .task-comparison').textContent")).toContain('No guess');
    }else{
      await chrome.evaluate("document.querySelector('[data-task-id=open] .task-eta').click()");
      await chrome.waitFor("document.querySelector('.tasks-popover')");
      expect(await chrome.evaluate("!!document.querySelector('.tasks-popover .task-comparison')")).toBe(false);
      await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    }
  });

});
