// Chief explicit-consent meeting capture. EPL-2.0; see upstream LICENSE.
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, chmodSync, lstatSync, realpathSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

export class CaptureError extends Error {
  constructor (readonly status: number, message: string) { super(message) }
}
export const captureLimits = Object.freeze({ maxParticipants: 8, maxDurationMs: 3600000, maxBytes: 256 * 1024 * 1024, leaseMs: 10000, retentionMs: 7 * 86400000 })
export type CaptureState = 'pending' | 'starting' | 'capturing' | 'stopping' | 'processing' | 'ready' | 'failed' | 'cancelled' | 'deleted'
export interface CapturePerson { personId: string, account: string, name: string, identity: string, sid: string }
interface Participant extends CapturePerson { consent: 'pending' | 'accepted' | 'declined' }
export interface Segment { id: string, personId: string, speaker: string, startMs: number, endMs: number, text: string }
export interface CaptureSession {
  id: string, workspace: string, meetingId: string, roomName: string, title: string, revision: number, state: CaptureState,
  requestedBy: string, requestedAt: number, startedAt?: number, stoppedAt?: number, reason?: string,
  participants: Participant[], workerIdentity: string, workerId?: string, expiresAt?: number,
  durationMs?: number, bytes?: number, completionHash?: string, deletedAck?: boolean, retryQueued?: boolean,
  segments?: Segment[], suggestions?: Array<{ id: string, kind: 'action' | 'decision', text: string, sourceSegmentId: string, personId: string }>
}
export interface CaptureContext { workspace: string, meetingId: string, roomName: string, title: string, personId: string }
export interface CaptureDependencies {
  roster: (context: Pick<CaptureContext, 'workspace' | 'meetingId' | 'roomName'>) => Promise<CapturePerson[]>
  remove: (roomName: string, identity: string) => Promise<void>
  token: (session: CaptureSession, expiresAt: number) => Promise<string>
  now?: () => number
}
const active = new Set<CaptureState>(['pending', 'starting', 'capturing', 'stopping', 'processing'])
const listening = new Set<CaptureState>(['pending', 'starting', 'capturing'])
function fail (condition: unknown, status: number, message: string): asserts condition { if (!condition) throw new CaptureError(status, message) }
export function exactBody (value: unknown, keys: string[]): asserts value is Record<string, any> {
  fail(value != null && typeof value === 'object' && !Array.isArray(value), 400, 'Invalid request')
  fail(Object.keys(value).every(key => keys.includes(key)), 400, 'Unexpected request field')
}
export function captureId (value: unknown): string {
  fail(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value), 400, 'Invalid identifier')
  return value
}
export function publicSession (s: CaptureSession): Record<string, unknown> {
  const { id, workspace, meetingId, title, revision, state, requestedBy, requestedAt, startedAt, stoppedAt, reason, segments, suggestions } = s
  return { id, workspace, meetingId, title, revision, state, requestedBy, requestedAt, startedAt, stoppedAt, reason,
    participants: s.participants.map(({ personId, name, consent }) => ({ personId, name, consent })), segments, suggestions }
}

