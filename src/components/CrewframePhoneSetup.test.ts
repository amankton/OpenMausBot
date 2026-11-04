import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CrewframePhoneDevices, CrewframePhoneSetup } from './CrewframePhoneSetup';
import { crewframePhoneSetupEnabled } from '../lib/crewframe-phone';

it('starts with app download choices and offers a connection to Crewframe', () => {
  const html = renderToStaticMarkup(createElement(CrewframePhoneSetup));
  expect(html).toContain('Get the phone app');
  expect(html).toContain('Connect your phone to Chief Executive Suite');
  expect(html).not.toContain('Open in the App Store');
  expect(html).toContain('Pair over Wi-Fi');
  expect(html).toContain('Tailscale is not connected yet');
  expect(html).not.toContain('Crewframe phone pairing code');
});
it('limits the phone UI to explicitly selected local Crewframe pages', () => {
  expect(crewframePhoneSetupEnabled('http://127.0.0.1:8801/?crewframe-phone=1')).toBe(true);
  expect(crewframePhoneSetupEnabled('http://127.0.0.1:8801/')).toBe(false);
  expect(crewframePhoneSetupEnabled('http://127.0.0.1:5299/')).toBe(true);
  expect(crewframePhoneSetupEnabled('https://foreign.example:5299/')).toBe(false);
  expect(crewframePhoneSetupEnabled('https://foreign.example/?crewframe-phone=1')).toBe(false);
});
it('shows saved per-phone computer access and distinguishes duplicate names by connection time', () => {
  const html = renderToStaticMarkup(createElement(CrewframePhoneDevices, { busy: false, onToggle: () => {}, devices: [
    { id: 'old', name: 'iPhone', createdAt: 1, lastSeenAt: 1000, cloudDesktopAccess: false },
    { id: 'new', name: 'iPhone', createdAt: 2, lastSeenAt: 2000, cloudDesktopAccess: true },
  ] }));
  expect(html).toContain('Paired phones and remote control');
  expect(html).toContain('Local VM');
  expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  expect(html.match(/checked=""/g)).toHaveLength(1);
  expect(html.match(/Last connected:/g)).toHaveLength(2);
});
