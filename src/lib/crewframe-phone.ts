export function crewframePhoneSetupEnabled(href = typeof window === 'undefined' ? '' : window.location?.href ?? ''): boolean {
  try {
    const url = new URL(href);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      (url.searchParams.get('crewframe-phone') === '1' || url.port === '5299');
  } catch { return false; }
}
