import { createServer } from 'node:http';
import { AccessError, exact } from './security.mjs';

const cookieName = 'chief-lifecycle-session';
const sessionCookie = (secret = '', expires = new Date(0)) => `${cookieName}=${secret}; Path=/chief/v1; HttpOnly; Secure; SameSite=None; Partitioned; Expires=${expires.toUTCString()}`;
const bearer = request => {
  const match = /^Bearer ([\w.-]{1,8192})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new AccessError(401, 'Authentication is required');
  return match[1];
};
const session = (request, optional = false) => {
  const values = (request.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(cookieName + '='));
  if (optional && values.length === 0) return undefined;
  if (values.length !== 1) throw new AccessError(401, 'A member session is required');
  return values[0].slice(cookieName.length + 1);
};
async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new AccessError(415, 'JSON is required');
  const chunks = []; let count = 0;
  for await (const chunk of request) {
    count += chunk.length; if (count > 16384) throw new AccessError(413, 'Request is too large'); chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AccessError(400, 'Invalid JSON'); }
}
export function createLifecycleServer({ pairing, origin, readiness = async () => {} }) {
  const configured = new URL(origin);
  if (!['http:', 'https:'].includes(configured.protocol) || configured.origin !== origin) throw Error('An exact lifecycle browser origin is required');
  return createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { response.writeHead(status); response.end(JSON.stringify(value)); };
    try {
      if (request.headers.host !== configured.host || (request.headers.origin && request.headers.origin !== origin)) throw new AccessError(403, 'Origin is not allowed');
      const url = new URL(request.url, origin);
      if (url.search || url.hash) throw new AccessError(400, 'Query parameters are not accepted');
      const path = url.pathname;
      const method = request.method;
      if (method === 'GET' && path === '/chief/v1/status') { await readiness(); return send(200, { enabled: true }); }
      if (method === 'GET' && path === '/chief/v1/sessions/current') {
        const result = await pairing.memberSession(bearer(request), session(request));
        return send(200, { member: result.member, expiresAt: result.session.expires_at });
      }
      const runtime = ['/chief/v1/connections/complete', '/chief/v1/runtime/authorize'].includes(path);
      // Browser mutations require the exact Origin; native runtime proofs do not.
      if (!runtime && method !== 'GET' && request.headers.origin !== origin) throw new AccessError(403, 'Browser origin is required');
      if (method === 'POST' && path === '/chief/v1/sessions') {
        exact(await readBody(request), []);
        const result = await pairing.openSession(bearer(request), session(request, true));
        response.setHeader('Set-Cookie', sessionCookie(result.secret, result.expiresAt));
        return send(201, { member: result.member, expiresAt: result.expiresAt });
      }
      if (method === 'DELETE' && path === '/chief/v1/sessions/current') {
        await pairing.closeBrowserSession(session(request, true));
        response.setHeader('Set-Cookie', sessionCookie()); return send(200, { revoked: true });
      }
      if (method === 'POST' && path === '/chief/v1/connections/challenges') {
        exact(await readBody(request), []);
        return send(201, await pairing.challenge(bearer(request), session(request)));
      }
      if (method === 'POST' && path === '/chief/v1/connections/complete') return send(201, await pairing.complete(await readBody(request)));
      if (method === 'GET' && path === '/chief/v1/connections') return send(200, { connections: await pairing.list(bearer(request), session(request)) });
      const connection = /^\/chief\/v1\/connections\/([a-f0-9-]{36})(\/confirm)?$/.exec(path);
      if (connection && method === 'POST' && connection[2]) {
        const body = await readBody(request); exact(body, ['keyFingerprint']);
        return send(200, await pairing.confirm(bearer(request), session(request), connection[1], body.keyFingerprint));
      }
      if (connection && method === 'DELETE' && !connection[2]) {
        await pairing.revoke(bearer(request), session(request), connection[1]); return send(200, { revoked: true });
      }
      if (method === 'POST' && path === '/chief/v1/runtime/authorize') {
        // Authorization probe only. No dispatch or workspace mutation exists yet.
        return send(200, await pairing.authorizeRuntime(bearer(request), await readBody(request)));
      }
      send(404, { error: 'Not found' });
    } catch (error) {
      // Never serialize database/Accounts diagnostics, tokens or request bodies.
      send(error instanceof AccessError ? error.status : 503, { error: error instanceof AccessError ? error.message : 'Lifecycle service unavailable' });
    }
  });
}
