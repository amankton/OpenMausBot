// Guarded additive deployment. Existing Chief Platform data volumes are preserved.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ROOT, PROJECT, URL, SOURCE, prepare, resourceResult, validateBoundaries, dockerEnvironment } from './configure-chief-platform.mjs';
import { meetingLiveKitConfig } from './configure-chief-platform-meetings.mjs';
import { validateCaptureConfiguration } from './prepare-chief-meeting-capture.mjs';

const dir=join(ROOT,'integrations/platform'), local=join(ROOT,'.chief-local/platform');
const compose=join(dir,'compose.json'), overlayPath=join(dir,'meetings.compose.json');
const manifestPath=join(local,'manifest.json');
function run(command,args,extra={}) {
  try {return execFileSync(command,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe'],...extra}).trim();}
  catch {throw Error(`${command} failed; output suppressed to protect private configuration.`);}
}
const docker=(args,extra={})=>run('docker',args,{env:dockerEnvironment(),...extra});
const composeArgs=(...args)=>['compose','--project-name',PROJECT,'--project-directory',dir,'--env-file',join(local,'platform.env'),'--env-file',join(local,'meetings.env'),'--env-file',join(ROOT,'.chief-local/meeting-capture/capture.env'),'--env-file',join(local,'meeting-images.env'),'--file',compose,'--file',overlayPath,...args];
const samePath=(a,b)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();

export function validateMeetingModelReceipt(receipt, images, patchSha256) {
  if(receipt?.schemaVersion!==1 || receipt.sourceRevision!==SOURCE || receipt.patchSha256!==patchSha256)throw Error('Meeting model validation does not match the reviewed source.');
  for(const name of ['tool','transactor','workspace'])if(receipt.images?.[name]!==images[name])throw Error('Meeting model validation image mismatch.');
  if(!Array.isArray(receipt.workspaces)||receipt.workspaces.length!==2)throw Error('Both existing workspaces require read-only model validation.');
  const expected=['chiefacceptance','chiefexecutivesuite'];
  if(receipt.workspaces.map(item=>item.slug).sort().join()!==expected.join())throw Error('Unexpected model validation workspace set.');
  for(const workspace of receipt.workspaces) {
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(workspace.uuid))throw Error('Verified workspace identity is required.');
    if(workspace.slug==='chiefacceptance' && workspace.uuid!=='b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb')throw Error('Wrong synthetic workspace identity.');
    if(workspace.slug==='chiefexecutivesuite' && workspace.uuid!=='5d4f208d-e8ca-4bec-809c-f8ea0556d37f')throw Error('Wrong owner workspace identity.');
    if(workspace.backup?.status!=='passed'||workspace.modelLoad?.status!=='passed'||workspace.verification?.status!=='passed'||workspace.verification.existingRecordsPreserved!==true)throw Error('Backup, model load and preservation verification must pass.');
    if([...workspace.verification.optionalFields??[]].sort().join()!=='admission,joined')throw Error('Expected optional invitation model fields.');
    for(const digest of [workspace.backup.receiptSha256,workspace.backup.manifestSha256,workspace.modelLoad.modelSha256,workspace.modelLoad.logSha256])if(!/^[a-f0-9]{64}$/.test(digest))throw Error('Model validation evidence hashes are required.');
    if(typeof workspace.backup.receiptPath!=='string'||!/^[a-zA-Z0-9_./-]+$/.test(workspace.backup.receiptPath)||workspace.backup.receiptPath.startsWith('/')||workspace.backup.receiptPath.split('/').includes('..'))throw Error('Backup receipt must be inside the private Platform directory.');
    if(workspace.modelLoad.readOnly!==true||!Number.isFinite(Date.parse(workspace.modelLoad.completedAt)))throw Error('Verified read-only model load completion required.');
  }
  if(new Set(receipt.workspaces.map(item=>item.uuid)).size!==2)throw Error('Workspace identities must be distinct.');
}

async function verifyMeetingModels(images) {
  const toolPath=join(local,'tool-image.json');await privateFile(toolPath);
  const tool=JSON.parse(await readFile(toolPath,'utf8'));
  if(tool.name!=='tool'||tool.sourceRevision!==SOURCE||!/^sha256:[a-f0-9]{64}$/.test(tool.image))throw Error('Reviewed model validation tool receipt required.');
  const validationPath=join(local,'meeting-model-validation.json');await privateFile(validationPath);
  const receipt=JSON.parse(await readFile(validationPath,'utf8'));
  const patch=await readFile(join(dir,'patches/0002-member-meeting-admission.patch'));
  validateMeetingModelReceipt(receipt,{...images,tool:tool.image},createHash('sha256').update(patch).digest('hex'));
  for(const workspace of receipt.workspaces) {
    const path=join(local,workspace.backup.receiptPath);await privateFile(path);
    if(createHash('sha256').update(await readFile(path)).digest('hex')!==workspace.backup.receiptSha256)throw Error('Backup receipt changed after model verification.');
  }
}

export function mergeMeetingConfig(base,overlay,images) {
  const result=structuredClone(base);
  if (Object.keys(overlay).sort().join()!=='services,volumes' || Object.keys(overlay.services).sort().join()!=='front,livekit,love,nginx,transactor,workspace' || JSON.stringify(overlay.volumes)!=='{"capture_metadata":{"name":"chief-platform_capture_metadata"}}') throw Error('Unexpected meeting overlay service or private volume set.');
  result.volumes={...result.volumes,...structuredClone(overlay.volumes)};
  for(const [name,change] of Object.entries(overlay.services)) {
    const previous=result.services[name]??{};
    result.services[name]={...previous,...structuredClone(change)};
    if(change.environment) {
      const env=new Map((previous.environment??[]).map(item=>[item.split('=')[0],item]));
      for(const item of change.environment)env.set(item.split('=')[0],item);
      result.services[name].environment=[...env.values()];
    }
    if(images[name]) {
      const variable=`CHIEF_PLATFORM_${name.toUpperCase()}_IMAGE`;
      if(typeof change.image!=='string'||!change.image.startsWith('${'+variable+':?')) throw Error(`Missing reviewed image placeholder for ${name}.`);
      result.services[name].image=images[name];
    }
  }
  if(!result.services.love.environment.includes('CHIEF_MEMBER_MEETINGS_ONLY=true') || !result.services.love.environment.includes('AGENTS=') || !result.services.front.environment.includes('LIVEKIT_WS=ws://localhost:18087/_livekit')) throw Error('Meeting consent and local transport configuration is missing.');
  return result;
}

export function ownedConfigFiles(value) {
  const files=value.split(',');
  return (files.length===1&&samePath(files[0],compose)) || (files.length===2&&samePath(files[0],compose)&&samePath(files[1],overlayPath));
}

async function privateFile(path) {
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||!samePath(await realpath(path),path))throw Error('Meeting configuration must be a regular private file.');
}

