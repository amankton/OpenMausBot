// Retry only a document that never navigated. Cross-origin and loaded documents
// are left untouched so a retry cannot discard edits in a running workspace.
export function recoverBlankFrame(frame: HTMLIFrameElement | null): boolean {
  if (!frame || !frame.src || frame.src === 'about:blank') return false;
  try {
    if (frame.contentWindow?.location.href !== 'about:blank') return false;
    frame.src = frame.src;
    return true;
  } catch { return false; }
}
