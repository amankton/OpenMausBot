import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontendMemoryPolicy } from './frontend-memory-policy.mjs';

test('standard profile preserves existing guards for supported heap sizes', () => {
  for (const [heap, start] of [[1728, 3584], [2240, 4608], [2752, 5120]]) {
    assert.deepEqual(frontendMemoryPolicy(heap), { profile: 'standard', minimumStartMiB: start, minimumRunningMiB: 2048 });
  }
});
test('constrained profile retains start and running headroom', () => {
  assert.deepEqual(frontendMemoryPolicy(2240, { constrained: true }), {
    profile: 'constrained', minimumStartMiB: 4096, minimumRunningMiB: 1280,
  });
});
test('constrained profile refuses a larger compiler heap', () => {
  assert.throws(() => frontendMemoryPolicy(2241, { constrained: true }), /2048 MiB/);
});
test('all profiles reject unbounded or invalid heap limits', () => {
  for (const constrained of [false, true]) {
    for (const heap of [NaN, Infinity, 0, -1, 2753]) {
      assert.throws(() => frontendMemoryPolicy(heap, { constrained }));
    }
  }
});
