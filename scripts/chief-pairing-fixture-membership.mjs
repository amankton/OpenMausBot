import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Mutations are restricted to the pre-existing synthetic acceptance workspace
// and its ordinary synthetic partner. No database bypass or email delivery.
export async function withRemovedSyntheticMember({ tokens, members, directory, action }) {
  const rpc = async (index, method, params = {}) => {
    const response = await fetch('http://localhost:18087/_accounts', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens[index] },
      body: JSON.stringify({ method, params })
    });
    if (!response.ok) throw Error('Synthetic membership authority unavailable');
    const value = await response.json();
    if (value.error) throw Error('Synthetic membership operation rejected: ' + value.error.code);
    return value.result;
  };
  const workspace = await rpc(0, 'getWorkspaceInfo');
  assert.equal(workspace.url, 'chiefacceptance');
  assert.equal(workspace.uuid, members[0].workspace);
  assert.equal(members[0].workspace, members[1].workspace);
  assert.notEqual(members[0].account, members[1].account);
  assert.equal(members[0].role, 'OWNER');
  assert.equal(members[1].role, 'USER');
  const social = await rpc(1, 'getSocialIds');
  const email = social.find(item => item.type === 'email' && item.verifiedOn && /chief|acceptance|synthetic|fixture/i.test(item.value))?.value;
  assert.equal(typeof email, 'string', 'Only the synthetic member can be removed');
  const inviteId = await rpc(0, 'createInvite', { exp: 300000, email, limit: 1, role: members[1].role });
  const recovery = { workspace: workspace.uuid, account: members[1].account, inviteId, role: members[1].role, state: 'prepared' };
  const file = join(directory, 'membership-recovery.private.json');
  await writeFile(file, JSON.stringify(recovery), { mode: 0o600 });
  try {
    await rpc(0, 'leaveWorkspace', { account: members[1].account });
    const current = await rpc(0, 'getWorkspaceMembers');
    assert.equal(current.some(member => member.person === members[1].account), false);
    await action();
  } finally {
    const current = await rpc(0, 'getWorkspaceMembers');
    if (!current.some(member => member.person === members[1].account)) await rpc(1, 'joinByToken', { inviteId });
    const restored = (await rpc(0, 'getWorkspaceMembers')).find(member => member.person === members[1].account);
    assert.equal(restored?.role, members[1].role, 'Restore the exact synthetic membership before exiting');
    await writeFile(file, JSON.stringify({ workspace: workspace.uuid, account: members[1].account, role: members[1].role, state: 'restored' }), { mode: 0o600 });
  }
}
