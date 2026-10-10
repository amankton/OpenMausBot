// Opt-in deployment to the existing loopback installation, never a cloud profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';
import { accountOverlayArgs } from './chief-account-overlay.mjs';

const resume = process.argv[2] === '--resume';
assert.ok(['--apply', '--resume'].includes(process.argv[2]), 'Use --apply or --resume for the explicitly authorized local deployment');
const local = join(ROOT, '.chief-local/platform');
const directory = join(ROOT, '.chief-local/m1-pairing/deployment');
const integration = join(ROOT, 'integrations/platform');
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const docker = args => {
  try { return execFileSync('docker', args, { env: dockerEnvironment(), encoding:'utf8', windowsHide:true, timeout:180000, maxBuffer:16*1024*1024, stdio:['ignore','pipe','pipe'] }).trim(); }
  catch { throw Error('Local deployment Docker operation failed; private output suppressed.'); }
};
const snapshot = () => JSON.parse(docker(['inspect', ...docker(['ps','-aq','--filter','label=com.docker.compose.project=chief-platform']).split(/\r?\n/)]))
  .map(c=>({ id:c.Id, service:c.Config.Labels['com.docker.compose.service'], image:c.Image, running:c.State.Running,
    mounts:c.Mounts.map(m=>({type:m.Type,source:m.Source,destination:m.Destination,rw:m.RW})).sort((a,b)=>a.destination.localeCompare(b.destination)) }));
const compose = (...args) => ['compose','--project-name','chief-platform','--project-directory',integration,
  '--env-file',join(local,'platform.env'),'--env-file',join(local,'meetings.env'),
  '--env-file',join(ROOT,'.chief-local/meeting-capture/capture.env'),'--env-file',join(local,'meeting-images.env'),
  '--file',join(integration,'compose.json'),'--file',join(integration,'meetings.compose.json'),...accountOverlayArgs(ROOT),...args];
