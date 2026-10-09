import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CrewframePhoneSetup } from './CrewframePhoneSetup';
import { crewframePhoneSetupEnabled } from '../lib/crewframe-phone';

it('starts with app download choices and offers a connection to Crewframe', () => {
  const html = renderToStaticMarkup(createElement(CrewframePhoneSetup));
  expect(html).toContain('Get the phone app');
  expect(html).toContain('Open in the App Store');
  expect(html).toContain('Download the APK');
  expect(html).toContain('to Crewframe on this computer');
  expect(html).toContain('Pair over Wi-Fi');
  expect(html).toContain('Tailscale is not connected yet');
  expect(html).not.toContain('Crewframe phone pairing code');
});
it('limits the phone UI to explicitly selected local Crewframe pages', () => {
  expect(crewframePhoneSetupEnabled('http://127.0.0.1:8801/?crewframe-phone=1')).toBe(true);
  expect(crewframePhoneSetupEnabled('http://127.0.0.1:8801/')).toBe(false);
  expect(crewframePhoneSetupEnabled('https://foreign.example/?crewframe-phone=1')).toBe(false);
});
