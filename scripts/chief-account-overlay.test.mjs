import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { accountOverlayArgs } from './chief-account-overlay.mjs';

test('local Accounts override is restricted to the verified epoch image', () => {
  const work=resolve('work');mkdirSync(work,{recursive:true});
  const root=mkdtempSync(join(work,'account-overlay-test-'));
  const image='sha256:'+'a'.repeat(64);
  try {
    assert.deepEqual(accountOverlayArgs(root),[]);
    const local=join(root,'.chief-local/platform'), evidence=join(root,'docs/verification/evidence');
    mkdirSync(local,{recursive:true});mkdirSync(evidence,{recursive:true});
    const path=join(local,'con01-account.compose.json');
    writeFileSync(join(evidence,'chief-lifecycle-epochs-release.json'),JSON.stringify({passed:true,accountImage:image}));
    writeFileSync(path,JSON.stringify({services:{account:{image}}}));
    assert.deepEqual(accountOverlayArgs(root),['--file',path]);
    for(const value of [{services:{account:{image:'sha256:'+'b'.repeat(64)}}},{services:{account:{image,privileged:true}}},{services:{account:{image},nginx:{image}}}]) {
      writeFileSync(path,JSON.stringify(value));assert.throws(()=>accountOverlayArgs(root));
    }
    writeFileSync(path,JSON.stringify({services:{account:{image}}}));
    writeFileSync(join(evidence,'chief-lifecycle-epochs-release.json'),JSON.stringify({passed:false,accountImage:image}));
    assert.throws(()=>accountOverlayArgs(root));
    unlinkSync(path);
    const deployment=join(root,'.chief-local/m1-pairing/deployment');mkdirSync(deployment,{recursive:true});
    writeFileSync(join(deployment,'local-prepared.json'),'{}');
    assert.throws(()=>accountOverlayArgs(root),/missing its epoch-aware/);
  } finally {
    assert.ok(resolve(root).startsWith(work+sep));rmSync(root,{recursive:true});
  }
});
