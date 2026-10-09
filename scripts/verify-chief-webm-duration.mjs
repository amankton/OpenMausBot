// Isolated metadata regression: generated canvas frames only; no app, account or devices.
// Run serially in an available browser slot: node scripts/verify-chief-webm-duration.mjs --run
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

if (process.argv.slice(2).join(' ') !== '--run') throw Error('Pass --run in a coordinated browser slot.');
const root = fileURLToPath(new URL('..', import.meta.url));
const packagePath = '.chief-local/platform-source/plugins/recorder-resources/node_modules/@fix-webm-duration/fix';
const pkg = JSON.parse(await readFile(join(root, packagePath, 'package.json'), 'utf8'));
if (pkg.version !== '1.0.1') throw Error('Expected pinned duration repair version.');
const bundled = await build({
  stdin: { contents: `import {fixWebmDuration} from './${packagePath}/src/index.js'; window.fixWebmDuration=fixWebmDuration;`, resolveDir: root },
  bundle: true, write: false, format: 'iife'
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const results = [];
  for (const paused of [false, true]) results.push(await page.evaluate(async paused => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d');
    let frame = 0;
    const timer = setInterval(() => {
      context.fillStyle = `hsl(${frame++ * 13},80%,50%)`;
      context.fillRect(0, 0, 320, 180);
    }, 40);
    const stream = canvas.captureStream(25);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    recorder.ondataavailable = event => chunks.push(event.data);
    let durationMs;
    try {
      let start = performance.now(); recorder.start(250); await delay(900);
      durationMs = performance.now() - start;
      if (paused) { recorder.pause(); await delay(650); recorder.resume(); }
      start = performance.now(); await delay(900); durationMs += performance.now() - start;
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.stop(); await stopped;
    } finally {
      clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    }
    async function inspect(blob, seek) {
      const video = document.createElement('video');
      video.muted = true; document.body.append(video);
      const url = URL.createObjectURL(blob);
      try {
        const metadata = new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(Error('Decode failed')); });
        video.src = url;
        await Promise.race([metadata, delay(5000).then(() => { throw Error('Metadata timeout'); })]);
        const result = { duration: String(video.duration), finite: Number.isFinite(video.duration) };
        if (seek) {
          await video.play(); await delay(150); video.pause();
          const target = video.duration * 0.55;
          const seeked = new Promise(resolve => { video.onseeked = resolve; });
          video.currentTime = target;
          await Promise.race([seeked, delay(5000).then(() => { throw Error('Seek timeout'); })]);
          result.seekDelta = Math.abs(video.currentTime - target);
          result.readyState = video.readyState;
        }
        return result;
      } finally { video.pause(); video.remove(); URL.revokeObjectURL(url); }
    }
    const raw = new Blob(chunks, { type: 'video/webm' });
    const before = await inspect(raw, false);
    const fixed = await window.fixWebmDuration(raw, durationMs, { logger: false });
    const after = await inspect(fixed, true);
    if (!after.finite || after.seekDelta > 0.1 || after.readyState < 2) throw Error('Repaired recording failed native duration/seek.');
    if (Math.abs(Number(after.duration) * 1000 - durationMs) > 10) throw Error('Duration differs from unpaused recording time.');
    return { paused, durationMs, rawBytes: raw.size, fixedBytes: fixed.size, before, after, tracksEnded: stream.getTracks().every(track => track.readyState === 'ended') };
  }, paused));
  const receipt = { verifiedAt: new Date().toISOString(), browser: browser.version(), generatedCanvasOnly: true, appSessions: false,
    libraryVersion: pkg.version, probeBundleSha256: createHash('sha256').update(bundled.outputFiles[0].contents).digest('hex'), results };
  await writeFile(join(root, 'docs/verification/evidence/chief-webm-duration.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await browser.close(); }
