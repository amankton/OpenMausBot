import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('embedded canvas matches its fixed theme before the application loads', () => {
  for (const mode of ['light', 'dark']) {
    const root = { dataset: {}, style: {} };
    vm.runInNewContext(readFileSync(new URL('./bootstrap.js', import.meta.url), 'utf8'), {
      window: { parent: {}, name: `crewframe-${mode}` }, document: { documentElement: root },
    });
    assert.equal(root.dataset.crewframeSkin, mode);
    assert.equal(root.style.backgroundColor, mode === 'light' ? '#ffffff' : '#18181b');
  }
  const root = { dataset: {}, style: {} };
  vm.runInNewContext(readFileSync(new URL('./bootstrap.js', import.meta.url), 'utf8'), {
    window: { parent: {}, name: 'untrusted-css' }, document: { documentElement: root },
  });
  assert.equal(root.dataset.crewframeSkin, undefined);
});

test('company theme trusts only its Chief parent and fixed modes', () => {
  const handlers = {}, dataset = {}, sent = [];
  const parent = { postMessage: (...args) => sent.push(args) };
  const window = { parent, addEventListener: (name, fn) => { handlers[name] = fn; } };
  vm.runInNewContext(readFileSync(new URL('./crewframe.js', import.meta.url), 'utf8'), { window, document: { documentElement: { dataset, style: { setProperty() {}, removeProperty() {} } } } });
  const send = (mode, origin = 'http://127.0.0.1:5299', source = parent) => handlers.message({ source, origin, data: { type: 'crewframe:theme', mode } });
  send('dark', 'http://127.0.0.1:3200'); send('dark', undefined, {}); send({ css: 'unsafe' });
  assert.equal(dataset.crewframeSkin, undefined);
  send('dark'); assert.equal(dataset.crewframeSkin, 'dark');
  send('light'); assert.equal(dataset.crewframeSkin, 'light');
  send(null); assert.equal(dataset.crewframeSkin, undefined);
  assert.equal(sent.length, 2);
  assert.ok(sent.every(([, origin]) => origin !== '*'));
});

test('Papra label adapter keeps original color and watches later labels', () => {
  const vars = new Map();
  const chip = { matches: () => true, querySelectorAll: () => [], style: {
    color: '#d15387', backgroundColor: '',
    getPropertyValue: key => vars.get(key) || '',
    setProperty: (key, value) => vars.set(key, value),
  } };
  let observeOptions;
  const window = { parent: { postMessage() {} }, addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('./crewframe.js', import.meta.url), 'utf8'), {
    window, document: { body: { querySelectorAll: () => [chip] } },
    MutationObserver: class { observe(_node, options) { observeOptions = options; } },
  });
  assert.equal(vars.get('--papra-tag-color'), '#d15387');
  assert.equal(observeOptions.childList, true);
  assert.equal(observeOptions.attributes, true);
});
