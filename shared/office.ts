import { z } from "zod";

const id = z.string().min(1).max(80);
const label = z.string().trim().min(1).max(80);
export const availabilitySchema = z.enum(["available", "focus", "away"]);
export const noteKindSchema = z.enum(["summary", "decision", "concern", "action"]);
// Photos stay on this machine. No remote trackers, SVG or arbitrary URL schemes.
const photo = z.string().max(180_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).nullable();
export const personSchema = z.object({ id, name: label, title: z.string().max(100), photo, availability: availabilitySchema });
export const roomSchema = z.object({ id, name: label, kind: z.enum(["audio", "video"]), capacity: z.number().int().min(2).max(50) });
export const noteSchema = z.object({ id, kind: noteKindSchema, text: z.string().trim().min(1).max(4000), speakerId: id, assigneeId: id.nullable(), createdAt: z.number() });
export const meetingSchema = z.object({ id, roomId: id, startedAt: z.number(), endedAt: z.number().nullable(), participantIds: z.array(id), presentIds: z.array(id), notes: z.array(noteSchema).max(200) });
export const officeSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(), workspaceId: id,
  ownerId: z.literal("local-owner"), people: z.array(personSchema).min(1).max(50), rooms: z.array(roomSchema).max(12),
  invitations: z.array(z.object({ id, roomId: id, personId: id, status: z.enum(["pending", "accepted", "declined"]), expiresAt: z.number() })).max(600),
  meetings: z.array(meetingSchema).max(100),
});
export type Office = z.infer<typeof officeSchema>;
export type OfficePerson = z.infer<typeof personSchema>;
export type OfficeMeeting = z.infer<typeof meetingSchema>;
export type OfficeNote = z.infer<typeof noteSchema>;

export const officeCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("person.add"), name: label, title: z.string().trim().max(100) }).strict(),
  z.object({ type: z.literal("person.update"), personId: id, name: label.optional(), photo: photo.optional(), availability: availabilitySchema.optional() }).strict(),
  z.object({ type: z.literal("room.add"), name: label, kind: z.enum(["audio", "video"]) }).strict(),
  z.object({ type: z.literal("invite.create"), roomId: id, personIds: z.array(id).min(1).max(50) }).strict(),
  z.object({ type: z.literal("invite.respond"), invitationId: id, accept: z.boolean() }).strict(),
  z.object({ type: z.literal("invite.cancel"), invitationId: id }).strict(),
  z.object({ type: z.literal("meeting.join"), roomId: id }).strict(),
  z.object({ type: z.literal("meeting.leave") }).strict(),
  z.object({ type: z.literal("note.add"), meetingId: id, kind: noteKindSchema, text: z.string().trim().min(1).max(4000), speakerId: id, assigneeId: id.nullable() }).strict(),
]);
export type OfficeCommand = z.infer<typeof officeCommandSchema>;
export const officeRequestSchema = z.object({ revision: z.number().int().nonnegative(), command: officeCommandSchema }).strict();
export interface OfficeSnapshot { office: Office; viewerId: string; onlineIds: string[]; media: "livekit" | "unconfigured"; occupants: Record<string, string[]> }

export function newOffice(workspaceId = "fixture"): Office {
  return { version: 1, revision: 0, workspaceId, ownerId: "local-owner",
    people: [{ id: "local-owner", name: "Your office", title: "Personal space", photo: null, availability: "available" }],
    rooms: [{ id: "huddle", name: "Quick huddle", kind: "audio", capacity: 6 }, { id: "boardroom", name: "Meeting room", kind: "video", capacity: 20 }],
    invitations: [], meetings: [] };
}

export function activeMeeting(office: Office, personId: string = office.ownerId) { return office.meetings.find(m => m.endedAt === null && m.presentIds.includes(personId)); }

/** Only explicitly selected notes cross into an export. No private agent history is read. */
export function meetingBrief(office: Office, meeting: OfficeMeeting, selectedIds: string[]): string {
  const selected = new Set(selectedIds);
  const person = (personId: string) => office.people.find(p => p.id === personId)?.name ?? "Unknown";
  return [`# ${office.rooms.find(r => r.id === meeting.roomId)?.name ?? "Meeting"}`, "Meeting notes · manually recorded · review before sharing", "",
    ...meeting.notes.filter(n => selected.has(n.id)).map(n => `- ${n.kind.toUpperCase()}: ${n.text}\n  Recorded statement by ${person(n.speakerId)}${n.assigneeId ? ` · Assigned to ${person(n.assigneeId)} (not notified)` : ""}`)].join("\n");
}
