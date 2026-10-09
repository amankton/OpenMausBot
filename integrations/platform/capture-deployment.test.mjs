import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {workerConfiguration,validateWorkerConfiguration,prepareCaptureConfiguration,validateCaptureConfiguration,capturePaths} from '../../scripts/prepare-chief-meeting-capture.mjs';
const secret='a'.repeat(64),root=join(tmpdir(),'chief-config-boundary-example');
test('native config locks both endpoints and exact model/audio paths with distinct credential',()=>{
 const good=workerConfiguration(root,secret),env=`CHIEF_CAPTURE_WORKER_SECRET=${secret}\n`;
 assert.doesNotThrow(()=>validateWorkerConfiguration(root,good,env,['b'.repeat(64)]));
 for(const change of [c=>{c.loveUrl='https://outside.test';},c=>{c.livekitUrl='ws://127.0.0.1:1234';},c=>{c.audioDirectory=tmpdir();},c=>{c.modelDirectory=tmpdir();},c=>{c.workerSecret='b'.repeat(64);},c=>{c.extra='override';}]){const c=structuredClone(good);change(c);assert.throws(()=>validateWorkerConfiguration(root,c,env));}
 assert.throws(()=>validateWorkerConfiguration(root,good,env,[secret]));
 assert.throws(()=>validateWorkerConfiguration(root,good,env+'OTHER=bad\n'));
});
test('prepare-only fixture creates private settings, preserves credentials, refuses redirected storage',async t=>{
 const fixture=await mkdtemp(join(tmpdir(),'chief-capture-config-'));t.after(()=>rm(fixture,{recursive:true,force:true}));
 const platform=join(fixture,'.chief-local/platform');await mkdir(platform,{recursive:true});await mkdir(capturePaths(fixture).model,{recursive:true});await writeFile(join(platform,'platform.env'),'CHIEF_PLATFORM_SECRET='+ 'b'.repeat(64)+'\n');await writeFile(join(platform,'meetings.env'),'CHIEF_PLATFORM_LIVEKIT_SECRET='+ 'c'.repeat(64)+'\n');
 const first=await prepareCaptureConfiguration(fixture);assert.equal(first.started,false);const p=capturePaths(fixture);const original=await readFile(p.config,'utf8');
 await prepareCaptureConfiguration(fixture);assert.equal(await readFile(p.config,'utf8'),original);assert.equal((await validateCaptureConfiguration(fixture)).prepared,true);
 await writeFile(join(p.audio,'synthetic-inherited-file'),'synthetic');assert.equal((await validateCaptureConfiguration(fixture)).prepared,true);
 await mkdir(join(fixture,'foreign'));await symlink(join(fixture,'foreign'),join(p.directory,'redirect'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(prepareCaptureConfiguration(fixture),/redirect|permission|regular|link/i);
});
