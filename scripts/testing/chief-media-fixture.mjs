import { Room, RoomEvent, Track } from "livekit-client";
const room = new Room({ adaptiveStream: false, dynacast: false });
const received = [];
const local = [];
let timer, audio;
room.on(RoomEvent.TrackSubscribed, track => {
  received.push(track);
  if (track.kind === Track.Kind.Video) { const el = track.attach(); el.muted = true; document.querySelector('#tracks').append(el); void el.play(); }
});
window.chiefMediaFixture = {
  async connect({ url, token }) { await room.connect(url, token); return room.state; },
  async publish() {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'); let count = 0;
    timer = setInterval(() => { ctx.fillStyle = '#2F58FF'; ctx.fillRect(0, 0, 320, 180); ctx.fillStyle = 'white'; ctx.font = '24px sans-serif'; ctx.fillText(`Chief test frame ${count++}`, 16, 80); }, 50);
    const video = canvas.captureStream(20).getVideoTracks()[0]; local.push(video);
    await room.localParticipant.publishTrack(video, { source: Track.Source.Camera });
    audio = new AudioContext(); await audio.resume();
    const oscillator = audio.createOscillator(); const destination = audio.createMediaStreamDestination();
    oscillator.connect(destination); oscillator.start();
    const sound = destination.stream.getAudioTracks()[0]; local.push(sound);
    await room.localParticipant.publishTrack(sound, { source: Track.Source.Microphone });
    // A separate synthetic stream proves screen-share transport without capturing the owner's desktop.
    const screen = canvas.captureStream(5).getVideoTracks()[0]; local.push(screen);
    await room.localParticipant.publishTrack(screen, { source: Track.Source.ScreenShare });
  },
  async stats() {
    const tracks = [];
    for (const track of received) {
      const report = await track.getRTCStatsReport();
      const inbound = [...(report?.values() ?? [])].filter(v => v.type === 'inbound-rtp');
      tracks.push({ kind: track.kind, source: track.source, bytes: inbound.reduce((sum, s) => sum + (s.bytesReceived ?? 0), 0), frames: inbound.reduce((sum, s) => sum + (s.framesDecoded ?? 0), 0) });
    }
    return { state: room.state, tracks };
  },
  async close() { clearInterval(timer); local.forEach(t => t.stop()); await audio?.close(); await room.disconnect(); return local.every(t => t.readyState === 'ended'); },
};
