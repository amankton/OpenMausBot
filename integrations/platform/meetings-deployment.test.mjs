import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{meetingLiveKitConfig,validateLoveImage}from'../../scripts/configure-chief-platform-meetings.mjs';
const overlay=JSON.parse(readFileSync(new URL('./meetings.compose.json',import.meta.url),'utf8'));
test('meeting overlay has private network and only loopback RTC ports; no privileged mounts',()=>{for(const name of ['love','livekit']){const s=overlay.services[name];assert.deepEqual(s.networks,['backend']);assert.equal(s.pull_policy,'never');for(const key of ['privileged','network_mode','pid','devices','cap_add','volumes_from'])assert.equal(s[key],undefined)}assert.deepEqual(overlay.services.livekit.ports,['127.0.0.1:18088:18088/tcp','127.0.0.1:18089:18089/udp']);assert.equal(overlay.services.love.ports,undefined);assert.match(overlay.services.livekit.image,/@sha256:[a-f0-9]{64}$/);assert.ok(overlay.services.love.environment.includes('CHIEF_MEMBER_MEETINGS_ONLY=true'))});
test('runtime requires exact patched image and separate caller-supplied LiveKit keys',()=>{for(const value of ['latest','platformcollective/love:s0.7.426','sha256:bad',''])assert.throws(()=>validateLoveImage(value));assert.equal(validateLoveImage('sha256:'+'a'.repeat(64)),'sha256:'+'a'.repeat(64));const c=meetingLiveKitConfig('fixture','synthetic');assert.deepEqual(c.keys,{fixture:'synthetic'});assert.deepEqual(c.webhook.urls,['http://love:8096/webhook']);assert.equal(c.rtc.node_ip,'127.0.0.1');assert.equal(c.rtc.use_external_ip,false);assert.equal(c.room.auto_create,false)});
test('mapped RTC candidates exclude container loopback without broadening published ports or forcing TCP',()=>{
 const {rtc,logging}=meetingLiveKitConfig('fixture','synthetic');
 assert.equal(rtc.enable_loopback_candidate,false,'loopback and eth0 must not compete for the same rewritten candidate and TCP mux');
 assert.equal(rtc.node_ip,'127.0.0.1');
 assert.equal(rtc.force_tcp,undefined);
 assert.equal(rtc.use_external_ip,false);
 assert.equal(logging.level,'warn');
 assert.equal(logging.pion_level,undefined);
 assert.deepEqual(overlay.services.livekit.ports,[`127.0.0.1:${rtc.tcp_port}:${rtc.tcp_port}/tcp`,`127.0.0.1:${rtc.udp_port}:${rtc.udp_port}/udp`]);
});
