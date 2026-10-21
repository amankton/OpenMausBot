import { randomBytes } from 'node:crypto';
import { ServerResponse, type IncomingMessage, type Server } from 'node:http';
import { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import type { RequestAuth } from './request-auth.ts';
import { PASS, type RouteHandler } from './routes/table.ts';
import { GeminiLiveSocket, type GeminiBrowserEvent } from './gemini-live.ts';
import { LiveSessionError } from './live-call.ts';

const PATH = '/api/live/gemini-audio';
const TICKET_MS = 30_000;
const MAX_BROWSER_BUFFER = 512 * 1024;
const authIdentity = (auth: RequestAuth) => auth.kind === 'session' ? `session:${auth.session.id}` : 'loopback';
interface Ticket { callId: string; origin: string; auth: string; expires: number }

/** Short-lived capability plus normal HTTP authentication. No API key or
 * model commands are accepted on the browser-facing audio socket. */
export class GeminiAudioBridge {
  private readonly sessions = new Map<string, GeminiLiveSocket>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly upgrades = new Map<IncomingMessage, { socket: Socket; head: Buffer; release: () => void }>();
  private readonly ws = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024 });
  private readonly active: (callId: string) => boolean;
  constructor(active: (callId: string) => boolean) { this.active = active; }

  register(callId: string, socket: GeminiLiveSocket): void { this.sessions.set(callId, socket); }
  remove(callId: string): void {
    this.sessions.delete(callId);
    for (const [token, ticket] of this.tickets) if (ticket.callId === callId) this.tickets.delete(token);
  }
  ticket(callId: string, origin: string, auth: RequestAuth): string {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new LiveSessionError('This call needs a browser origin.', 400); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || !this.active(callId) || !this.sessions.has(callId)) throw new LiveSessionError('The audio connection could not be prepared.', 400);
    for (const [token, ticket] of this.tickets) if (ticket.expires < Date.now() || ticket.callId === callId) this.tickets.delete(token);
    const token = randomBytes(32).toString('base64url');
    this.tickets.set(token, { callId, origin, auth: authIdentity(auth), expires: Date.now() + TICKET_MS });
    const expiry = setTimeout(() => {
      if (this.tickets.delete(token)) { this.sessions.get(callId)?.close(); this.remove(callId); }
    }, TICKET_MS);
    expiry.unref();
    return `${PATH}?ticket=${token}`;
  }

  attach(server: Server, handle: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>): void {
    server.on('upgrade', (req, socket, head) => {
      let path: string;
      try { path = new URL(req.url ?? '', 'http://localhost').pathname; } catch { return; }
      if (path !== PATH) return;
      if (!(socket instanceof Socket)) { socket.destroy(); return; }
      const res = new ServerResponse(req); res.assignSocket(socket); res.setHeader('connection', 'close');
      socket.on('error', () => socket.destroy());
      res.once('finish', () => socket.end(() => socket.destroy()));
      const upgrade = { socket, head, release: () => socket.off('data', buffer) };
      const buffer = (data: Buffer) => { if (upgrade.head.length + data.length > 64 * 1024) socket.destroy(); else upgrade.head = Buffer.concat([upgrade.head, data]); };
      socket.on('data', buffer); socket.once('end', () => socket.destroy());
      socket.once('close', () => { upgrade.release(); this.upgrades.delete(req); });
      this.upgrades.set(req, upgrade);
      const timeout = setTimeout(() => socket.destroy(), 10_000); timeout.unref();
      socket.once('close', () => clearTimeout(timeout));
      void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); else socket.destroy(); }).finally(() => clearTimeout(timeout));
    });
  }

  route: RouteHandler = async ({ req, res, path, url, method, auth, json }) => {
    if (path !== PATH) return PASS;
    const upgrade = this.upgrades.get(req);
    if (method !== 'GET' || !upgrade) return json(res, 400, { error: 'A WebSocket audio connection is required.' });
    const token = url.searchParams.get('ticket') ?? '';
    const ticket = this.tickets.get(token);
    if (!ticket || ticket.expires < Date.now() || req.headers.origin !== ticket.origin || authIdentity(auth) !== ticket.auth || !this.active(ticket.callId)) return json(res, 403, { error: 'The audio connection ticket is invalid or expired.' });
    const session = this.sessions.get(ticket.callId);
    if (!session || session.readyState === 3) return json(res, 410, { error: 'This call has ended.' });
    this.tickets.delete(token); // consumed before upgrade, including a failed handshake
    this.upgrades.delete(req); upgrade.release(); res.detachSocket(upgrade.socket);
    this.ws.handleUpgrade(req, upgrade.socket, upgrade.head, browser => {
      const send = (event: GeminiBrowserEvent) => {
        if (browser.readyState !== 1) return;
        if (browser.bufferedAmount > MAX_BROWSER_BUFFER) { browser.close(1013, 'Audio connection too slow'); session.close(); return; }
        browser.send(JSON.stringify(event));
        if (event.type === 'event' && event.event.type === 'session.closed') browser.close(1000, 'Call ended');
      };
      session.bindBrowser(send);
      browser.on('message', (data, binary) => {
        if (!this.active(ticket.callId) || binary || !session.browserInput(data.toString('utf8'))) { browser.close(1008, 'Invalid audio input'); session.close(); }
      });
      browser.on('close', () => { session.close(); this.remove(ticket.callId); });
      browser.on('error', () => { session.close(); this.remove(ticket.callId); });
    });
    return;
  };

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear(); this.tickets.clear();
    for (const upgrade of this.upgrades.values()) upgrade.socket.destroy();
    this.ws.close();
  }
}
