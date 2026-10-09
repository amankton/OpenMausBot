/** Explicit deployment origins only; default upstream framing protection remains. */
export function crewframePageHeaders(value = process.env.OMB_FRAME_ORIGINS) {
  if (!value?.trim()) return { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };
  const origins = value.split(',').map(origin => origin.trim());
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password || origin.includes('*')) {
      throw new Error('OMB_FRAME_ORIGINS must contain exact HTTP(S) origins');
    }
  }
  return { "content-security-policy": `frame-ancestors ${origins.join(' ')}`, "referrer-policy": "no-referrer" };
}
