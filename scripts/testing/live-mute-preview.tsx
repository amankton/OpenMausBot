import { createRoot } from "react-dom/client";
import { useState } from "react";
import { StoreProvider, useStore, type Bot } from "../../src/state/store";
import { LiveCallBar } from "../../src/components/LiveCallBar";
import { configureLiveMedia, onServerCall, startLiveCall, useLiveMedia } from "../../src/lib/live-call-media";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

const bot = { id: "mute-fixture", threadId: "mute-thread", name: "Solo test", messages: [] } as unknown as Bot;
let track: MediaStreamTrack | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let renew = () => {};
async function startSynthetic() {
  const audio = new AudioContext();
  await audio.resume();
  const destination = audio.createMediaStreamDestination();
  const tone = audio.createOscillator();
  tone.connect(destination); tone.start();
  track = destination.stream.getAudioTracks()[0];
  // Synthetic track only: no microphone request, network session, or speakers.
  configureLiveMedia({
    getUserMedia: async () => destination.stream,
    createPeer: () => ({ localDescription: { sdp: "fixture" }, iceGatheringState: "complete", connectionState: "connected",
      addTrack() {}, createDataChannel: () => ({ readyState: "open", close() {} }), createOffer: async () => ({ type: "offer", sdp: "fixture" }),
      setLocalDescription: async () => {}, setRemoteDescription: async () => {}, close: () => { tone.stop(); void audio.close(); },
    }) as unknown as RTCPeerConnection,
    request: (async (path: string) => { if (path.endsWith("/keep")) renew(); return { call: { callId: "synthetic", botId: bot.id, threadId: bot.threadId, client: "web", status: "live", startedAt: Date.now() }, transport: { sdp: "fixture" } }; }) as never,
  });
  await startLiveCall({ botId: bot.id, threadId: bot.threadId });
}

function Fixture() {
  const { dispatch } = useStore();
  const media = useLiveMedia();
  const [width, setWidth] = useState(320);
  const call = { callId: "synthetic", botId: bot.id, threadId: bot.threadId, client: "web" as const, voice: "fixture", status: "live" as const, startedAt: Date.now() };
  renew = () => { clearTimeout(idleTimer); dispatch({ type: "liveCall", call: { ...call, idleWarning: false, idleDeadlineAt: Date.now() + 30_000 } }); };
  return <main className="min-h-dvh bg-app p-4 text-ink">
    <h1 className="text-balance text-lg">Isolated microphone controls — no real microphone</h1>
    <button className="m-2 rounded border p-2" onClick={() => void startSynthetic()}>Start synthetic call</button>
    <button className="m-2 rounded border p-2" onClick={() => setWidth(width === 320 ? 768 : 320)}>Toggle width</button>
    <button className="m-2 rounded border p-2" onClick={() => {
      dispatch({ type: "liveCall", call: { ...call, idleWarning: true, idleDeadlineAt: Date.now() + 5_000 } });
      idleTimer = setTimeout(() => { const ended = { ...call, status: "ended" as const, endReason: "idle" as const }; onServerCall(ended); dispatch({ type: "liveCall", call: ended }); }, 5_000);
    }}>Preview final five seconds</button>
    <p role="status">Synthetic track enabled: {String(track?.enabled)}. UI muted: {String(media.muted)}. Width: {width}px.</p>
    <div style={{ width, maxWidth: "100%" }} className="mt-4 border border-hairline"><LiveCallBar bot={bot} /></div>
  </main>;
}
applySkin("midnight");
createRoot(document.getElementById("root")!).render(<StoreProvider><Fixture /></StoreProvider>);
