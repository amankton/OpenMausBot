import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { accountsMemberVerifier } from './member.mjs';
import { AccessError, credentialVault } from './security.mjs';

const account = randomUUID(), workspace = randomUUID();
const token = claims => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.fixture';
const ordinary = token({ account, workspace });
const verifier = fetcher => accountsMemberVerifier({ accountsUrl: 'http://localhost/accounts', transactorUrl: 'http://localhost/transactor', fetcher });
const rejected = (action, status) => assert.rejects(action, e => e instanceof AccessError && e.status === status);
const response = value => new Response(JSON.stringify(value));

test('privileged token forms never reach the membership authority', async () => {
  let calls = 0;
  const verify = verifier(async () => { calls++; throw Error('Unexpected call'); });
  for (const claims of [
    { account, workspace, extra: { admin: true } },
    { account, workspace, extra: { admin: 'true', authMethod: 'password' } },
    { account, workspace, extra: { service: 'accounts', authMethod: 'otp' } },
    { account, workspace, extra: { authMethod: 'unknown' } },
    { account, workspace, extra: { authMethod: { password: true } } },
    { account, workspace, grant: 'system' },
    { account: '1749089e-22e6-48de-af4e-165e18fbd2f9', workspace },
    { account, workspace, extra: [] }
  ]) await rejected(() => verify(token(claims)), 401);
  assert.equal(calls, 0);
});

test('ordinary password and OTP login metadata still requires authoritative membership', async () => {
  for (const authMethod of ['password', 'otp']) {
    const membershipEpoch = randomUUID(); let step = 0;
    const values = [{ result: { account, workspace, role: 'OWNER' } },
      { result: [{ person: account, role: 'OWNER', membershipEpoch }] }, { dataType: 'TotalArray', value: [{ _id: 'synthetic-owner' }] }];
    const signedIn = token({ account, workspace, extra: { authMethod } });
    assert.equal((await verifier(async () => response(values[step++]))(signedIn)).membershipEpoch, membershipEpoch);
    assert.equal(step, 3);
    await rejected(() => verifier(async () => response({ error: { code: 'platform:status:Forbidden' } }))(signedIn), 403);
  }
});

test('ordinary token claims cannot override authoritative workspace identity', async () => {
  const verify = verifier(async () => response({ result: { account, workspace: randomUUID(), role: 'USER' } }));
  await rejected(() => verify(ordinary), 403);
});

test('membership and active person are both required', async () => {
  for (const people of [[], [{ _id: 'a' }, { _id: 'b' }]]) {
    let step = 0;
    const responses = [
      { result: { account, workspace, role: 'USER' } },
      { result: [{ person: account, role: 'USER', membershipEpoch: randomUUID() }] },
      { dataType: 'TotalArray', value: people }
    ];
    await rejected(() => verifier(async () => response(responses[step++]))(ordinary), 403);
  }
  let step = 0;
  await rejected(() => verifier(async () => response(step++ === 0
    ? { result: { account, workspace, role: 'USER' } } : { result: [] }))(ordinary), 403);
});

test('authority outages fail closed without returning diagnostics', async () => {
  const verify = verifier(async () => { throw Error('private upstream diagnostic'); });
  await assert.rejects(() => verify(ordinary), error => error.status === 503 && !error.message.includes('private'));
});

test('only known authority denials are classified as membership revocation', async () => {
  await rejected(() => verifier(async () => response({ error: { code: 'platform:status:Forbidden' } }))(ordinary), 403);
  await rejected(() => verifier(async () => response({ error: { code: 'platform:status:InternalServerError' } }))(ordinary), 503);
});

test('encrypted member credential cannot be moved across session identities or altered', () => {
  const vault = credentialVault(randomBytes(32));
  const cipher = vault.seal(ordinary, 'workspace:member:session-one');
  assert.equal(cipher.includes(ordinary), false);
  assert.equal(vault.open(cipher, 'workspace:member:session-one'), ordinary);
  assert.throws(() => vault.open(cipher, 'workspace:member:session-two'), AccessError);
  const parts = cipher.split('.');
  const body = Buffer.from(parts[2], 'base64url'); body[0] ^= 1; parts[2] = body.toString('base64url');
  assert.throws(() => vault.open(parts.join('.'), 'workspace:member:session-one'), AccessError);
});

test('missing membership epochs fail closed, and browser claims cannot supply one', async () => {
  let step = 0;
  const values = [{ result: { account, workspace, role: 'USER' } }, { result: [{ person: account, role: 'USER' }] }];
  await rejected(() => verifier(async () => response(values[step++]))(ordinary), 503);
  await rejected(() => verifier(async () => { throw Error('must not call authority'); })(token({ account, workspace, membershipEpoch: randomUUID() })), 401);
});

test('membership epoch comes from the current Accounts member result', async () => {
  const membershipEpoch = randomUUID(); let step = 0;
  const values = [{ result: { account, workspace, role: 'USER' } },
    { result: [{ person: account, role: 'USER', membershipEpoch }] }, { dataType: 'TotalArray', value: [{ _id: 'synthetic-person' }] }];
  assert.equal((await verifier(async () => response(values[step++]))(ordinary)).membershipEpoch, membershipEpoch);
});
