import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../../../.chief-local/platform-source/packages/presentation/src/utils.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('utils.ts', source, ts.ScriptTarget.Latest, true);
const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'setPresentationCookie');
assert.ok(fn);
const code = ts.transpileModule(fn.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function cookieFor({ embedded = false, secure = true, storage = { getCookiePath: id => `/files/${id}` } } = {}) {
  const self = {}, document = {}, exports = {};
  runInNewContext(code, { exports, document, window: { self, top: embedded ? {} : self, isSecureContext: secure },
    plugin: { metadata: { Token: 'presentation:metadata:Token', FileStorage: 'storage' } }, getMetadata: () => storage });
  exports.setPresentationCookie('synthetic/session', 'synthetic-workspace');
  return document.cookie;
}
test('secure embedded media gets a workspace-scoped, host-only partitioned session cookie', () => {
  assert.equal(cookieFor({ embedded: true }), 'presentation-metadata-Token=synthetic%2Fsession; path=/files/synthetic-workspace; SameSite=None; Secure; Partitioned');
});
test('standalone and insecure contexts retain their existing cookie policy', () => {
  const expected = 'presentation-metadata-Token=synthetic%2Fsession; path=/files/synthetic-workspace';
  assert.equal(cookieFor(), expected);
  assert.equal(cookieFor({ embedded: true, secure: false }), expected);
});
test('storage-defined paths and path fallback retain workspace scoping', () => {
  assert.match(cookieFor({ embedded: true, storage: { getCookiePath: () => 'custom/workspace' } }), /path=\/custom\/workspace; SameSite=None; Secure; Partitioned$/);
  assert.match(cookieFor({ embedded: true, storage: { getCookiePath: () => { throw Error('unavailable'); } } }), /path=\/files\/synthetic-workspace;/);
  assert.equal(cookieFor({ storage: null }), 'presentation-metadata-Token=synthetic%2Fsession; path=/files/synthetic-workspace');
});
