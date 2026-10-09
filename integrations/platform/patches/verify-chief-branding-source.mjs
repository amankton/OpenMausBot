// Bounded component syntax/compile check; not a full production build.
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
const files = ['packages/ui/src/components/internal/Root.svelte', 'packages/ui/src/components/internal/ChiefBrand.svelte', 'plugins/login-resources/src/components/LoginAppBase.svelte', 'plugins/login-resources/src/components/LoginApp.svelte'];
for (const file of files) {
  const filename = join(source, file);
  const input = await preprocess(await readFile(filename, 'utf8'), preprocessor({ scss: { silenceDeprecations: ['legacy-js-api'] } }), { filename });
  const result = compile(input.code, { filename });
  const errors = result.warnings.filter(warning => warning.code.startsWith('a11y-') && file.endsWith('ChiefBrand.svelte'));
  if (errors.length) throw Error(JSON.stringify(errors));
}
const result = ts.transpileModule(await readFile(join(source, 'dev/prod/src/platform.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw Error('Platform entry syntax failed');
console.log(JSON.stringify({ passed: true, compiledComponents: files, entrySyntax: 'dev/prod/src/platform.ts', scope: 'Component compilation and syntax only; full retained package type checking and production build not performed.' }));
