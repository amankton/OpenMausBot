import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import { activeMeeting, newOffice, officeSchema, type Office, type OfficeCommand, type OfficeSnapshot } from "../shared/office.ts";

export class OfficeError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const credentialSchema = z.object({ hash: z.string(), personId: z.string(), invitationId: z.string().optional(), expiresAt: z.number() });
const savedSchema = z.object({ office: officeSchema, credentials: z.array(credentialSchema).max(1200) });
type Saved = z.infer<typeof savedSchema>;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");

export function applyOfficeCommand(current: Office, command: OfficeCommand, actor: string, now = Date.now()): Office {
  const office = structuredClone(current);
  const owner = actor === office.ownerId;
  const admin = () => { if (!owner) throw new OfficeError("Only the office owner can do that", 403); };
  const person = (id: string) => { const p = office.people.find(p => p.id === id); if (!p) throw new OfficeError("Person not found", 404); return p; };
  const room = (id: string) => { const r = office.rooms.find(r => r.id === id); if (!r) throw new OfficeError("Room not found", 404); return r; };
  person(actor);
  switch (command.type) {
    case "person.add":
      admin();
      if (office.people.length >= 50) throw new OfficeError("This office supports up to 50 personal spaces");
      office.people.push({ id: randomUUID(), name: command.name, title: command.title, photo: null, availability: "available" }); break;
    case "person.update": {
      if (command.personId !== actor) admin();
      const p = person(command.personId);
      if (command.availability !== undefined && p.id !== actor) throw new OfficeError("Only your own availability can be changed", 403);
      if (command.name !== undefined) p.name = command.name;
      if (command.photo !== undefined) p.photo = command.photo;
      if (command.availability !== undefined) p.availability = command.availability;
      break;
    }
    case "room.add":
      admin();
      if (office.rooms.length >= 12) throw new OfficeError("This office supports up to 12 rooms");
      office.rooms.push({ id: randomUUID(), name: command.name, kind: command.kind, capacity: 20 }); break;
    case "invite.create": {
      admin(); const r = room(command.roomId);
      const ids = [...new Set(command.personIds)].filter(id => id !== office.ownerId);
      ids.forEach(person);
      const existing = office.invitations.filter(i => i.roomId === r.id && i.status !== "declined" && i.expiresAt > now);
      if (new Set([...existing.map(i => i.personId), ...ids]).size + 1 > r.capacity) throw new OfficeError("Room capacity exceeded");
      if (office.invitations.length + ids.length > 600) throw new OfficeError("Invitation limit reached");
      for (const personId of ids) {
        if (!existing.some(i => i.personId === personId)) office.invitations.push({ id: randomUUID(), roomId: r.id, personId, status: "pending", expiresAt: now + 86_400_000 });
      }
      break;
    }
    case "invite.respond": {
      const invitation = office.invitations.find(i => i.id === command.invitationId && i.personId === actor);
      if (!invitation || invitation.expiresAt <= now) throw new OfficeError("Invitation is unavailable or expired", 404);
      if (invitation.status !== "pending") throw new OfficeError("Invitation has already been answered", 409);
      invitation.status = command.accept ? "accepted" : "declined"; break;
    }
    case "invite.cancel": {
      admin();
      const invitation = office.invitations.find(i => i.id === command.invitationId);
      if (!invitation) throw new OfficeError("Invitation not found", 404);
      if (office.meetings.some(m => m.endedAt === null && m.roomId === invitation.roomId && m.presentIds.includes(invitation.personId))) throw new OfficeError("Participant is in the room; invitation cannot be cancelled mid-meeting", 409);
      office.invitations = office.invitations.filter(i => i.id !== command.invitationId); break;
    }
    case "meeting.join": {
      const r = room(command.roomId);
      if (!owner && !office.invitations.some(i => i.personId === actor && i.roomId === r.id && i.status === "accepted" && i.expiresAt > now)) throw new OfficeError("Accept an invitation to this room first", 403);
      if (activeMeeting(office, actor)) throw new OfficeError("Leave your current room before joining another", 409);
      let meeting = office.meetings.find(m => m.roomId === r.id && m.endedAt === null);
      if (!meeting) {
        if (office.meetings.length >= 100) throw new OfficeError("Meeting history is full", 409);
        meeting = { id: randomUUID(), roomId: r.id, startedAt: now, endedAt: null, participantIds: [], presentIds: [], notes: [] };
        office.meetings.push(meeting);
      }
      if (meeting.presentIds.length >= r.capacity) throw new OfficeError("This room is full", 409);
      meeting.presentIds.push(actor);
      if (!meeting.participantIds.includes(actor)) meeting.participantIds.push(actor);
      break;
    }
    case "meeting.leave": {
      const meeting = activeMeeting(office, actor);
      if (!meeting) throw new OfficeError("You are already in your personal space", 409);
      meeting.presentIds = meeting.presentIds.filter(id => id !== actor);
      if (!meeting.presentIds.length) meeting.endedAt = now;
      break;
    }
    case "note.add": {
      const meeting = office.meetings.find(m => m.id === command.meetingId && m.presentIds.includes(actor));
      if (!meeting) throw new OfficeError("Join this meeting before adding a note", 403);
      if (meeting.endedAt !== null) throw new OfficeError("This meeting has ended", 409);
      if (meeting.notes.length >= 200) throw new OfficeError("Meeting note limit reached");
      if (command.speakerId !== actor) throw new OfficeError("Record your own explicit words; do not impersonate a speaker", 403);
      if (command.assigneeId && !meeting.participantIds.includes(command.assigneeId)) throw new OfficeError("Action owner must be a meeting participant");
      if (command.kind !== "action" && command.assigneeId) throw new OfficeError("Only action items have an assignee");
      meeting.notes.push({ id: randomUUID(), kind: command.kind, text: command.text, speakerId: actor, assigneeId: command.assigneeId, createdAt: now }); break;
    }
  }
  office.revision++;
  return officeSchema.parse(office);
}

