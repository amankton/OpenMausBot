import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, readBody } from '../harness/http.ts';
import type { RequestAuth } from '../request-auth.ts';
import { createCrewframePhoneRoutes } from './crewframe-phone.ts';
import { dispatchRoutes } from './table.ts';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))); });
async function serve(enabled = true, auth: RequestAuth = { kind: 'loopback', scopes: ['admin', 'client'] }, fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ port: 8820, devices: [] }))) {
  const route = createCrewframePhoneRoutes(enabled, fetchImpl);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? 'GET', auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/crewframe/phone`, fetchImpl };
}
describe('Crewframe phone control', () => {
  it('uses the dedicated companion and never caches pairing state', async () => {
    const { base, fetchImpl } = await serve();
    const response = await fetch(`${base}/state`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8821/state');
  });
  it('is unavailable outside the opted-in Crewframe runtime', async () => {
    const { base, fetchImpl } = await serve(false);
    expect((await fetch(`${base}/state`)).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses reduced service trust and foreign browser origins', async () => {
    const reduced = await serve(true, { kind: 'loopback', scopes: [], trust: 'service' });
    expect((await fetch(`${reduced.base}/state`)).status).toBe(403);
    const owner = await serve();
    expect((await fetch(`${owner.base}/state`, { headers: { origin: 'https://foreign.example' } })).status).toBe(403);
    expect(owner.fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses paired sessions even with admin scope', async () => {
    const { base, fetchImpl } = await serve(true, { kind: 'session', scopes: ['admin'], via: 'bearer', session: {
      id: 'test-device', label: 'Test phone', tokenHash: 'synthetic', scopes: ['admin'], createdAt: 1, lastSeenAt: 1, expiresAt: Date.now() + 10000,
    } });
    expect((await fetch(`${base}/state`)).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('requires JSON for pairing and a specific token for cancellation', async () => {
    const { base, fetchImpl } = await serve();
    expect((await fetch(`${base}/pairing`, { method: 'POST' })).status).toBe(415);
    expect((await fetch(`${base}/pairing`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    const token = 'synthetic_pairing_window_credential';
    expect((await fetch(`${base}/pairing`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedToken: token }) })).status).toBe(200);
    expect(fetchImpl.mock.calls[0][0]).toBe(`http://127.0.0.1:8821/pairing?expectedToken=${token}`);
  });
  it('reports offline or wrong-workspace companions without returning their state', async () => {
    const wrong = await serve(true, undefined, vi.fn<typeof fetch>(async () => Response.json({ port: 8810, pairing: 'private' })));
    const response = await fetch(`${wrong.base}/state`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    const offline = await serve(true, undefined, vi.fn<typeof fetch>(async () => { throw new Error('offline'); }));
    expect((await fetch(`${offline.base}/state`)).status).toBe(503);
  });
});
