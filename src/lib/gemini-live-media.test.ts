import { describe, expect, it, vi } from 'vitest';
import { GeminiLiveMedia, geminiSocketUrl, Pcm16Capture } from './gemini-live-media';

describe('Gemini browser PCM transport', () => {
  it('uses only the current server and preserves secure transport', () => {
    expect(geminiSocketUrl('/api/live/audio', 'https://chief.test/')).toBe('wss://chief.test/api/live/audio');
    for (const url of ['ws://chief.test/a', 'wss://other.test/a', 'wss://name:secret@chief.test/a']) {
      expect(() => geminiSocketUrl(url, 'https://chief.test/')).toThrow();
    }
  });
  it('resamples across block boundaries and emits little-endian signed PCM', () => {
    const input = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 20));
    const whole = atob(new Pcm16Capture(48000).encode(input));
    const split = new Pcm16Capture(48000);
    expect(atob(split.encode(input.slice(0, 2048))) + atob(split.encode(input.slice(2048)))).toBe(whole);
    expect(whole.length).toBe(3200);
    const bytes = atob(new Pcm16Capture(16000).encode(new Float32Array([-1, 1, 0])));
    expect([...bytes].map(c => c.charCodeAt(0))).toEqual([0, 128, 255, 127]);
  });
  it('captures, mutes, interrupts queued playback and releases all resources', async () => {
    const sent: string[] = [];
    const socket = { readyState: 1, bufferedAmount: 0, send: (data: string) => sent.push(data), close: vi.fn(), onopen: null, onmessage: null } as unknown as WebSocket;
    const track = { enabled: true, stop: vi.fn() };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const processor = { ...node(), onaudioprocess: null } as unknown as ScriptProcessorNode;
    const playback = { ...node(), start: vi.fn(), stop: vi.fn(), onended: null };
    const context = { sampleRate: 48000, currentTime: 0, destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
      createMediaStreamSource: node, createScriptProcessor: () => processor,
      createGain: () => ({ ...node(), gain: { value: 1 } }),
      createBuffer: (_channels: number, count: number, rate: number) => ({ duration: count / rate, getChannelData: () => new Float32Array(count) }),
      createBufferSource: () => playback,
    } as unknown as AudioContext;
    const callbacks = { onEvent: vi.fn(), onError: vi.fn() };
    const media = new GeminiLiveMedia(callbacks, { context: () => context, socket: () => socket, pageUrl: () => 'http://localhost:5299/' });
    const starting = media.start('/api/live/audio', stream);
    await Promise.resolve();
    await Promise.resolve();
    socket.onopen?.call(socket, new Event('open'));
    await starting;
    processor.onaudioprocess?.call(processor, { inputBuffer: { getChannelData: () => new Float32Array(2048) } } as unknown as AudioProcessingEvent);
    expect(JSON.parse(sent[0])).toMatchObject({ type: 'audio', sampleRate: 16000 });
    media.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(JSON.parse(sent.at(-1)!)).toEqual({ type: 'audio.end' });
    socket.onmessage?.call(socket, { data: JSON.stringify({ type: 'audio', sampleRate: 24000, data: btoa('\0\0') }) } as MessageEvent);
    expect(playback.start).toHaveBeenCalled();
    socket.onmessage?.call(socket, { data: JSON.stringify({ type: 'interrupted' }) } as MessageEvent);
    expect(playback.stop).toHaveBeenCalledOnce();
    expect(callbacks.onEvent).toHaveBeenCalledWith({ type: 'session.interrupted' });
    media.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
  it('cancels an opening socket without reporting an intentional close', async () => {
    const socket = { readyState: 0, close: vi.fn() } as unknown as WebSocket;
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const context = { resume: async () => {}, close: vi.fn(async () => {}) } as unknown as AudioContext;
    const callbacks = { onEvent: vi.fn(), onError: vi.fn(), onClose: vi.fn() };
    const media = new GeminiLiveMedia(callbacks, { context: () => context, socket: () => socket, pageUrl: () => 'http://localhost:5299/' });
    const starting = media.start('/api/live/audio', stream);
    await Promise.resolve();
    media.stop();
    await expect(starting).rejects.toThrow('cancelled');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
  it('bounds a suspended AudioContext and releases the synthetic microphone', async () => {
    vi.useFakeTimers();
    try {
      const track = { stop: vi.fn() };
      const context = { resume: () => new Promise<void>(() => {}), close: vi.fn(async () => {}) } as unknown as AudioContext;
      const socket = vi.fn();
      const media = new GeminiLiveMedia({ onEvent: vi.fn(), onError: vi.fn() }, { context: () => context, socket, pageUrl: () => 'http://localhost:5299/' });
      const result = media.start('/api/live/audio', { getTracks: () => [track] } as unknown as MediaStream).catch(error => error);
      await vi.advanceTimersByTimeAsync(20000);
      expect((await result).message).toMatch(/could not start in time/);
      expect(track.stop).toHaveBeenCalledOnce();
      expect(context.close).toHaveBeenCalledOnce();
      expect(socket).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
