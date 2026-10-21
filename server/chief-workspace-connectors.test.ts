import type { IncomingMessage } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requiredScope, resolveRequestAuth } from './request-auth.ts';
import { SessionRegistry } from './sessions.ts';
import { removeTempDir } from './testing/cleanup.ts';

// Personal / and owner /workspace must use the same native management API.
// Giving that API another UI entry must not give platform members its authority.
const routes = [
  ['GET','/api/connectors/catalog'], ['GET','/api/connectors/connected'],
  ['GET','/api/connectors/tools'], ['GET','/api/connectors?services=gmail'],
  ['POST','/api/connectors/gmail/authorize'],
  ['DELETE','/api/connectors/gmail/accounts/ca_fixture'], ['DELETE','/api/connectors/gmail'],
  ['PUT','/api/config'],
] as const;

describe('Chief shared workspace native Apps authority',()=>{
 let dir:string;let sessions:SessionRegistry;
 beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'chief-apps-auth-'));sessions=new SessionRegistry({file:join(dir,'sessions.json')});});
 afterEach(async()=>{await removeTempDir(dir);});
 const check=(method:string,path:string,headers:Record<string,string>)=>resolveRequestAuth(
  {method,headers} as IncomingMessage,
  {sessions,cookieName:'fixture_session',streamPath:'/api/events',url:new URL(path,'http://127.0.0.1:5299')},
 );
 it('keeps catalog, inventory, authorization and disconnect behind native admin scope',()=>{
  for(const [method,path] of routes) expect(requiredScope(method,new URL(path,'http://localhost').pathname)).toBe('admin');
  const member=sessions.issue({label:'Fixture member',scopes:['client']});
  for(const [method,path] of routes){
   const result=check(method,path,{host:'127.0.0.1:5299',authorization:`Bearer ${member.token}`});
   expect(result.auth,path).toBeNull();expect(result.status,path).toBe(403);
  }
 });
 it('allows the native local owner without introducing a different connection identity',()=>{
  for(const [method,path] of routes){
   const result=check(method,path,{host:'127.0.0.1:5299',origin:'http://127.0.0.1:5299'});
   expect(result.auth?.kind,path).toBe('loopback');expect(result.auth?.scopes,path).toContain('admin');
  }
 });
 it('never promotes an Office bearer or revoked member to native owner through loopback fallback',()=>{
  const member=sessions.issue({label:'Fixture member',scopes:['client']});
  sessions.revoke(member.session.id);
  for(const token of ['chief_office_fixture',member.token]) for(const [method,path] of routes){
   const result=check(method,path,{host:'127.0.0.1:5299',authorization:`Bearer ${token}`});
   expect(result.auth,path).toBeNull();expect(result.status,path).toBe(401);
  }
 });
});
