import { applyAppearance, appearanceKey, embeddedAppearance, receiveHostAppearance } from './appearance';
applyAppearance();
window.addEventListener('storage', event => {
  if (event.key === appearanceKey(embeddedAppearance())) applyAppearance();
});
const crewframeOrigins = ['http://127.0.0.1:3200', 'http://localhost:3200'];
if (window.parent !== window) {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || !crewframeOrigins.includes(event.origin) || event.data?.type !== 'crewframe:theme') return;
    receiveHostAppearance(event.data.mode);
  });
  for (const origin of crewframeOrigins) window.parent.postMessage({ type: 'crewframe:theme-ready' }, origin);
}
