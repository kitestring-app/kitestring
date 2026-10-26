import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';

const shots = process.env.SHOTS_DIR || '.agents/jobs/50-shots';
const looks = ['classic', 'glass', 'sketch', 'companion', 'sunrise'];
const sizes = [[720,540],[800,600],[1000,700],[1280,820]];
const c = new Chrome();
const results = [];
let server;
const ev = expression => c.evaluate(expression);
async function settle() { await ev('document.fonts.ready'); await delay(90); }
async function size(width,height) { await c.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false}); }
async function shot(name) { await writeFile(`${shots}/${name}.png`, await c.png()); }
async function seed({look='glass',style='default',huge=false,card=false,dash='focus',long=false}={}) {
  await ev(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/state/intent.ts'),import('/src/state/tasks.ts'),import('/src/state/returnActivity.ts'),import('/src/state/parkingReview.ts')]).then(async([s,t,i,k,a,p])=>{
    await s.calmFoundationReady;t.timerActions.stop(); k.tasks.set([]);k.focusPick.set(null);
    a.returnActivity.set({...a.returnActivity.get(),pendingGap:null});p.parkingReview.set({...p.parkingReview.get(),review:null});
    const next=structuredClone(s.DEFAULT_SETTINGS);
    next.dash=${JSON.stringify(dash)};next.appearance.look=${JSON.stringify(look)};
    next.clock={...next.clock,size:${JSON.stringify(huge?'huge':'regular')},flip:${style==='flip'},format:'24',seconds:false};
    next.extras={...next.extras,reduceMotion:true,clearMode:false,preventSleep:false,disableAnimated:true};
    next.timer={...next.timer,style:${JSON.stringify(style)},takeover:false,notify:false,speak:false,bringToFront:false,interruptionPrompt:false,autoRun:'off',ticking:'off'};
    next.quotes={...next.quotes,inFocus:true,inHome:true};s.settings.set(next);
    i.updateIntent({action:${JSON.stringify(long?'A long action '.repeat(35):'Write the opening paragraph')},why:'Make the first draft easy to review',cue:${JSON.stringify(long?'After tea '.repeat(48):'After tea, open the draft')},reward:'A short walk outside'});
    ${card?'t.timerActions.start();t.timerActions.pause();':''}
    ${long&&card?"i.updateIntent({action:'A newer action'});":''}
  })`);
  await c.waitFor(`document.documentElement.dataset.look === '${look}' && !!document.querySelector('.recovery-card') === ${card && dash==='focus'}`);
  await settle();
}
// This inspects both the painted viewport and the full scrollable middle. Items beyond
// its clip must become fully reachable by scrolling; page scrolling is never allowed.
async function geometry(label) {
  const layout = await ev(`(() => {
    const center=document.querySelector('.center');center.scrollTop=0;
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const cr=rect(center), top=rect(document.querySelector('.topbar')), bottom=rect(document.querySelector('.bottombar'));
    const selectors=['.headline','.tabs','.tallies',':scope > .timer.big',':scope > .timer-face','.clock-row','.next-action','.controls','.focus-card-slot','.start-support','.quote'];
    const flow=selectors.flatMap(s=>[...center.querySelectorAll(s)]).filter(e=>e.getBoundingClientRect().height && getComputedStyle(e).position!=='absolute').map(e=>({name:e.className,...rect(e)}));
    const errors=[];
    const hit=(a,b)=>a.left<b.right-.5 && a.right>b.left+.5 && a.top<b.bottom-.5 && a.bottom>b.top+.5;
    for(let i=0;i<flow.length;i++){
      const a=flow[i];if(a.left < -.5 || a.right > innerWidth+.5)errors.push('horizontal overflow '+a.name);
      if(a.top < cr.top-.5)errors.push('clipped start '+a.name);
      for(let j=i+1;j<flow.length;j++)if(hit(a,flow[j]))errors.push('overlap '+a.name+' / '+flow[j].name);
    }
    // Middle is bounded by the real bars; painted scroll content cannot overlap them.
    if(cr.top<top.bottom-.5 || cr.bottom>bottom.top+.5)errors.push('middle overlaps chrome');
    for(const s of ['.topbar .seg','.topbar > .row','.dock','.credits']){
      const el=document.querySelector(s);if(!el)continue;const r=rect(el);
      if(r.left<-.5 || r.right>innerWidth+.5 || r.top<-.5 || r.bottom>innerHeight+.5)errors.push('outside viewport '+s);
    }
    const dock=document.querySelector('.dock'), footer=document.querySelector('.credits');
    if(dock&&footer&&hit(rect(dock),rect(footer)))errors.push('dock/footer overlap');
    const reachable=[];
    for(const s of ['.next-action-buttons button','.controls button','.recovery-buttons button','.recovery-heading button','.start-support button'])for(const b of center.querySelectorAll(s)){
      b.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=rect(b);
      if(r.top<cr.top-.5 || r.bottom>cr.bottom+.5)errors.push('unreachable '+s);
      reachable.push(b.textContent||b.getAttribute('aria-label'));
    }
    const card=center.querySelector('.recovery-card');
    if(card){const r=rect(card),body=card.querySelector('.focus-card-body');if(body && body.clientHeight<16)errors.push('card body clipped');
      for(const b of card.querySelectorAll('button')){const br=rect(b);if(br.top<r.top-.5 || br.bottom>r.bottom+.5)errors.push('card button clipped');}}
    center.scrollTop=0;
    return {width:innerWidth,height:innerHeight,errors,flow,reachable,scroll:{client:center.clientHeight,content:center.scrollHeight,overflow:getComputedStyle(center).overflowY},pageScroll:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth};
  })()`);
  assert.deepEqual(layout.errors,[],`${label}: ${JSON.stringify(layout)}`);
  assert.equal(layout.pageScroll,false,label);
  if(layout.scroll.content>layout.scroll.client+1)assert.equal(layout.scroll.overflow,'auto',label);
  results.push({label,...layout});
}
async function key(key,shift=false) { await c.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers:shift?8:0}); await c.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers:shift?8:0}); await delay(30); }
async function settingsPolishChecks(width,look) {
  for(const label of ['Themes','Clock','Focus Timer','Stats','Quotes','Extras','Your data','About']) {
    await ev(`[...document.querySelectorAll('.drawer .tab')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click();document.querySelector('.drawer main').scrollTop=0`);
    await settle();
    const heading=await ev(`(()=>{const h=document.querySelector('.drawer main h1'),s=getComputedStyle(h),p=document.querySelector('.drawer main p');return {title:h.textContent,width:h.getBoundingClientRect().width,height:h.getBoundingClientRect().height,clip:s.clipPath,display:s.display,visibility:s.visibility,descriptionVisible:p.getBoundingClientRect().height>0&&getComputedStyle(p).visibility==='visible'}})()`);
    assert.equal(heading.width,1,`${look} ${label} duplicate title`);assert.equal(heading.height,1);assert.equal(heading.clip,'inset(50%)');assert.notEqual(heading.display,'none');assert.equal(heading.visibility,'visible');assert.equal(heading.descriptionVisible,true);
    const ax=await c.send('Accessibility.getFullAXTree');
    assert.ok(ax.nodes.some(n=>!n.ignored&&n.role?.value==='heading'&&n.name?.value===heading.title&&n.properties?.some(p=>p.name==='level'&&p.value.value===1)),`${look} ${label} accessible body heading`);
    assert.equal(await ev(`document.querySelector('.settings-header h2').textContent`),label);
  }
  await ev(`[...document.querySelectorAll('.drawer .tab')].find(b=>b.textContent.trim()==='Clock').click()`);await settle();
  const previews=await ev(`(()=>{const rgb=c=>c.match(/[\\d.]+/g).map(Number),background=e=>{if(!e)return [0,0,0];const c=rgb(getComputedStyle(e).backgroundColor),a=c[3]??1;return a===1?c.slice(0,3):background(e.parentElement).map((v,i)=>c[i]*a+v*(1-a))},luminance=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);return [...document.querySelectorAll('.flip-palette-picker .face-flip')].map(f=>{const e=f.querySelector('.flip-colon'),s=getComputedStyle(e),ink=luminance(rgb(s.color)),bg=luminance(background(f.closest('.choice')));return {glyph:e.textContent,background:s.backgroundColor,weight:s.fontWeight,faceWeight:getComputedStyle(f).fontWeight,contrast:(Math.max(ink,bg)+.05)/(Math.min(ink,bg)+.05),hinges:[...f.querySelectorAll('.flip-top')].map(e=>getComputedStyle(e).boxShadow)}})})()`);
  assert.equal(previews.length,8);
  for(const p of previews){assert.equal(p.glyph,':');assert.equal(p.background,'rgba(0, 0, 0, 0)');assert.equal(p.weight,p.faceWeight);assert.ok(p.contrast>=4.5,`${look} colon contrast ${p.contrast}`);assert.ok(p.hinges.every(s=>s==='none'));}
  // The dashboard keeps the full-size hinge, even while settings is mounted.
  assert.notEqual(await ev(`getComputedStyle(document.querySelector('.center .face-flip.is-big .flip-top')).boxShadow`),'none');
  if(width<760) {
    assert.equal(await ev(`getComputedStyle(document.querySelector('.drawer nav')).scrollbarWidth`),'none');
    assert.equal(await ev(`getComputedStyle(document.querySelector('.drawer nav'),'::-webkit-scrollbar').display`),'none');
    await ev(`document.querySelector('.drawer nav').scrollLeft=0`);
    const point=await ev(`(()=>{const r=document.querySelector('.drawer nav').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await c.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:180,deltaY:0});
    await c.waitFor(`document.querySelector('.drawer nav').scrollLeft>0`);
    await ev(`document.querySelector('.drawer nav button').focus()`);
    for(let n=0;n<7;n++)await key('Tab');
    assert.equal(await ev(`document.activeElement.textContent.trim()`),'About');
    assert.equal(await ev(`(()=>{const a=document.activeElement.getBoundingClientRect(),n=document.querySelector('.drawer nav').getBoundingClientRect();return a.left>=n.left-.5&&a.right<=n.right+.5})()`),true);
  }
  await ev(`[...document.querySelectorAll('.drawer .tab')].find(b=>b.textContent.trim()==='Your data').click();document.querySelector('.settings-close').focus()`);await settle();
}
async function settingsChecks() {
  for(const [width,height] of [[1280,820],[390,844]])for(const look of looks){
    await size(width,height); await seed({look,style:'flip',huge:true});
    await ev(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('lastTab','data'))`);
    await ev(`document.querySelector('[aria-label="Settings (S)"]').focus();document.querySelector('[aria-label="Settings (S)"]').click()`);
    await c.waitFor("document.querySelector('.drawer')");await settle();
    const header=await ev(`(() => {const d=document.querySelector('.drawer'),b=d.querySelector('.settings-close'),r=b.getBoundingClientRect(),v=b.querySelector('span').getBoundingClientRect(),n=d.querySelector('nav'),a=n.querySelector('[aria-current="true"]'),ar=a.getBoundingClientRect(),nr=n.getBoundingClientRect();return {count:d.querySelectorAll('[aria-label="Close settings · Escape"]').length,outsideNav:!n.contains(b),focus:document.activeElement===b,tap:[r.width,r.height],visible:[v.width,v.height],activeInView:ar.left>=nr.left&&ar.right<=nr.right,title:d.querySelector('header h2').textContent,surfaces:['header','nav','main'].map(s=>getComputedStyle(d.querySelector(s)).backgroundColor)}})()`);
    assert.equal(header.count,1);assert.equal(header.outsideNav,true);assert.equal(header.focus,true);assert.deepEqual(header.tap,[44,44]);assert.deepEqual(header.visible,[36,36]);assert.equal(header.activeInView,true);assert.equal(header.title,'Your data');assert.equal(new Set(header.surfaces).size,1);
    assert.equal(await ev(`[...document.querySelectorAll('.drawer .tab')].every(b=>getComputedStyle(b).whiteSpace==='nowrap')`),true);
    await settingsPolishChecks(width,look);
    // Focus loops around the new first control and the final body control.
    await key('Tab',true);assert.equal(await ev(`document.activeElement.textContent.includes('Delete all data')`),true);
    await key('Tab');assert.equal(await ev(`document.activeElement===document.querySelector('.settings-close')`),true);
    for(const [tab,label] of [['clock','Clock'],['timer','Focus Timer'],['data','Your data']]){
      await ev(`[...document.querySelectorAll('.drawer .tab')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);await settle();
      assert.equal(await ev(`document.querySelector('.settings-header h2').textContent`),label);
      assert.equal(await ev(`(()=>{const a=document.querySelector('.drawer .tab[aria-current="true"]').getBoundingClientRect(),n=document.querySelector('.drawer nav').getBoundingClientRect();return a.left>=n.left-.5&&a.right<=n.right+.5})()`),true);
      assert.equal(await ev(`(()=>{const b=document.querySelector('.settings-close').getBoundingClientRect();document.querySelector('.drawer main').scrollTop=500;document.querySelector('.drawer nav').scrollLeft=1000;const a=document.querySelector('.settings-close').getBoundingClientRect();return a.y===b.y&&a.x===b.x&&a.bottom<=innerHeight})()`),true);
      await ev(`document.querySelector('.drawer main').scrollTop=0;document.querySelector('.drawer .tab[aria-current="true"]').scrollIntoView({block:'nearest',inline:'nearest'})`);
      if(tab==='data'){
        await ev(`[...document.querySelectorAll('.drawer button')].find(b=>b.textContent==='Export settings…').click()`);await settle();
        const toggles=await ev(`({switches:document.querySelectorAll('.data-file-panel input.switch').length,plain:document.querySelectorAll('.data-file-panel input[type=checkbox]:not(.switch)').length,full:document.querySelector('.data-file-panel').textContent.includes('Full backup')})`);
        assert.deepEqual(toggles,{switches:6,plain:0,full:false});
      }else{
        const selected=await ev(`(()=>{const b=document.querySelector('.grid3 .choice[aria-pressed=true]');return {badge:getComputedStyle(b,'::after').content.includes('✓'),bg:getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color,ring:getComputedStyle(b).boxShadow}})()`);
        assert.equal(selected.badge,true);assert.match(selected.ring,/inset/);
        // Compare the very same card before/after selection so palette differences cannot mask inversion.
        const unchanged=await ev(`(()=>{const group=document.querySelector('.grid3'),b=group.querySelector('.choice[aria-pressed=true]');const before=getComputedStyle(b).backgroundColor;group.querySelector('.choice[aria-pressed=false]').click();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r({before,after:getComputedStyle(b).backgroundColor}))));})()`);
        assert.equal(unchanged.before,unchanged.after);
        if(tab==='clock')assert.equal(await ev(`new Set([...document.querySelectorAll('.flip-palette-picker .flip-colon')].map(e=>getComputedStyle(e).backgroundColor+getComputedStyle(e).color)).size`),1);
      }
      await settle();await shot(`${width}x${height}-${look}-settings-${tab}`);
      if(tab==='clock'){
        await ev(`document.querySelector('.flip-palette-picker').scrollIntoView({block:'start',behavior:'instant'})`);
        await settle();await shot(`${width}x${height}-${look}-settings-clock-flip`);
      }
      if(tab==='data'){
        await ev(`(()=>{const file=new File([JSON.stringify({format:'custom-pomodoro-backup',version:2,sections:['settings','sounds','device','focus','images'],data:{settings:{},notes:'hello'},images:[]})],'settings.json',{type:'application/json'}),files=new DataTransfer();files.items.add(file);const input=document.querySelector('[aria-label="Choose settings file"]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await c.waitFor("document.querySelector('[aria-labelledby=settings-import-heading]')");
        const preview=await ev(`(()=>{const p=document.querySelector('[aria-labelledby=settings-import-heading]'),f=p.querySelector('fieldset');return {switches:f.querySelectorAll('input.switch').length,checked:[...f.querySelectorAll('input')].every(e=>e.checked&&!e.disabled),text:f.textContent}})()`);
        assert.equal(preview.switches,2);assert.equal(preview.checked,true);assert.match(preview.text,/Notes/);assert.doesNotMatch(preview.text,/notes characters|Sounds and mixes|This device’s options|Images/);
        await ev(`document.querySelector('[aria-labelledby=settings-import-heading]').scrollIntoView({block:'start',behavior:'instant'})`);
        await settle();await shot(`${width}x${height}-${look}-settings-data-import`);
      }
    }
    await key('Escape');await c.waitFor("!document.querySelector('.drawer')");
    assert.equal(await ev(`document.activeElement===document.querySelector('[aria-label="Settings (S)"]')`),true);
    await ev(`document.querySelector('[aria-label="Settings (S)"]').click()`);await c.waitFor("document.querySelector('.settings-close')");
    await ev(`document.querySelector('.settings-close').click()`);await c.waitFor("!document.querySelector('.drawer')");
    assert.equal(await ev(`document.activeElement===document.querySelector('[aria-label="Settings (S)"]')`),true);
    results.push({label:`settings ${width}x${height} ${look}`,header});
  }
}
try {
  await mkdir(shots,{recursive:true});
  server=await createServer({configLoader:'runner',server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'error'});await server.listen();
  c.origin=`http://127.0.0.1:${server.httpServer.address().port}`;await c.start();
  await c.send('Network.enable');await c.send('Network.setBlockedURLs',{urls:['https://*']});
  await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`{
    const D=Date,now=${Date.parse('2026-10-26T09:24:00Z')};window.Date=new Proxy(D,{construct:(t,a)=>Reflect.construct(t,a.length?a:[now]),get:(t,k)=>k==='now'?()=>now:Reflect.get(t,k)});
    window.desktop={armAlarm:async()=>true,disarmAlarm(){},cancelSpeech(){},release(){},preventSleep(){}};
  }`});
  await size(1280,820);await c.send('Page.navigate',{url:c.origin});await c.waitFor("document.querySelector('.next-action')");
  if(process.argv[2]!=='settings'){
    for(const [width,height]of sizes)for(const look of looks)for(const [style,huge]of [['default',false],['flip',true]])for(const card of [false,true]){
      await size(width,height);await seed({look,style,huge,card});await geometry(`${width}x${height} ${look} ${style} card=${card}`);
      if(huge&&['glass','sketch'].includes(look))await shot(`${width}x${height}-${look}-huge-flip${card?'-card':''}`);
    }
    // All non-flip faces obey the same height budget, including the taller Pie.
    for(const style of ['bar','gauge','pie','dots'])for(const [width,height]of sizes)for(const look of looks)for(const card of [false,true]){
      await size(width,height);await seed({look,style,huge:true,card});await geometry(`${width}x${height} ${look} ${style} card=${card}`);
    }
    for(const [width,height]of sizes)for(const look of looks)for(const style of ['default','flip']){
      await size(width,height);await seed({look,style,huge:true,dash:'home'});await geometry(`home ${width}x${height} ${look} ${style}`);
    }
    // Exercise the last resort with an expanded pin editor and long recovery copy.
    await size(720,540);await seed({style:'flip',huge:true,card:true,long:true});
    await geometry('long recovery at minimum');
    await ev(`document.querySelector('.next-action-buttons button').click()`);await settle();await geometry('pin editor at minimum');
    await seed({style:'flip',huge:true});
    const samples=[];
    for(let height=810;height<=910;height+=2){await size(1280,height);await settle();samples.push([height,await ev("parseFloat(getComputedStyle(document.querySelector('.timer-face')).fontSize)")]);}
    for(let n=1;n<samples.length;n++)assert.ok(Math.abs(samples[n][1]-samples[n-1][1])<8,`timer jumps ${JSON.stringify(samples.slice(n-1,n+1))}`);
    results.push({label:'continuous former 850px breakpoint',samples});
  }
  if(process.argv[2]!=='fit')await settingsChecks();
  c.assertHealthy();await writeFile(`${shots}/browser-${process.argv[2]??'all'}-results.json`,JSON.stringify(results,null,2)+'\n');
  console.log(`PASS: ${results.length} rendered cases; isolated ${c.version}`);
}catch(error){await shot('failure').catch(()=>{});await writeFile(`${shots}/failure.json`,JSON.stringify({error:String(error),last:results.at(-1)},null,2));throw error;}
finally{await c.close();await server?.close();}
