// Real source API and SQLite; disposable fake-engine workspace, no paid calls.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { launchVerificationServer } from '../scripts/control-omb.ts';
import { importSelected } from './import-agents.mjs';

const fixture = await launchVerificationServer(process.env);
try {
  const url = fixture.info.url;
  const request = async (path, options = {}) => {
    const r = await fetch(url + path, { method: options.method || 'GET', headers: { Origin: url, 'Content-Type': 'application/json' }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(15000) });
    const body = await r.json(); assert.equal(r.ok, true, body.error || `HTTP ${r.status}`); return body;
  };
  await mkdir(join(fixture.info.dataDir, 'work'));
  const catalog = { agents: [{ id: 'synthetic-operator', name: 'Installer synthetic operator', title: 'Fixture', description: 'Isolated installation test', division: 'Installer fixture', color: 'blue', soul: 'Synthetic instructions. Do not contact any external service.', revision: 'fixture-v1' }] };
  const settings = { catalog, selected: ['synthetic-operator'], home: fixture.info.dataDir, request, protocol: 'Fixture-only protocol' };
  const first = await importSelected(settings); assert.equal(first[0].state, 'created');
  const second = await importSelected(settings); assert.equal(second[0].state, 'existing');
  const actual = (await request('/api/bots')).bots.filter(b => b.name === 'Installer synthetic operator');
  assert.equal(actual.length, 1); assert.equal(actual[0].approvalMode, 'auto'); assert.equal(actual[0].cwd, join(fixture.info.dataDir, 'work'));
  assert.ok(actual[0].soul.includes('Synthetic instructions.')); assert.ok(actual[0].soul.includes('chief-catalog:synthetic-operator'));
  console.log(JSON.stringify({ passed: true, realChiefApi: true, isolatedSQLite: true, repeatAddedZero: true, syntheticOnly: true, modelCalls: 0 }));
} finally { await fixture.close(); }
