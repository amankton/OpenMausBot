#!/usr/bin/env node
// Prepare private local configuration only. Never starts a worker or any container.
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,lstat,realpath,readdir,chmod} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const same=(a,b)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const run=(args)=>{try{return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',args],{encoding:'utf8',windowsHide:true,timeout:30000,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath')),stdio:['ignore','pipe','pipe']}).trim()}catch(error){const category=String(error.stderr??'').match(/FullyQualifiedErrorId\s*:\s*([a-zA-Z0-9_.]+)/)?.[1]??'Unknown';throw Error('Private capture directory permission validation failed ('+category+'); no secrets emitted.')}};
export function capturePaths(root=ROOT){const directory=join(root,'.chief-local/meeting-capture');return {directory,audio:join(directory,'audio'),env:join(directory,'capture.env'),config:join(directory,'worker.json'),model:join(root,'.chief-local/capture-models/tiny.en')};}
async function noLink(path,kind){const stat=await lstat(path);if(stat.isSymbolicLink()||!same(await realpath(path),path)||(kind==='directory'?!stat.isDirectory():!stat.isFile()))throw Error('Capture paths must be regular and must not redirect.');}
async function inspectTree(directory){
 await noLink(directory,'directory');
 if(process.platform==='win32')run(`$ErrorActionPreference='Stop';$p=${quote(directory)}; $items=@(Get-Item -LiteralPath $p -Force)+@(Get-ChildItem -LiteralPath $p -Recurse -Force);if($items | Where-Object {($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0}){throw 'Reparse path refused'}`);
 for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await inspectTree(path);else await noLink(path,'file');}
}
async function acl(directory,apply){
 if(process.platform!=='win32'){if(apply){await chmod(directory,0o700);for(const item of await readdir(directory,{withFileTypes:true})){const p=join(directory,item.name);if(item.isDirectory())await acl(p,true);else await chmod(p,0o600);}}return;}
 const code=`$ErrorActionPreference='Stop';$p=${quote(directory)};$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18');$items=@(Get-Item -LiteralPath $p -Force)+@(Get-ChildItem -LiteralPath $p -Recurse -Force);foreach($item in $items){if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse refused'};${apply?`if($item.PSIsContainer){$flags=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$flags=[Security.AccessControl.InheritanceFlags]::None};$security=Get-Acl -LiteralPath $item.FullName;$security.SetAccessRuleProtection($true,$false);foreach($old in @($security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))){[void]$security.RemoveAccessRuleSpecific($old)};foreach($identity in @($sid,$system)){$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);$security.AddAccessRule($rule)};if($item.PSIsContainer){[IO.Directory]::SetAccessControl($item.FullName,$security)}else{[IO.File]::SetAccessControl($item.FullName,$security)};`:''}$actual=Get-Acl -LiteralPath $item.FullName;if($item.FullName -eq $p -and !$actual.AreAccessRulesProtected){throw 'Inherited capture ACL'};$rules=$actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);if($rules.Count -ne 2){throw 'Unexpected capture ACL'};foreach($rule in $rules){if($rule.IdentityReference.Value -notin @($sid.Value,$system.Value) -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl){throw 'Broad capture ACL'}}}`;
 run(code);
}
async function existing(path){try{await noLink(path,'file');return await readFile(path,'utf8')}catch(error){if(error.code==='ENOENT')return;throw error}}
async function otherSecrets(root){const values=[];for(const name of ['platform.env','meetings.env']){const raw=await existing(join(root,'.chief-local/platform',name));if(raw==null)throw Error('Prepare existing private Platform and meeting settings first.');for(const line of raw.split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&/(SECRET|PASSWORD|KEY)$/.test(line.slice(0,i)))values.push(line.slice(i+1));}}return values;}
export function workerConfiguration(root,secret){const p=capturePaths(root);return {loveUrl:'http://localhost:18087/_love',livekitUrl:'ws://localhost:18087/_livekit',modelDirectory:p.model,audioDirectory:p.audio,workerSecret:secret};}
export function validateWorkerConfiguration(root,config,env,forbidden=[]){
 const match=/^CHIEF_CAPTURE_WORKER_SECRET=([a-f0-9]{64})\r?\n?$/.exec(env);
 if(!match||forbidden.includes(match[1]))throw Error('Capture needs a distinct private worker credential.');
 const expected=workerConfiguration(root,match[1]);
 if(JSON.stringify(config)!==JSON.stringify(expected))throw Error('Unreviewed native worker configuration.');
 return expected;
}
export async function validateCaptureConfiguration(root=ROOT){
 const p=capturePaths(root);await noLink(join(root,'.chief-local'),'directory');await inspectTree(p.directory);await noLink(p.audio,'directory');await inspectTree(p.model);await acl(p.directory,false);
 const raw=await existing(p.config),env=await existing(p.env);if(raw==null||env==null||raw.length>16384)throw Error('Prepare private capture configuration first.');
 validateWorkerConfiguration(root,JSON.parse(raw),env,await otherSecrets(root));
 return {prepared:true,config:p.config,metadataVolume:'chief-platform_capture_metadata'};
}
export async function prepareCaptureConfiguration(root=ROOT){
 await noLink(root,'directory');const local=join(root,'.chief-local');await noLink(local,'directory');
 const p=capturePaths(root);try{await inspectTree(p.directory)}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(p.directory,{mode:0o700});}
 await acl(p.directory,true);await mkdir(p.audio,{recursive:true,mode:0o700});await inspectTree(p.directory);
 const forbidden=await otherSecrets(root);const oldEnv=await existing(p.env),oldConfig=await existing(p.config);
 let secret=oldEnv?.match(/^CHIEF_CAPTURE_WORKER_SECRET=([a-f0-9]{64})\r?\n?$/)?.[1];
 if(oldEnv!=null&&secret==null)throw Error('Existing capture environment is invalid; refusing replacement.');
 if(oldConfig!=null){const stored=JSON.parse(oldConfig);if(secret!=null&&secret!==stored.workerSecret)throw Error('Existing capture credentials disagree.');secret??=stored.workerSecret;}
 secret??=randomBytes(32).toString('hex');const env=`CHIEF_CAPTURE_WORKER_SECRET=${secret}\n`;const config=workerConfiguration(root,secret);
 validateWorkerConfiguration(root,config,env,forbidden);
 if(oldConfig!=null)validateWorkerConfiguration(root,JSON.parse(oldConfig),env,forbidden);
 if(oldEnv==null)await writeFile(p.env,env,{mode:0o600,flag:'wx'});
 if(oldConfig==null)await writeFile(p.config,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
 await acl(p.directory,true);await validateCaptureConfiguration(root);
 return {prepared:true,started:false,config:p.config,metadataVolume:'chief-platform_capture_metadata'};
}
if(process.argv[1]&&same(process.argv[1],fileURLToPath(import.meta.url))){
 if(process.argv.length!==2){console.error('This prepare-only script accepts no arguments.');process.exitCode=1;}
 else prepareCaptureConfiguration().then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('Capture preparation failed; existing data and services were preserved, details suppressed to protect credentials.');process.exitCode=1;});
}
