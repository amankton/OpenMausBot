import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { frontendMinifyOptions } from './frontend-minify-options.mjs';

const require = createRequire(new URL('../../../.chief-local/platform-source/dev/prod/package.json', import.meta.url));
const esbuild = require('esbuild');
const sources = [
  'globalThis.registry.first=()=>new(class Query { value=42; get(){return this.value} })().get()',
  'globalThis.registry.second=()=>{class Other { static label="second"; value=7 }; return new Other().value }',
  'globalThis.registry.third=()=>{class Last { static result=11 }; return Last.result }'
];

test('independently minified asynchronous chunks keep helpers private and earlier factories callable', async () => {
  const context = vm.createContext({ registry: {} });
  for (const source of sources) {
    const output = await esbuild.transform(source, frontendMinifyOptions);
    vm.runInContext(output.code, context);
    assert.deepEqual(Object.keys(context), ['registry'], 'generated helpers must never become shared browser globals');
    assert.equal(context.registry.first(), 42);
  }
  assert.equal(context.registry.second(), 7);
  assert.equal(context.registry.third(), 11);
});

test('regression fixture exposes the original unscoped helper leak', async () => {
  const context = vm.createContext({ registry: {} });
  const { format, ...unscoped } = frontendMinifyOptions;
  vm.runInContext((await esbuild.transform(sources[0], unscoped)).code, context);
  assert.ok(Object.keys(context).some(key => key !== 'registry'));
});
