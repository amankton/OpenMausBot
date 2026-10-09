// Isolated synthetic workspace only. Exercises the actual embedded Drive recorder/player.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const flags=process.argv.slice(2);
if(flags.length>1||flags.some(f=>!['--mode=compiled','--mode=deployed'].includes(f)))throw Error('Use --mode=compiled or --mode=deployed');
const mode=flags.includes('--mode=deployed')?'deployed':'compiled';
const origin='http://localhost:18087', workspace='b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb';
const local=join(root,'.chief-local/platform'), logs=join(root,'.chief-local/platform-build-logs'), dist=join(root,'.chief-local/platform-source/dev/prod/dist');
const state=JSON.parse(await readFile(join(local,'acceptance-state.json')));
if(JSON.stringify(state).includes('chiefexecutivesuite')||!state.origins.some(o=>o.origin===origin&&o.localStorage.some(i=>i.name.includes('chiefacceptance'))))throw Error('Synthetic acceptance state required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const buildBytes=await readFile(join(logs,'production-build-receipt.json')), build=JSON.parse(buildBytes);
const provenance=JSON.parse(await readFile(join(root,'integrations/platform/patches/embedded-playback-provenance.json')));
if(build.productionConfigurationsPassed!==2||provenance.inputs.some(i=>build.inputs[i.file]!==i.sha256))throw Error('Matching playback build required');
if(mode==='deployed') {
 const image=JSON.parse(await readFile(join(local,'front-image.json')));
 if(image.webpackReceiptSha256!==sha(buildBytes))throw Error('Deployment receipt mismatch');
 const response=await fetch(origin);
 if(!response.ok||sha(Buffer.from(await response.arrayBuffer()))!==build.assets['index.html'].sha256)throw Error('Deployed entry mismatch');
}
let frameUrl=origin+'/workbench/chiefacceptance/contact/persons';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><body style="margin:0"><iframe title="Chief organization workspace" style="width:100vw;height:100vh;border:0" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" allow="camera ${origin}; microphone ${origin}; local-network ${origin}; loopback-network ${origin}" src="${frameUrl}"></iframe></body></html>`)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const parent=`http://127.0.0.1:${server.address().port}`, otherParent=`http://localhost:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const checks=[], served=new Set(), responses=[];let page;
try {
 const context=await browser.newContext({storageState:state,viewport:{width:1440,height:1000},serviceWorkers:'block'});
 // Restore synthetic account authentication into this iframe's cookie partition.
 // File cookies are deliberately excluded: their creation is the product under test.
 // This fixture does not claim to test the separate account sign-in persistence flow.
 await context.addCookies(state.cookies.filter(c=>c.name.startsWith('account-metadata-Token')).map(c=>({...c,secure:true,sameSite:'None',partitionKey:'http://127.0.0.1'})));
 // Chromium partitions iframe localStorage separately from the top-level fixture.
 // Seed only this synthetic account's existing app state; the compiled app must
 // create its own file cookie. No owner state or file-cookie injection is used.
 await context.addInitScript(({origin,entries})=>{
  if(location.origin===origin)for(const {name,value} of entries)if(localStorage.getItem(name)===null)localStorage.setItem(name,value);
 },{origin,entries:state.origins.find(o=>o.origin===origin).localStorage});
 await context.grantPermissions(['camera','microphone','local-network-access'],{origin});
 await context.grantPermissions(['camera','microphone','local-network-access'],{origin:parent});
 await context.addInitScript(()=>{
  window.__playbackTest={streams:[],chunks:0,calls:0};
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{
   const inputs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>['audioinput','videoinput'].includes(d.kind));
   if(!inputs.length||inputs.some(d=>!/fake/i.test(d.label)))throw Error('Real inputs forbidden');
   window.__playbackTest.calls++;const stream=await original(constraints);window.__playbackTest.streams.push(stream);return stream;
  };
  navigator.mediaDevices.getDisplayMedia=async()=>{throw Error('Real display capture forbidden')};
  window.MediaRecorder=new Proxy(MediaRecorder,{construct(Target,args){const value=new Target(...args);value.addEventListener('dataavailable',()=>window.__playbackTest.chunks++);return value}});
 });
 if(mode==='compiled')await context.route(origin+'/**',async route=>{
  const req=route.request();if(req.method()!=='GET')return route.continue();
  const path=decodeURIComponent(new URL(req.url()).pathname), file=req.isNavigationRequest()?join(dist,'index.html'):resolve(dist,'.'+path);
  if(!file.startsWith(dist+sep)||!(await stat(file).catch(()=>null))?.isFile())return route.continue();
  const name=file.slice(dist.length+1).split(sep).join('/'), bytes=await readFile(file);
  if(build.assets[name]?.sha256!==sha(bytes))throw Error('Asset mismatch');served.add(name);await route.fulfill({path:file});
 });
 page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('response',r=>{if(new URL(r.url()).pathname.startsWith(`/files/${workspace}/`))responses.push({url:r.url(),status:r.status()})});
 await page.goto(parent);let frame=page.frames().find(f=>f.url().startsWith(origin));
 await expect(frame.getByRole('button',{name:'Person',exact:true}).last()).toBeVisible({timeout:30000});
 if(await frame.getByRole('button',{name:'Clear filters',exact:true}).isVisible())await frame.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(frame.getByText('Synthetic Ada Chief Fixture',{exact:true})).toBeVisible({timeout:30000});
 expect(await frame.evaluate(()=>window.__playbackTest.calls)).toBe(0);
 // RecorderExt's REC glyph is a unique 22x10 SVG in the global status bar.
 await frame.locator('button.statusButton').filter({has:frame.locator('svg[viewBox="0 0 22 10"]')}).click();
 const popup=frame.locator('.hulyModal-container').filter({hasText:'Record video'});
 await expect(popup).toBeVisible();await popup.locator('.hulyModal-footer .hulySplitButton-main').nth(2).click();
 await popup.getByRole('button',{name:'Record',exact:true}).click();
 await expect.poll(()=>frame.evaluate(()=>window.__playbackTest.chunks)).toBeGreaterThanOrEqual(2);
 await popup.getByRole('button',{name:'Stop',exact:true}).click();
 await expect(popup.getByRole('button',{name:'Save',exact:true})).toBeVisible();
 const name=`Chief embedded playback ${Date.now()}.webm`;
 await popup.getByPlaceholder('Name',{exact:true}).fill(name);
 await popup.getByRole('button',{name:'Save',exact:true}).click();
 await expect(popup).toBeHidden();await expect.poll(()=>frame.url()).toMatch(/\/workbench\/chiefacceptance\/drive\/file\//);
 const filePage=frame.url();const video=frame.locator('video[src*="/files/"]');await expect(video).toBeVisible();
 await expect.poll(()=>frame.evaluate(()=>window.__playbackTest.streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length)).toBe(0);
 const play=async video=>{await video.evaluate(async v=>{v.muted=true;await v.play()});await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0.2);return video.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,decoded:v.getVideoPlaybackQuality().totalVideoFrames,src:v.currentSrc}))};
 const first=await play(video);expect(first.duration).toBeGreaterThan(1);expect(first.width).toBeGreaterThan(0);expect(first.decoded).toBeGreaterThan(0);
 checks.push('Global recorder saves a generated camera clip to Drive inside the sandboxed cross-site iframe; native playback advances with decoded frames and no live capture tracks');
 frameUrl=filePage;await page.reload();frame=page.frames().find(f=>f.url().startsWith(origin));
 const reopened=frame.locator('video[src*="/files/"]');await expect(reopened).toBeVisible();const details=await play(reopened);
 await reopened.evaluate(v=>{v.pause();v.currentTime=v.duration/2});await expect.poll(()=>reopened.evaluate(v=>Math.abs(v.currentTime-v.duration/2))).toBeLessThan(0.15);
 expect(responses.some(r=>r.url===details.src&&[200,206].includes(r.status))).toBe(true);
 checks.push('Persisted Drive recording reopens inside the iframe with authenticated bytes, finite duration and working seek');
 await page.screenshot({path:join(root,'docs/verification/evidence/chief-embedded-playback.png')});
 const partitioned=(await context.cookies()).filter(c=>c.name==='presentation-metadata-Token'&&c.path===`/files/${workspace}`&&c.partitionKey);
 expect(partitioned).toHaveLength(1);expect(partitioned[0].secure).toBe(true);expect(partitioned[0].sameSite).toBe('None');expect(partitioned[0].domain).toBe('localhost');
 // Copy only the synthetic partitioned file cookie into an otherwise anonymous
 // context: no account state, bearer injection, device access or application boot.
 const isolated=await browser.newContext({storageState:{cookies:partitioned,origins:[]}});
 await isolated.route(origin+'/__chief-file-partition-probe',r=>r.fulfill({contentType:'text/html',body:`<video muted controls src="${details.src}"></video>`}));
 frameUrl=origin+'/__chief-file-partition-probe';const probe=await isolated.newPage();
 await probe.goto(parent);let probeFrame=probe.frames().find(f=>f.url().startsWith(origin));await play(probeFrame.locator('video'));
 await probe.goto(otherParent);probeFrame=probe.frames().find(f=>f.url().startsWith(origin));
 const denied=await probeFrame.locator('video').evaluate(async v=>{try{await v.play();return false}catch{return true}});expect(denied).toBe(true);
 const anonymous=await fetch(details.src);expect([401,403]).toContain(anonymous.status);
 checks.push('File cookie stays host-only and workspace-scoped; it plays under its original top-level site but is withheld under a different site and from an unpartitioned anonymous request');
 if(mode==='compiled')expect(served.size).toBeGreaterThan(2);
 const receipt={passed:true,mode,verifiedAt:new Date().toISOString(),buildReceiptSha256:sha(buildBytes),patchSha256:provenance.patchSha256,syntheticOnly:true,fakeDevicesOnly:true,checks,servedBuiltAssets:served.size,recording:{name,duration:details.duration,width:details.width,height:details.height,decodedFrames:details.decoded},partitionedCookieVerified:true};
 await writeFile(join(root,`docs/verification/evidence/chief-embedded-playback-${mode}.json`),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
} catch(error) {if(page)await page.screenshot({path:join(logs,'embedded-playback-failure.png')}).catch(()=>{});throw error} finally {await browser.close();server.close()}
