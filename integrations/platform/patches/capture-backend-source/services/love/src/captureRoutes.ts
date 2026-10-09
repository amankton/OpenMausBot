// Chief explicit-consent meeting capture. EPL-2.0; see upstream LICENSE.
import express, { type Request, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { getClient as accounts, isWorkspaceLoginInfo } from '@hcengineering/account-client'
import contact, { type Employee } from '@hcengineering/contact'
import { AccountRole, systemAccountUuid, type AccountUuid, type WorkspaceUuid, type Ref, type MeasureContext } from '@hcengineering/core'
import love, { RoomAccess, type MeetingMinutes, type Room, type Office } from '@hcengineering/love'
import { generateToken } from '@hcengineering/server-token'
import platform, { PlatformError } from '@hcengineering/platform'
import { AccessToken, type RoomServiceClient } from 'livekit-server-sdk'
import { MeetingAdmission, AdmissionError, readReceipt } from './admission'
import { getClient } from './client'
import config from './config'
import { WorkspaceClient } from './workspaceClient'
import { extractToken, getRoomName } from './utils'
import { CaptureError, CaptureStore, MeetingCapture, captureLimits, captureId, exactBody, publicSession, type CaptureContext, type CapturePerson } from './capture'

export async function installCapture (app: express.Express, rooms: RoomServiceClient, ctx: MeasureContext): Promise<{ check: () => Promise<void>, attendance: (room: string, event: string, identity?: string, sid?: string) => Promise<void>, close: () => Promise<void> }> {
  const enabled = config.CaptureDirectory !== '' && config.CaptureWorkerSecret.length >= 32 && config.CaptureWorkerSecret !== config.Secret && config.CaptureWorkerSecret !== config.ApiSecret
  const member = async (token: string): Promise<MeetingAdmission> => {
    // Both calls resolve membership from the account database, not cached JWT role claims.
    const ac = accounts(config.AccountsURL, token)
    const login = await ac.getLoginInfoByToken()
    if (!isWorkspaceLoginInfo(login) || login.account === systemAccountUuid || ![AccountRole.User, AccountRole.Maintainer, AccountRole.Owner, AccountRole.Admin, AccountRole.Guest].includes(login.role)) throw new CaptureError(403, 'A current workspace member is required')
    const memberships = await ac.getWorkspaceMembers()
    if (!memberships.some(m => m.person === login.account && m.role === login.role)) throw new CaptureError(403, 'Workspace membership changed')
    const caller = await getClient(token, login.workspace)
    const ws = await WorkspaceClient.create(login.workspace, ctx)
    return new MeetingAdmission(login, caller, ws.getAdmissionClient(), config.Secret)
  }
  const context = async (admission: MeetingAdmission, meetingId: string, current: boolean): Promise<CaptureContext> => {
    const person = await admission.actor()
    const meeting = await admission.caller.findOne(love.class.MeetingMinutes, { _id: meetingId as Ref<MeetingMinutes> })
    if (meeting == null) throw new CaptureError(403, 'Meeting access is unavailable')
    const room = await admission.caller.findOne(love.class.Room, { _id: meeting.attachedTo as Ref<Room> })
    if (room == null || room.access === RoomAccess.DND || meeting.access === RoomAccess.DND) throw new CaptureError(403, 'Room access is unavailable')
    if (current) await admission.requireJoin(meeting._id)
    else if (!((room as Office).person === person._id || await admission.authority(person._id, meeting, room) || (room.access === RoomAccess.Open && meeting.access === RoomAccess.Open && (admission.auth.role !== AccountRole.Guest || (room as Office).person == null)))) {
      const invitations = await admission.system.findAll(love.class.UserMeetingInvite, { meeting: meeting._id, kind: 'invite-request', status: 'accepted' })
      if (!invitations.some(invite => {
        const proof = readReceipt(invite.admission, config.Secret)
        return proof?.state === 'accepted' && proof.workspace === admission.auth.workspace && proof.request === invite._id && proof.meeting === meeting._id && proof.room === room._id && proof.from === invite.from && proof.to === invite.to && (proof.from === person._id || proof.to === person._id)
      })) throw new CaptureError(403, 'Current room permission is required')
    }
    return { workspace: admission.auth.workspace, meetingId, roomName: getRoomName(admission.auth.workspace, meeting._id), title: meeting.title, personId: person._id }
  }
  let engine: MeetingCapture | undefined
  const remove = async (roomName: string, identity: string): Promise<void> => {
    if ((await rooms.listRooms([roomName])).length === 0) return
    if ((await rooms.listParticipants(roomName)).some(p => p.identity === identity)) await rooms.removeParticipant(roomName, identity)
  }
  const roster = async (c: Pick<CaptureContext, 'workspace' | 'meetingId' | 'roomName'>): Promise<CapturePerson[]> => {
    if ((await rooms.listRooms([c.roomName])).length === 0) return []
    const participants = await rooms.listParticipants(c.roomName)
    const system = (await WorkspaceClient.create(c.workspace as WorkspaceUuid, ctx)).getAdmissionClient()
    const result: CapturePerson[] = []
    for (const p of participants) {
      const ownWorker = engine?.store.sessions.find(s => s.workspace === c.workspace && s.meetingId === c.meetingId && s.workerIdentity === p.identity)
      if (ownWorker != null) {
        if (!['starting', 'capturing'].includes(ownWorker.state)) await remove(c.roomName, p.identity)
        continue
      }
      const person = await system.findOne(contact.mixin.Employee, { _id: p.identity as Ref<Employee>, active: true })
      if (person?.personUuid == null || !p.sid) throw new CaptureError(403, 'Every connected participant must be a current member')
      // A short internal person token enables the same caller-scoped ACL reads for roster revalidation.
      // It is never persisted, returned, or passed to LiveKit/the capture worker.
      const token = generateToken(person.personUuid as AccountUuid, c.workspace as WorkspaceUuid, {})
      const admission = await member(token)
      const verified = await context(admission, c.meetingId, true)
      if (verified.personId !== person._id) throw new CaptureError(403, 'Participant identity changed')
      result.push({ personId: person._id, account: person.personUuid, name: person.name, identity: p.identity, sid: p.sid })
    }
    return result.sort((a, b) => a.identity.localeCompare(b.identity))
  }
  if (enabled) {
    engine = new MeetingCapture(new CaptureStore(config.CaptureDirectory), {
      roster, remove,
      token: async (s, expiresAt) => {
        const token = new AccessToken(config.ApiKey, config.ApiSecret, { identity: s.workerIdentity, name: 'Meeting notes (consented)', ttl: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)) })
        token.addGrant({ roomJoin: true, room: s.roomName, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false })
        return await token.toJwt()
      }
    })
    await engine.recover()
  }
  const router = express.Router()
  router.use(express.json({ limit: '768kb', strict: true }))
  const failure = (res: Response, e: unknown): void => {
    if (e instanceof PlatformError) {
      if ([platform.status.Unauthorized, platform.status.TokenExpired, platform.status.TokenNotActive].includes(e.status.code)) { res.status(401).json({ error: 'A current workspace sign-in is required' }); return }
      if ([platform.status.Forbidden, platform.status.AccountNotFound, platform.status.WorkspaceNotFound].includes(e.status.code)) { res.status(403).json({ error: 'Workspace access is unavailable' }); return }
    }
    const known = e instanceof CaptureError || e instanceof AdmissionError
    res.status(known ? e.status : 503).json({ error: known ? e.message : 'Meeting notes are temporarily unavailable' })
  }
  const route = (action: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response): void => { void action(req, res).catch(e => failure(res, e)) }
  const signedIn = async (req: Request): Promise<MeetingAdmission> => { const token = extractToken(req.headers); if (token == null) throw new CaptureError(401, 'Sign in to your workspace'); return await member(token) }
  const requireEngine = (): MeetingCapture => { if (engine == null) throw new CaptureError(503, 'Local meeting notes are not configured'); return engine }
  const workerAuth = (req: Request): void => {
    const supplied = Buffer.from(extractToken(req.headers) ?? '')
    const expected = Buffer.from(config.CaptureWorkerSecret)
    if (!enabled || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new CaptureError(401, 'Worker authentication required')
  }
  router.post('/worker/poll', route(async (req, res) => { workerAuth(req); const e = requireEngine(); res.json(await e.serial(async () => await e.poll(req.body))) }))
  router.post('/worker/event', route(async (req, res) => { workerAuth(req); const e = requireEngine(); await e.serial(async () => { await e.event(req.body); res.json({ ok: true, durationMs: req.body.type === 'stopped' ? e.find(req.body.sessionId).durationMs : undefined }) }) }))
  router.get('/status', route(async (req, res) => {
    const a = await signedIn(req); const c = await context(a, captureId(req.query.meetingId), false)
    if (engine == null) { res.json({ available: false, reason: 'Local meeting notes are not configured', worker: { state: 'offline' }, selfPersonId: c.personId, joined: false, limits: captureLimits }); return }
    const e = engine
    await e.serial(async () => {
      await e.tick()
      let joined = false; try { joined = (await roster(c)).some(p => p.personId === c.personId) } catch {}
      const sessions = e.store.sessions.filter(s => s.state !== 'deleted' && s.workspace === c.workspace && s.meetingId === c.meetingId && s.participants.some(p => p.personId === c.personId))
      const latest = sessions[sessions.length - 1]
      const state = e.workerState()
      res.json({ available: state !== 'offline', reason: state === 'offline' ? 'The local notes worker is offline' : undefined, worker: { state }, selfPersonId: c.personId, joined, session: latest == null ? undefined : publicSession(latest), limits: captureLimits })
    })
  }))
  router.get('/history', route(async (req, res) => {
    const a = await signedIn(req); const c = await context(a, captureId(req.query.meetingId), false); const e = requireEngine()
    await e.serial(async () => { res.json({ sessions: e.store.sessions.filter(s => s.state !== 'deleted' && s.workspace === c.workspace && s.meetingId === c.meetingId && s.participants.some(p => p.personId === c.personId)).map(s => { const view = publicSession(s); delete view.segments; delete view.suggestions; return view }) }) })
  }))
  router.post('/request', route(async (req, res) => {
    exactBody(req.body, ['meetingId']); const a = await signedIn(req); const c = await context(a, captureId(req.body.meetingId), true); const e = requireEngine()
    res.json(await e.serial(async () => ({ session: publicSession(await e.request(c)) })))
  }))
  for (const operation of ['consent', 'stop', 'retry', 'read', 'delete']) {
    const handler = route(async (req, res) => {
      if (!['read', 'delete'].includes(operation)) exactBody(req.body, operation === 'consent' ? ['sessionId', 'revision', 'accept'] : ['sessionId', 'revision'])
      const a = await signedIn(req); const e = requireEngine()
      await e.serial(async () => {
        const s = e.find(captureId(['read', 'delete'].includes(operation) ? req.params.sessionId : req.body.sessionId))
        if (s.workspace !== a.auth.workspace) throw new CaptureError(403, 'Capture workspace mismatch')
        const c = await context(a, s.meetingId, operation === 'consent'); e.authorize(s, c)
        if (operation === 'consent') await e.consent(s, c, req.body.revision, req.body.accept)
        if (operation === 'stop') await e.stop(s, c, req.body.revision)
        if (operation === 'retry') await e.retry(s, c, req.body.revision)
        if (operation === 'delete') await e.delete(s, c)
        res.json({ session: publicSession(s) })
      })
    })
    if (operation === 'read') router.get('/session/:sessionId', handler)
    else if (operation === 'delete') router.delete('/session/:sessionId', handler)
    else router.post('/' + operation, handler)
  }
  app.use('/capture', router)
  const check = async (): Promise<void> => { if (engine != null) await engine.serial(async () => { await engine!.tick() }) }
  const timer = setInterval(() => { void check().catch(() => { ctx.warn('Meeting capture safety check failed') }) }, 2000)
  timer.unref()
  return { check, attendance: async (room, event, identity, sid) => { if (engine != null) await engine.serial(async () => { await engine!.attendance(room, event, identity, sid) }) }, close: async () => {
    clearInterval(timer)
    if (engine != null) await engine.serial(async () => { await engine!.recover() })
  } }
}
