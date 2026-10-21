import { useEffect, useState } from 'react';
import { embeddedAppearance, readAppearance, saveAppearance, type Appearance } from '@/lib/appearance';
import { SkinPicker } from './SkinPicker';

export function AppearancePicker() {
  const [settings, setSettings] = useState(readAppearance);
  useEffect(() => {
    const sync = () => setSettings(readAppearance());
    window.addEventListener('chief:appearance', sync);
    return () => window.removeEventListener('chief:appearance', sync);
  }, []);
  const update = (patch: Partial<Appearance>) => { const next = { ...settings, ...patch }; saveAppearance(next); setSettings(next); };
  const control = 'rounded-lg border border-hairline bg-control px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-focus';
  return <div className="space-y-4">
    <label className="flex flex-wrap items-center justify-between gap-3 text-sm">Appearance profile
      <select className={control} value={settings.profile} onChange={e => update({ profile: e.target.value as Appearance['profile'] })}>
        <option value="original">Chief Original</option><option value="crewframe">Chief (Crewframe)</option><option value="custom">Custom</option>
      </select>
    </label>
    <p className="text-sm text-ink-secondary">{embeddedAppearance() ? 'These preferences apply to Chief inside Crewframe. Your standalone appearance stays separate.' : 'These preferences apply to standalone Chief.'}</p>
    {settings.profile === 'original' ? <SkinPicker /> : <>
      {embeddedAppearance() && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.followHost} onChange={e => update({ followHost: e.target.checked })} />Follow Crewframe light and dark mode</label>}
      <label className="flex items-center justify-between gap-3 text-sm">Color mode<select className={control} disabled={embeddedAppearance() && settings.followHost} value={settings.mode} onChange={e => update({ mode: e.target.value as Appearance['mode'] })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      {settings.profile === 'custom' && <label className="flex items-center justify-between gap-3 text-sm">Accent and primary buttons<input aria-label="Accent and primary buttons" type="color" value={settings.accent} onChange={e => update({ accent: e.target.value })} /></label>}
      {settings.profile === 'custom' && <p className="text-xs text-ink-secondary">Button text contrast is adjusted automatically. Text and focus indicators remain readable.</p>}
      <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm">Primary button preview</button>
    </>}
  </div>;
}
