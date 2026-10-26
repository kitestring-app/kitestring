import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';

const shots = process.env.PHONE_SHOTS_DIR || (process.env.SHOTS_DIR ? `${process.env.SHOTS_DIR}/phone` : '.agents/jobs/51-shots');
const c = new Chrome();
const results = [];
const phoneSizes = [[320,568],[375,500],[390,600],[375,667],[390,844],[430,932]];
let server;
const ev = code => c.evaluate(code);
async function settle() { await ev('document.fonts.ready'); await delay(100); }
async function seed(look, view) {
  await ev(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/state/intent.ts'),import('/src/state/tasks.ts'),import('/src/state/returnActivity.ts'),import('/src/state/parkingReview.ts'),import('/src/state/notes.ts')]).then(async([s,t,i,k,a,p,n])=>{
    await s.calmFoundationReady; t.timerActions.stop();
    a.returnActivity.set({...a.returnActivity.get(),pendingGap:null});p.parkingReview.set({...p.parkingReview.get(),review:null});
    const next=structuredClone(s.DEFAULT_SETTINGS); next.dash=${JSON.stringify(view==='home'||view==='ambient'?view:'focus')};next.appearance.look=${JSON.stringify(look)};
    next.clock={...next.clock,format:'24',seconds:false};next.lastTab=${JSON.stringify(view.startsWith('settings-')?view.slice(9):'themes')};
    next.extras={...next.extras,reduceMotion:true,preventSleep:false,clearMode:false,disableAnimated:true};
    next.timer={...next.timer,takeover:false,speak:false,notify:false,bringToFront:false,interruptionPrompt:false,autoRun:'off',ticking:'off',alertSound:'none',focusDoneSound:'none',breakOverSound:'none'};
    s.settings.set(next);i.updateIntent({action:'Write the opening paragraph',why:'Make the first draft easy to review',cue:'After tea, open the draft'});
    k.tasks.set(Array.from({length:16},(_,j)=>({id:'phone-'+j,title:j===0?'Draft the proposal':'Review paragraph '+j,etaMin:15,done:j===2,createdAt:Date.now()+j})));k.focusPick.set(null);
    if(${JSON.stringify(view)}==='focus-gap'){i.updateIntent({action:'A useful next action with enough context to review later. '.repeat(12).slice(0,500)});a.returnActivity.set({...a.returnActivity.get(),pendingGap:'phone-gap',uncertain:false});}
    n.setNotesText('Draft notes\\n\\n'+('A useful paragraph for the next session.\\n\\n').repeat(18));
    if(${JSON.stringify(view)}==='focus-running'||${JSON.stringify(view)}==='focus-reentry'){t.timerActions.start();if(${JSON.stringify(view)}==='focus-reentry')t.timerActions.pause();}
  })`);
  await settle();
}
async function geometry(label) {
  const r=await ev(`(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const visible=e=>{if(e.closest('[hidden],[inert]'))return false;const s=getComputedStyle(e),r=rect(e);return s.visibility!=='hidden'&&s.display!=='none'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth};
    const errors=[],controls=[];
    for(const e of document.querySelectorAll('button,a,input,select,textarea,summary,[role="button"]')){
      if(!visible(e))continue;
      let target=e;if(e instanceof HTMLInputElement&&['checkbox','radio'].includes(e.type)&&e.closest('label'))target=e.closest('label');
      const r=rect(target);controls.push({name:e.getAttribute('aria-label')||e.textContent.trim().slice(0,50)||e.className,...r});
      if(r.width<43.9||r.height<43.9)errors.push('small target '+controls.at(-1).name+' '+r.width+'x'+r.height);
    }
    for(const button of document.querySelectorAll('.controls button')) {
      const r=rect(button);
      if(r.left<-.5||r.right>innerWidth+.5)errors.push('focus button outside viewport '+button.getAttribute('aria-label'));
    }
    const top=rect(document.querySelector('.topbar')),bottom=rect(document.querySelector('.bottombar')),center=rect(document.querySelector('.center'));
    const hit=(a,b)=>a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5;
    const sheet=document.querySelector('.panel:not([hidden])'),drawer=document.querySelector('.drawer');
    if(!drawer){
      if(center.top<top.bottom-.5||center.bottom>bottom.top+.5)errors.push('middle overlaps bars');
      const parts=['.topbar .seg','.topbar > .row','.dock','.credits'].map(s=>rect(document.querySelector(s)));
      for(const r of parts)if(r.left<-.5||r.right>innerWidth+.5||r.top<-.5||r.bottom>innerHeight+.5)errors.push('bar outside viewport');
      if(hit(parts[0],parts[1])||hit(parts[2],parts[3]))errors.push('bar controls overlap');
      if(sheet){const sr=rect(sheet);if(sr.top<top.bottom-.5||sr.bottom>bottom.top+.5)errors.push('sheet overlaps bars');if(sr.width!==innerWidth)errors.push('sheet not full width');if(sr.height>innerHeight*.85+.5)errors.push('sheet too tall');}
      else {
        const flow=[...document.querySelector('.center').children].filter(e=>{const s=getComputedStyle(e);return visible(e)&&!['absolute','fixed'].includes(s.position)}).map(e=>({name:e.className,...rect(e)}));
        for(let j=0;j<flow.length;j++){if(flow[j].left<-.5||flow[j].right>innerWidth+.5)errors.push('middle horizontal overflow '+flow[j].name);for(let k=j+1;k<flow.length;k++)if(hit(flow[j],flow[k]))errors.push('middle overlap '+flow[j].name+'/'+flow[k].name);}
      }
    }else{const close=rect(document.querySelector('.settings-close'));if(close.top<0||close.bottom>innerHeight||close.right>innerWidth)errors.push('settings close out of view');}
    return {errors,controls,top,bottom,center,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  })()`);
  assert.deepEqual(r.errors,[],`${label}: ${JSON.stringify(r.errors)}`);
  assert.equal(r.pageWidth,r.viewport,`${label}: horizontal page scroll`);
  results.push({label,...r});
}
async function internalScroll(selector) {
  const r=await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollTop=el.scrollHeight;const result={client:el.clientHeight,height:el.scrollHeight,scrolled:el.scrollTop,overflow:getComputedStyle(el).overflowY,page:document.documentElement.scrollTop};el.scrollTop=0;return result})()`);
  assert.ok(r.height>r.client,`${selector} should have long fixture`);assert.ok(r.scrolled>0,`${selector} must scroll internally`);assert.equal(r.page,0);assert.match(r.overflow,/auto|scroll/);
}
async function alarmGeometry(label) {
  const result = await ev(`(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    const toast=document.querySelector('.alarm-toast'),center=document.querySelector('.center'),dock=document.querySelector('.bottombar');
    const controls=[...document.querySelectorAll('.alarm-toast button,.controls button')].filter(e=>!e.disabled).map(e=>{
      const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {label:e.getAttribute('aria-label')||e.textContent.trim(),reachable:!!hit&&(hit===e||e.contains(hit))};
    });
    return {toast:rect(toast),dock:rect(dock),centerVisible:getComputedStyle(center).visibility,controls,width:innerWidth};
  })()`);
  await writeFile(`${shots}/${label}.png`,await c.png());
  assert.equal(result.centerVisible,'visible',`${label}: timer must stay visible during alarm`);
  assert.ok(result.toast.left>=0&&result.toast.right<=result.width,`${label}: toast must fit on screen ${JSON.stringify(result.toast)}`);
  assert.ok(result.toast.top>=0&&result.toast.bottom<=result.dock.top,`${label}: toast must sit above dock and safe area ${JSON.stringify(result)}`);
  assert.ok(result.controls.length>=3,`${label}: alarm and timer controls must be present`);
  assert.deepEqual(result.controls.filter(control=>!control.reachable),[],`${label}: controls must be reachable`);
  results.push({label,...result});
}
async function recoveryGeometry(label) {
  // Dashboard scrolling may reveal a card; nothing inside it may clip its fixed controls.
  const result = await ev(`(()=>{
    const card=document.querySelector('.recovery-card'),body=card.querySelector('.focus-card-body');
    const bounds=card.getBoundingClientRect();
    const clipped=[...card.querySelectorAll('button')].filter(button=>{
      const r=button.getBoundingClientRect();
      return r.top<bounds.top||r.bottom>bounds.bottom||r.left<bounds.left||r.right>bounds.right;
    }).map(button=>button.textContent.trim()||button.getAttribute('aria-label'));
    return {clipped,bodyHeight:body?.clientHeight??null};
  })()`);
  assert.deepEqual(result.clipped,[],`${label}: recovery controls clipped inside card`);
  if(result.bodyHeight!==null)assert.ok(result.bodyHeight>=16,`${label}: body must remain readable`);
  for(const index of await ev(`[...document.querySelectorAll('.recovery-card button')].map((_,i)=>i)`)){
    const reachable=await ev(`(()=>{
      const b=document.querySelectorAll('.recovery-card button')[${index}];b.scrollIntoView({block:'nearest'});
      const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return !!hit&&(hit===b||b.contains(hit));
    })()`);
    assert.equal(reachable,true,`${label}: recovery control ${index} is unreachable`);
  }
  results.push({label:label+'-recovery',...result});
}
async function startAlarm() {
  await ev(`import('/src/state/timer.ts').then(async t=>{
    t.timerActions.start();
    // Exercise the actual live completion path without playing an audible sample.
    const s=await import('/src/state/settings.ts');s.settingsUpdate('timer',{focusDoneSound:'bell'});
    t.timer.set({...t.timer.get(),startedAt:Date.now()-t.totalMs()});
    t.timerActions.complete(t.timer.get().segId);
  })`);
  await c.waitFor("document.querySelector('.alarm-toast')");
  await settle();
}
try {
  await mkdir(shots,{recursive:true});
  server=await createServer({configLoader:'runner',server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'error',plugins:[{name:'phone-signed-out-fixture',configureServer(s){s.middlewares.use('/api/me',(_req,res)=>{res.statusCode=401;res.setHeader('Content-Type','application/json');res.end('{"error":"Signed out"}');});}}]});await server.listen();
  c.origin=`http://127.0.0.1:${server.httpServer.address().port}`;await c.start();
  await c.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await c.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`{const D=Date,now=${Date.parse('2026-10-26T09:24:00Z')};window.Date=new Proxy(D,{construct:(t,a)=>Reflect.construct(t,a.length?a:[now]),get:(t,k)=>k==='now'?()=>now:Reflect.get(t,k)});}`});
  await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await c.send('Page.navigate',{url:c.origin});await c.waitFor("document.querySelector('.next-action')");
  assert.equal(await ev("matchMedia('(pointer: coarse)').matches"),true);
  // Drive the real signed-out status branch using a local 401, never a cloud account.
  await ev(`import('/src/lib/sync.ts').then(s=>s.cloudRequest('GET','/api/me').catch(()=>{}))`);
  await c.waitFor("document.querySelector('.topbar .btn')");
  const manifest=await ev("fetch('/manifest.webmanifest').then(r=>r.json())");assert.equal(manifest.name,'Kitestring');assert.equal(manifest.display,'standalone');
  for(const [size,purpose] of [['192x192','any'],['512x512','any'],['512x512','maskable']]) assert.ok(manifest.icons.some(icon=>icon.sizes===size&&icon.purpose.split(' ').includes(purpose)),`missing ${size} ${purpose} icon`);
  for(const path of ['/apple-touch-icon.png',...manifest.icons.map(i=>i.src)])assert.equal(await ev(`fetch(${JSON.stringify(path)}).then(r=>r.ok)`),true);
  assert.equal(await ev(`document.querySelector('meta[name="viewport"]').content.includes('viewport-fit=cover')`),true);
  assert.equal(await ev(`document.querySelector('meta[name="apple-mobile-web-app-capable"]').content`),'yes');
  assert.equal(await ev(`navigator.serviceWorker.getRegistrations().then(r=>r.length)`),0);
  for(const [width,height]of phoneSizes)for(const look of ['classic','glass','sketch','companion','sunrise']){
    await c.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await seed(look,'focus-idle');await startAlarm();
    assert.equal(await ev('innerWidth'),width,'phone viewport must not expand to fit overflow');
    await alarmGeometry(`${width}x${height}-${look}-focus-alarm`);
    await ev(`document.querySelector('.alarm-toast button').click()`);
    await c.waitFor("!document.querySelector('.alarm-toast')");
  }
  const views=['home','focus-idle','focus-running','focus-reentry','focus-gap','ambient','settings-themes','settings-clock','settings-timer','tasks','sounds','notes'];
  for(const [width,height]of phoneSizes)for(const look of ['classic','glass','sketch','companion','sunrise'])for(const view of views){
    await c.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await seed(look,view);
    if(view.startsWith('settings-')){await ev(`document.querySelector('[aria-label="Settings (S)"]').click()`);await c.waitFor("document.querySelector('.drawer')");}
    else if(['tasks','sounds','notes'].includes(view)){await ev(`document.querySelector('[data-panel="${view}"]').click()`);await c.waitFor("document.querySelector('.panel:not([hidden])')");if(view==='sounds')await c.waitFor(`!document.querySelector('.sounds-panel').textContent.includes('Loading your mixes')`);}
    else if(view==='focus-reentry'||view==='focus-gap')await c.waitFor("document.querySelector('.recovery-card')");
    await settle();
    if(view==='focus-gap'||view==='focus-reentry')await recoveryGeometry(`${width}x${height}-${look}-${view}`);
    assert.equal(await ev('innerWidth'),width,'phone viewport must not expand to fit overflow');
    const name=`${width}x${height}-${look}-${view}`;await geometry(name);
    if(view==='focus-gap'&&height<=600)await internalScroll('.focus-card-body');
    if(view.startsWith('settings-')){await internalScroll('.drawer main');await geometry(name+'-scrolled');}
    if(['tasks','sounds','notes'].includes(view))await internalScroll('.panel:not([hidden]) .panel-body');
    await writeFile(`${shots}/${name}.png`,await c.png());
    assert.equal(await ev(`document.querySelector('meta[name="theme-color"]').content===getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`),true);
    if(view.startsWith('settings-'))await ev(`document.querySelector('.settings-close').click()`);
    if(['tasks','sounds','notes'].includes(view))await ev(`document.querySelector('.panel:not([hidden]) .panel-head button').click()`);
  }
  // Drag with real touch events so a scroll gesture cannot silently cancel reordering.
  await seed('glass','tasks');
  await ev(`document.querySelector('[data-panel="tasks"]').click()`);await settle();
  assert.equal(await ev(`getComputedStyle(document.querySelector('.task-drag')).touchAction`),'none');
  const drag=await ev(`(()=>{const rows=[...document.querySelectorAll('.tasks-list > .task-group')];const a=rows[0].querySelector('.task-drag').getBoundingClientRect(),b=rows[1].getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,end:b.bottom-8}})()`);
  await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:drag.x,y:drag.y}]});
  for(let j=1;j<=8;j++){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:drag.x,y:drag.y+(drag.end-drag.y)*j/8}]});await delay(20);}
  await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await c.waitFor(`document.querySelector('.tasks-list .task-title').value==='Review paragraph 1'`);
  await ev(`document.querySelector('.tasks-close').click()`);
  // Safe-area emulation checks the actual env() padding, including the dock and sheet offset.
  await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:30,bottom:20,left:8,right:8}});
  await seed('glass','home');await geometry('safe-area-home');
  assert.equal(await ev(`parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingTop)`),38);
  assert.equal(await ev(`parseFloat(getComputedStyle(document.querySelector('.bottombar')).paddingBottom)`),24);
  await seed('glass','focus-idle');await startAlarm();await alarmGeometry('safe-area-alarm');
  await ev(`document.querySelector('[aria-label="Stop sound and pause"]').click()`);
  await c.waitFor("!document.querySelector('.alarm-toast')");
  await seed('glass','home');
  await ev(`document.querySelector('[data-panel="tasks"]').click()`);await settle();await geometry('safe-area-tasks');
  await ev(`document.querySelector('.tasks-close').click();document.querySelector('[aria-label="Settings (S)"]').click()`);await settle();await geometry('safe-area-settings');
  await ev(`document.querySelector('.settings-close').click()`);
  await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,left:0,right:0}});
  // Landscape notches and home indicators also apply beyond the portrait breakpoint.
  await c.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:21,left:44,right:44}});
  await seed('glass','home');
  const insets=async()=>ev(`(()=>{const css=s=>getComputedStyle(document.querySelector(s));const top=css('.topbar'),bottom=css('.bottombar');return {left:parseFloat(top.paddingLeft),right:parseFloat(top.paddingRight),bottom:parseFloat(bottom.paddingBottom)}})()`);
  assert.deepEqual(await insets(),{left:44,right:44,bottom:39});
  await ev(`document.querySelector('[data-panel="tasks"]').click()`);await settle();
  assert.equal(await ev(`parseFloat(getComputedStyle(document.querySelector('.tasks-panel')).paddingLeft)`),44);
  await ev(`document.querySelector('.tasks-close').click();document.querySelector('[aria-label="Settings (S)"]').click()`);await settle();
  assert.equal(await ev(`parseFloat(getComputedStyle(document.querySelector('.settings-header')).paddingRight)`),44);
  assert.equal(await ev(`parseFloat(getComputedStyle(document.querySelector('.drawer main')).paddingBottom)`),101);
  await ev(`document.querySelector('.settings-close').click();document.documentElement.dataset.desktop='true'`);
  assert.deepEqual(await insets(),{left:22,right:22,bottom:18},'native renderer never gets mobile insets');
  await ev(`document.documentElement.dataset.desktop='false'`);
  await c.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  assert.deepEqual(await insets(),{left:22,right:22,bottom:18},'desktop fine pointers retain their layout');
  await c.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await c.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,left:0,right:0}});
  // A shorter dynamic viewport keeps actions reachable, as browser chrome/keyboard reduces space.
  await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:500,deviceScaleFactor:1,mobile:true});
  await seed('glass','focus-reentry');await geometry('short-dynamic-viewport');
  assert.equal(await ev(`document.querySelector('.app').getBoundingClientRect().height`),500);
  await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  // Touch wakes hidden inert chrome, and cannot leave a tooltip open.
  await seed('glass','focus-running');await ev(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('extras',{clearMode:true}))`);
  await c.waitFor("document.querySelector('.app.idle')");
  await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:190,y:300}]});await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await c.waitFor("!document.querySelector('.app.idle') && !document.querySelector('.topbar').inert");
  await ev(`document.querySelector('[aria-label="Settings (S)"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'touch'}))`);await delay(350);
  assert.equal(await ev(`!!document.querySelector('.control-tooltip:not([hidden])')`),false);
  await ev(`void Object.defineProperty(window,'documentPictureInPicture',{value:undefined,configurable:true})`);
  // Force a render after removing the API, as on iPhone Safari.
  await seed('glass','focus-idle');assert.equal(await ev(`getComputedStyle(document.querySelector('[aria-label="Floating timer"]')).display`),'none');
  c.assertHealthy();await writeFile(`${shots}/measurements.json`,JSON.stringify({browser:c.version,results},null,2));
  console.log(`PASS: ${results.length} phone layout states; ${phoneSizes.length*5*(views.length+1)+1} screenshots; alarm controls, hosted sign-in, internal scroll, touch wake, tooltips, PiP and install metadata`);
} finally {await c.close();await server?.close();}
