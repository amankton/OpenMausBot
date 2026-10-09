import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff } from "lucide-react";
import { officeRequest } from "../lib/office-client";

export function OfficeMedia({ configured, meetingId }: { configured: boolean; meetingId: string }) {
  const current = useRef<Room | null>(null);
  const generation = useRef(0);
  const tracks = useRef<HTMLDivElement>(null);
  const [state, setState] = useState("disconnected");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [screen, setScreen] = useState(false);
  const disconnect = () => {
    generation.current++;
    const room = current.current;
    current.current = null;
    if (room) { room.removeAllListeners(); void room.disconnect(true); }
    tracks.current?.replaceChildren();
    setState("disconnected"); setMic(false); setCamera(false); setScreen(false); setBusy(false);
  };
  useEffect(() => {
    const stop = () => disconnect();
    window.addEventListener("pagehide", stop);
    return () => { window.removeEventListener("pagehide", stop); disconnect(); };
  }, [meetingId]);
  const connect = async () => {
    if (current.current) return;
    const attempt = ++generation.current;
    setState("connecting"); setError("");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    current.current = room;
    const sync = () => { if (current.current === room) { setMic(room.localParticipant.isMicrophoneEnabled); setCamera(room.localParticipant.isCameraEnabled); setScreen(room.localParticipant.isScreenShareEnabled); } };
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (current.current !== room) return;
      const element = track.attach();
      element.dataset.officeTrack = track.sid ?? "";
      element.setAttribute("aria-label", `${participant.name || participant.identity} ${track.source === Track.Source.ScreenShare ? "screen share" : track.kind}`);
      if (element instanceof HTMLVideoElement) { element.playsInline = true; element.controls = true; }
      tracks.current?.append(element);
      void element.play().catch(() => setError("Your browser paused meeting audio. Use Enable audio to hear participants."));
    });
    room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()));
    room.on(RoomEvent.LocalTrackPublished, publication => {
      sync();
      if (current.current !== room || publication.track?.kind !== Track.Kind.Video) return;
      const element = publication.track.attach();
      element.muted = true;
      element.setAttribute("aria-label", publication.source === Track.Source.ScreenShare ? "Your screen share" : "Your camera preview");
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      tracks.current?.append(element);
    });
    room.on(RoomEvent.LocalTrackUnpublished, publication => { publication.track?.detach().forEach(element => element.remove()); sync(); });
    room.on(RoomEvent.TrackMuted, sync).on(RoomEvent.TrackUnmuted, sync);
    room.on(RoomEvent.Disconnected, () => { if (current.current === room) disconnect(); });
    room.on(RoomEvent.Reconnecting, () => { if (current.current === room) setState("reconnecting"); });
    room.on(RoomEvent.Reconnected, () => { if (current.current === room) setState("connected"); });
    try {
      const access = await officeRequest<{ url: string; token: string }>("/media", {});
      if (attempt !== generation.current) return;
      await room.connect(access.url, access.token);
      if (attempt !== generation.current) { await room.disconnect(true); return; }
      setState("connected");
    } catch (cause) {
      if (attempt === generation.current) { disconnect(); setError(cause instanceof Error ? cause.message : "Could not connect media"); }
    }
  };
  const toggle = async (kind: "mic" | "camera" | "screen") => {
    const room = current.current;
    if (!room || state !== "connected" || busy) return;
    setBusy(true); setError("");
    try {
      if (kind === "mic") await room.localParticipant.setMicrophoneEnabled(!mic);
      if (kind === "camera") await room.localParticipant.setCameraEnabled(!camera);
      if (kind === "screen") await room.localParticipant.setScreenShareEnabled(!screen, { audio: true });
      if (current.current !== room) {
        room.localParticipant.trackPublications.forEach(publication => publication.track?.stop());
        await room.disconnect(true); return;
      }
      setMic(room.localParticipant.isMicrophoneEnabled); setCamera(room.localParticipant.isCameraEnabled); setScreen(room.localParticipant.isScreenShareEnabled);
    } catch (cause) { if (current.current === room) setError(cause instanceof Error ? cause.message : "Media permission was not granted"); }
    finally { if (current.current === room) setBusy(false); }
  };
  return <section className="office-media" aria-label="Meeting audio and video">
    <div className="office-row"><strong>Audio & video</strong><span className="office-muted">{state}</span></div>
    {!configured ? <p>Calling is not configured yet. Room membership and shared notes are available; no audio is being captured.</p> : <>
      <p>Microphone and camera start off. Nothing is recorded or transcribed.</p>
      <div className="office-actions">
        {state === "disconnected" ? <button className="office-primary" onClick={() => void connect()}>Connect audio & video</button> : <button onClick={disconnect}><PhoneOff size={15} /> Disconnect media</button>}
        <button disabled={state !== "connected" || busy} aria-pressed={mic} onClick={() => void toggle("mic")}>{mic ? <Mic size={16} /> : <MicOff size={16} />}{mic ? "Mute" : "Enable mic"}</button>
        <button disabled={state !== "connected" || busy} aria-pressed={camera} onClick={() => void toggle("camera")}>{camera ? <Video size={16} /> : <VideoOff size={16} />}{camera ? "Stop camera" : "Enable camera"}</button>
        <button disabled={state !== "connected" || busy} aria-pressed={screen} onClick={() => void toggle("screen")}><MonitorUp size={16} />{screen ? "Stop sharing" : "Share screen"}</button>
        {state === "connected" && <button onClick={() => void current.current?.startAudio().catch(() => setError("Audio playback is blocked by your browser."))}>Enable audio</button>}
      </div>
    </>}
    {error && <p role="alert" className="office-error">{error}</p>}
    <div className="office-media-tracks" ref={tracks} />
  </section>;
}
