import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(root, '.chief-local/platform-source');
const require = createRequire(join(source, 'packages/ui/package.json'));
const { compile, preprocess } = require('svelte/compiler');
const preprocessor = require('svelte-preprocess');
const ts = require('typescript');
const components = ['plugins/setting-resources/src/components/integrations/ChiefPairing.svelte', 'plugins/setting-resources/src/components/integrations/Integrations.svelte', 'plugins/setting-resources/src/components/Settings.svelte'];
for (const file of components) {
  const filename = join(source, file);
  const input = await preprocess(await readFile(filename, 'utf8'), preprocessor({ scss: { silenceDeprecations: ['legacy-js-api'] } }), { filename });
  const result = compile(input.code, { filename });
  const errors = result.warnings.filter(item => item.code.startsWith('a11y-') && file.endsWith('/ChiefPairing.svelte'));
  assert.deepEqual(errors, []);
}
for (const file of ['packages/presentation/src/chief-session.ts', 'plugins/workbench-resources/src/connect.ts', 'plugins/workbench-resources/src/utils.ts']) {
  const input = await readFile(join(source, file), 'utf8');
  const result = ts.transpileModule(input, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error), false);
  if (file.endsWith('/connect.ts')) assert.ok(input.indexOf('await reconcileChiefSession(token)') < input.indexOf('setMetadata(presentation.metadata.Token, workspaceLoginInfo.token)'));
  if (file.endsWith('/utils.ts')) assert.ok(input.indexOf('await revokeChiefSession()') < input.indexOf('await getAccountClient(accountsUrl).deleteCookie()'));
}
console.log(JSON.stringify({ passed: true, components, scope: 'Native component compilation/accessibility and auth-hook syntax/order; not full package validation or production build' }));
