import { AccessError, uuid } from './security.mjs';

const roles = new Set(['USER', 'MAINTAINER', 'OWNER', 'ADMIN']);
const systemAccount = '1749089e-22e6-48de-af4e-165e18fbd2f9';
// Decode only to reject privileged token forms before calling Accounts. This is
// not authentication: Accounts verifies the signature and current membership.
function ordinaryClaims(token) {
  try {
    if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw Error();
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    if (!uuid(claims.account) || !uuid(claims.workspace) || claims.account === systemAccount ||
        Object.keys(claims).some(k => !['account', 'workspace', 'extra', 'exp', 'nbf', 'iat'].includes(k)) ||
        (claims.extra != null && (typeof claims.extra !== 'object' || Array.isArray(claims.extra) ||
          Object.keys(claims.extra).some(k => k !== 'authMethod') ||
          ('authMethod' in claims.extra && !['password', 'otp'].includes(claims.extra.authMethod))))) throw Error();
    return claims;
  } catch { throw new AccessError(401, 'An ordinary workspace member credential is required'); }
}
async function boundedJson(url, init, fetcher) {
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error();
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 262144) throw Error(); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new AccessError(503, 'Workspace authorization is unavailable'); }
}
export function accountsMemberVerifier({ accountsUrl, transactorUrl, fetcher = fetch, requireMembershipEpoch = true }) {
  // Endpoints are deployment configuration, never supplied by a browser/runtime.
  for (const endpoint of [accountsUrl, transactorUrl]) {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid configured Platform endpoint');
  }
  return async token => {
    const claims = ordinaryClaims(token);
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    const rpc = async method => {
      const value = await boundedJson(accountsUrl, { method: 'POST', headers, body: JSON.stringify({ method, params: {} }) }, fetcher);
      if (value.error) {
        const revoked = ['Forbidden', 'Unauthorized', 'TokenExpired', 'AccountNotFound', 'WorkspaceNotFound']
          .some(code => value.error.code === 'platform:status:' + code);
        throw new AccessError(revoked ? 403 : 503, revoked ? 'Current workspace membership is required' : 'Workspace authorization is unavailable');
      }
      return value.result;
    };
    const login = await rpc('getLoginInfoByToken');
    if (!login || login.account !== claims.account || login.workspace !== claims.workspace || !roles.has(login.role)) throw new AccessError();
    const members = await rpc('getWorkspaceMembers');
    const membership = Array.isArray(members) ? members.find(m => m.person === login.account && m.role === login.role) : undefined;
    if (!membership) throw new AccessError();
    if (requireMembershipEpoch && !uuid(membership.membershipEpoch)) throw new AccessError(503, 'Membership version authority is unavailable');
    const params = new URLSearchParams({ class: 'contact:mixin:Employee', query: JSON.stringify({ personUuid: login.account, active: true }), options: JSON.stringify({ limit: 2 }) });
    const response = await boundedJson(`${transactorUrl.replace(/\/$/, '')}/api/v1/find-all/${login.workspace}?${params}`, { headers }, fetcher);
    const people = response?.dataType === 'TotalArray' ? response.value : response;
    if (!Array.isArray(people) || people.length !== 1 || typeof people[0]._id !== 'string') throw new AccessError(403, 'An active workspace person is required');
    return { workspace: login.workspace, account: login.account, role: login.role, person: people[0]._id,
      ...(typeof login.socialId === 'string' ? { socialId: login.socialId } : {}),
      ...(typeof login.workspaceUrl === 'string' ? { workspaceSlug: login.workspaceUrl } : {}),
      ...(uuid(membership.membershipEpoch) ? { membershipEpoch: membership.membershipEpoch } : {}) };
  };
}
