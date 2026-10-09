import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Copy, DoorOpen, Download, Headphones, Plus, Users, Video } from "lucide-react";
import { activeMeeting, meetingBrief, type OfficeCommand, type OfficePerson, type OfficeSnapshot, type OfficeNote } from "../../shared/office";
import { claimOffice, hasOfficeSession, officePhoto, officeRequest, OfficeRequestError, updateOffice } from "../lib/office-client";
import { OfficeMedia } from "./OfficeMedia";
import "./OfficePage.css";

interface Props { onBack?: () => void; agents?: Array<{ id: string; name: string }>; onPrivateAgent?: (id: string) => void }
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
function Face({ person, small = false }: { person: OfficePerson; small?: boolean }) {
  return <span className={`office-face${small ? " office-face-small" : ""}`}>
    {person.photo ? <img src={person.photo} alt={person.name} /> : <span aria-hidden="true">{person.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>}
  </span>;
}
export function OfficePage({ onBack, agents = [], onPrivateAgent }: Props) {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(location.hash.slice(1)).get("invite"));
  const [signedOut, setSignedOut] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [addPerson, setAddPerson] = useState(false);
  const [personName, setPersonName] = useState("");
  const [personTitle, setPersonTitle] = useState("");
  const [addRoom, setAddRoom] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomKind, setRoomKind] = useState<"audio" | "video">("video");
  const [profileName, setProfileName] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [links, setLinks] = useState<Array<{ personId: string; code: string }>>([]);
  const [noteText, setNoteText] = useState("");
  const [noteKind, setNoteKind] = useState<OfficeNote["kind"]>("summary");
  const [assignee, setAssignee] = useState("");
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [historyId, setHistoryId] = useState("");
  const acceptSnapshot = useCallback((next: OfficeSnapshot) => {
    if (mounted.current) setSnapshot(previous => !previous || next.viewerId !== previous.viewerId || next.office.revision >= previous.office.revision ? next : previous);
  }, []);
  const refresh = useCallback(async () => {
    if (saving.current) return;
    try { const next = await officeRequest<OfficeSnapshot>(); acceptSnapshot(next); }
    catch (cause) {
      if (mounted.current) {
        setError(message(cause));
        // Expired credentials remain in storage so a local member cannot
        // silently become the loopback owner. Remove stale participant data.
        if (cause instanceof OfficeRequestError && (cause.status === 401 || cause.status === 403)) setSnapshot(null);
      }
    }
  }, [acceptSnapshot]);
  useEffect(() => {
    mounted.current = true;
    if (inviteCode || signedOut) return () => { mounted.current = false; };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 3000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refresh, inviteCode, signedOut]);
  async function act(command: OfficeCommand): Promise<boolean> {
    if (!snapshot || saving.current) return false;
    saving.current = true; setBusy(true); setError(""); setStatus("");
    try {
      let next: OfficeSnapshot & { links: Array<{ personId: string; code: string }> };
      try {
        next = await updateOffice(snapshot.office.revision, command);
      } catch (cause) {
        // A note arriving from another participant must not trap someone in a
        // room. Retry only leaving this exact meeting, never a newer session.
        if (command.type !== "meeting.leave" || !(cause instanceof OfficeRequestError) || cause.status !== 409) throw cause;
        const originalMeeting = activeMeeting(snapshot.office, snapshot.viewerId);
        const fresh = await officeRequest<OfficeSnapshot>();
        acceptSnapshot(fresh);
        const currentMeeting = activeMeeting(fresh.office, fresh.viewerId);
        if (!currentMeeting) return true;
        if (fresh.viewerId !== snapshot.viewerId || !originalMeeting || currentMeeting.id !== originalMeeting.id) throw cause;
        next = await updateOffice(fresh.office.revision, command);
      }
      acceptSnapshot(next);
      if (next.links.length) setLinks(previous => [...previous, ...next.links]);
      if (command.type === "invite.create") { setSelected([]); setStatus(next.links.length ? "Invitation links are ready. Share each link privately with the named person." : "These people already have invitations for this room."); }
      return true;
    } catch (cause) { setError(message(cause)); return false; }
    finally { saving.current = false; setBusy(false); void refresh(); }
  }
  const brand = <img className="office-brand" src="/brand/chief-lockup-full-color-on-light.svg" alt="C.H.I.E.F. Executive Suite" />;
  if (inviteCode) return <main className="chief-office office-gate"><section className="office-gate-card">{brand}<span className="office-eyebrow">Your personal space is waiting</span><h1>Step into the office.</h1><p>Accept this one-use link to access your office identity. You will choose whether to accept the meeting invitation and connect your microphone or camera afterward.</p><button className="office-primary" disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { await claimOffice(inviteCode); setSnapshot(null); setInviteCode(null); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }}>{busy ? "Accepting…" : "Accept office access"}<ArrowUpRight size={16} /></button>{error && <p role="alert" className="office-error">{error}</p>}</section></main>;
  if (signedOut) return <main className="chief-office office-gate"><section className="office-gate-card">{brand}<h1>Office session ended.</h1><p>Your meeting media is disconnected. Ask the office owner for a new invitation link to return.</p></section></main>;
  if (!snapshot) return <main className="chief-office office-gate"><section className="office-gate-card">{brand}<h1>{error ? "Office access needed" : "Opening your office…"}</h1><p>{error || "Connecting to your shared office."}</p>{error && <button onClick={() => { setError(""); void refresh(); }}>Retry office connection</button>}{onBack && <button onClick={onBack}>Back to team map</button>}</section></main>;
  const { office, viewerId, onlineIds, occupants } = snapshot;
  const owner = viewerId === office.ownerId;
  const me = office.people.find(person => person.id === viewerId)!;
  const meeting = activeMeeting(office, viewerId);
  const viewedMeeting = meeting ?? office.meetings.find(item => item.id === historyId);
  const myInvites = office.invitations.filter(invitation => invitation.personId === viewerId && invitation.status === "pending" && invitation.expiresAt > Date.now());
  const visiblePeople = office.people.filter(person => `${person.name} ${person.title}`.toLowerCase().includes(search.toLowerCase()));
  const toggleSelected = (id: string) => setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  const invitationUrl = (code: string) => `${location.origin}/office#invite=${encodeURIComponent(code)}`;
  const download = () => {
    if (!viewedMeeting) return;
    const url = URL.createObjectURL(new Blob([meetingBrief(office, viewedMeeting, selectedNotes)], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "chief-meeting-notes.md"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className="chief-office">
    <header className="office-header"><div className="office-row">{onBack && <button className="office-icon" aria-label="Back to team map" onClick={onBack}><ArrowLeft size={18} /></button>}{brand}<span className="office-header-divider" /><span className="office-eyebrow">Shared office</span></div><div className="office-row"><span className="office-connected"><span />{onlineIds.length} online</span>{hasOfficeSession() && <button disabled={busy} onClick={async () => { setBusy(true); try { await officeRequest("/logout", {}); setSnapshot(null); setSignedOut(true); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }}>End session</button>}<button className="office-profile-button" onClick={() => { setProfileName(me.name); setProfileOpen(!profileOpen); }}><Face person={me} small /><span>{me.name}</span></button></div></header>
    <div className="office-layout">
      <aside className="office-sidebar"><div className="office-sidebar-top"><span className="office-eyebrow">My workspace</span><h2>A place to belong.<br />Room to get things done.</h2><p>Your personal space stays yours, wherever the conversation takes you.</p></div>
        <section className="office-personal"><div className="office-row"><Face person={me} small /><div><strong>{me.name}</strong><span className="office-muted">{meeting ? "Currently in a meeting" : "In your personal space"}</span></div></div><label className="office-field">My availability<select aria-label="My availability" value={me.availability} disabled={busy} onChange={event => void act({ type: "person.update", personId: viewerId, availability: event.target.value as OfficePerson["availability"] })}><option value="available">Available</option><option value="focus">Focus time</option><option value="away">Away</option></select></label></section>
        <section className="office-private"><span className="office-eyebrow">Private by design</span><h3>Your personal agents</h3><p>Return here after a meeting. Private conversations stay separate from shared notes.</p>{onPrivateAgent && agents.length ? <div className="office-agent-list">{agents.slice(0, 12).map(agent => <button disabled={!!meeting} key={agent.id} onClick={() => onPrivateAgent(agent.id)}>{agent.name}<ArrowUpRight size={14} /></button>)}{meeting && <small>Leave the room to return to a private conversation.</small>}</div> : <p className="office-muted">{onBack ? "Your agents appear here after they are set up in the team map." : "Private agent conversations are available in your own workspace."}</p>}</section>
        <div className="office-sidebar-foot">{owner && !onBack && <a className="office-workspace-link" href="/">Open my agent workspace <ArrowUpRight size={14} /></a>}People first. Agents alongside.</div>
      </aside>
      <div className="office-content">
        <div className="office-title-row"><div><span className="office-eyebrow">C.H.I.E.F. Executive Suite</span><h1>Your team, in one place.</h1><p>Make space for focused work and conversations that move it forward.</p></div><div className="office-actions">{owner && <button className="office-primary" onClick={() => setAddPerson(!addPerson)}><Plus size={16} />Add a person</button>}</div></div>
        {error && <div role="alert" className="office-error">{error}<button onClick={() => { setError(""); void refresh(); }}>Refresh</button></div>}{status && <p role="status" className="office-status">{status}</p>}
        {profileOpen && <section className="office-inline-form"><h3>Your profile</h3><form onSubmit={event => { event.preventDefault(); void act({ type: "person.update", personId: viewerId, name: profileName }).then(ok => { if (ok) setProfileOpen(false); }); }}><label className="office-field">Name<input maxLength={80} required value={profileName} onChange={event => setProfileName(event.target.value)} /></label><button disabled={busy} className="office-primary">Save name</button><button type="button" onClick={() => setProfileOpen(false)}>Close</button></form></section>}
        {owner && addPerson && <section className="office-inline-form"><h3>Create a personal space</h3><form onSubmit={event => { event.preventDefault(); void act({ type: "person.add", name: personName, title: personTitle }).then(ok => { if (ok) { setPersonName(""); setPersonTitle(""); setAddPerson(false); } }); }}><label className="office-field">Full name<input autoFocus required maxLength={80} value={personName} onChange={event => setPersonName(event.target.value)} placeholder="Person’s name" /></label><label className="office-field">Role or team<input maxLength={100} value={personTitle} onChange={event => setPersonTitle(event.target.value)} placeholder="Optional" /></label><button disabled={busy} className="office-primary">Create space</button><button type="button" onClick={() => setAddPerson(false)}>Cancel</button></form><p>No message is sent. Select the person below and invite them to a room to create an access link.</p></section>}
        {myInvites.map(invitation => <section className="office-invitation" key={invitation.id}><div><strong>You’re invited to {office.rooms.find(room => room.id === invitation.roomId)?.name}</strong><p>Accepting gives you access. You choose when to join.</p></div><div className="office-actions"><button className="office-primary" disabled={busy} onClick={() => void act({ type: "invite.respond", invitationId: invitation.id, accept: true })}><Check size={16} />Accept invitation</button><button disabled={busy} onClick={() => void act({ type: "invite.respond", invitationId: invitation.id, accept: false })}>Decline</button></div></section>)}
        {links.length > 0 && <section className="office-links"><div className="office-row office-between"><h3>Private invitation links</h3><button onClick={() => setLinks([])}>Hide links</button></div><p>Each link can be used once, for the named person. Share it privately. Nothing has been sent.</p>{links.map(link => <div className="office-link-row" key={link.code}><strong>{office.people.find(person => person.id === link.personId)?.name}</strong><input readOnly aria-label={`Invitation link for ${office.people.find(person => person.id === link.personId)?.name}`} value={invitationUrl(link.code)} onFocus={event => event.currentTarget.select()} /><button aria-label={`Copy invitation link for ${office.people.find(person => person.id === link.personId)?.name}`} onClick={() => void navigator.clipboard.writeText(invitationUrl(link.code)).then(() => setStatus("Invitation link copied."), () => setError("Clipboard unavailable. Select and copy the link field."))}><Copy size={15} />Copy</button></div>)}</section>}
        <section aria-labelledby="office-people-title"><div className="office-section-head"><div><h2 id="office-people-title">Personal spaces <span>{office.people.length}</span></h2><p>{owner ? "Select people or drag a face into a room to prepare an invitation." : "Your personal space stays here while you join meetings."}</p></div><input className="office-search" aria-label="Find a person" placeholder="Find a person…" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <div className="office-people">{visiblePeople.map(person => { const room = office.rooms.find(item => occupants[item.id]?.includes(person.id)); const isSelected = selected.includes(person.id); return <article className={`office-person${isSelected ? " office-person-selected" : ""}`} key={person.id} draggable={owner && person.id !== viewerId} onDragStart={event => { event.dataTransfer.setData("application/chief-person", person.id); event.dataTransfer.effectAllowed = "copy"; }}>
            {owner && person.id !== viewerId && <label className="office-select-person"><input type="checkbox" aria-label={`Select ${person.name}`} checked={isSelected} onChange={() => toggleSelected(person.id)} /></label>}<Face person={person} /><span className={`office-presence office-presence-${onlineIds.includes(person.id) ? person.availability : "offline"}`}><span />{onlineIds.includes(person.id) ? person.availability === "focus" ? "Focus time" : person.availability === "away" ? "Away" : "Available" : "Offline"}</span><h3>{person.name}{person.id === viewerId && <span> · you</span>}</h3><p>{person.title || "Personal space"}</p><div className="office-person-location">{room ? <><Headphones size={13} />{room.name}</> : <><DoorOpen size={13} />Personal space</>}</div>{(owner || person.id === viewerId) && <label className="office-photo-action">{person.photo ? "Change photo" : "Add photo"}<input type="file" aria-label={`Photo for ${person.name}`} accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void officePhoto(file).then(photo => act({ type: "person.update", personId: person.id, photo })).catch(cause => setError(message(cause))); }} /></label>}</article>; })}
            {owner && !search && <button className="office-add-space" onClick={() => setAddPerson(true)}><Plus size={24} /><strong>A space for someone new</strong><span>Add a real person to your office</span></button>}
          </div>{visiblePeople.length === 0 && <p>No people match your search.</p>}
        </section>
        <section aria-labelledby="office-rooms-title"><div className="office-section-head"><div><h2 id="office-rooms-title">Meeting rooms <span>{office.rooms.length}</span></h2><p>{selected.length ? `${selected.length} selected · choose a room to invite them` : "Bring the right people together. Everyone joins on their own terms."}</p></div>{owner && <button onClick={() => setAddRoom(!addRoom)}><Plus size={15} />Add room</button>}</div>
          {owner && addRoom && <section className="office-inline-form"><form onSubmit={event => { event.preventDefault(); void act({ type: "room.add", name: roomName, kind: roomKind }).then(ok => { if (ok) { setRoomName(""); setAddRoom(false); } }); }}><label className="office-field">Room name<input required maxLength={80} value={roomName} onChange={event => setRoomName(event.target.value)} /></label><label className="office-field">Meeting style<select value={roomKind} onChange={event => setRoomKind(event.target.value as "audio" | "video")}><option value="video">Video room</option><option value="audio">Audio huddle</option></select></label><button disabled={busy} className="office-primary">Create room</button><button type="button" onClick={() => setAddRoom(false)}>Cancel</button></form></section>}
          <div className="office-rooms">{office.rooms.map(room => { const ids = occupants[room.id] ?? []; const inRoom = meeting?.roomId === room.id; const allowed = owner || office.invitations.some(invitation => invitation.roomId === room.id && invitation.personId === viewerId && invitation.status === "accepted" && invitation.expiresAt > Date.now()); return <article key={room.id} className={`office-room${inRoom ? " office-room-current" : ""}`} onDragOver={event => { if (owner && event.dataTransfer.types.includes("application/chief-person")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("application/chief-person"); if (owner && office.people.some(person => person.id === id) && id !== viewerId) void act({ type: "invite.create", roomId: room.id, personIds: selected.includes(id) ? selected : [id] }); }}><div className="office-row office-between"><span className="office-room-icon">{room.kind === "audio" ? <Headphones size={22} /> : <Video size={22} />}</span><span className="office-muted">{ids.length} / {room.capacity}</span></div><h3>{room.name}</h3><p>{room.kind === "audio" ? "A quick conversation, without the camera." : "A shared space for your next conversation."}</p><div className="office-room-people">{ids.length ? ids.map(id => { const person = office.people.find(item => item.id === id); return person ? <span key={id} title={person.name}><Face person={person} small /></span> : null; }) : <span className="office-muted">Ready when you are</span>}</div><div className="office-actions">{inRoom ? <button disabled={busy} onClick={() => void act({ type: "meeting.leave" })}>Leave room</button> : <button className="office-primary" disabled={busy || !!meeting || !allowed} onClick={() => void act({ type: "meeting.join", roomId: room.id })}><DoorOpen size={15} />{allowed ? "Join room" : "Invitation required"}</button>}{owner && <button disabled={busy || !selected.length} onClick={() => void act({ type: "invite.create", roomId: room.id, personIds: selected })}><Users size={15} />Invite{selected.length ? ` ${selected.length}` : " selected"}</button>}</div></article>; })}</div>
        </section>
        {meeting && <section className="office-active"><div className="office-section-head"><div><span className="office-eyebrow">You’re in the room</span><h2>{office.rooms.find(room => room.id === meeting.roomId)?.name}</h2><p>Room participation is saved. Media connects only when you choose.</p></div><button disabled={busy} onClick={() => void act({ type: "meeting.leave" })}><ArrowLeft size={15} />Return to my space</button></div><OfficeMedia key={meeting.id} meetingId={meeting.id} configured={snapshot.media === "livekit"} /></section>}
        {(meeting || office.meetings.length > 0) && <section className="office-notes"><div className="office-section-head"><div><span className="office-eyebrow">Shared meeting record</span><h2>What matters after the meeting.</h2><p>Manually record explicit statements. No recording, transcription or emotional inference is active.</p></div>{!meeting && <select aria-label="Meeting history" value={historyId} onChange={event => { setHistoryId(event.target.value); setSelectedNotes([]); }}><option value="">Choose a past meeting</option>{office.meetings.map(item => <option key={item.id} value={item.id}>{office.rooms.find(room => room.id === item.roomId)?.name} · {new Date(item.startedAt).toLocaleString()}</option>)}</select>}</div>
          {meeting && <form className="office-note-form" onSubmit={event => { event.preventDefault(); void act({ type: "note.add", meetingId: meeting.id, kind: noteKind, text: noteText, speakerId: viewerId, assigneeId: noteKind === "action" && assignee ? assignee : null }).then(ok => { if (ok) setNoteText(""); }); }}><div className="office-row"><label className="office-field">Record type<select value={noteKind} onChange={event => setNoteKind(event.target.value as OfficeNote["kind"])}><option value="summary">Summary</option><option value="decision">Decision</option><option value="concern">Explicit concern / disagreement</option><option value="action">Action item</option></select></label>{noteKind === "action" && <label className="office-field">Action owner<select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">Unassigned</option>{meeting.participantIds.map(id => <option key={id} value={id}>{office.people.find(person => person.id === id)?.name}</option>)}</select></label>}</div><label className="office-field">Your statement<textarea required maxLength={4000} rows={3} value={noteText} onChange={event => setNoteText(event.target.value)} placeholder="Record what you said, decided, or agreed to do…" /></label><div className="office-row office-between"><small>Attributed to {me.name}. Visible to participants in this meeting.</small><button className="office-primary" disabled={busy || !noteText.trim()}>Add to meeting record</button></div></form>}
          {viewedMeeting && <><div className="office-records">{viewedMeeting.notes.length ? viewedMeeting.notes.map(note => <label className="office-record" key={note.id}><input type="checkbox" aria-label={`Select ${note.kind} note: ${note.text.slice(0, 50)}`} checked={selectedNotes.includes(note.id)} onChange={() => setSelectedNotes(previous => previous.includes(note.id) ? previous.filter(id => id !== note.id) : [...previous, note.id])} /><div><span className="office-note-kind">{note.kind}</span><p>{note.text}</p><small>{office.people.find(person => person.id === note.speakerId)?.name}{note.assigneeId && ` · Assigned to ${office.people.find(person => person.id === note.assigneeId)?.name} (not notified)`}</small></div></label>) : <p className="office-muted">No notes yet. Capture the first takeaway above.</p>}</div><div className="office-row office-between"><small>Only selected notes are exported. Private agent chats are never included.</small><button disabled={!selectedNotes.some(id => viewedMeeting.notes.some(note => note.id === id))} onClick={download}><Download size={15} />Download selected notes</button></div></>}
        </section>}
        <footer className="office-footer"><span>C.H.I.E.F. Executive Suite</span><span>{snapshot.media === "livekit" ? "LiveKit media available · connect inside a room" : "Calling setup pending · shared rooms and notes are available"}</span></footer>
      </div>
    </div>
  </main>;
}
