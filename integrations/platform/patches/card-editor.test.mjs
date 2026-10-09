// Exercise the actual Card action wrapper without a browser or Platform service.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const path = fileURLToPath(new URL('../../../.chief-local/platform-source/plugins/card-resources/src/components/ContentEditor.svelte', import.meta.url));
const source = readFileSync(path, 'utf8');
const instance = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1];
assert.ok(instance);
const ast = ts.createSourceFile(path, instance, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const guard = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'guardedAction');
const actions = ast.statements.find(node => ts.isLabeledStatement(node) && node.label.text === '$' && node.statement.getText(ast).startsWith('refActions ='));
assert.ok(guard); assert.ok(actions);
const javascript = ts.transpileModule(guard.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const refresh = actions.statement.getText(ast);

function fixture() {
  const calls = [];
  const scope = { readonly: false, disposed: false, bodyEditor: { isEditable: true }, object: { _id: 'card-one' }, defaultRefActions: [], modelRefActions: [], refActions: [], actionCache: new WeakMap() };
  const create = runInNewContext(javascript + '\nguardedAction', scope);
  let received;
  const action = { label: 'Templates', icon: 'template-icon', order: 5000, action: (_element, handler) => { received = handler; } };
  const methods = ['insertText', 'insertEmoji', 'insertMarkup', 'insertTemplate', 'insertTable', 'insertCodeBlock', 'insertSeparatorLine', 'insertContent', 'focus'];
  const handler = Object.fromEntries(methods.map(name => [name, (...args) => calls.push({ name, args })]));
  const open = () => create(action, scope.bodyEditor).action({}, handler, undefined);
  return { scope, create, action, open, handler, calls, methods, received: () => received, refresh: () => runInNewContext(javascript + '\n' + refresh, scope) };
}

test('editor actions use the body handler and preserve all existing command arguments', () => {
  const f = fixture(); f.open();
  for (const name of f.methods) f.received()[name]('synthetic', { retained: true });
  assert.deepEqual(f.calls, f.methods.map(name => ({ name, args: ['synthetic', { retained: true }] })));
  assert.equal(f.create(f.action, f.scope.bodyEditor).disabled, false);
});
test('readonly, noneditable, missing-editor and disabled actions cannot open a popup', () => {
  for (const change of [f => { f.scope.readonly = true; }, f => { f.scope.bodyEditor.isEditable = false; }, f => { f.scope.bodyEditor = undefined; }, f => { f.action.disabled = true; }]) {
    const f = fixture(); change(f); f.open(); assert.equal(f.received(), undefined); assert.equal(f.calls.length, 0);
  }
});
test('delayed popup callbacks cannot insert or focus after readonly, target change or destruction', () => {
  for (const change of [f => { f.scope.readonly = true; }, f => { f.scope.bodyEditor.isEditable = false; }, f => { f.scope.object = { _id: 'card-two' }; }, f => { f.scope.bodyEditor = { isEditable: true }; }, f => { f.scope.disposed = true; }]) {
    const f = fixture(); f.open(); change(f);
    for (const name of f.methods) f.received()[name]('must-not-insert');
    assert.equal(f.calls.length, 0);
  }
});
test('reactive provider composition keeps standard actions ordered and hides them for readonly', () => {
  const f = fixture();
  f.scope.defaultRefActions = [{ ...f.action, label: 'Emoji', order: 4001 }, { ...f.action, label: 'Mention', order: 3000 }];
  f.scope.modelRefActions = [f.action]; f.refresh();
  assert.deepEqual(Array.from(f.scope.refActions, action => action.label), ['Mention', 'Emoji', 'Templates']);
  assert.equal(f.scope.defaultRefActions[0].label, 'Emoji');
  f.scope.readonly = true; f.refresh(); assert.equal(f.scope.refActions.length, 0);
});
test('editor transactions preserve keyed button and popup-anchor action identities while updating disabled state', () => {
  const f = fixture(); f.scope.defaultRefActions = [f.action]; f.refresh();
  const original = f.scope.refActions[0];
  for (let i = 0; i < 5; i++) { f.refresh(); assert.equal(f.scope.refActions[0], original); }
  f.scope.bodyEditor.isEditable = false; f.refresh();
  assert.equal(f.scope.refActions[0], original); assert.equal(original.disabled, true);
  f.scope.bodyEditor.isEditable = true; f.refresh();
  assert.equal(f.scope.refActions[0], original); assert.equal(original.disabled, false);
  f.scope.readonly = true; f.refresh(); assert.equal(f.scope.refActions.length, 0);
  f.scope.readonly = false; f.refresh(); assert.equal(f.scope.refActions[0], original);
});
test('the actual collaborator receives refActions and retains file, readonly and editor-kit bindings', () => {
  const editor = source.match(/<CollaboratorEditor([\s\S]*?)\/>/)?.[1];
  assert.ok(editor);
  for (const binding of ['{refActions}', '{readonly}', '{attachFile}', '{boundary}', '{requestSideSpace}', 'kitOptions=', 'on:editor=']) assert.ok(editor.includes(binding), binding);
  assert.ok(instance.includes('getModelRefActions()'));
  assert.ok(!/getUserMedia|getDisplayMedia|MediaRecorder/.test(instance));
});
