/** Server-only Hermes transport. Never import this module from a renderer. */
export interface HermesHttpConfig { baseUrl: string; apiKey: string; model: string; timeoutMs: number }

export function hermesHttpConfig(env: Record<string, string | undefined>): HermesHttpConfig {
  const baseUrl = (env.HERMES_API_BASE_URL || "http://127.0.0.1:8642").replace(/\/+$/, "");
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("HERMES_API_BASE_URL must be an HTTP(S) URL without credentials, query or fragment");
  }
  const apiKey = env.HERMES_API_KEY?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error("Set server-side HERMES_API_KEY to the Hermes API_SERVER_KEY");
  const timeoutMs = Number(env.HERMES_API_TIMEOUT_MS || 900000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("HERMES_API_TIMEOUT_MS must be a positive integer");
  return { baseUrl, apiKey, model: env.HERMES_API_MODEL?.trim() || "hermes-agent", timeoutMs };
}

export class HermesHttpError extends Error {
  readonly category: string;
  readonly status?: number;
  constructor(category: string, status?: number) {
    // Upstream bodies can contain prompts, headers and credentials. Parse for
    // protocol validity, but expose only a controlled diagnostic.
    super(category === "unauthorized" ? "Hermes rejected authentication; check server-side HERMES_API_KEY"
      : `Hermes HTTP ${category}${status ? ` (${status})` : ""}; check the API server and retry`);
    this.category = category;
    this.status = status;
  }
}

export interface SseEvent { event: string; data: string; id?: string }

/** Incremental UTF-8 SSE decoder, including CR, LF, CRLF and multiline data. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", event = "message", id: string | undefined;
  let data: string[] = [];
  const line = (value: string): SseEvent | undefined => {
    if (!value) {
      const result = data.length ? { event, data: data.join("\n"), id } : undefined;
      event = "message"; data = [];
      return result;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    let text = colon < 0 ? "" : value.slice(colon + 1);
    if (text.startsWith(" ")) text = text.slice(1);
    if (field === "data") data.push(text);
    else if (field === "event") event = text;
    else if (field === "id" && !text.includes("\0")) id = text;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      // Bound a missing delimiter / malicious event without buffering a response.
      if (buffer.length + data.reduce((n, s) => n + s.length, 0) > 4 * 1024 * 1024) throw new HermesHttpError("event_too_large");
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] !== "\r" && buffer[i] !== "\n") continue;
        if (buffer[i] === "\r" && i === buffer.length - 1 && !chunk.done) break;
        const value = buffer.slice(start, i);
        if (buffer[i] === "\r" && buffer[i + 1] === "\n") i++;
        start = i + 1;
        const parsed = line(value);
        if (parsed) {
          if (parsed.data === "[DONE]") return;
          yield parsed;
        }
      }
      buffer = buffer.slice(start);
      if (chunk.done) return; // Only blank-line terminated events are complete.
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class HermesHttpClient {
  readonly config: HermesHttpConfig;
  private readonly fetcher: typeof fetch;
  constructor(config: HermesHttpConfig, fetcher: typeof fetch = fetch) { this.config = config; this.fetcher = fetcher; }

  private async response(path: string, body: unknown, signal?: AbortSignal, onHeaders?: (status: number) => void) {
    const combined = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])]);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST", signal: combined,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: path.endsWith('/events') ? 'text/event-stream' : 'application/json',
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
      });
      onHeaders?.(response.status);
      if (!response.ok) {
        // Parse bounded OpenAI-style error JSON without retaining or surfacing
        // untrusted message text (it may echo private input or credentials).
        const reader = response.body?.getReader();
        if (reader) {
          let size = 0, payload = "";
          const decoder = new TextDecoder();
          try {
            while (size < 16384) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              payload += decoder.decode(value.subarray(0, Math.max(0, 16384 - (size - value.length))), { stream: true });
            }
            try { JSON.parse(payload); } catch { /* Non-JSON errors still use HTTP status. */ }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        throw new HermesHttpError(response.status === 401 || response.status === 403 ? "unauthorized" : "upstream_error", response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof HermesHttpError) throw error;
      if (signal?.aborted) throw new HermesHttpError("cancelled");
      throw new HermesHttpError(combined.aborted ? "timeout" : "unreachable");
    }
  }

  async json(path: string, body?: unknown, signal?: AbortSignal, onHeaders?: (status: number) => void): Promise<Record<string, unknown>> {
    const response = await this.response(path, body, signal, onHeaders);
    try {
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid JSON object");
      return data as Record<string, unknown>;
    }
    catch (error) { throw new HermesHttpError(signal?.aborted ? "cancelled" : (error as Error).name === "TimeoutError" ? "timeout" : "invalid_json"); }
  }

  async *events(runId: string, signal: AbortSignal, onHeaders?: (status: number) => void): AsyncGenerator<Record<string, unknown>> {
    const response = await this.response(`/v1/runs/${encodeURIComponent(runId)}/events`, undefined, signal, onHeaders);
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new HermesHttpError("invalid_stream");
    try {
      for await (const event of parseSse(response.body)) {
        let data: unknown;
        try { data = JSON.parse(event.data); } catch { throw new HermesHttpError("malformed_event"); }
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new HermesHttpError("malformed_event");
        yield { ...data, event: (data as Record<string, unknown>).event ?? event.event };
      }
    } catch (error) {
      if (error instanceof HermesHttpError) throw error;
      throw new HermesHttpError(signal.aborted ? "cancelled" : (error as Error).name === "TimeoutError" ? "timeout" : "interrupted");
    }
  }
}
