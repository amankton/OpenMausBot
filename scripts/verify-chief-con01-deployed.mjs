// Explicitly authorized Playwright release test. Synthetic accounts only.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ROOT } from './configure-chief-platform.mjs';
import { ChiefPairingRuntime } from '../server/chief-pairing.ts';

const origin='http://localhost:18087', path=origin+'/workbench/chiefacceptance/setting/integrations';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const rollout=await json(join(ROOT,'docs/verification/evidence/chief-con01-local-rollout.json'));assert.equal(rollout.passed,true);
const states=await Promise.all(['acceptance-state.json','acceptance-partner-state.json'].map(n=>json(join(ROOT,'.chief-local/platform',n))));
for(const state of states)assert.ok(!JSON.stringify(state).includes('chiefexecutivesuite')&&state.origins.some(o=>o.origin===origin&&o.localStorage.some(r=>r.name.includes('chiefacceptance'))));
const directory=await mkdtemp(join(ROOT,'.chief-local/m1-pairing/deployed-runtime-'));
const runtime=new ChiefPairingRuntime({directory,origin,hasBot:id=>['synthetic-specialist-0','synthetic-specialist-1'].includes(id)});
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];let first, embeddedServer;
try {
  const context=await browser.newContext({storageState:states[0],viewport:{width:1500,height:1000},serviceWorkers:'block'});
  first=await context.newPage();await first.goto(path);
  const panel=page=>page.getByRole('region',{name:'Personal Chief connection'});
  const pair=async(page,bot)=>{
    await panel(page).getByRole('button',{name:'Create invitation',exact:true}).click();
    const invitation=JSON.parse(await panel(page).getByRole('textbox',{name:'One-time workspace invitation'}).inputValue());
    const connection=await runtime.pair(invitation,[bot]);
    await panel(page).getByRole('button',{name:'Refresh connections'}).click();
    // Native markup is deliberately selected by the unique pending approval text.
    await expect(panel(page).getByRole('button',{name:'Approve connection',exact:true})).toBeDisabled();
    await expect(panel(page)).toContainText(connection.keyFingerprint);
    await panel(page).getByRole('checkbox').check();
    await panel(page).getByRole('button',{name:'Approve connection',exact:true}).click();
    await expect(panel(page).getByText('Connected',{exact:true})).toBeVisible();
    assert.equal((await runtime.check(connection.id)).state,'active');
    return connection;
  };
  const connection=await pair(first,'synthetic-specialist-0');
  checks.push('Actual deployed Accounts epoch, active Employee lookup, nginx, lifecycle SQL and compiled UI complete two-sided synthetic pairing without authority stubs');
  await first.reload();await expect(panel(first).getByText('Connected',{exact:true})).toBeVisible();assert.equal((await runtime.check(connection.id)).state,'active');
  await first.screenshot({path:join(ROOT,'docs/verification/evidence/chief-con01-deployed.png')});
  checks.push('Deployed pairing persists across full workbench reload and signed runtime authorization');
  const separate=await browser.newContext({storageState:states[1]});const member=await separate.newPage();await member.goto(path);
  await expect(panel(member).getByRole('button',{name:'Create invitation',exact:true})).toBeVisible();
  await expect(panel(member)).not.toContainText(connection.keyFingerprint);
  checks.push('Independent second member browser context does not expose the first member connection');
  await separate.close();
  // Model account switching in one browser profile while the first tab remains open.
  await context.addCookies(states[1].cookies);
  const switched=await context.newPage();
  await switched.addInitScript(({origin,entries})=>{if(location.origin===origin)for(const row of entries)localStorage.setItem(row.name,row.value)},
    {origin,entries:states[1].origins.find(o=>o.origin===origin).localStorage});
  await switched.goto(path);await expect(panel(switched).getByRole('button',{name:'Create invitation',exact:true})).toBeVisible();
  await expect.poll(async()=>{try{await runtime.check(connection.id);return 200}catch(e){return e.status}}).toBe(403);
  await panel(first).getByRole('button',{name:'Refresh connections'}).click();await expect(panel(first).getByText('Connected',{exact:true})).toHaveCount(0);
  checks.push('Actual same-browser account switch revokes the old signed runtime and clears stale-tab connection state');
  const next=await pair(switched,'synthetic-specialist-1');
  await switched.getByRole('button',{name:'Sign out',exact:true}).click();await expect(switched).toHaveURL(/\/login/);
  await assert.rejects(()=>runtime.check(next.id),e=>e.status===403);
  await switched.reload();await expect(switched.getByText('Email',{exact:true})).toBeVisible();
  checks.push('Settings sign-out revokes the second member runtime and remains signed out after reload');
  embeddedServer=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<iframe title="Synthetic Chief workspace" style="width:100%;height:95vh" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" src="${path}"></iframe>`)});
  await new Promise(r=>embeddedServer.listen(0,'127.0.0.1',r));
  const embeddedContext=await browser.newContext({storageState:states[0],viewport:{width:1500,height:1000}});
  await embeddedContext.addCookies(states[0].cookies.filter(c=>c.name.startsWith('account-metadata-Token')).map(c=>({...c,secure:true,sameSite:'None',partitionKey:'http://127.0.0.1'})));
  await embeddedContext.addInitScript(({origin,entries})=>{if(location.origin===origin)for(const row of entries)if(localStorage.getItem(row.name)===null)localStorage.setItem(row.name,row.value)},
    {origin,entries:states[0].origins.find(o=>o.origin===origin).localStorage});
  const embeddedPage=await embeddedContext.newPage();await embeddedPage.goto('http://127.0.0.1:'+embeddedServer.address().port);
  let embeddedFrame=embeddedPage.frameLocator('iframe');const embeddedConnection=await pair(embeddedFrame,'synthetic-specialist-0');
  const cookies=await embeddedContext.cookies();assert.ok(cookies.some(c=>c.name==='chief-lifecycle-session'&&c.partitionKey==='http://127.0.0.1'&&c.secure&&c.sameSite==='None'));
  await embeddedPage.reload();embeddedFrame=embeddedPage.frameLocator('iframe');await expect(panel(embeddedFrame).getByText('Connected',{exact:true})).toBeVisible();
  assert.equal((await runtime.check(embeddedConnection.id)).state,'active');
  await embeddedFrame.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect.poll(async()=>{try{await runtime.check(embeddedConnection.id);return 200}catch(e){return e.status}}).toBe(403);
  checks.push('Cross-site sandboxed workspace iframe stores the Secure partitioned Chief cookie, retains pairing on outer-page reload, and revokes the signed runtime on sign-out');
  const receipt={passed:true,verifiedAt:new Date().toISOString(),deployed:true,syntheticOnly:true,authorityStubs:false,membershipEpochRequired:true,
    accountImage:rollout.accountImage,lifecycleImage:rollout.lifecycleImage,frontImage:rollout.frontImage,buildReceiptSha256:rollout.buildReceiptSha256,checks,
    limitations:['Local loopback pilot; no cloud/TLS acceptance','Outage/retry UI verified separately on the same compiled build','No real specialist dispatch']};
  await writeFile(join(ROOT,'docs/verification/evidence/chief-con01-deployed.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
} catch(error) {
  // Avoid screenshots of an invitation capability on failure.
  console.error(error.message?.replace(/eyJ[\w.-]+/g,'[redacted]').replace(/\b[A-Za-z0-9_-]{43}\b/g,'[redacted-capability]'));process.exitCode=1;
} finally {await browser.close();if(embeddedServer)await new Promise(r=>embeddedServer.close(r))}
