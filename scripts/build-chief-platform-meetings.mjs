/** Build reviewed retained backend outputs on the exact installed Linux runtimes. Does not deploy. */
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'.chief-local/platform-source');
const lock=JSON.parse(readFileSync(resolve(root,'integrations/platform/image-lock.json'),'utf8'));
const candidates={love:{source:'services/love',base:'workspace',files:['bundle.js']},workspace:{source:'pods/workspace',base:'workspace',files:['bundle.js','bundle.js.map']},transactor:{source:'pods/server',base:'transactor',files:['bundle.js','bundle.js.map','model.json']},tool:{source:'dev/tool',base:'workspace',files:['bundle.js']}};
const name=process.argv[2];if(!Object.hasOwn(candidates,name)||process.argv.length!==3)throw Error('Choose love, workspace, transactor, or tool.');
const spec=candidates[name],base=lock.images[spec.base].digest;
if(!/^platformcollective\/[a-z]+@sha256:[a-f0-9]{64}$/.test(base))throw Error('Unpinned runtime base.');
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
const context=docker(['context','show']).trim();if(!/^(npipe|unix):\/\//.test(docker(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']).trim()))throw Error('Local Docker only.');
docker(['image','inspect',base,'--format','{{.Id}}']);
const folder=resolve(root,'.chief-local/platform-build-contexts',name);mkdirSync(folder,{recursive:true});
const outputs={};for(const file of spec.files){const input=resolve(source,spec.source,'bundle',file);const data=readFileSync(input);outputs[file]=createHash('sha256').update(data).digest('hex');copyFileSync(input,resolve(folder,file));}
const patch=readFileSync(resolve(root,'integrations/platform/patches/0002-member-meeting-admission.patch'));
const patchHash=createHash('sha256').update(patch).digest('hex');
let capture;
if(name==='love'){
 const {verifyFrontendPatchStack}=await import('../integrations/platform/patches/verify-frontend-patch-stack.mjs');
 const stack=await verifyFrontendPatchStack();
 capture={patchSha256:stack.patchHashes['0005-consented-meeting-capture.patch'],filesVerified:stack.filesVerified};
 const notices=resolve(folder,'source-notice');mkdirSync(notices,{recursive:true});
 for(const file of ['0002-member-meeting-admission.patch','0005-consented-meeting-capture.patch','meeting-capture-provenance.json','MEETING_CAPTURE_BACKEND.md'])copyFileSync(resolve(root,'integrations/platform/patches',file),resolve(notices,file));
 copyFileSync(resolve(source,'LICENSE'),resolve(notices,'LICENSE'));
}
writeFileSync(resolve(folder,'Dockerfile'),`FROM ${base}\nWORKDIR /usr/src/app\n${spec.files.map(f=>`COPY ${f} ./`).join('\n')}\n${capture?'COPY source-notice /usr/share/chief/source-notice\n':''}LABEL org.opencontainers.image.revision="03b7aad7dc562f4f9769c51a4df08191a0393997" io.chief.admission-patch.sha256="${patchHash}"${capture?' io.chief.capture-patch.sha256="'+capture.patchSha256+'"':''}\nCMD ["node", "bundle.js"]\n`);
const tag=`chief-platform-${name}:chief-s0.7.426-admission`;
const log=docker(['build','--pull=false','--network=none','--tag',tag,folder]);writeFileSync(resolve(root,'.chief-local/platform-build-logs',`${name}-image.log`),log);
const id=docker(['image','inspect',tag,'--format','{{.Id}}']).trim();if(!/^sha256:[a-f0-9]{64}$/.test(id))throw Error('Cannot verify built image.');
const receipt={name,image:id,tag,base,sourceRevision:'03b7aad7dc562f4f9769c51a4df08191a0393997',patchSha256:patchHash,...(capture?{capture}:{}),outputs,builtAt:new Date().toISOString(),deployed:false};
writeFileSync(resolve(root,'.chief-local/platform',`${name}-image.json`),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({name,image:id,deployed:false}));
