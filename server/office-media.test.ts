import { RoomServiceClient, TokenVerifier } from "livekit-server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficeMedia } from "./office-media.ts";
import { applyOfficeCommand } from "./office.ts";
import { newOffice } from "../shared/office.ts";

// Synthetic signing credentials; never connected to a media server.
const env = { CHIEF_LIVEKIT_URL: "wss://media.example.invalid", CHIEF_LIVEKIT_API_KEY: "chief-test-key", CHIEF_LIVEKIT_API_SECRET: "synthetic-chief-test-secret-at-least-32-characters" };
const joinedOffice = () => applyOfficeCommand(newOffice("workspace-a"), { type: "meeting.join", roomId: "huddle" }, "local-owner");
afterEach(() => vi.restoreAllMocks());

describe("office media authorization", () => {
  it("keeps invalid or incomplete configuration unavailable without crashing", async () => {
    for (const config of [{}, { ...env, CHIEF_LIVEKIT_API_SECRET: "" }, ...[
      "not a url", "https://media.example.invalid", "ws://media.example.invalid", "wss://user:pass@media.example.invalid", "wss://media.example.invalid?token=x", "wss://media.example.invalid#fragment",
    ].map(CHIEF_LIVEKIT_URL => ({ ...env, CHIEF_LIVEKIT_URL }))]) {
      const media = createOfficeMedia(config);
      expect(media.configured).toBe(false);
      await expect(media.token(joinedOffice(), "local-owner")).rejects.toMatchObject({ status: 503 });
    }
    for (const url of ["ws://localhost:7880", "ws://127.0.0.1:7880", "ws://[::1]:7880", env.CHIEF_LIVEKIT_URL]) {
      expect(createOfficeMedia({ ...env, CHIEF_LIVEKIT_URL: url }).configured).toBe(true);
    }
  });

  it("signs only a present participant's identity and exact workspace/meeting room", async () => {
    const office = joinedOffice(), media = createOfficeMedia(env);
    const result = await media.token(office, "local-owner");
    const claims = await new TokenVerifier(env.CHIEF_LIVEKIT_API_KEY, env.CHIEF_LIVEKIT_API_SECRET).verify(result.token);
    expect(result.url).toBe(env.CHIEF_LIVEKIT_URL);
    expect(claims.sub).toBe("local-owner");
    expect(claims.video).toEqual({ roomJoin: true, room: `chief-workspace-a-${office.meetings[0]!.id}`, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
    expect(claims.exp! - Math.floor(Date.now() / 1000)).toBeGreaterThan(55);
    expect(claims.exp! - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60);
    expect(claims.video?.roomAdmin).toBeUndefined(); expect(claims.video?.roomRecord).toBeUndefined();
    const another = { ...office, workspaceId: "workspace-b" };
    const second = await media.token(another, "local-owner");
    const secondClaims = await new TokenVerifier(env.CHIEF_LIVEKIT_API_KEY, env.CHIEF_LIVEKIT_API_SECRET).verify(second.token);
    expect(secondClaims.video?.room).not.toBe(claims.video?.room);
    await expect(new TokenVerifier(env.CHIEF_LIVEKIT_API_KEY, "wrong-signing-secret").verify(result.token)).rejects.toThrow();
  });

  it("refuses outsider identities, personal spaces and ended meetings", async () => {
    const media = createOfficeMedia(env), office = joinedOffice();
    await expect(media.token(office, "outsider")).rejects.toMatchObject({ status: 403 });
    await expect(media.token(newOffice(), "local-owner")).rejects.toMatchObject({ status: 403 });
    const left = applyOfficeCommand(office, { type: "meeting.leave" }, "local-owner");
    await expect(media.token(left, "local-owner")).rejects.toMatchObject({ status: 403 });
  });

  it("disconnects the actor from only their current media room and tolerates already removed participants", async () => {
    const remove = vi.spyOn(RoomServiceClient.prototype, "removeParticipant").mockResolvedValue(undefined);
    const media = createOfficeMedia(env), office = joinedOffice();
    await media.disconnect(office, "local-owner");
    expect(remove).toHaveBeenCalledExactlyOnceWith(`chief-workspace-a-${office.meetings[0]!.id}`, "local-owner");
    remove.mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 404 }));
    await expect(media.disconnect(office, "local-owner")).resolves.toBeUndefined();
    remove.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "not_found" }));
    await expect(media.disconnect(office, "local-owner")).resolves.toBeUndefined();
    remove.mockRejectedValueOnce(new Error("network failure with secret upstream detail"));
    await expect(media.disconnect(office, "local-owner")).rejects.toMatchObject({ status: 503, message: "Could not disconnect the media session. Retry leaving the room." });
  });
});
