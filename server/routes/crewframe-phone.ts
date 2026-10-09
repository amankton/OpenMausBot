import { PASS, type RouteHandler } from './table.ts';

/** The companion control plane is available only to this machine's owner. */
export function createCrewframePhoneRoutes(enabled: boolean, fetchImpl: typeof fetch = fetch): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith('/api/crewframe/phone')) return PASS;
    res.setHeader('cache-control', 'no-store');
    if (!enabled) return json(res, 404, { error: 'Crewframe phone access is not enabled.' });
    const hostname = new URL(`http://${req.headers.host ?? 'invalid'}`).hostname;
    const origin = req.headers.origin;
    if (auth.kind !== 'loopback' || auth.trust === 'service' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ||
        (origin && origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      return json(res, 403, { error: 'Phone setup is available only on the Crewframe computer.' });
    }
    const operations: Record<string, string> = {
      'GET /api/crewframe/phone/state': '/state',
      'POST /api/crewframe/phone/pairing': '/pairing',
      'DELETE /api/crewframe/phone/pairing': '/pairing',
      'POST /api/crewframe/phone/refresh': '/tailscale/refresh',
    };
    let target = operations[`${method} ${path}`];
    if (!target) return json(res, 405, { error: 'Unsupported phone setup operation.' });
    if (method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return json(res, 415, { error: 'Send phone setup requests as JSON.' });
    }
    if (method === 'DELETE') {
      const body = await readBody(req) as { expectedToken?: unknown };
      if (typeof body.expectedToken !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(body.expectedToken)) {
        return json(res, 400, { error: 'The pairing window to cancel must be specified.' });
      }
      target += `?expectedToken=${encodeURIComponent(body.expectedToken)}`;
    }
    try {
      const reply = await fetchImpl(`http://127.0.0.1:8821${target}`, { method, signal: AbortSignal.timeout(5000) });
      const body = await reply.json();
      if (reply.ok && (!body || typeof body !== 'object' || !('port' in body) || body.port !== 8820)) return json(res, 503, { error: 'The phone companion belongs to a different workspace.' });
      return json(res, reply.status, body);
    } catch {
      return json(res, 503, { error: 'Crewframe phone companion is unavailable. Restart Agent Crew and try again.' });
    }
  };
}
