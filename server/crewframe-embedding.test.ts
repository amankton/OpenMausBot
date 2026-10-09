import { expect, test } from 'vitest';
import { crewframePageHeaders } from './crewframe-embedding.ts';
test('framing is denied unless exact deployment origins are configured', () => {
  expect(crewframePageHeaders('')['x-frame-options']).toBe('DENY');
  expect(crewframePageHeaders('http://localhost:3200,http://127.0.0.1:3200')).toEqual({
    'content-security-policy': 'frame-ancestors http://localhost:3200 http://127.0.0.1:3200',
    'referrer-policy': 'no-referrer',
  });
  for (const invalid of ['*', 'https://*.example.com', 'https://host.test/path', 'https://user:pass@host.test', 'javascript:alert(1)', 'https://host.test#x']) expect(() => crewframePageHeaders(invalid)).toThrow();
});
