// The proxy-side half of computer control. The harness keeps the record of
// who is driving (server/computer-control.ts); the per-turn computer
// processes consult it through this client before acting, because the
// action paths themselves never traverse the harness — a boat click goes
// straight to the boat's REST API, and a Local VM / VPS click rides a
// transparent stdio bridge into Cua Driver.
//
// Failure posture: CLOSED once configured. A missing/expired turn capability
// must never be interpreted as "the person released control": that would let
// a stale computer proxy resume acting underneath them. An unconfigured
// client remains disengaged because there is no control surface to consult.
//
// The state is cached briefly so a computer_batch of two dozen actions
// doesn't turn into two dozen loopback round trips.

import { COMPUTER_ACCESS_TIMEOUT_MS } from "../shared/computer-control-timing.ts";

export interface ControlState {
  /** The person is driving; actions must be refused, not queued. */
  held: boolean;
  /** A help request the person has neither answered nor dismissed. */
  helpOpen: boolean;
  /** A different thread owns the same physical computer, not a human hold. */
  blockedReason?: string;
}

export interface ControlClient {
  /** Current state, cached for `cacheMs`. `fresh` bypasses the cache —
   * the wait loop in request-help polls with it so a hand-back is seen
   * within one poll interval, not one poll interval plus the cache. */
  state(fresh?: boolean): Promise<ControlState>;
  /** Surface the bot's plea in the app. Returns its expiry id, or null when
   * the harness could not be told. */
  requestHelp(reason: string): Promise<string | null>;
  /** Close only the unanswered plea opened by this client. */
  expireHelp(requestId: string): Promise<void>;
  readonly configured: boolean;
}

const DISENGAGED: ControlState = { held: false, helpOpen: false };
export const CONTROL_UNAVAILABLE_PLAIN =
  "This computer connection could not verify current access. This call was NOT performed. " +
  "Pause computer work and reconnect the computer tools before retrying.";

function unavailable(detail: string): ControlState {
  return { held: true, helpOpen: false, blockedReason: `${detail} ${CONTROL_UNAVAILABLE_PLAIN}` };
}

export function createControlClient(options?: {
  url?: string;
  token?: string;
  cacheMs?: number;
  fetchImpl?: typeof fetch;
}): ControlClient {
  const url = options?.url ?? process.env.OMB_CONTROL_URL ?? "";
  const token = options?.token ?? process.env.OMB_CONTROL_TOKEN ?? "";
  const cacheMs = options?.cacheMs ?? 750;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const configured = Boolean(url && token);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  let cachedAt = 0;
  let cached: ControlState = DISENGAGED;

  async function read(): Promise<ControlState> {
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(COMPUTER_ACCESS_TIMEOUT_MS) });
      if (res.status === 401 || res.status === 403) {
        return unavailable(`The computer access service refused authorization (HTTP ${res.status}).`);
      }
      if (!res.ok) return unavailable(`The computer access service returned HTTP ${res.status}.`);
      let body: any;
      try { body = await res.json(); }
      catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw error;
        return unavailable("The computer access service returned an invalid state response.");
      }
      if (typeof body?.held !== "boolean" || typeof body?.helpOpen !== "boolean") {
        return unavailable("The computer access service returned an invalid state response.");
      }
      return {
        held: body.held,
        helpOpen: body.helpOpen,
        ...(typeof body.blockedReason === "string" && body.blockedReason.trim() ? { blockedReason: body.blockedReason } : {}),
      };
    } catch (error) {
      return unavailable(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "The computer access check timed out."
        : "This computer connection could not reach its access service.");
    }
  }

  return {
    configured,
    async state(fresh = false): Promise<ControlState> {
      if (!configured) return DISENGAGED;
      const now = Date.now();
      if (!fresh && now - cachedAt < cacheMs) return cached;
      cached = await read();
      cachedAt = Date.now();
      return cached;
    },
    async requestHelp(reason: string): Promise<string | null> {
      if (!configured) return null;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ reason }),
          signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) return null;
        const body: any = await res.json().catch(() => null);
        return typeof body?.requestId === "string" && body.requestId ? body.requestId : null;
      } catch {
        return null;
      }
    },
    async expireHelp(requestId: string): Promise<void> {
      if (!configured || !requestId) return;
      try {
        await fetchImpl(url, {
          method: "DELETE",
          headers,
          body: JSON.stringify({ requestId }),
          signal: AbortSignal.timeout(2_000),
        });
      } catch {
        // Best effort: the harness also clears the in-memory request on
        // release/restart, and an unavailable harness cannot show the card.
      }
    },
  };
}

/** The one sentence every refused computer action gets, on every computer.
 * Deliberately does not vary per tool: the model needs the same three facts
 * every time — nothing happened, don't retry blindly, and wait for the
 * person. */
export const CONTROL_REFUSAL_PLAIN =
  "A person has taken control of this computer, so this call was NOT performed. " +
  "Do not retry it — the screen is changing under their hands. " +
  "Pause this task, tell the person you are waiting for them to hand control back, " +
  "and take a fresh screenshot before your next action once they have.";
