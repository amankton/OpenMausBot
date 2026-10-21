import { afterEach, describe, expect, it, vi } from 'vitest';
import { accentInk, appearanceKey, normalizeAppearance, readAppearance, saveAppearance, receiveHostAppearance } from './appearance';
afterEach(() => vi.unstubAllGlobals());
describe('Chief appearance profiles', () => {
  it('defaults embedded Chief to Crewframe and standalone Chief to Original', () => {
    expect(normalizeAppearance(null, true).profile).toBe('crewframe');
    expect(normalizeAppearance(null, false).profile).toBe('original');
    expect(appearanceKey(true)).not.toBe(appearanceKey(false));
  });
  it('rejects malformed stored profiles and CSS values', () => {
    expect(normalizeAppearance({ profile: 'unknown', accent: 'url(https://invalid)' }, true)).toMatchObject({ profile: 'crewframe', accent: '#d9ff7a' });
    expect(accentInk('#ffffff')).toBe('#000000');
    expect(accentInk('#000000')).toBe('#ffffff');
  });
  it('isolates preferences and restores native appearance without rewriting branding', () => {
    const values = new Map<string, string>();
    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    const dataset: Record<string, string> = {};
    const win = { parent: {}, dispatchEvent: vi.fn() };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { documentElement: { dataset, style } });
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
    saveAppearance({ profile: 'crewframe', mode: 'light', followHost: true, accent: '#123456' });
    receiveHostAppearance('dark');
    expect(dataset.crewframeSkin).toBe('dark');
    expect(readAppearance().mode).toBe('light');
    expect(values.has(appearanceKey(false))).toBe(false);
    saveAppearance({ ...readAppearance(), profile: 'original' });
    expect(dataset.crewframeSkin).toBeUndefined();
    expect(style.setProperty).not.toHaveBeenCalled();
  });
});