async function prepareMeetings() {
  const {config:base,lock}=await prepare();
  const images={};
  for(const name of ['front','love','transactor','workspace']) {
    const path=join(local,`${name}-image.json`);await privateFile(path);
    const receipt=JSON.parse(await readFile(path,'utf8'));
    if(receipt.name!==name || receipt.sourceRevision!==SOURCE || !/^sha256:[a-f0-9]{64}$/.test(receipt.image))throw Error(`A reviewed ${name} image receipt is required.`);
    if(docker(['image','inspect',receipt.image,'--format','{{.Id}}'])!==receipt.image)throw Error(`Missing pinned ${name} image.`);
    images[name]=receipt.image;
  }
  const overlay=JSON.parse(await readFile(overlayPath,'utf8'));
  const config=mergeMeetingConfig(base,overlay,images);
  validateBoundaries(config,lock,images);
  await validateCaptureConfiguration(ROOT);
  const envPath=join(local,'meetings.env'), livekitPath=join(local,'livekit.json');
  await privateFile(envPath);await privateFile(livekitPath);
  const values=Object.fromEntries((await readFile(envPath,'utf8')).trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  if(!/^chief[a-f0-9]{24}$/.test(values.CHIEF_PLATFORM_LIVEKIT_KEY)||! /^[a-f0-9]{64}$/.test(values.CHIEF_PLATFORM_LIVEKIT_SECRET))throw Error('Meeting keys are missing or malformed.');
  const rtc=JSON.parse(await readFile(livekitPath,'utf8'));
  if(JSON.stringify(rtc)!==JSON.stringify(meetingLiveKitConfig(values.CHIEF_PLATFORM_LIVEKIT_KEY,values.CHIEF_PLATFORM_LIVEKIT_SECRET)))throw Error('Unreviewed media listener or webhook configuration.');
  const imageEnv=join(local,'meeting-images.env');
  try {await privateFile(imageEnv);}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(imageEnv,Object.entries(images).map(([name,id])=>`CHIEF_PLATFORM_${name.toUpperCase()}_IMAGE=${id}`).join('\n')+'\n',{mode:0o600});
  docker(composeArgs('config','--quiet'));
  docker(['image','inspect',config.services.livekit.image,'--format','{{.Id}}']);
  return {config,images};
}

function verifyOwnership() {
  const context=docker(['context','show']);
  if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))throw Error('Local Docker only.');
  if(!/^(npipe|unix):\/\//.test(docker(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}'])))throw Error('Local Docker only.');
  for(const row of docker(['ps','-a','--filter',`label=com.docker.compose.project=${PROJECT}`,'--format','{{.Label "com.docker.compose.project.config_files"}}|{{.Label "com.docker.compose.project.working_dir"}}']).split('\n').filter(Boolean)) {
    const [files,directory]=row.split('|');
    if(!ownedConfigFiles(files)||!samePath(directory,dir))throw Error('Foreign Chief Platform container ownership.');
  }
  for(const name of ['cr_data','cr_certs','redpanda','files','elastic']) {
    const found=docker(['volume','ls','--filter',`name=^${PROJECT}_${name}$`,'--format','{{.Name}}|{{.Label "com.docker.compose.project"}}']);
    if(found!==`${PROJECT}_${name}|${PROJECT}`)throw Error('Expected existing Chief Platform volume ownership.');
  }
  const captureVolume=docker(['volume','ls','--filter',`name=^${PROJECT}_capture_metadata$`,'--format','{{.Name}}|{{.Label "com.docker.compose.project"}}']);
  if(captureVolume && captureVolume!==`${PROJECT}_capture_metadata|${PROJECT}`)throw Error('Capture volume is owned outside Chief.');
  if(captureVolume)for(const owner of docker(['ps','-a','--filter',`volume=${PROJECT}_capture_metadata`,'--format','{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}']).split('\n').filter(Boolean))if(owner!==`${PROJECT}|love`)throw Error('Capture metadata is mounted outside Love.');
  const network=docker(['network','ls','--filter',`name=^${PROJECT}_backend$`,'--format','{{.Name}}|{{.Label "com.docker.compose.project"}}']);
  if(network!==`${PROJECT}_backend|${PROJECT}`)throw Error('Expected existing Chief Platform network ownership.');
}

