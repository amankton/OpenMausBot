import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { phonePairingLink } from '../../shared/pairing-link';
import { companionPairingAddressText, companionPairingRoute, type CompanionPairingRoute } from '../lib/companion-pairing';
import type { CompanionState, PhoneDevice } from './PhoneSetupFlow';
import { PhoneAppDialog } from './PhoneAppDialog';
import { Card } from './SettingsPrimitives';

async function phoneApi(action: string, method = 'GET', body?: unknown): Promise<CompanionState> {
  const response = await fetch(`/api/crewframe/phone/${action}`, {
    method, cache: 'no-store', headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const state = await response.json();
  if (!response.ok) throw new Error(state.error ?? 'Phone setup failed.');
  return state;
}

export function CrewframePhoneDevices({ devices, busy, onToggle }: { devices: PhoneDevice[]; busy: boolean; onToggle: (device: PhoneDevice) => void }) {
  return <section aria-label="Paired phone remote control" className="flex flex-col gap-3">
    <h3 className="font-medium">Paired phones and remote control</h3>
    <p>Allow computer view to see and control a bot's Local VM or cloud desktop from your paired phone.</p>
    {devices.map(device => <label key={device.id} className="flex items-start gap-3 rounded-xl border border-hairline/40 p-3">
      <input type="checkbox" className="mt-1" checked={device.cloudDesktopAccess === true} disabled={busy}
        aria-label={`Allow computer view for ${device.name}`}
        onChange={() => onToggle(device)} />
      <span><strong className="block">{device.name}</strong><span className="block">Allow computer view and control</span>
        <span className="block text-ink-secondary">Last connected: {new Date(device.lastSeenAt).toLocaleString()}</span></span>
    </label>)}
    {devices.length === 0 && <p>No phones paired yet.</p>}
  </section>;
}

export function CrewframePhoneSetup({ focusRequest = 0 }: { focusRequest?: number }) {
  const [appOpen, setAppOpen] = useState(false);
  const [state, setState] = useState<CompanionState | null>(null);
  const [offer, setOffer] = useState<{ pairing: NonNullable<CompanionState['pairing']>; route: CompanionPairingRoute; mode: 'local' | 'tailscale' } | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState('');
  const baseline = useRef<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusRequest) { root.current?.scrollIntoView?.({ block: 'start' }); root.current?.focus(); }
  }, [focusRequest]);
  useEffect(() => {
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await phoneApi('state');
        if (!disposed) { setState(next); setLoadError(''); }
      } catch (cause) {
        if (!disposed) setLoadError(cause instanceof Error ? cause.message : 'Phone companion is unavailable.');
      }
      if (!disposed) timeout = setTimeout(poll, 2000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timeout); };
  }, []);
  useEffect(() => {
    if (!offer || !state) return;
    const added = state.devices.find(device => !baseline.current.includes(device.id));
    if (added) { setConnected(added.name); setOffer(null); }
  }, [state, offer]);

  async function pair(mode: 'local' | 'tailscale') {
    if (!state || busy) return;
    const route = companionPairingRoute(state, mode);
    if (!route) { setError(mode === 'local' ? 'Connect this computer to Wi-Fi first.' : 'Connect Tailscale on this computer and phone, then check again.'); return; }
    setBusy(true); setError(''); setConnected('');
    try {
      baseline.current = state.devices.map(device => device.id);
      const next = await phoneApi('pairing', 'POST');
      if (!next.pairing) throw new Error('No pairing code was returned.');
      setState(next); setOffer({ pairing: next.pairing, route, mode });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Pairing failed.'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true);
    try { setState(await phoneApi('refresh', 'POST')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check Tailscale.'); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!offer) return;
    setBusy(true);
    try { setState(await phoneApi('pairing', 'DELETE', { expectedToken: offer.pairing.token })); setOffer(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel pairing.'); }
    finally { setBusy(false); }
  }
  async function toggleDesktop(device: PhoneDevice) {
    if (busy) return;
    setBusy(true); setError('');
    try { setState(await phoneApi(`devices/${encodeURIComponent(device.id)}/cloud-desktop`, device.cloudDesktopAccess ? 'DELETE' : 'POST')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save computer access.'); }
    finally { setBusy(false); }
  }
  const expired = offer ? offer.pairing.expiresAt <= Date.now() : false;
  const valid = offer && !expired && state?.pairing?.token === offer.pairing.token;
  const link = valid ? phonePairingLink({ ...offer.route, ...offer.pairing, name: 'Chief Executive Suite', secretPublicKey: state?.secretPublicKey }) : null;
  return <div ref={root} tabIndex={-1}>
    <PhoneAppDialog open={appOpen} onClose={() => setAppOpen(false)} connect={[{
      key: 'crewframe', subtitle: 'to Chief Executive Suite on this computer',
      onSelect: () => { setAppOpen(false); root.current?.scrollIntoView({ block: 'start' }); root.current?.focus(); },
    }]} />
    <Card title="Connect your phone to Chief Executive Suite" subtitle="Get the phone app, choose how to connect, then scan the pairing code inside Chief Executive Suite.">
      <div className="flex flex-col gap-3 text-[13px]">
        <button className="ui-button self-start" onClick={() => setAppOpen(true)}>Get the phone app</button>
        {state && <CrewframePhoneDevices devices={state.devices} busy={busy} onToggle={device => void toggleDesktop(device)} />}
        <p>On the same Wi-Fi: keep this computer running and allow local network access on your phone.</p>
        <button className="ui-button self-start" disabled={busy || !state || Boolean(offer)} onClick={() => void pair('local')}>Pair over Wi-Fi</button>
        <p>From another network: connect this computer and your phone to the same Tailscale account.</p>
        {!state?.tailnetName && <p className="text-ink-secondary">Tailscale is not connected yet. Finish Tailscale sign-in on both devices, then check again.</p>}
        <div className="flex flex-wrap gap-2">
          <button className="ui-button" disabled={busy || !state?.tailnetName || Boolean(offer)} onClick={() => void pair('tailscale')}>Pair with Tailscale</button>
          <button className="ui-button" disabled={busy} onClick={() => void refresh()}>Check connection again</button>
        </div>
        {link && offer && <section aria-label="Chief phone pairing code" className="flex flex-col items-start gap-3">
          <p>In the phone app, choose Connect a computer → Scan QR code.</p>
          <div className="rounded-xl bg-white p-4"><QRCodeSVG value={link} size={220} /></div>
          <p>Or enter <strong>{companionPairingAddressText(offer.route)}</strong> and code <strong>{offer.pairing.code}</strong>.</p>
          <p>The code expires in two minutes. {offer.mode === 'local' ? 'This connection works on the same Wi-Fi.' : 'Keep Tailscale connected on both devices.'}</p>
          {offer.mode === 'local' && state?.publicNetwork && <p role="alert" className="text-danger">Windows marks {state.publicNetwork} as a Public network, which may block your phone. On a trusted home network, select Private in Windows network settings, or use Tailscale.</p>}
        </section>}
        {offer && !valid && <p role="status">The pairing code expired or was replaced. Cancel it and create a new code.</p>}
        {offer && <button className="ui-button self-start" disabled={busy} onClick={() => void cancel()}>Cancel pairing</button>}
        {connected && <p role="status">{connected} connected to Chief Executive Suite.</p>}
        {state && <p>{state.devices.length} phone{state.devices.length === 1 ? '' : 's'} paired to Chief Executive Suite.</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {loadError && <p role="alert" className="text-danger">{loadError}</p>}
      </div>
    </Card>
  </div>;
}
