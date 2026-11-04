// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CrewframePhoneSetup } from './CrewframePhoneSetup';

vi.mock('./PhoneAppDialog', () => ({ PhoneAppDialog: ({ open }: { open: boolean }) => open ? createElement('div', { 'data-testid': 'download-dialog' }) : null }));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('loads a paired phone, grants and revokes its desktop permission, and reports a failed save', async () => {
  let allowed = false;
  let fail = false;
  const requests: string[] = [];
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    if (method !== 'GET') {
      requests.push(`${method} ${path}`);
      if (fail) return Response.json({ error: 'Could not save computer access.' }, { status: 500 });
      allowed = method === 'POST';
    }
    return Response.json({ enabled: true, keepAwake: false, port: 18910, pairing: null,
      devices: [{ id: 'fixture-phone', name: 'Fixture phone', createdAt: 1, lastSeenAt: 2, cloudDesktopAccess: allowed }] });
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const element = document.createElement('div'); document.body.appendChild(element);
  const root = createRoot(element); roots.push(root);
  await act(async () => { root.render(createElement(CrewframePhoneSetup, { focusRequest: 1 })); });
  expect(element.querySelector('[data-testid=download-dialog]')).toBeNull();
  const checkbox = element.querySelector('input[type=checkbox]') as HTMLInputElement;
  expect(checkbox).not.toBeNull();
  expect(checkbox.checked).toBe(false);
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(true);
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(false);
  fail = true;
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(false);
  expect(element.querySelector('[role=alert]')?.textContent).toBe('Could not save computer access.');
  expect(requests).toEqual(['POST', 'DELETE', 'POST'].map(method => `${method} /api/crewframe/phone/devices/fixture-phone/cloud-desktop`));
});