async function verifyPorts() {
  const proxy=docker(composeArgs('ps','--status','running','--quiet','nginx'));
  if(!proxy) await new Promise((accept,reject)=>{const server=createServer();server.once('error',()=>reject(Error('Chief proxy port18087 is occupied.')));server.listen(18087,'127.0.0.1',()=>server.close(accept));});
  const own=docker(composeArgs('ps','--status','running','--quiet','livekit'));
  if(own)return;
  await new Promise((accept,reject)=>{const server=createServer();server.once('error',()=>reject(Error('Media TCP port18088 is occupied.')));server.listen(18088,'127.0.0.1',()=>server.close(accept));});
  await new Promise((accept,reject)=>{const socket=createSocket('udp4');socket.once('error',()=>{socket.close();reject(Error('Media UDP port18089 is occupied.'));});socket.bind(18089,'127.0.0.1',()=>socket.close(accept));});
}

async function readiness(config) {
  const output=docker(composeArgs('ps','--all','--format','json'));
  const rows=output.startsWith('[')?JSON.parse(output):output.split('\n').filter(Boolean).map(row=>JSON.parse(row));
  if(rows.map(row=>row.Service).sort().join()!==Object.keys(config.services).sort().join()||rows.some(row=>row.State!=='running'||(row.Health&&row.Health!=='healthy')))return false;
  for(const pathname of ['/','/config.json','/_love/checkRecordAvailable']) {
    const response=await fetch(URL+pathname,{signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)return false;
    if(pathname==='/config.json'&&(await response.json()).LIVEKIT_WS!=='ws://localhost:18087/_livekit')return false;
    if(pathname.endsWith('checkRecordAvailable')&&(await response.json())!==false)return false;
    await response.body?.cancel().catch(()=>{});
  }
  return true;
}

async function writeStatus(status,extra={}) {
  const previous=JSON.parse(await readFile(manifestPath,'utf8'));
  const value={...previous,runtimeProfile:'meetings',status,updatedAt:new Date().toISOString(),blockers:[],...extra};
  await writeFile(manifestPath,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  return value;
}

export async function meetingsMain(mode) {
  if(!['--configure','--preflight','--status','--start'].includes(mode))throw Error('Unknown meeting deployment action.');
  verifyOwnership();
  const {config,images}=await prepareMeetings();
  if(mode==='--configure'){console.log(JSON.stringify({project:PROJECT,prepared:true,started:false,profile:'meetings'}));return;}
  if(mode==='--status'){const ready=await readiness(config).catch(()=>false);console.log(JSON.stringify(await writeStatus(ready?'ready':'unavailable')));return;}
  await verifyPorts();
  if(process.platform!=='win32')throw Error('Verified Windows/Docker Desktop memory metrics required.');
  const resources=resourceResult(run('wsl.exe',['-d','docker-desktop','--','cat','/proc/meminfo']),JSON.parse(run('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory | ConvertTo-Json -Compress'])));
  if(resources.blockers.length){console.log(JSON.stringify({project:PROJECT,status:'blocked-resources',...resources}));process.exitCode=2;return;}
  if(mode==='--preflight'){console.log(JSON.stringify({project:PROJECT,prepared:true,started:false,profile:'meetings',...resources}));return;}
  await verifyMeetingModels(images);
  const previous=JSON.parse(await readFile(manifestPath,'utf8'));
  await writeFile(join(local,`pre-meetings-${Date.now()}.json`),JSON.stringify({manifest:previous,images,checkedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
  await writeStatus('starting',{resourceCheck:resources.resourceCheck});
  docker(composeArgs('up','--detach','--pull','never','--no-build','--wait','--wait-timeout','180'),{timeout:240000});
  if(!await readiness(config))throw Error('Meeting containers started but readiness did not pass; data volumes preserved.');
  console.log(JSON.stringify(await writeStatus('ready',{images,readiness:'17 services running; retained front and member-only Love reachable. Meeting browser acceptance remains separate.'})));
}
