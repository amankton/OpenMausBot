/** Browser-only PCM transport. Provider credentials stay on the harness. */
export interface GeminiLiveMediaCallbacks {
  onEvent(event: Record<string, unknown>): void;
  onError(error: Error): void;
  onClose?(): void;
}
export interface GeminiLiveMediaDeps {
  context(): AudioContext;
  socket(url: string): WebSocket;
  pageUrl(): string;
}

export function geminiSocketUrl(value: string, page: string): string {
  const base = new URL(page);
  const url = new URL(value, base);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.host !== base.host || url.protocol !== (base.protocol === 'https:' ? 'wss:' : 'ws:') || url.username || url.password || url.hash) {
    throw new Error('The voice connection must use this server.');
  }
  return url.href;
}

/** Stateful linear resampling retains fractional positions across input blocks. */
export class Pcm16Capture {
  private pending: number[] = [];
  private position = 0;
  constructor(private readonly sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid microphone sample rate.');
  }
  encode(input: Float32Array): string {
    this.pending.push(...input);
    const samples: number[] = [];
    const step = this.sampleRate / 16000;
    while (this.position + 1 < this.pending.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const value = Math.max(-1, Math.min(1, this.pending[index] * (1 - fraction) + this.pending[index + 1] * fraction));
      samples.push(Math.round(value * (value < 0 ? 32768 : 32767)));
      this.position += step;
    }
    const consumed = Math.min(Math.floor(this.position), this.pending.length);
    this.pending.splice(0, consumed);
    this.position -= consumed;
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

export class GeminiLiveMedia {
  private context: AudioContext | null = null;
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silence: GainNode | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private playbackAt = 0;
  private muted = false;
  private generation = 0;
  private cancelStart: (() => void) | null = null;
  constructor(private readonly callbacks: GeminiLiveMediaCallbacks, private readonly deps: GeminiLiveMediaDeps = {
    context: () => new AudioContext(), socket: url => new WebSocket(url), pageUrl: () => location.href,
  }) {}

  async start(url: string, stream: MediaStream): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.stream = stream;
    try {
      const socketUrl = geminiSocketUrl(url, this.deps.pageUrl());
      const context = this.context = this.deps.context();
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(new Error('Voice audio could not start in time.')), 20000);
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer); this.cancelStart = null;
          if (error) reject(error);
          else resolve();
        };
        this.cancelStart = () => finish(new Error('Voice connection cancelled.'));
        void context.resume().then(() => finish(), () => finish(new Error('Voice audio could not start.')));
      });
      if (generation !== this.generation) throw new Error('Voice connection cancelled.');
      const socket = this.socket = this.deps.socket(socketUrl);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Voice connection timed out.')), 20000);
        const finish = (error?: Error) => { clearTimeout(timer); this.cancelStart = null; if (error) reject(error); else resolve(); };
        this.cancelStart = () => finish(new Error('Voice connection cancelled.'));
        socket.onopen = () => finish();
        socket.onerror = () => finish(new Error('Voice connection failed.'));
        socket.onclose = () => finish(new Error('Voice connection closed.'));
        socket.onmessage = event => this.receive(event.data);
      });
      if (generation !== this.generation) throw new Error('Voice connection cancelled.');
      socket.onerror = () => this.fail(new Error('Voice connection failed.'));
      socket.onclose = () => { this.stop(); this.callbacks.onClose?.(); };
      this.input = context.createMediaStreamSource(stream);
      // ScriptProcessor keeps this transport usable in embedded browsers without
      // requiring a separate worklet URL or relaxing the application's CSP.
      this.processor = context.createScriptProcessor(2048, 1, 1);
      const encoder = new Pcm16Capture(context.sampleRate);
      this.processor.onaudioprocess = event => {
        if (this.muted || socket.readyState !== 1) return;
        if (socket.bufferedAmount > 1024 * 1024) return this.fail(new Error('Voice connection is too slow.'));
        const data = encoder.encode(event.inputBuffer.getChannelData(0));
        if (data) socket.send(JSON.stringify({ type: 'audio', data, sampleRate: 16000 }));
      };
      this.silence = context.createGain();
      this.silence.gain.value = 0;
      this.input.connect(this.processor);
      this.processor.connect(this.silence);
      this.silence.connect(context.destination);
      this.setMuted(this.muted);
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }

  setMuted(muted: boolean): void {
    if (muted && !this.muted && this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'audio.end' }));
    this.muted = muted;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  stop(): void {
    this.generation++;
    this.cancelStart?.();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      if (socket.readyState === 1) { try { socket.send(JSON.stringify({ type: 'audio.end' })); } catch { /* disconnected */ } }
      socket.close();
    }
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect(); this.input?.disconnect(); this.silence?.disconnect();
    this.processor = null; this.input = null; this.silence = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.clearPlayback();
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  private fail(error: Error): void { this.stop(); this.callbacks.onError(error); }
  private clearPlayback(): void {
    for (const source of this.playing) { source.onended = null; try { source.stop(); } catch { /* ended */ } source.disconnect(); }
    this.playing.clear(); this.playbackAt = 0;
  }
  private receive(raw: unknown): void {
    if (typeof raw !== 'string') return;
    try {
      const message = JSON.parse(raw);
      if (message.type === 'interrupted') {
        this.clearPlayback();
        this.callbacks.onEvent({ type: 'session.interrupted' });
      } else if (message.type === 'event' && message.event && typeof message.event === 'object') {
        if (['session.interrupted', 'session.output_audio.interrupted', 'interrupted'].includes(message.event.type)) this.clearPlayback();
        this.callbacks.onEvent(message.event);
      } else if (message.type === 'audio' && typeof message.data === 'string' && message.sampleRate === 24000 && this.context) {
        if (message.data.length > 1024 * 1024) throw new Error('Voice audio packet is too large.');
        const binary = atob(message.data);
        if (binary.length % 2) throw new Error('Invalid voice audio packet.');
        if (!binary.length) return;
        const context = this.context;
        if (this.playbackAt - context.currentTime > 30) throw new Error('Voice playback fell too far behind.');
        const buffer = context.createBuffer(1, binary.length / 2, 24000);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
          const value = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
          samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
        }
        const source = context.createBufferSource();
        source.buffer = buffer; source.connect(context.destination);
        this.playing.add(source);
        source.onended = () => { this.playing.delete(source); source.disconnect(); };
        const when = Math.max(context.currentTime, this.playbackAt);
        source.start(when); this.playbackAt = when + buffer.duration;
      }
    } catch { this.fail(new Error('Could not process voice audio.')); }
  }
}
