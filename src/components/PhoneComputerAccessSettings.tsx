import type { PhoneDevice } from "./PhoneSetupFlow";

export function PhoneComputerAccessSettings({ devices, busy, onToggle }: { devices: PhoneDevice[]; busy: boolean; onToggle: (device: PhoneDevice) => void }) {
  return <section aria-label="Paired phone remote control" className="flex flex-col gap-3 text-[13px]">
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