/** Single-process serialized private store. Never persists bearer tokens or worker credentials. */
export class CaptureStore {
  sessions: CaptureSession[] = []
  private readonly file: string
  constructor (directory: string) {
    directory = resolve(directory)
    // Docker may precreate the dedicated named-volume root as 0755. Check every
    // existing ancestor before mkdir/chmod, so a link cannot redirect this change.
    for (let current = directory; ; current = dirname(current)) {
      try {
        const info = lstatSync(current)
        fail(info.isDirectory() && !info.isSymbolicLink() && resolve(realpathSync(current)) === current, 503, 'Capture storage must be a regular directory without links')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (dirname(current) === current) break
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    fail(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink() && resolve(realpathSync(directory)) === directory, 503, 'Capture storage directory changed')
    chmodSync(directory, 0o700)
    this.file = join(directory, 'sessions.json')
    try {
      const raw = readFileSync(this.file, 'utf8')
      fail(Buffer.byteLength(raw) <= 16 * 1024 * 1024, 503, 'Capture store exceeds limit')
      const value = JSON.parse(raw)
      fail(value.version === 1 && Array.isArray(value.sessions) && value.sessions.length <= 200, 503, 'Invalid capture store')
      this.sessions = value.sessions
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  save (): void {
    const raw = JSON.stringify({ version: 1, sessions: this.sessions })
    fail(Buffer.byteLength(raw) <= 16 * 1024 * 1024, 503, 'Capture store exceeds limit')
    const temporary = this.file + '.next'
    writeFileSync(temporary, raw, { mode: 0o600 })
    const fd = openSync(temporary, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, this.file)
  }
}

export class MeetingCapture {
  private queue: Promise<unknown> = Promise.resolve()
  private worker?: { id: string, at: number, ready: boolean, model: string }
  private fault = false
  private readonly now: () => number
  constructor (readonly store: CaptureStore, private readonly deps: CaptureDependencies) { this.now = deps.now ?? Date.now }
  async serial<T> (action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { fail(!this.fault, 503, 'Capture storage is unavailable'); return await action() })
    this.queue = next.catch(() => {})
    return await next
  }
  private persist (): void { try { this.store.save() } catch (error) { this.fault = true; throw error } }
  private compactDeleted (): void {
    // Keep cleanup receipts until the worker acknowledges deletion and every
    // previously issued connection token/lease has expired. Never drop a pending cleanup.
    const retained = this.store.sessions.filter(s => s.state !== 'deleted' || !s.deletedAck || this.now() < (s.expiresAt ?? s.requestedAt) + captureLimits.leaseMs)
    if (retained.length !== this.store.sessions.length) { this.store.sessions = retained; this.persist() }
  }
  async recover (): Promise<void> {
    for (const s of this.store.sessions) {
      if (active.has(s.state)) { s.state = 'failed'; s.reason = 'Server restarted; capture was not resumed'; s.stoppedAt = this.now() }
      // Remove stale listener identities even for persisted terminal sessions.
      await this.deps.remove(s.roomName, s.workerIdentity)
    }
    this.persist()
  }
  find (id: string): CaptureSession {
    const s = this.store.sessions.find(item => item.id === captureId(id))
    fail(s != null && s.state !== 'deleted', 404, 'Capture is unavailable'); return s
  }
  authorize (s: CaptureSession, context: CaptureContext): void {
    fail(s.workspace === context.workspace && s.meetingId === context.meetingId && s.participants.some(p => p.personId === context.personId), 403, 'This capture is not available to this member')
  }
  workerState (): string { return this.worker == null || this.now() - this.worker.at > captureLimits.leaseMs ? 'offline' : this.store.sessions.some(s => active.has(s.state)) ? 'busy' : this.worker.ready ? 'ready' : 'offline' }
  private async unchanged (s: CaptureSession): Promise<boolean> {
    try {
      const current = await this.deps.roster(s)
      return current.length === s.participants.length && current.every(p => s.participants.some(old => old.personId === p.personId && old.account === p.account && old.identity === p.identity && old.sid === p.sid))
    } catch { return false }
  }
  private async end (s: CaptureSession, reason: string): Promise<void> {
    if (!listening.has(s.state) && s.state !== 'stopping') return
    const pending = s.state === 'pending'
    if (s.state !== 'stopping') s.reason = reason
    s.stoppedAt ??= this.now(); s.state = pending ? 'cancelled' : 'stopping'; this.persist()
    await this.deps.remove(s.roomName, s.workerIdentity)
    // Worker acknowledgment is required before processing; failed removal never reports a completed stop.
  }
  async tick (): Promise<void> {
    for (const s of this.store.sessions) {
      if (s.state === 'deleted') { await this.deps.remove(s.roomName, s.workerIdentity); continue }
      if (listening.has(s.state)) {
        if (!await this.unchanged(s)) await this.end(s, 'Attendance or room authorization changed')
        else if (this.worker == null || this.now() - this.worker.at > captureLimits.leaseMs) await this.end(s, 'Capture worker disconnected')
        else if (s.startedAt != null && this.now() - s.startedAt >= captureLimits.maxDurationMs) await this.end(s, 'Meeting capture reached its duration limit')
        else if (s.state === 'pending' && this.now() - s.requestedAt > 120000) await this.end(s, 'Consent request expired')
      }
      if (s.state === 'stopping') {
        await this.deps.remove(s.roomName, s.workerIdentity)
        if (this.now() - (s.stoppedAt ?? this.now()) > captureLimits.leaseMs * 2) { s.state = 'failed'; s.reason = 'Worker did not confirm capture stopped'; this.persist() }
      }
      if (s.state === 'processing' && (this.worker == null || this.now() - this.worker.at > captureLimits.leaseMs)) { s.state = 'failed'; s.reason = 'Transcription worker disconnected'; this.persist() }
      const retention = s.state === 'failed' ? 72 * 3600000 : captureLimits.retentionMs
      if (!active.has(s.state) && this.now() - s.requestedAt > retention) { s.state = 'deleted'; delete s.segments; delete s.suggestions; this.persist() }
    }
  }
  async request (context: CaptureContext): Promise<CaptureSession> {
    await this.tick()
    this.compactDeleted()
    fail(this.workerState() === 'ready', 409, 'The local capture worker is unavailable or busy')
    fail(this.store.sessions.length < 200, 409, 'Capture history limit reached')
    const roster = await this.deps.roster(context)
    fail(roster.length > 0 && roster.length <= captureLimits.maxParticipants && roster.some(p => p.personId === context.personId), 403, 'Join this meeting before requesting notes (maximum eight people)')
    fail(new Set(roster.map(p => p.personId)).size === roster.length, 409, 'Participant identities are ambiguous')
    const id = randomUUID()
    const s: CaptureSession = { ...context, id, revision: 1, state: 'pending', requestedBy: context.personId, requestedAt: this.now(), participants: roster.map(p => ({ ...p, consent: 'pending' })), workerIdentity: 'chief-capture-' + id }
    this.store.sessions.push(s); this.persist(); return s
  }
  async consent (s: CaptureSession, context: CaptureContext, revision: unknown, accept: unknown): Promise<void> {
    this.authorize(s, context); fail(revision === s.revision && typeof accept === 'boolean', 409, 'Consent revision is stale')
    fail(s.state === 'pending', 409, 'This consent request has ended')
    if (!await this.unchanged(s)) { await this.end(s, 'Attendance or room authorization changed'); throw new CaptureError(409, 'Request fresh consent after attendance changed') }
    const person = s.participants.find(p => p.personId === context.personId)!
    const choice = accept ? 'accepted' : 'declined'
    fail(person.consent === 'pending' || person.consent === choice, 409, 'Consent already recorded; use Stop to withdraw')
    person.consent = choice; this.persist()
    if (!accept) await this.end(s, 'A participant declined capture')
    else if (s.participants.every(p => p.consent === 'accepted')) {
      fail(this.worker != null && this.worker.ready && this.now() - this.worker.at <= captureLimits.leaseMs, 409, 'Capture worker is unavailable')
      s.state = 'starting'; s.workerId = this.worker.id; this.persist()
    }
  }
  async stop (s: CaptureSession, context: CaptureContext, revision: unknown): Promise<void> {
    this.authorize(s, context); fail(revision === s.revision, 409, 'Capture revision is stale')
    await this.end(s, 'A participant stopped capture')
  }
  async delete (s: CaptureSession, context: CaptureContext): Promise<void> {
    this.authorize(s, context); fail(s.requestedBy === context.personId, 403, 'Only the requester can delete this capture')
    s.state = 'deleted'; s.stoppedAt ??= this.now(); delete s.segments; delete s.suggestions; this.persist()
    await this.deps.remove(s.roomName, s.workerIdentity)
  }
  async retry (s: CaptureSession, context: CaptureContext, revision: unknown): Promise<void> {
    this.authorize(s, context)
    fail(s.requestedBy === context.personId, 403, 'Only the requester can retry transcription')
    fail(s.revision === revision && s.state === 'failed' && s.startedAt != null && s.durationMs != null && this.now() - s.requestedAt < 72 * 3600000, 409, 'This capture cannot be retried')
    fail(this.workerState() === 'ready', 409, 'The local worker is unavailable or busy')
    s.state = 'processing'; s.workerId = this.worker!.id; s.retryQueued = true; s.reason = 'Retrying retained audio transcription'; this.persist()
  }
  async attendance (roomName: string, event: string, identity?: string, sid?: string): Promise<void> {
    const worker = this.store.sessions.find(s => s.roomName === roomName && s.workerIdentity === identity)
    if (worker != null && event === 'participant_joined' && !['starting', 'capturing'].includes(worker.state)) await this.deps.remove(roomName, worker.workerIdentity)
    for (const s of this.store.sessions.filter(s => s.roomName === roomName && listening.has(s.state))) {
      if (identity === s.workerIdentity) {
        if (event === 'participant_left' && s.state === 'capturing') await this.end(s, 'Capture worker disconnected')
      } else if (event === 'room_finished' || event === 'participant_left' || (event === 'participant_joined' && !s.participants.some(p => p.identity === identity && p.sid === sid))) {
        await this.end(s, 'Attendance changed')
      }
    }
  }
  async poll (body: Record<string, any>): Promise<Record<string, unknown>> {
    exactBody(body, ['workerId', 'ready', 'model', 'activeSessionId', 'phase', 'durationMs', 'bytes'])
    const workerId = captureId(body.workerId)
    fail(typeof body.ready === 'boolean' && typeof body.model === 'string' && body.model.length <= 160, 400, 'Invalid worker state')
    fail(this.worker == null || this.worker.id === workerId || this.now() - this.worker.at > captureLimits.leaseMs, 409, 'Another worker owns the lease')
    // Check expiry before renewing, so a recovered worker cannot revive missed consent.
    await this.tick()
    this.worker = { id: workerId, ready: body.ready, model: body.model, at: this.now() }
    for (const s of this.store.sessions.filter(s => s.workerId === workerId && s.state === 'capturing' && s.id !== body.activeSessionId)) await this.end(s, 'Worker lost its active capture')
    const result = (command: Record<string, unknown>): Record<string, unknown> => ({ serverTime: this.now(), leaseUntil: this.now() + captureLimits.leaseMs, command })
    const deleted = this.store.sessions.find(s => s.state === 'deleted' && !s.deletedAck)
    if (deleted != null) return result({ kind: 'delete', sessionId: deleted.id, revision: deleted.revision })
    if (body.activeSessionId != null) {
      const s = this.store.sessions.find(s => s.id === body.activeSessionId)
      if (s == null || s.workerId !== workerId || !active.has(s.state)) return result({ kind: 'stop', sessionId: captureId(body.activeSessionId), reason: 'No active authorization' })
      if (body.bytes != null || body.durationMs != null) {
        fail(Number.isSafeInteger(body.bytes) && body.bytes >= 0 && Number.isSafeInteger(body.durationMs) && body.durationMs >= 0, 400, 'Invalid capture counters')
        fail(body.bytes >= (s.bytes ?? 0) && body.durationMs >= (s.durationMs ?? 0), 409, 'Capture counters cannot decrease')
        if (s.state === 'capturing') {
          s.bytes = Math.min(body.bytes, captureLimits.maxBytes); s.durationMs = Math.min(body.durationMs, captureLimits.maxDurationMs); this.persist()
          if (body.bytes >= captureLimits.maxBytes || body.durationMs >= captureLimits.maxDurationMs) await this.end(s, 'Meeting capture reached its storage or duration limit')
        }
      }
      if (s.state === 'stopping') return result({ kind: 'stop', sessionId: s.id, reason: s.reason })
      return result({ kind: 'idle' })
    }
    const retry = this.store.sessions.find(s => s.state === 'processing' && s.retryQueued && s.workerId === workerId)
    if (retry != null) return result({ kind: 'transcribe', sessionId: retry.id, revision: retry.revision, durationMs: retry.durationMs, participants: retry.participants.map(({ personId, name }) => ({ personId, name })), limits: captureLimits })
    const s = this.store.sessions.find(s => s.state === 'starting' && s.workerId === workerId)
    if (s != null) {
      if (!await this.unchanged(s)) { await this.end(s, 'Attendance or room authorization changed'); return result({ kind: 'stop', sessionId: s.id, reason: s.reason }) }
      s.expiresAt ??= this.now() + captureLimits.leaseMs; this.persist()
      if (s.expiresAt <= this.now()) { await this.end(s, 'Capture connection lease expired'); return result({ kind: 'stop', sessionId: s.id, reason: s.reason }) }
      return result({ kind: 'capture', sessionId: s.id, revision: s.revision, workspace: s.workspace, meetingId: s.meetingId, roomName: s.roomName, identity: s.workerIdentity, token: await this.deps.token(s, s.expiresAt), expiresAt: s.expiresAt, participants: s.participants.map(({ personId, name, identity, sid }) => ({ personId, name, identity, sid })), limits: captureLimits })
    }
    return result({ kind: 'idle' })
  }
  async event (body: Record<string, any>): Promise<void> {
    exactBody(body, ['workerId', 'sessionId', 'revision', 'type', 'durationMs', 'bytes', 'segments', 'reason'])
    const s = this.store.sessions.find(s => s.id === captureId(body.sessionId))
    fail(s != null && s.revision === body.revision, 409, 'Capture session or revision is stale')
    fail(this.worker != null && this.worker.id === body.workerId && this.now() - this.worker.at <= captureLimits.leaseMs, 403, 'Worker lease expired')
    if (body.type === 'deleted') { fail(s.state === 'deleted', 409, 'Deletion was not requested'); s.deletedAck = true; this.persist(); return }
    fail(s.workerId === body.workerId && s.state !== 'deleted', 409, 'Worker does not own this capture')
    if (body.type === 'connected') {
      if (s.state === 'capturing') {
        if (!await this.unchanged(s)) { await this.end(s, 'Attendance or room authorization changed'); throw new CaptureError(409, 'Attendance changed') }
        return
      }
      fail(s.state === 'starting' && (s.expiresAt ?? 0) > this.now(), 409, 'Capture cannot connect')
      if (!await this.unchanged(s)) { await this.end(s, 'Attendance or room authorization changed'); throw new CaptureError(409, 'Attendance changed') }
      s.startedAt = this.now(); s.state = 'capturing'; this.persist(); return
    }
    if (body.type === 'stopped') {
      fail(['capturing', 'starting', 'stopping', 'processing'].includes(s.state), 409, 'Capture already ended')
      fail(Number.isSafeInteger(body.durationMs) && body.durationMs >= 0 && body.durationMs <= captureLimits.maxDurationMs && Number.isSafeInteger(body.bytes) && body.bytes >= 0 && body.bytes <= captureLimits.maxBytes, 400, 'Invalid capture bounds')
      if (s.state === 'processing') { fail(s.durationMs === Math.min(body.durationMs, Math.max(0, (s.stoppedAt ?? this.now()) - (s.startedAt ?? this.now()))) && s.bytes === body.bytes, 409, 'Conflicting completion'); return }
      await this.end(s, 'Capture worker stopped listening'); await this.deps.remove(s.roomName, s.workerIdentity)
      s.durationMs = Math.min(body.durationMs, Math.max(0, (s.stoppedAt ?? this.now()) - (s.startedAt ?? this.now()))); s.bytes = body.bytes; s.state = 'processing'; this.persist(); return
    }
    if (body.type === 'failed') { fail(active.has(s.state), 409, 'Capture already ended'); await this.end(s, 'Local capture or transcription failed'); await this.deps.remove(s.roomName, s.workerIdentity); s.state = 'failed'; s.reason = 'Local capture or transcription failed'; this.persist(); return }
    fail(body.type === 'transcript' && (s.state === 'processing' || s.state === 'ready'), 409, 'Transcript is not expected')
    fail(Array.isArray(body.segments) && body.segments.length <= 4000, 400, 'Transcript exceeds segment limit')
    const segments: Segment[] = body.segments.map((segment: any, index: number) => {
      exactBody(segment, ['personId', 'startMs', 'endMs', 'text'])
      const p = s.participants.find(p => p.personId === segment.personId)
      fail(p != null && typeof segment.text === 'string' && segment.text.length <= 4000 && Number.isSafeInteger(segment.startMs) && Number.isSafeInteger(segment.endMs) && segment.startMs >= 0 && segment.endMs >= segment.startMs && segment.endMs <= (s.durationMs ?? 0), 400, 'Invalid transcript speaker or interval')
      return { id: `${s.id}-${index}`, personId: p.personId, speaker: p.name, startMs: segment.startMs, endMs: segment.endMs, text: segment.text }
    })
    fail(Buffer.byteLength(JSON.stringify(segments)) <= 512 * 1024, 400, 'Transcript is too large')
    const hash = createHash('sha256').update(JSON.stringify(segments)).digest('hex')
    if (s.state === 'ready') { fail(hash === s.completionHash, 409, 'Conflicting transcript completion'); return }
    s.segments = segments; s.suggestions = segments.filter(s => /\b(?:decid(?:e|ed)|agreed|will|action item)\b/i.test(s.text)).slice(0, 100).map(seg => ({ id: 'suggestion-' + seg.id, kind: /\b(?:decid(?:e|ed)|agreed)\b/i.test(seg.text) ? 'decision' : 'action', text: seg.text, sourceSegmentId: seg.id, personId: seg.personId }))
    s.completionHash = hash; s.state = 'ready'; this.persist()
  }
}
