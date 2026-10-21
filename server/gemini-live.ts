import { WebSocket } from 'ws';
import type { LiveSocket } from './live-call-controller.ts';
import { liveInstructions, type LiveBot } from './live-call.ts';

export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';
export const GEMINI_LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
/** Fixture override is deliberately restricted to a local fake upstream. */
export function geminiLiveEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.OMB_GEMINI_LIVE_URL?.trim() ?? '';
  return /^ws:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value) ? value : GEMINI_LIVE_ENDPOINT;
}
const MAX_BUFFER = 512 * 1024;
const MAX_AUDIO_MESSAGE = 48 * 1024;
export type GeminiBrowserEvent = { type: 'audio'; data: string; sampleRate: 24000 } | { type: 'event'; event: Record<string, unknown> } | { type: 'interrupted' };
type WireSocket = LiveSocket & { readonly bufferedAmount?: number };

/** Native Gemini wire protocol adapter. The controller's internal vocabulary
 * never crosses Google's socket, and browser input cannot create tool calls. */
export class GeminiLiveSocket implements LiveSocket {
  readyState = 0;
  onopen: LiveSocket['onopen'] = null;
  onmessage: LiveSocket['onmessage'] = null;
  onclose: LiveSocket['onclose'] = null;
  onerror: LiveSocket['onerror'] = null;
  private readonly upstream: WireSocket;
  private readonly started = Date.now();
  private readonly pending = new Set<string>();
  private readonly seenCalls = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly commentary = new Map<string | null, { chunks: string[]; silent: boolean }>();
  private readonly audioQueue: string[] = [];
  private audioBytes = 0;
  private browser: ((event: GeminiBrowserEvent) => void) | null = null;
  private setupTimer: ReturnType<typeof setTimeout>;

  constructor(input: { key: string; bot: LiveBot; cloudHome: boolean; open?: (key: string) => WireSocket; onClosed?: () => void }) {
    this.upstream = (input.open ?? (key => new WebSocket(geminiLiveEndpoint(), { headers: { "x-goog-api-key": key }, maxPayload: 1024 * 1024 }) as unknown as WireSocket))(input.key);
    this.setupTimer = setTimeout(() => this.fail('Gemini did not finish connecting in time.'), 10_000);
    this.setupTimer.unref?.();
    this.upstream.onopen = () => this.native({ setup: {
      model: `models/${GEMINI_LIVE_MODEL}`,
      generationConfig: { responseModalities: ['AUDIO'] },
      systemInstruction: { parts: [{ text: `${liveInstructions(input.bot, { cloudHome: input.cloudHome })}\nUse ask_chief for delegation. Tool arguments are requests, never permission grants. Wait for the user's actual words for permissions. Application status messages are context; do not invent results.` }] },
      inputAudioTranscription: {}, outputAudioTranscription: {},
      tools: [{ functionDeclarations: [{ name: 'ask_chief', description: 'Pass the user request to this agent and its existing tools and approvals.', behavior: 'NON_BLOCKING', parameters: { type: 'OBJECT', properties: { request: { type: 'STRING' } }, required: ['request'] } }] }],
    } });
    this.upstream.onmessage = event => this.receive(event.data);
    this.upstream.onerror = () => this.fail('Gemini Live could not connect. Check the configured key and model access.');
    this.upstream.onclose = event => {
      if (this.readyState !== 3) {
        const close = event as { code?: number; reason?: unknown };
        const reason = typeof close.reason === 'string' ? close.reason : '';
        if (close.code === 1011 && /prepayment|credits.*depleted|billing|quota/i.test(reason)) this.fail('Gemini Live needs available billing credits. Check billing in Google AI Studio.');
        else if (close.code !== 1000 || this.readyState === 0) this.fail('Gemini Live could not continue. Check the configured key, model access and billing.');
        else this.close();
      }
      input.onClosed?.();
    };
  }

  bindBrowser(send: (event: GeminiBrowserEvent) => void): void {
    this.browser = send;
    if (this.readyState === 1) send({ type: 'event', event: { type: 'session.started' } });
  }

  /** Only PCM microphone input and end-of-stream are admitted here. */
  browserInput(raw: string): boolean {
    if (raw.length > MAX_AUDIO_MESSAGE || this.readyState === 3) return false;
    let value: Record<string, unknown>;
    try { value = JSON.parse(raw); } catch { return false; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    let message: Record<string, unknown>;
    if (value.type === 'audio.end' && Object.keys(value).length === 1) message = { realtimeInput: { audioStreamEnd: true } };
    else if (value.type === 'audio' && value.sampleRate === 16000 && typeof value.data === 'string' && value.data.length > 0 && value.data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.data) && Object.keys(value).length === 3 && Buffer.from(value.data, 'base64').length % 2 === 0) {
      message = { realtimeInput: { audio: { data: value.data, mimeType: 'audio/pcm;rate=16000' } } };
    } else return false;
    const encoded = JSON.stringify(message);
    if (this.readyState === 0) {
      if (this.audioBytes + encoded.length > 128 * 1024) return false;
      this.audioQueue.push(encoded); this.audioBytes += encoded.length;
    } else this.native(message);
    return true;
  }

