import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Keep ordinary starts and frontend-only updates on the deployed epoch authority.
export function accountOverlayArgs(root) {
  const path = join(root, '.chief-local/platform/con01-account.compose.json');
  if (!existsSync(path)) {
    if (existsSync(join(root, '.chief-local/m1-pairing/deployment/local-prepared.json'))) {
      throw Error('Prepared CON-01 installation is missing its epoch-aware Accounts override.');
    }
    return [];
  }
  const value = JSON.parse(readFileSync(path, 'utf8'));
  const receipt = JSON.parse(readFileSync(join(root, 'docs/verification/evidence/chief-lifecycle-epochs-release.json'), 'utf8'));
  if (!receipt.passed || !/^sha256:[a-f0-9]{64}$/.test(receipt.accountImage) ||
      JSON.stringify(value) !== JSON.stringify({ services: { account: { image: receipt.accountImage } } })) {
    throw Error('The local Accounts override must match the verified epoch image only.');
  }
  return ['--file', path];
}
