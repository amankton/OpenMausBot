// Real retained meeting transport; only the two synthetic acceptance members.
import {chromium, expect} from '@playwright/test';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('..',import.meta.url));
const local=join(root,'.chief-local/platform'), evidence=join(root,'docs/verification/evidence');
const manifest=JSON.parse(await readFile(join(local,'manifest.json'),'utf8'));
if(manifest.project!=='chief-platform'||manifest.url!=='http://localhost:18087'||manifest.status!=='ready'||manifest.runtimeProfile!=='meetings')throw Error('Verified retained meeting runtime is required.');
const states=await Promise.all(['acceptance-state.json','acceptance-partner-state.json'].map(async name=>{
 const state=JSON.parse(await readFile(join(local,name),'utf8'));
 if(!state.origins.some(o=>o.origin===manifest.url&&o.localStorage.some(i=>i.name.includes('chiefacceptance')))||JSON.stringify(state).includes('chiefexecutivesuite'))throw Error('Synthetic-only browser state required.');
 return state;
}));
const config=await (await fetch(manifest.url+'/config.json')).json();
if(config.LIVEKIT_WS!=='ws://localhost:18087/_livekit')throw Error('Local retained media transport is unavailable.');
const rtcBytes=await readFile(join(local,'livekit.json'));
const rtc=JSON.parse(rtcBytes).rtc;
const rtcEvidence={configurationSha256:createHash('sha256').update(rtcBytes).digest('hex'),addressScope:rtc.node_ip==='127.0.0.1'?'loopback':manifest.rtcDiagnostic?'host-only diagnostic':'unclassified',forceTcp:rtc.force_tcp===true,loopbackCandidates:rtc.enable_loopback_candidate===true,diagnostic:manifest.rtcDiagnostic?.status??null};
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const checks=[];
let pages=[];
try {
 const contexts=[];
 for(const storageState of states){
  const context=await browser.newContext({storageState,serviceWorkers:'block',viewport:{width:1600,height:1000}});
  await context.grantPermissions(['camera','microphone','local-network-access'],{origin:manifest.url});
  await context.addInitScript(()=>{
   const calls=[],streams=[],connections=[],transportHistory=[],remoteCandidates=[],iceErrors=[];
   window.__chiefMeeting={calls,streams,connections,transportHistory,remoteCandidates,iceErrors};
   const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   navigator.mediaDevices.getUserMedia=async constraints=>{
    calls.push({kind:'devices',audio:Boolean(constraints.audio),video:Boolean(constraints.video)});
    const stream=await original(constraints);streams.push(stream);return stream;
   };
   // Simulated chooser result, containing generated pixels only. Real RTP transport.
   navigator.mediaDevices.getDisplayMedia=async()=>{
    calls.push({kind:'screen'});
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const drawing=canvas.getContext('2d');let n=0;
    const timer=setInterval(()=>{drawing.fillStyle=n++%2?'#18364f':'#247563';drawing.fillRect(0,0,640,360);drawing.fillStyle='white';drawing.fillText('Chief synthetic shared screen '+n,30,60);},100);
    const stream=canvas.captureStream(10);streams.push(stream);
    stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));
    return stream;
   };
   const PeerConnection=window.RTCPeerConnection;
   window.RTCPeerConnection=new Proxy(PeerConnection,{construct(Target,args){
    const pc=new Target(...args);connections.push(pc);
    pc.addEventListener('icecandidateerror',event=>iceErrors.push({code:event.errorCode,text:event.errorText,url:event.url}));
    const addIceCandidate=pc.addIceCandidate.bind(pc);
    pc.addIceCandidate=(candidate,...rest)=>{remoteCandidates.push({index:connections.indexOf(pc),candidate:candidate?.candidate??null});return addIceCandidate(candidate,...rest);};
    const setRemoteDescription=pc.setRemoteDescription.bind(pc);
    pc.setRemoteDescription=(description,...rest)=>{for(const candidate of (description?.sdp??'').split(/\r?\n/).filter(line=>line.startsWith('a=candidate:')))remoteCandidates.push({index:connections.indexOf(pc),candidate});return setRemoteDescription(description,...rest);};
    const snapshot=async()=>{transportHistory.push({at:Date.now(),index:connections.indexOf(pc),state:pc.connectionState,ice:pc.iceConnectionState,candidates:[...(await pc.getStats()).values()].filter(s=>['candidate-pair','local-candidate','remote-candidate'].includes(s.type)).map(s=>({type:s.type,state:s.state,nominated:s.nominated,requestsSent:s.requestsSent,responsesReceived:s.responsesReceived,requestsReceived:s.requestsReceived,responsesSent:s.responsesSent,protocol:s.protocol,candidateType:s.candidateType,address:s.address,port:s.port,bytesSent:s.bytesSent,bytesReceived:s.bytesReceived}))});};
    const timer=setInterval(()=>{if(pc.connectionState==='closed'){clearInterval(timer);return;}void snapshot().catch(()=>{});},1000);
    for(const event of ['connectionstatechange','iceconnectionstatechange','icegatheringstatechange'])pc.addEventListener(event,()=>{void snapshot().catch(()=>{});});
    return pc;
   }});
  });
  contexts.push(context);
 }
 const [personal,partner]=await Promise.all(contexts.map(c=>c.newPage()));
 pages=[personal,partner];
 for(const page of [personal,partner])page.setDefaultTimeout(30000);
 const cardUrl=manifest.url+'/workbench/chiefacceptance/card/6ac6aa185b1567fb393c76f2';
 await personal.goto(cardUrl,{waitUntil:'networkidle'});
 await partner.goto(manifest.url+'/workbench/chiefacceptance/love',{waitUntil:'networkidle'});
 const office=personal.locator('button.app.small').filter({has:personal.locator('use[href$="#office"]')});
 if(!await personal.locator('.floorGrid-room').count())await office.click();
 const room=personal.getByRole('group',{name:/^Meeting room 1$/i});
 await expect(room).toBeVisible();
 const captures=page=>page.evaluate(()=>window.__chiefMeeting.calls);
 const connected=page=>page.evaluate(()=>window.__chiefMeeting.connections.some(pc=>pc.connectionState==='connected'));
 const control=(page,icon)=>page.locator('.bar button').filter({has:page.locator(`use[href$="#${icon}"]`)}).filter({visible:true}).first();
 const assertCard=async()=>{expect(personal.url()).toBe(cardUrl);await expect(personal.getByPlaceholder('Card',{exact:true})).toHaveValue('Chief Synthetic Card');};
 expect(await captures(personal)).toEqual([]);expect(await captures(partner)).toEqual([]);
 const ownTile=personal.locator('.floorGrid-room.myOffice .floorGrid-room__field[draggable="true"]').first();
 await expect(ownTile).toBeVisible();
 await ownTile.hover();
 await expect(ownTile.locator('.flex-presenter')).toBeVisible();
 await ownTile.dragTo(room);
 await expect.poll(()=>connected(personal),{timeout:30000}).toBe(true);
 await assertCard();expect(await captures(personal)).toEqual([]);
 const partnerRoom=partner.getByRole('group',{name:/^Meeting room 1$/i});
 const occupants=group=>group.locator('.floorGrid-room__field[draggable="true"]');
 await expect(occupants(room)).toHaveCount(1);
 await expect(occupants(partnerRoom)).toHaveCount(1);
 checks.push('Actual self-drag from personal Office into a named meeting room connects without device capture and preserves the Card');

 const invite=async()=>{
  const menu=room.getByRole('button',{name:'Room actions',exact:true});
  if(await menu.count()){
   await room.hover();await menu.focus();await menu.press('Enter');
   await personal.getByText('Invite a person to this room',{exact:true}).click();
  }else await room.getByRole('button',{name:'Invite a person to this room',exact:true}).click();
  await personal.getByLabel('Workspace member',{exact:true}).selectOption({label:'Chief Meeting Partner'});
  await personal.getByRole('button',{name:'Send invitation',exact:true}).click();
  await partner.getByRole('button',{name:/^You are inviting to join/}).click();
  await expect(partner.locator('.invite-popup')).toBeVisible();
 };
 await invite();
 expect(await connected(partner)).toBe(false);expect(await captures(partner)).toEqual([]);
 await partner.locator('.invite-popup').getByRole('button',{name:'Reject',exact:true}).click();
 await expect(partner.locator('.invite-popup')).toHaveCount(0);
 expect(await connected(partner)).toBe(false);
 if(await personal.getByRole('button',{name:'Close',exact:true}).isVisible())await personal.getByRole('button',{name:'Close',exact:true}).click();
 checks.push('Keyboard-accessible room invitation leaves recipient unjoined; rejecting does not activate media');
 const partnerOffice=personal.getByRole('group',{name:/Partner/i});
 const otherTile=partnerOffice.locator('.floorGrid-room__field[draggable="true"]').first();
 await otherTile.hover();
 await expect(otherTile.locator('.flex-presenter')).toBeVisible();
 await otherTile.dragTo(room);
 await partner.getByRole('button',{name:/^You are inviting to join/}).click();
 await expect(partner.locator('.invite-popup')).toBeVisible();
 expect(await connected(partner)).toBe(false);
 await expect(occupants(room)).toHaveCount(1);
 await expect(occupants(partnerRoom)).toHaveCount(1);
 await partner.locator('.invite-popup').getByRole('button',{name:'Join',exact:true}).click();
 await expect.poll(()=>connected(partner),{timeout:30000}).toBe(true);
 await partner.keyboard.press('Escape');
 await expect(control(partner,'micOff')).toBeVisible();
 await expect(control(partner,'cameraOff')).toBeVisible();
 expect(await captures(partner)).toEqual([]);await assertCard();
 await expect(occupants(room)).toHaveCount(2);
 await expect(occupants(partnerRoom)).toHaveCount(2);
 checks.push('Dragging the other visible member sends an invitation without moving them; acceptance synchronizes two joined occupants in compact and full Office');
 checks.push('Recipient acceptance joins the same retained meeting while both members start with devices off');

 const received=page=>page.evaluate(async()=>{
  let audio=0,video=0,frames=0;
  for(const pc of window.__chiefMeeting.connections)for(const stat of (await pc.getStats()).values()){
   if(stat.type!=='inbound-rtp')continue;
   if((stat.kind??stat.mediaType)==='audio')audio+=stat.bytesReceived??0;
   if((stat.kind??stat.mediaType)==='video'){video+=stat.bytesReceived??0;frames+=stat.framesDecoded??0;}
  }
  return {audio,video,frames};
 });
 await personal.locator('button[id="app-love:string:Meeting"]').click();
 await expect(control(personal,'micOff')).toBeVisible();
 await expect(control(personal,'cameraOff')).toBeVisible();
 await assertCard();
 await control(personal,'micOff').click();await control(personal,'cameraOff').click();
 await expect.poll(async()=>{const x=await received(partner);return x.audio>0&&x.video>0&&x.frames>0;},{timeout:30000}).toBe(true);
 const av=await received(partner);
 await control(personal,'cameraOn').click();
 const beforeScreen=await received(partner);
 await control(personal,'shareOff').click();
 await expect.poll(async()=>{const x=await received(partner);return x.frames>beforeScreen.frames+5;},{timeout:30000}).toBe(true);
 const screen=await received(partner);
 expect((await captures(personal)).filter(call=>call.kind==='screen')).toHaveLength(1);
 await assertCard();
 checks.push('Explicit camera/microphone and generated screen-share controls deliver decoded media over actual LiveKit WebRTC to the other member');
 await control(personal,'shareOn').click();await control(personal,'micOn').click();
 await personal.screenshot({path:join(evidence,'chief-platform-meeting-card.png')});
 await partner.screenshot({path:join(evidence,'chief-platform-meeting-partner.png')});
 for(const page of [partner,personal]){
  await control(page,'leave').click();
  await expect.poll(()=>connected(page)).toBe(false);
  expect(await page.evaluate(()=>window.__chiefMeeting.streams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
 }
 if(!await room.isVisible())await office.click();
 await expect(occupants(room)).toHaveCount(0);
 await expect(occupants(partnerRoom)).toHaveCount(0);
 const fullOwnTile=partner.locator('.floorGrid-room.myOffice .floorGrid-room__field[draggable="true"]').first();
 await fullOwnTile.hover();
 await expect(fullOwnTile.locator('.flex-presenter')).toBeVisible();
 await fullOwnTile.dragTo(partnerRoom);
 await expect.poll(()=>connected(partner),{timeout:30000}).toBe(true);
 await partner.keyboard.press('Escape');
 await expect(occupants(room)).toHaveCount(1);
 await expect(occupants(partnerRoom)).toHaveCount(1);
 expect(await captures(partner)).toEqual([]);
 await assertCard();
 await control(partner,'leave').click();
 await expect.poll(()=>connected(partner)).toBe(false);
 await expect(occupants(room)).toHaveCount(0);
 checks.push('Self-drag also joins from full Office; shared room placement clears after leaving in both views');
 const receipt={verifiedAt:new Date().toISOString(),scope:'Retained two-member meeting, synthetic organization only',fakeDevicesOnly:true,images:manifest.images,rtc:rtcEvidence,checks,received:{av,screen},pending:['Meeting capture and agent follow-up']};
 await writeFile(join(evidence,'chief-platform-meetings.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
} catch(error) {
 await Promise.all(pages.map((page,index)=>page.screenshot({path:join(evidence,`chief-platform-meeting-failure-${index}.png`)}).catch(()=>{})));
 const transport=await Promise.all(pages.map(page=>page.evaluate(async()=>Promise.all(window.__chiefMeeting.connections.map(async pc=>({
  connectionState:pc.connectionState,iceConnectionState:pc.iceConnectionState,signalingState:pc.signalingState,
  candidates:[...(await pc.getStats()).values()].filter(s=>['candidate-pair','local-candidate','remote-candidate'].includes(s.type)).map(s=>({type:s.type,state:s.state,nominated:s.nominated,requestsSent:s.requestsSent,responsesReceived:s.responsesReceived,requestsReceived:s.requestsReceived,responsesSent:s.responsesSent,protocol:s.protocol,candidateType:s.candidateType,address:s.address,port:s.port,bytesSent:s.bytesSent,bytesReceived:s.bytesReceived}))
 })))).catch(()=>[])));
 const transportHistory=await Promise.all(pages.map(page=>page.evaluate(()=>window.__chiefMeeting.transportHistory).catch(()=>[])));
 const remoteCandidates=await Promise.all(pages.map(page=>page.evaluate(()=>window.__chiefMeeting.remoteCandidates).catch(()=>[])));
 const iceErrors=await Promise.all(pages.map(page=>page.evaluate(()=>window.__chiefMeeting.iceErrors).catch(()=>[])));
 const failure={failedAt:new Date().toISOString(),checks,message:String(error),routes:pages.map(page=>new URL(page.url()).pathname),transport,transportHistory,remoteCandidates,iceErrors};
 await writeFile(join(local,'meeting-transport-failure-private.json'),JSON.stringify(failure,null,2)+'\n',{mode:0o600});
 // Keep interface addresses and ephemeral ICE fields in local diagnostics only.
 const publicFailure=JSON.parse(JSON.stringify(failure,(key,value)=>{
  if(key==='address')return value==='127.0.0.1'?'loopback':'redacted-interface';
  if(key==='candidate'&&typeof value==='string'){
   const fields=value.replace(/^a=/,'').split(' ');
   return {protocol:fields[2],address:fields[4]==='127.0.0.1'?'loopback':'redacted-interface',port:fields[5],type:fields[7]};
  }
  return value;
 }));
 await writeFile(join(evidence,'chief-platform-meetings-failure.json'),JSON.stringify({...publicFailure,networkAddressesRedacted:true},null,2)+'\n');
 throw error;
} finally {await browser.close();}