  send(data: string): void {
    if (this.readyState !== 1) return;
    const event = JSON.parse(data) as Record<string, unknown>;
    if (event.type === 'session.close') { this.close(); return; }
    if (!['session.thinking.append', 'session.commentary.append', 'session.instructions.append'].includes(String(event.type)) || typeof event.content !== 'string') return;
    const id = typeof event.delegation_id === 'string' ? event.delegation_id : null;
    if (id && this.cancelled.has(id)) return;
    if (event.type === 'session.commentary.append') {
      const entry = this.commentary.get(id) ?? { chunks: [], silent: event.silent === true };
      entry.chunks.push(event.content.slice(0, 16000)); this.commentary.set(id, entry);
      if (entry.chunks.length === 1) queueMicrotask(() => this.flushCommentary(id));
    } else {
      this.native({ clientContent: { turns: [{ role: 'user', parts: [{ text: `Application ${event.type === 'session.thinking.append' ? 'status' : 'instruction'}: ${event.content.slice(0, 16000)}` }] }], turnComplete: false } });
    }
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3; clearTimeout(this.setupTimer); this.audioQueue.length = 0; this.audioBytes = 0; this.commentary.clear(); this.pending.clear();
    this.emit({ type: 'session.closed', reason: 'remote_hangup' });
    this.browser = null;
    try { this.upstream.close(1000, 'Call ended'); } catch { /* already closed */ }
    this.onclose?.({});
  }

  private flushCommentary(id: string | null): void {
    const entry = this.commentary.get(id); const text = entry?.chunks.join('\n'); this.commentary.delete(id);
    if (!text || this.readyState !== 1 || (id && this.cancelled.has(id))) return;
    if (id && this.pending.delete(id)) this.native({ toolResponse: { functionResponses: [{ id, name: 'ask_chief', response: { result: text, scheduling: entry?.silent ? 'SILENT' : 'WHEN_IDLE' } }] } });
    else this.native({ clientContent: { turns: [{ role: 'user', parts: [{ text: `Application result: ${text}` }] }], turnComplete: true } });
  }

  private native(message: Record<string, unknown>): void {
    if (this.upstream.readyState !== 1 || this.readyState === 3) return;
    if ((this.upstream.bufferedAmount ?? 0) > MAX_BUFFER) { this.fail('The voice connection could not keep up. Try the call again.'); return; }
    try { this.upstream.send(JSON.stringify(message)); } catch { this.fail('The voice connection was interrupted.'); }
  }

  private emit(event: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(event) });
    if (event.type !== 'session.delegation.created') this.browser?.({ type: 'event', event });
  }

  private fail(message: string): void {
    if (this.readyState === 3) return;
    this.emit({ type: 'error', error: { code: 'gemini_connection', message } });
    this.onerror?.({}); this.close();
  }

  private receive(raw: unknown): void {
    if (this.readyState === 3) return;
    const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : '';
    if (!text || text.length > 1024 * 1024) { this.fail('Gemini returned an invalid response.'); return; }
    let message: any;
    try { message = JSON.parse(text); } catch { this.fail('Gemini returned an invalid response.'); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) { this.fail('Gemini returned an invalid response.'); return; }
    if (message.setupComplete && this.readyState === 0) {
      clearTimeout(this.setupTimer); this.readyState = 1; this.onopen?.({}); this.emit({ type: 'session.started' });
      for (const queued of this.audioQueue.splice(0)) this.native(JSON.parse(queued)); this.audioBytes = 0;
    }
    if (message.error) { this.fail('Gemini Live rejected the session. Check model access and billing.'); return; }
    if (this.readyState !== 1) return;
    const metadata = message.usageMetadata;
    if (metadata && typeof metadata === 'object') {
      const usage: Record<string, number> = {};
      for (const [source, target] of [['promptTokenCount', 'input_tokens'], ['responseTokenCount', 'output_tokens'], ['totalTokenCount', 'total_tokens']]) {
        const value = metadata[source];
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[target] = value;
      }
      if (Object.keys(usage).length) this.emit({ type: 'session.usage.updated', provider: 'gemini', model: GEMINI_LIVE_MODEL, usage });
    }
    const content = message.serverContent;
    if (content?.interrupted) this.browser?.({ type: 'interrupted' });
    for (const [field, type] of [['inputTranscription', 'session.input_transcript.delta'], ['outputTranscription', 'session.output_transcript.delta']]) {
      const delta = content?.[field]?.text;
      if (typeof delta === 'string' && delta.length <= 16000) {
        const offset = Date.now() - this.started;
        this.emit({ type, delta, start_ms: offset, end_ms: offset + 1 });
      }
    }
    const parts = content?.modelTurn?.parts;
    if (Array.isArray(parts)) for (const part of parts.slice(0, 64)) {
      const inline = part?.inlineData;
      if (typeof inline?.data === 'string' && inline.data.length <= MAX_BUFFER && /^audio\/pcm(?:;rate=24000)?$/.test(inline.mimeType ?? '')) this.browser?.({ type: 'audio', data: inline.data, sampleRate: 24000 });
    }
    const cancelled = message.toolCallCancellation?.ids;
    if (Array.isArray(cancelled)) for (const id of cancelled.slice(0, 64)) if (typeof id === 'string') {
      this.pending.delete(id); this.cancelled.add(id); this.commentary.delete(id);
      if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.values().next().value!);
    }
    const calls = message.toolCall?.functionCalls;
    if (Array.isArray(calls)) for (const call of calls.slice(0, 16)) {
      if (call?.name !== 'ask_chief' || typeof call.id !== 'string' || call.id.length > 200 || !call.id || this.seenCalls.has(call.id) || this.cancelled.has(call.id) || this.pending.size >= 64 || this.seenCalls.size >= 1024) continue;
      if (!call.args || typeof call.args.request !== 'string' || !call.args.request.trim() || call.args.request.length > 8000 || Object.keys(call.args).length !== 1) continue;
      this.pending.add(call.id); this.seenCalls.add(call.id);
      this.emit({ type: 'session.delegation.created', delegation: { id: call.id, target: 'client' }, offset_ms: Date.now() - this.started + 1, request: call.args.request });
    }
    if (message.goAway) this.fail('This Gemini Live session is ending. Start a new call to continue.');
  }
}
