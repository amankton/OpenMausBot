export type Appearance = { profile: 'original' | 'crewframe' | 'custom'; mode: 'light' | 'dark'; followHost: boolean; accent: string };
export const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export function normalizeAppearance(value: unknown, embedded: boolean): Appearance {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Appearance>;
  return { profile: v.profile === 'original' || v.profile === 'crewframe' || v.profile === 'custom' ? v.profile : embedded ? 'crewframe' : 'original', mode: v.mode === 'light' ? 'light' : 'dark', followHost: typeof v.followHost === 'boolean' ? v.followHost : embedded, accent: isColor(v.accent) ? v.accent : '#d9ff7a' };
}
export function accentInk(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(c => { const v = parseInt(c, 16) / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance > .179 ? '#000000' : '#ffffff';
}
export const embeddedAppearance = () => typeof window !== 'undefined' && !!window.parent && window.parent !== window;
export const appearanceKey = (embedded: boolean) => `chief-appearance-${embedded ? 'embedded' : 'standalone'}`;
let hostMode: 'light' | 'dark' | null = null;
export function readAppearance(): Appearance {
  const embedded = embeddedAppearance();
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(appearanceKey(embedded)) || 'null'), embedded); }
  catch { return normalizeAppearance(null, embedded); }
}
export function applyAppearance() {
  const settings = readAppearance();
  const root = document.documentElement;
  root.dataset.chiefAppearance = settings.profile;
  if (settings.profile === 'original') delete root.dataset.crewframeSkin;
  else root.dataset.crewframeSkin = settings.followHost && hostMode ? hostMode : settings.mode;
  if (settings.profile === 'custom') {
    root.style.setProperty('--chief-custom-accent', settings.accent);
    root.style.setProperty('--chief-custom-ink', accentInk(settings.accent));
  } else {
    root.style.removeProperty('--chief-custom-accent');
    root.style.removeProperty('--chief-custom-ink');
  }
  window.dispatchEvent(new Event('chief:appearance'));
}
export function saveAppearance(settings: Appearance) {
  localStorage.setItem(appearanceKey(embeddedAppearance()), JSON.stringify(normalizeAppearance(settings, embeddedAppearance())));
  applyAppearance();
}
export function receiveHostAppearance(mode: unknown) {
  if (mode !== 'light' && mode !== 'dark' && mode !== null) return;
  hostMode = mode;
  applyAppearance();
}
