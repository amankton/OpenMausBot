import { expect, it } from 'vitest';
import { recoverBlankFrame } from './blank-frame-recovery';
it('retries only an untouched blank document and preserves loaded/cross-origin work', () => {
 let writes = 0; let href = 'about:blank';
 const frame = { get src() { return 'http://localhost:18087/'; }, set src(_value: string) { writes++; }, contentWindow: { location: { get href() { return href; } } } } as HTMLIFrameElement;
 expect(recoverBlankFrame(frame)).toBe(true); expect(writes).toBe(1);
 href = 'http://localhost:18087/workbench';
 expect(recoverBlankFrame(frame)).toBe(false); expect(writes).toBe(1);
 Object.defineProperty(frame.contentWindow, 'location', { get() { throw new Error('cross-origin'); } });
 expect(recoverBlankFrame(frame)).toBe(false); expect(writes).toBe(1);
 expect(recoverBlankFrame(null)).toBe(false);
});