export function createOfficeStore(dataDir: string, clock = Date.now) {
  const path = join(dataDir, "chief-office.v1.json");
  const seen = new Map<string, number>();
  let initial: Saved | undefined;
  const read = (): Saved => existsSync(path) ? savedSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : (initial ??= { office: newOffice(randomUUID()), credentials: [] });
  const save = (state: Saved) => { mkdirSync(dataDir, { recursive: true }); writeFileAtomic(path, JSON.stringify(savedSchema.parse(state)), { mode: 0o600 }); };
  const validCredential = (value: string) => /^(?:chief_office_)?[A-Za-z0-9_-]{43}$/.test(value) ? read().credentials.find(c => c.hash === hash(value) && c.expiresAt > clock()) : undefined;
  return {
    read: () => read().office,
    authenticate(value: string): string | undefined { const c = validCredential(value); return c && !c.invitationId ? c.personId : undefined; },
    claim(value: string) {
      const c = validCredential(value);
      const saved = read();
      if (!c?.invitationId || !saved.office.invitations.some(i => i.id === c.invitationId && i.status === "pending" && i.expiresAt > clock())) throw new OfficeError("Invitation link is invalid, already used or expired", 401);
      const secret = `chief_office_${token()}`;
      saved.credentials = saved.credentials.filter(item => item.hash !== c.hash && item.expiresAt > clock());
      saved.credentials.push({ hash: hash(secret), personId: c.personId, expiresAt: clock() + 7 * 86_400_000 });
      save(saved); return { token: secret, personId: c.personId };
    },
    logout(value: string) { const saved = read(); saved.credentials = saved.credentials.filter(c => c.hash !== hash(value)); save(saved); },
    snapshot(actor: string, media: OfficeSnapshot["media"]): OfficeSnapshot {
      const office = read().office;
      if (!office.people.some(p => p.id === actor)) throw new OfficeError("Office membership required", 403);
      seen.set(actor, clock());
      return { viewerId: actor, media, onlineIds: [...seen].filter(([, t]) => clock() - t < 30_000).map(([id]) => id),
        occupants: Object.fromEntries(office.rooms.map(r => [r.id, office.meetings.find(m => m.roomId === r.id && m.endedAt === null)?.presentIds ?? []])),
        office: { ...office, invitations: office.invitations.filter(i => actor === office.ownerId || i.personId === actor), meetings: office.meetings.filter(m => m.participantIds.includes(actor)) } };
    },
    update(revision: number, command: OfficeCommand, actor: string) {
      const saved = read();
      if (revision !== saved.office.revision) throw new OfficeError("Office changed in another window. Refresh and try again.", 409);
      const previous = new Set(saved.office.invitations.map(i => i.id));
      saved.office = applyOfficeCommand(saved.office, command, actor, clock());
      saved.credentials = saved.credentials.filter(c => c.expiresAt > clock() && (!c.invitationId || saved.office.invitations.some(i => i.id === c.invitationId)));
      const links: Array<{ personId: string; code: string }> = [];
      for (const invitation of saved.office.invitations.filter(i => !previous.has(i.id))) {
        const code = token();
        saved.credentials.push({ hash: hash(code), personId: invitation.personId, invitationId: invitation.id, expiresAt: invitation.expiresAt });
        links.push({ personId: invitation.personId, code });
      }
      save(saved); return links;
    },
  };
}
