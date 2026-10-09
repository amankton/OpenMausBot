import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBackupProvenance } from '../../scripts/chief-platform-backup-provenance.mjs';
const expected = { slug: 'synthetic', uuid: 'fixture-uuid', sourceRevision: 'pinned-source' };
const id = 'sha256:' + 'a'.repeat(64);
const backup = { ...expected, status: 'passed', images: { tool: id } };
const image = { Id: id, Config: { Labels: { 'org.opencontainers.image.revision': expected.sourceRevision } } };
test('retains original backup tool identity independently of candidate rebuild', () => {
  const before = JSON.stringify(backup);
  verifyBackupProvenance(backup, expected, requested => { assert.equal(requested, id); return image; });
  assert.equal(JSON.stringify(backup), before);
});
test('rejects wrong backup workspace, source, status and malformed original image', () => {
  for (const change of [{slug:'other'},{uuid:'other'},{sourceRevision:'other'},{status:'failed'},{images:{}},{images:{tool:'latest'}}]) {
    assert.throws(() => verifyBackupProvenance({...backup,...change}, expected, () => { throw Error('must not inspect'); }), /Exact workspace backup/);
  }
});
test('rejects missing original tool image, wrong image ID, or unverified image source', () => {
  for (const value of [undefined,{...image,Id:'sha256:'+'b'.repeat(64)},{...image,Config:{Labels:{}}},{...image,Config:{Labels:{'org.opencontainers.image.revision':'other'}}}]) {
    assert.throws(() => verifyBackupProvenance(backup, expected, () => value), /Original pinned backup tool/);
  }
  assert.throws(() => verifyBackupProvenance(backup, expected, () => { throw Error('missing image'); }), /missing image/);
});
