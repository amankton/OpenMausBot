import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchVerificationServer } from './control-omb.ts';
import { createControlClient, CONTROL_UNAVAILABLE_PLAIN } from '../server/control-client.ts';

const fixture = await launchVerificationServer();
try {
  const client = createControlClient({
    url: fixture.info.url + '/api/internal/computer-control?botId=synthetic-control-fixture',
    token: 'invalid-synthetic-capability',
  });
  const state = await client.state(true);
  assert.equal(state.held, true);
  assert.equal(state.blockedReason, CONTROL_UNAVAILABLE_PLAIN);
  assert.match(state.blockedReason, /could not verify/);
  const receipt = { passed: true, verifiedAt: new Date().toISOString(), isolatedServer: true,
    invalidCapabilityBlocked: true, distinguishesUnavailableFromHumanControl: true,
    ownerDataUsed: false, desktopActions: 0 };
  writeFileSync('docs/verification/evidence/chief-control-expiry.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await fixture.close(); }
