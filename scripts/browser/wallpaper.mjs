import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';
const c = new Chrome(), looks = ['classic','glass','sketch','companion','sunrise'];
const names = ['Classic','Glass','Sketchbook','Companion','Sunrise'];
const shots = process.env.SHOTS_DIR || '.agents/jobs/77-shots';
const contrastResults = [];
const ev = expression => c.evaluate(expression);
const click = selector => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const state = () => ev(`import('/src/state/settings.ts').then(s=>s.settings.get())`);
async function colour(value) {
  await ev(`(()=>{const e=document.querySelector('input[type="color"]');e.value='${value}';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function restore(name) {
  const selector = `[aria-label="Use ${name} default"]`;
  assert.equal(await ev(`!!document.querySelector(${JSON.stringify(selector)})`),true,'restore button exists');
  await ev(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  assert.equal(await ev(`document.activeElement.getAttribute('aria-label')`),`Use ${name} default`);
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await c.waitFor(`!document.querySelector(${JSON.stringify(selector)}) || document.querySelector(${JSON.stringify(selector)}).disabled`);
}
async function readability(value, imagePixel = null) {
  const result = await ev(`(()=>{
    const rgb=s=>s.match(/[\\d.]+/g).map(Number), lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const bg=getComputedStyle(document.querySelector('.bg')),scrim=getComputedStyle(document.querySelector('.scrim')).backgroundImage;
    const under=${JSON.stringify(imagePixel)}??rgb(bg.backgroundColor),stop=rgb(scrim.match(/rgba?\\([^)]*\\)/)[0]),alpha=stop[3]??1;
    const base=under.map((v,i)=>v*(1-alpha)+stop[i]*alpha);
    return {scrim,ratios:['.headline','.next-action-text','.timer'].map(selector=>{const e=document.querySelector(selector);if(!e)throw Error(selector);const color=rgb(getComputedStyle(e).color),alpha=color[3]??1,ink=lum(base.map((v,i)=>color[i]*alpha+v*(1-alpha))),b=lum(base);return {selector,ratio:(Math.max(ink,b)+.05)/(Math.min(ink,b)+.05)}})};
  })()`);
  assert.notEqual(result.scrim,'none');
  for(const r of result.ratios)assert.ok(r.ratio>=4.5,`${value} ${JSON.stringify(r)}`);
  return result;
}
let server;
try {
  await mkdir(shots,{recursive:true});
  server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  c.origin=`http://127.0.0.1:${server.httpServer.address().port}`;await c.start();
  await c.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await c.send('Page.navigate',{url:c.origin});await c.waitFor(`document.querySelector('.next-action')`);
  for(const mac of [false,true])for(const width of [1280,390,320])for(const [i,look] of looks.entries()) {
    await c.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
    await ev(`import('/src/state/settings.ts').then(async s=>{await s.calmFoundationReady;window.desktop=${mac ? '{cloud:{status:async()=>({status:401,data:{ok:false}})}}' : 'undefined'};const v=structuredClone(s.DEFAULT_SETTINGS);v.appearance.look='${look}';v.lastTab='themes';v.extras.reduceMotion=true;v.extras.disableAnimated=true;s.settings.set(v);(await import('/src/state/intent.ts')).updateIntent({action:'Write the opening paragraph'})})`);
    await c.waitFor(`document.documentElement.dataset.look==='${look}'`);
    if(!await ev(`!!document.querySelector('.drawer')`))await click('[aria-label="Settings (S)"]');
    await c.waitFor(`document.querySelector('input[type="color"]:not(:disabled)')`);
    const initial=await ev(`document.querySelector('.bg,.look-bg').outerHTML`);
    for(const value of ['#ffffff','#000000']) {
      await colour(value);
      await c.waitFor(`document.querySelector('.bg')?.style.background==='rgb(${value==='#ffffff'?'255, 255, 255':'0, 0, 0'})'`);
      assert.equal((await state()).appearance.lookBackdrop,false);
      await click('.settings-close');await c.waitFor(`!document.querySelector('.drawer')`);
      if(i>=2)contrastResults.push({look,width,mac,value,...await readability(value)});
      assert.equal(await ev(`document.documentElement.scrollWidth>innerWidth`),false);
      await writeFile(`${shots}/${mac?'mac':'web'}-${width}-${look}-${value.slice(1)}.png`,await c.png());
      await click('[aria-label="Settings (S)"]');await c.waitFor(`document.querySelector('input[type="color"]:not(:disabled)')`);
      assert.equal(await ev(`document.documentElement.scrollWidth>innerWidth || document.querySelector('.drawer main').scrollWidth>document.querySelector('.drawer main').clientWidth`),false);
      const before=await state();
      await restore(names[i]);
      const after=await state();
      assert.deepEqual(after,{...before,appearance:{...before.appearance,lookBackdrop:true},themes:i>=2?before.themes:{...before.themes,focus:{kind:'library',id:'dusk-glass'}}});
      assert.equal(await ev(`document.querySelector('.bg,.look-bg').outerHTML`),initial);
    }
    await ev(`[...document.querySelectorAll('.theme-actions button')].find(b=>b.textContent==='Random theme').click()`);
    assert.equal((await state()).appearance.lookBackdrop,false);await restore(names[i]);
    await colour('#123456');
    await ev(`[...document.querySelectorAll('.theme-actions button')].find(b=>b.textContent==='Apply to all modes').click()`);
    const all=await state();assert.equal(all.appearance.lookBackdrop,false);assert.deepEqual(all.themes.home,all.themes.focus);assert.deepEqual(all.themes.ambient,all.themes.focus);await restore(names[i]);
    await ev(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('appearance',{fx:'grain'}))`);
    // Library, saved custom and successful upload all use the same explicit picker.
    await click('.theme-section .theme-tile:nth-child(2)');assert.equal((await state()).appearance.lookBackdrop,false);await restore(names[i]);assert.equal((await state()).appearance.fx,'grain');await ev(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('appearance',{fx:'none'}))`);
    await ev(`(async()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,8,8);const blob=await new Promise(r=>canvas.toBlob(r));const file=new File([blob],'wallpaper-test.png',{type:'image/png'}),dt=new DataTransfer();dt.items.add(file);const e=document.querySelector('input[type="file"]');e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await c.waitFor(`import('/src/state/settings.ts').then(s=>s.settings.get().themes.focus.kind==='custom')`);
    await c.waitFor(`document.querySelector('.bg')?.style.background.includes('blob:')`);
    assert.equal((await state()).appearance.lookBackdrop,false);
    if(i>=2){await click('.settings-close');await c.waitFor(`!document.querySelector('.drawer')`);contrastResults.push({look,width,mac,value:'white upload',...await readability('white upload',[255,255,255])});await click('[aria-label="Settings (S)"]');await c.waitFor(`document.querySelector('input[type="color"]:not(:disabled)')`);}
    await restore(names[i]);
    await click('.theme-saved .theme-tile');assert.equal((await state()).appearance.lookBackdrop,false);
    await click(`.look-option-${looks[(i+1)%5]}`);
    assert.equal((await state()).themes.focus.kind,'custom');assert.equal((await state()).appearance.lookBackdrop,false);
    await c.waitFor(`document.querySelector('.bg')?.style.background.includes('blob:')`);
    await restore(names[(i+1)%5]);
    await click('.theme-delete');await c.waitFor(`!document.querySelector('.theme-delete') && !document.querySelector('input[type="file"]').disabled`);
    console.log(`PASS: ${mac?'Mac bridge':'Web'} ${width} ${look}`);
  }
  c.assertHealthy();await writeFile(`${shots}/contrast.json`,JSON.stringify(contrastResults,null,2)+'\n');
} finally {await c.close();await server?.close();}