const release = await json(join(ROOT,'docs/verification/evidence/chief-lifecycle-epochs-release.json'));
assert.equal(release.passed,true);
for(const image of [release.accountImage,release.candidateImage]) assert.equal(docker(['image','inspect',image,'--format','{{.Id}}']),image);
const buildHash=hash(await readFile(join(ROOT,'.chief-local/platform-build-logs/production-build-receipt.json')));
const workbench=await json(join(ROOT,'docs/verification/evidence/chief-member-pairing-workbench.json'));
assert.ok(workbench.passed && workbench.buildReceiptSha256===buildHash);
const front=await json(join(local,'front-image.json'));
assert.equal(front.webpackReceiptSha256,buildHash);
const before=resume ? await json(join(directory,'before.json')) : snapshot(); assert.equal(before.length,17); assert.ok(before.every(c=>c.running));
if(resume)for(const old of before){const current=snapshot().find(c=>c.service===old.service);assert.deepEqual(current.mounts,old.mounts);if(old.service!=='account')assert.equal(current.id,old.id);}
assert.equal(before.find(c=>c.service==='front').image,front.image,'Deploy verified frontend first');
const [proxy]=JSON.parse(docker(['inspect','chief-platform-nginx-1']));
assert.deepEqual(proxy.HostConfig.PortBindings,{'80/tcp':[{HostIp:'127.0.0.1',HostPort:'18087'}]});
assert.equal(docker(['network','inspect','chief-platform_backend','--format','{{index .Labels "com.docker.compose.project"}}']),'chief-platform');
await mkdir(directory,{recursive:true});
const marker=join(directory,'local-prepared.json');
const proxyPath=join(integration,'nginx-meetings.conf');
const proxyBefore=await readFile(resume ? join(directory,'nginx.before.conf') : proxyPath,'utf8');
const serviceConfig=join(directory,'compose.json');
const serviceCompose=(...args)=>['compose','--project-name','chief-lifecycle-local','--file',serviceConfig,...args];
let backupPath, expiresAt, sql;
if (!resume) {
assert.equal(await readFile(marker).then(()=>true,()=>false),false,'Local preparation already exists; inspect it rather than replacing credentials');
const [db]=JSON.parse(docker(['inspect','chief-platform-cockroach-1']));
const dbEnv=Object.fromEntries(db.Config.Env.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
const adminUrl=new URL('postgresql://localhost:26257/chief_platform?sslmode=disable');adminUrl.username=dbEnv.COCKROACH_USER;adminUrl.password=dbEnv.COCKROACH_PASSWORD;
sql = statement => docker(['exec','chief-platform-cockroach-1','/cockroach/cockroach','sql','--url',adminUrl.href,'--format=csv','--execute',statement]);
const existing=sql("SELECT username FROM system.users WHERE username IN ('chief_lifecycle_migration','chief_lifecycle_runtime')");
assert.equal(existing.trim(),'username','Refuse to reuse unowned lifecycle database roles');
const ownerRows=sql("SELECT m.account_uuid AS account,m.workspace_uuid AS workspace FROM global_account.workspace_members m JOIN global_account.workspace w ON w.uuid=m.workspace_uuid WHERE w.url='chiefexecutivesuite' AND m.role='OWNER'").split(/\r?\n/);
assert.equal(ownerRows.length,2,'Require the existing single local owner');
const [ownerAccount,ownerWorkspace]=ownerRows[1].split(',');
for(const id of [ownerAccount,ownerWorkspace])assert.match(id,/^[a-f0-9-]{36}$/);
const preview=await json(join(ROOT,'.chief-local/preview.json'));
assert.match(preview.url,/^http:\/\/127\.0\.0\.1:\d+$/);
const botsResponse=await fetch(preview.url+'/api/bots',{signal:AbortSignal.timeout(5000)});assert.ok(botsResponse.ok);
const {bots}=await botsResponse.json();assert.ok(Array.isArray(bots)&&bots.length>0&&bots.length<=16);
assert.ok(bots.every(b=>typeof b.id==='string'&&/^[\w:-]{1,100}$/.test(b.id)));
assert.ok(bots.every(b=>!b.busy),'Wait for active personal-agent work before rollout');
expiresAt=new Date(Date.now()+30*86400000).toISOString();
const grants=[{workspace:ownerWorkspace,account:ownerAccount,pairing:true,bots:bots.map(b=>b.id),scopes:['workspace:read'],expiresAt}];
for(const [index,name] of ['acceptance-state.json','acceptance-partner-state.json'].entries()) {
  const state=await json(join(local,name));assert.ok(!JSON.stringify(state).includes('chiefexecutivesuite'));
  const cookie=state.cookies.find(c=>c.name==='presentation-metadata-Token');
  const claims=JSON.parse(Buffer.from(decodeURIComponent(cookie.value).split('.')[1],'base64url'));
  grants.push({workspace:claims.workspace,account:claims.account,pairing:true,bots:['synthetic-specialist-'+index],scopes:['workspace:read'],expiresAt});
}
backupPath='nodelocal://1/chief-con01-pre-migration-'+Date.now();
const backupResult=sql(`BACKUP DATABASE chief_platform INTO '${backupPath}'`);assert.ok(backupResult.includes('succeeded'));
await writeFile(join(directory,'before.json'),JSON.stringify(before,null,2));
await writeFile(join(directory,'pre-migration-backup.json'),JSON.stringify({path:backupPath,completedAt:new Date().toISOString(),result:backupResult},null,2));
docker(['cp','chief-platform-cockroach-1:/cockroach/cockroach-data/extern/'+backupPath.split('/').at(-1),directory]);
assert.ok(!proxyBefore.includes('location ^~ /chief/v1/'));
await writeFile(join(directory,'nginx.before.conf'),proxyBefore);
await copyFile(join(local,'manifest.json'),join(directory,'manifest.before.json'));
const migrationPassword=randomBytes(32).toString('hex'), runtimePassword=randomBytes(32).toString('hex');
const databaseUrl=(role,password)=>`postgres://${role}:${password}@cockroach:26257/chief_platform?sslmode=disable`;
const policy=join(directory,'policy');await mkdir(policy,{recursive:true});
await writeFile(join(policy,'grants.json'),JSON.stringify({version:1,mode:'staging',validUntil:expiresAt,grants}),{mode:0o600});
await writeFile(join(directory,'migration-db'),databaseUrl('chief_lifecycle_migration',migrationPassword),{mode:0o600});
await writeFile(join(directory,'runtime-db'),databaseUrl('chief_lifecycle_runtime',runtimePassword),{mode:0o600});
await writeFile(join(directory,'encryption-key'),randomBytes(32).toString('base64url'),{mode:0o600});
await writeFile(marker,JSON.stringify({preparedAt:new Date().toISOString(),accountImage:release.accountImage,lifecycleImage:release.candidateImage,backupPath}));
sql(`CREATE USER chief_lifecycle_migration WITH PASSWORD '${migrationPassword}'; CREATE USER chief_lifecycle_runtime WITH PASSWORD '${runtimePassword}'; GRANT CREATE ON DATABASE chief_platform TO chief_lifecycle_migration;`);
const environment={CHIEF_LIFECYCLE_MODE:'staging',CHIEF_LIFECYCLE_ALLOW_PLAINTEXT_DB:'1',CHIEF_LIFECYCLE_ORIGIN:'http://localhost:18087',
  CHIEF_LIFECYCLE_HOST:'0.0.0.0',CHIEF_LIFECYCLE_PORT:'8097',CHIEF_LIFECYCLE_ACCOUNTS_URL:'http://account:3000',
  CHIEF_LIFECYCLE_TRANSACTOR_URL:'http://transactor:3333',CHIEF_LIFECYCLE_DATABASE_URL_FILE:'/run/chief/runtime-db',
  CHIEF_LIFECYCLE_ENCRYPTION_KEY_FILE:'/run/chief/encryption-key',CHIEF_LIFECYCLE_POLICY_FILE:'/run/chief-policy/grants.json'};
const secretsMounts=['runtime-db','encryption-key'].map(name=>({type:'bind',source:join(directory,name),target:'/run/chief/'+name,read_only:true}));
const service={image:release.candidateImage,restart:'unless-stopped',init:true,read_only:true,user:'node',cap_drop:['ALL'],security_opt:['no-new-privileges:true'],mem_limit:'256m',cpus:0.5,
  environment,volumes:[...secretsMounts,{type:'bind',source:policy,target:'/run/chief-policy',read_only:true}],networks:{platform:{aliases:['chief-lifecycle']}},
  healthcheck:{test:['CMD','node','-e',"require('node:http').get('http://127.0.0.1:8097/chief/v1/status',{headers:{Host:'localhost:18087'},timeout:3000},r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))"],interval:'10s',timeout:'5s',retries:3},stop_grace_period:'20s'};
await writeFile(serviceConfig,JSON.stringify({services:{'chief-lifecycle':service},networks:{platform:{external:true,name:'chief-platform_backend'}}},null,2));
const migrationArgs=['run','--rm','--network','chief-platform_backend','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
  ...Object.entries({...environment,CHIEF_LIFECYCLE_DATABASE_URL_FILE:'/run/chief/migration-db'}).flatMap(([k,v])=>['--env',k+'='+v]),
  '--mount',`type=bind,src=${join(directory,'migration-db')},dst=/run/chief/migration-db,readonly`,
  '--mount',`type=bind,src=${join(directory,'encryption-key')},dst=/run/chief/encryption-key,readonly`,release.candidateImage,'node','main.mjs','migrate'];
docker(migrationArgs);
sql('GRANT USAGE ON SCHEMA chief_lifecycle TO chief_lifecycle_runtime; GRANT SELECT ON TABLE chief_lifecycle.schema_version TO chief_lifecycle_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chief_lifecycle.member_session, chief_lifecycle.connection_challenge, chief_lifecycle.member_connection, chief_lifecycle.runtime_nonce TO chief_lifecycle_runtime;');
await writeFile(join(local,'con01-account.compose.json'),JSON.stringify({services:{account:{image:release.accountImage}}}));
} else {
  const prepared=await json(marker);assert.equal(prepared.accountImage,release.accountImage);assert.equal(prepared.lifecycleImage,release.candidateImage);
  backupPath=prepared.backupPath;
  const config=await json(serviceConfig);assert.equal(config.services['chief-lifecycle'].image,release.candidateImage);
  assert.equal(config.services['chief-lifecycle'].environment.CHIEF_LIFECYCLE_ORIGIN,'http://localhost:18087');
  assert.equal(config.services['chief-lifecycle'].ports,undefined);
  config.services['chief-lifecycle'].healthcheck.test=['CMD','node','-e',"require('node:http').get('http://127.0.0.1:8097/chief/v1/status',{headers:{Host:'localhost:18087'},timeout:3000},r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))"];
  await writeFile(serviceConfig,JSON.stringify(config,null,2));
  expiresAt=(await json(join(directory,'policy/grants.json'))).validUntil;
}
let proxyChanged=false;
try {
  docker(compose('up','--detach','--no-deps','--no-build','--pull','never','account'));
  if(!resume)for(let attempt=0;;attempt++) {
    const rows=sql("SELECT count(*) AS count FROM information_schema.columns WHERE table_schema='global_account' AND table_name='workspace_members' AND column_name='membership_epoch'");
    if(rows.split(/\r?\n/).at(-1)==='1')break;
    if(attempt>=30)throw Error('Accounts membership migration did not become ready');
    await new Promise(r=>setTimeout(r,500));
  }
  docker(serviceCompose('up','--detach','--no-build','--pull','never','--wait','--wait-timeout','60'));
  const location=await readFile(join(integration,'lifecycle/nginx-location.conf'),'utf8');
  await writeFile(proxyPath,proxyBefore.replace('    location / {',location+'\n    location / {'));proxyChanged=true;
  docker(['exec','chief-platform-nginx-1','nginx','-t']);docker(['exec','chief-platform-nginx-1','nginx','-s','reload']);
  const response=await fetch('http://localhost:18087/chief/v1/status',{signal:AbortSignal.timeout(5000)});assert.ok(response.ok);
  const after=snapshot();
  for(const old of before){const current=after.find(c=>c.service===old.service);assert.ok(current?.running);assert.deepEqual(current.mounts,old.mounts);
    if(old.service==='account')assert.equal(current.image,release.accountImage);else assert.equal(current.id,old.id);}
  const receipt={passed:true,deployedAt:new Date().toISOString(),target:'existing local loopback workspace',mode:'staging',productionTls:false,
    accountImage:release.accountImage,lifecycleImage:release.candidateImage,frontImage:front.image,buildReceiptSha256:buildHash,
    backupPath,allOriginalMountsPreserved:true,unchangedOriginalServices:16,dispatchEnabled:false,operatorGrantExpiresAt:expiresAt,before,after};
  await writeFile(join(ROOT,'docs/verification/evidence/chief-con01-local-rollout.json'),JSON.stringify(receipt,null,2));
  const manifest=await json(join(local,'manifest.json'));await writeFile(join(local,'manifest.json'),JSON.stringify({...manifest,updatedAt:receipt.deployedAt,con01:{enabled:true,localOnly:true,accountOverlay:'con01-account.compose.json',serviceCompose:serviceConfig},images:{...manifest.images,account:release.accountImage}},null,2));
  console.log(JSON.stringify({passed:true,target:receipt.target,allOriginalMountsPreserved:true,dispatchEnabled:false}));
} catch(error) {
  if(proxyChanged){await writeFile(proxyPath,proxyBefore);docker(['exec','chief-platform-nginx-1','nginx','-t']);docker(['exec','chief-platform-nginx-1','nginx','-s','reload']);}
  try{docker(serviceCompose('stop','chief-lifecycle'));}catch{}
  // Keep the additive epoch schema and epoch-aware Accounts authority. Never
  // restore an older writer over a migrated database or delete recovery data.
  throw error;
}
