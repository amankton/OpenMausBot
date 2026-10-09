import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyOfficeCommand, createOfficeStore } from "./office.ts";
import { newOffice, type OfficeCommand } from "../shared/office.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "chief-office-test-")); dirs.push(dir);
  let now = 1_800_000_000_000;
  const store = createOfficeStore(dir, () => now);
  const command = (command: OfficeCommand, actor = "local-owner") => store.update(store.read().revision, command, actor);
  const add = (name: string) => { command({ type: "person.add", name, title: "Teammate" }); return store.read().people.at(-1)!.id; };
  const invite = (personId: string, roomId = "huddle") => command({ type: "invite.create", roomId, personIds: [personId] })[0]!.code;
  const accept = (personId: string, roomId = "huddle") => command({ type: "invite.respond", invitationId: store.read().invitations.find(i => i.personId === personId && i.roomId === roomId)!.id, accept: true }, personId);
  return { dir, store, command, add, invite, accept, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("persisted office membership", () => {
  it("claims a link once, persists only credential hashes, and restores identity after restart", () => {
    const f = fixture(), person = f.add("Avery"), code = f.invite(person);
    expect(f.store.authenticate(code)).toBeUndefined();
    const member = f.store.claim(code);
    expect(member.personId).toBe(person);
    expect(() => f.store.claim(code)).toThrow(/already used/);
    expect(f.store.authenticate(member.token)).toBe(person);
    const disk = readFileSync(join(f.dir, "chief-office.v1.json"), "utf8");
    expect(disk).not.toContain(code); expect(disk).not.toContain(member.token);
    expect(JSON.stringify(f.store.snapshot(person, "unconfigured"))).not.toMatch(/credentials|"hash"|"token"/);
    expect(createOfficeStore(f.dir, f.now).authenticate(member.token)).toBe(person);
    f.store.logout(member.token);
    expect(createOfficeStore(f.dir, f.now).authenticate(member.token)).toBeUndefined();
  });

  it("requires the invited person to accept before joining; the owner cannot accept for them", () => {
    const f = fixture(), a = f.add("Avery"), b = f.add("Blake"); f.invite(a);
    const invitationId = f.store.read().invitations[0]!.id;
    for (const actor of ["local-owner", b]) expect(() => f.command({ type: "invite.respond", invitationId, accept: true }, actor)).toThrow(/unavailable/);
    expect(() => f.command({ type: "meeting.join", roomId: "huddle" }, a)).toThrow(/Accept/);
    f.accept(a); f.command({ type: "meeting.join", roomId: "huddle" }, a);
    expect(f.store.read().meetings[0]!.presentIds).toEqual([a]);
    expect(() => f.accept(a)).toThrow(/already been answered/);
    expect(() => f.command({ type: "meeting.join", roomId: "boardroom" }, a)).toThrow(/Accept/);
  });

  it("expires invitation links, acceptance and sessions using persisted deadlines", () => {
    const f = fixture(), a = f.add("Avery"), code = f.invite(a);
    const member = f.store.claim(code); f.accept(a);
    f.advance(86_400_000);
    expect(() => f.command({ type: "meeting.join", roomId: "huddle" }, a)).toThrow(/Accept/);
    const b = f.add("Blake"), expiredCode = f.invite(b); f.advance(86_400_000);
    expect(() => f.store.claim(expiredCode)).toThrow(/expired/);
    expect(() => f.accept(b)).toThrow(/expired/);
    f.advance(6 * 86_400_000);
    expect(f.store.authenticate(member.token)).toBeUndefined();
  });

  it("hides meeting records from outsiders, including an owner who did not participate", () => {
    const f = fixture(), a = f.add("Avery"), b = f.add("Blake"); f.invite(a); f.accept(a);
    f.command({ type: "meeting.join", roomId: "huddle" }, a);
    const meetingId = f.store.read().meetings[0]!.id;
    f.command({ type: "note.add", meetingId, kind: "concern", text: "I explicitly disagree with the timeline.", speakerId: a, assigneeId: null }, a);
    for (const actor of [b, "local-owner"]) {
      const snapshot = f.store.snapshot(actor, "unconfigured");
      expect(snapshot.office.meetings).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toContain("disagree");
      expect(snapshot.occupants.huddle).toEqual([a]);
    }
    expect(f.store.snapshot(b, "unconfigured").office.invitations).toEqual([]);
    f.command({ type: "meeting.leave" }, a);
    const returned = f.store.snapshot(a, "unconfigured");
    expect(returned.office.meetings[0]!.notes[0]!.text).toContain("explicitly disagree");
    expect(returned.office.meetings[0]!.endedAt).not.toBeNull();
    expect(returned.office.people.some(p => p.id === a)).toBe(true);
  });

  it("permits only self availability and self-attributed notes with valid action participants", () => {
    const f = fixture(), a = f.add("Avery"), b = f.add("Blake");
    expect(() => f.command({ type: "person.update", personId: a, availability: "away" })).toThrow(/own availability/);
    expect(() => f.command({ type: "person.update", personId: b, name: "Fake" }, a)).toThrow(/owner/);
    f.command({ type: "person.update", personId: a, availability: "focus" }, a);
    expect(f.store.read().people.find(p => p.id === a)?.availability).toBe("focus");
    f.invite(a); f.accept(a); f.command({ type: "meeting.join", roomId: "huddle" }, a);
    const meetingId = f.store.read().meetings[0]!.id;
    expect(() => f.command({ type: "note.add", meetingId, kind: "summary", text: "invented", speakerId: b, assigneeId: null }, a)).toThrow(/impersonate/);
    expect(() => f.command({ type: "note.add", meetingId, kind: "action", text: "task", speakerId: a, assigneeId: b }, a)).toThrow(/participant/);
    expect(() => f.command({ type: "note.add", meetingId, kind: "summary", text: "summary", speakerId: a, assigneeId: a }, a)).toThrow(/Only action/);
    expect(() => f.command({ type: "note.add", meetingId, kind: "summary", text: "outsider", speakerId: b, assigneeId: null }, b)).toThrow(/Join/);
  });

  it("rejects stale writes without losing the winning persisted change", () => {
    const f = fixture(); f.add("Avery"); const revision = f.store.read().revision;
    const second = createOfficeStore(f.dir, f.now);
    f.command({ type: "room.add", name: "Planning", kind: "video" });
    const before = readFileSync(join(f.dir, "chief-office.v1.json"), "utf8");
    expect(() => second.update(revision, { type: "room.add", name: "Stale", kind: "audio" }, "local-owner")).toThrow(/another window/);
    expect(readFileSync(join(f.dir, "chief-office.v1.json"), "utf8")).toBe(before);
    expect(second.read().rooms.at(-1)!.name).toBe("Planning");
  });

  it("enforces invitation and physical room capacity separately", () => {
    const f = fixture(), ids = Array.from({ length: 6 }, (_, i) => f.add(`Person ${i}`));
    expect(() => f.command({ type: "invite.create", roomId: "huddle", personIds: ids })).toThrow(/capacity/);
    let office = newOffice(); office.rooms[0]!.capacity = 2;
    office.people.push(...ids.slice(0, 2).map(id => ({ id, name: id, title: "", photo: null, availability: "available" as const })));
    office.invitations = ids.slice(0, 2).map(personId => ({ id: personId, roomId: "huddle", personId, status: "accepted" as const, expiresAt: f.now() + 1000 }));
    for (const actor of ids.slice(0, 2)) office = applyOfficeCommand(office, { type: "meeting.join", roomId: "huddle" }, actor, f.now());
    expect(() => applyOfficeCommand(office, { type: "meeting.join", roomId: "huddle" }, "local-owner", f.now())).toThrow(/full/);
  });

  it("cancels unclaimed links and refuses cancellation while the person is in the meeting", () => {
    const f = fixture(), a = f.add("Avery"), code = f.invite(a), invitationId = f.store.read().invitations[0]!.id;
    f.command({ type: "invite.cancel", invitationId }); expect(() => f.store.claim(code)).toThrow(/invalid/);
    f.invite(a); f.accept(a); f.command({ type: "meeting.join", roomId: "huddle" }, a);
    expect(() => f.command({ type: "invite.cancel", invitationId: f.store.read().invitations[0]!.id })).toThrow(/mid-meeting/);
  });

  it("expires presence without removing persistent personal spaces", () => {
    const f = fixture(), a = f.add("Avery"); f.store.snapshot(a, "unconfigured"); f.advance(30_001);
    const snapshot = f.store.snapshot("local-owner", "unconfigured");
    expect(snapshot.onlineIds).toEqual(["local-owner"]);
    expect(snapshot.office.people.some(p => p.id === a)).toBe(true);
  });

  it("does not overwrite malformed saved data", () => {
    const f = fixture(); f.add("Avery"); const file = join(f.dir, "chief-office.v1.json");
    writeFileSync(file, "{broken");
    expect(() => f.store.update(0, { type: "room.add", name: "Oops", kind: "video" }, "local-owner")).toThrow();
    expect(readFileSync(file, "utf8")).toBe("{broken");
  });
});
