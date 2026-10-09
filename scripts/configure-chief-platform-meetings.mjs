/** Prepare only; never restarts services, touches volumes, or prints keys. */
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PRIVATE=resolve(ROOT,'.chief-local/platform');
// Explicit node_ip maps every gathered interface to one address. Including lo
// can deduplicate eth0's candidate and strand its TCP mux connection.
export function meetingLiveKitConfig(key,secret){return {port:7880,bind_addresses:['0.0.0.0'],rtc:{tcp_port:18088,udp_port:18089,node_ip:'127.0.0.1',use_external_ip:false,enable_loopback_candidate:false},keys:{[key]:secret},webhook:{api_key:key,urls:['http://love:8096/webhook']},room:{auto_create:false},logging:{level:'warn'}};}
export function validateLoveImage(image){if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw new Error('Pass the exact locally built patched Love image ID.');return image;}
export async function prepareMeetingRuntime(image){
 if(image!==undefined)validateLoveImage(image);
 if((await lstat(PRIVATE)).isSymbolicLink()||resolve(await realpath(PRIVATE)).toLowerCase()!==PRIVATE.toLowerCase())throw new Error('Unexpected private configuration directory.');
 await lstat(resolve(PRIVATE,'platform.env'));
 const verified=image===undefined?undefined:execFileSync('docker',['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8',windowsHide:true}).trim();
 if(verified!==image)throw new Error('Patched Love image ID does not match.');
 const environment=resolve(PRIVATE,'meetings.env'),configPath=resolve(PRIVATE,'livekit.json');
 for(const path of [environment,configPath]){try{if((await lstat(path)).isSymbolicLink())throw new Error('Private meeting configuration must not be a link.')}catch(error){if(error.code!=='ENOENT')throw error}}
 let values;
 try{values=Object.fromEntries((await readFile(environment,'utf8')).trim().split('\n').map(line=>line.trim().split('=')))}catch(error){if(error.code!=='ENOENT')throw error;values={CHIEF_PLATFORM_LIVEKIT_KEY:'chief'+randomBytes(12).toString('hex'),CHIEF_PLATFORM_LIVEKIT_SECRET:randomBytes(32).toString('hex')}}
 if(!/^chief[a-f0-9]{24}$/.test(values.CHIEF_PLATFORM_LIVEKIT_KEY)||! /^[a-f0-9]{64}$/.test(values.CHIEF_PLATFORM_LIVEKIT_SECRET))throw new Error('Existing meeting key format is unexpected; preserved without alteration.');
 if(image!==undefined)values.CHIEF_PLATFORM_LOVE_IMAGE=image;
 await writeFile(environment,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
 await writeFile(configPath,JSON.stringify(meetingLiveKitConfig(values.CHIEF_PLATFORM_LIVEKIT_KEY,values.CHIEF_PLATFORM_LIVEKIT_SECRET),null,2)+'\n',{mode:0o600});
 return {prepared:true,started:false,loveImage:values.CHIEF_PLATFORM_LOVE_IMAGE??null,platformCredentialsChanged:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepareMeetingRuntime(process.argv[2])));
