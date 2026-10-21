// Backend-only cold/warm comparison. No owner profile, credentials or app UI.
import { spawn } from 'node:child_process';
import { mkdtemp, cp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
const evidence=await mkdtemp(join(tmpdir(),'chief-startup-comparison-'));
const candidates=[['installed',join(process.env.LOCALAPPDATA,'Programs/chief-executive-suite/resources/server')],['current',resolve('dist-server')]];
const results=[];
for(const [label,source] of candidates){
  const stage=join(evidence,label);await cp(source,join(stage,'server'),{recursive:true});
  const home=join(stage,'home');await mkdir(home);await mkdir(join(stage,'skills'));
  for(const run of ['cold','warm']){
    const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
    const env={SystemRoot:process.env.SystemRoot,PATH:join(process.env.SystemRoot,'System32'),HOME:home,USERPROFILE:home,APPDATA:join(home,'roaming'),LOCALAPPDATA:join(home,'local'),OMB_DATA_DIR:join(home,'data'),OMB_PORT:String(port),OMB_WEBHOOK_PORT:'0',OMB_SKILLS_DIR:join(stage,'skills')};
    const started=performance.now();let output='';
    const child=spawn(process.execPath,[join(stage,'server/index.js')],{cwd:stage,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const exited=once(child,'exit');child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
    try{
      let ready=false;while(performance.now()-started<60000){if(child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${port}/api/config`,{signal:AbortSignal.timeout(500)});if(r.ok){await r.body.cancel();ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
      if(!ready)throw Error(label+' '+run+' did not start');
      const startupMs=Math.round(performance.now()-started),requests=[];
      for(let i=0;i<5;i++){const t=performance.now(),r=await fetch(`http://127.0.0.1:${port}/api/config`,{signal:AbortSignal.timeout(2000)});await r.body.cancel();requests.push(Math.round(performance.now()-t));}
      let discovery;
      if(run==='warm'&&process.argv.includes('--slow-discovery')) { const t=performance.now();const r=await fetch(`http://127.0.0.1:${port}/api/instances`,{signal:AbortSignal.timeout(30000)});const data=await r.json();discovery={ms:Math.round(performance.now()-t),instances:data.instances?.map(i=>({id:i.instanceId,state:i.snapshot.state,reason:i.snapshot.reason}))}; }
      results.push({label,run,startupMs,configRequestMs:requests,...(discovery?{discovery}:{})});console.log(JSON.stringify(results.at(-1)));
    }finally{child.kill();await exited;await writeFile(join(stage,run+'.log'),output);}
    if(run==='cold'&&process.argv.includes('--slow-discovery')){
      const script=join(stage,'slow-cli.cjs'), wrapper=join(stage,'slow-cli.cmd');
      await writeFile(script,`if(process.argv.includes('--version'))setTimeout(()=>console.log('2.1.221 (Claude Code)'),5000);else if(process.argv.includes('status'))console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));else console.log('synthetic CLI');`);
      await writeFile(wrapper,`@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
      await writeFile(join(home,'data/config.json'),JSON.stringify({instances:{claude:{driver:'claudeAgent',config:{cli:'"'+process.execPath+'" "'+script+'"'}}}}));
    }
  }
}
await writeFile(join(evidence,'receipt.json'),JSON.stringify({backendOnly:true,syntheticProfiles:true,results},null,2));
console.log(JSON.stringify({evidence}));
