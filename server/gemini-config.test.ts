import { afterEach, expect, it, vi } from 'vitest';
import { liveSettingsFor, parseConfigPatch, stripWorkspaceCredentialEnv, syncCredentialEnv, type AppConfig } from './config.ts';
afterEach(()=>vi.unstubAllEnvs());
it('reports both providers independently and never exposes either key',()=>{
 const settings=liveSettingsFor({openai:{key:'fixture-openai'},live:{geminiKey:'fixture-gemini'}} as AppConfig);
 expect(settings.providers).toEqual({openai:{configured:true,model:'gpt-live-1'},gemini:{configured:true,model:'gemini-3.8-live'}});expect(settings.configured).toBe(true);expect(JSON.stringify(settings)).not.toContain('fixture-');
 expect(liveSettingsFor({openaiCompat:{key:'fixture-compatible'}} as AppConfig).providers?.openai.configured).toBe(false);
});
it('accepts the dedicated Gemini credential and strips it from engine environments',()=>{
 expect(parseConfigPatch({live:{geminiKey:'fixture-gemini'}})).toMatchObject({live:{geminiKey:'fixture-gemini'}});
 vi.stubEnv('OMB_GEMINI_LIVE_KEY','');syncCredentialEnv({live:{geminiKey:'fixture-gemini'}});expect(process.env.OMB_GEMINI_LIVE_KEY).toBe('fixture-gemini');
 const env={OMB_GEMINI_LIVE_KEY:'fixture-gemini',PATH:'fixture-path'};stripWorkspaceCredentialEnv(env);expect(env).toEqual({PATH:'fixture-path'});
});
