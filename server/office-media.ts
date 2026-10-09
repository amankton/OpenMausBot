import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import type { Office } from "../shared/office.ts";
import { activeMeeting } from "../shared/office.ts";
import { OfficeError } from "./office.ts";

export interface OfficeMedia {
  configured: boolean;
  token(office: Office, actor: string): Promise<{ url: string; token: string }>;
  disconnect(office: Office, actor: string): Promise<void>;
}

export function createOfficeMedia(env: NodeJS.ProcessEnv = process.env): OfficeMedia {
  const { CHIEF_LIVEKIT_URL: url, CHIEF_LIVEKIT_API_KEY: key, CHIEF_LIVEKIT_API_SECRET: secret } = env;
  let configured = false;
  if (url && key && secret) {
    try {
      const parsed = new URL(url);
      configured = !parsed.username && !parsed.password && !parsed.search && !parsed.hash &&
        (parsed.protocol === "wss:" || (parsed.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)));
    } catch { /* Invalid deployment configuration leaves calling unavailable. */ }
  }
  const roomName = (office: Office, actor: string) => {
    const meeting = activeMeeting(office, actor);
    if (!meeting) throw new OfficeError("Join a room before connecting media", 403);
    return `chief-${office.workspaceId}-${meeting.id}`;
  };
  return {
    configured,
    async token(office, actor) {
      const room = roomName(office, actor);
      if (!configured) throw new OfficeError("Calling is not configured. Set CHIEF_LIVEKIT_URL, CHIEF_LIVEKIT_API_KEY and CHIEF_LIVEKIT_API_SECRET on the Chief server.", 503);
      const at = new AccessToken(key!, secret!, { identity: actor, ttl: 60 });
      at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
      return { url: url!, token: await at.toJwt() };
    },
    async disconnect(office, actor) {
      if (!configured) return;
      const room = roomName(office, actor);
      const service = new RoomServiceClient(url!.replace(/^ws/, "http"), key, secret);
      try { await service.removeParticipant(room, actor); }
      catch (error) {
        if (error instanceof Error && "status" in error && error.status === 404) return;
        if (error instanceof Error && "code" in error && error.code === "not_found") return;
        throw new OfficeError("Could not disconnect the media session. Retry leaving the room.", 503);
      }
    },
  };
}
