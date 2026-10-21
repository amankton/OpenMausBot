import { randomUUID } from 'node:crypto';
import { AccessError, exact, uuid } from './security.mjs';

const ID = /^[\w:-]{1,128}$/;
const issueClass = 'tracker:class:Issue', projectClass = 'tracker:class:Project';
const denied = () => { throw new AccessError(403, 'The current member cannot access this Tracker record'); };
const validId = value => typeof value === 'string' && ID.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !value.includes('\0');
export function trackerInput(operation, args) {
  const fields = { projects: ['name'], issues: ['projectId', 'title'], issue: ['projectId', 'issueId'],
    create_issue: ['projectId', 'title', 'description', 'requestId'],
    update_issue: ['projectId', 'issueId', 'title', 'description', 'status', 'requestId'] };
  if (!fields[operation]) throw new AccessError(400, 'Unsupported Tracker operation');
  exact(args, fields[operation]);
  if (operation !== 'projects' && !validId(args.projectId)) throw new AccessError(400, 'An exact projectId is required');
  if (['issue', 'update_issue'].includes(operation) && !validId(args.issueId)) throw new AccessError(400, 'An exact issueId is required');
  for (const [key, max] of [['name', 200], ['title', 240], ['description', 8000]]) {
    if (args[key] !== undefined && !text(args[key], max)) throw new AccessError(400, 'Invalid Tracker text');
  }
  if (operation === 'create_issue' && (!args.title?.trim() || typeof args.description !== 'string')) throw new AccessError(400, 'Title and description are required');
  if (operation === 'update_issue' && !['title', 'description', 'status'].some(k => args[k] !== undefined)) throw new AccessError(400, 'No issue changes supplied');
  if (args.status !== undefined && !validId(args.status)) throw new AccessError(400, 'Invalid status');
  if (operation.endsWith('_issue') && operation !== 'issue' && !uuid(args.requestId)) throw new AccessError(400, 'A stable requestId UUID is required for writes');
  return operation === 'create_issue' || operation === 'update_issue' ? 'tracker:write' : 'tracker:read';
}

// Ordinary member JWT only. Fixed configured services, bounded output and no
// automatic write retries; native Transactor middleware enforces record ACLs.
export class TrackerClient {
  constructor({ transactorUrl, collaboratorUrl, origin, fetcher = fetch }) {
    this.transactor = transactorUrl.replace(/\/$/, ''); this.collaborator = collaboratorUrl.replace(/\/$/, '');
    this.origin = origin; this.fetcher = fetcher;
  }
  async request(endpoint, path, token, body) {
    try {
      const response = await this.fetcher(endpoint + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!response.ok) { await response.body?.cancel(); throw new AccessError([401, 403].includes(response.status) ? 403 : 503, 'Member workspace request was refused or unavailable'); }
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 262144) throw Error(); chunks.push(chunk); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (value?.error) throw Error();
      return value;
    } catch (error) { if (error instanceof AccessError) throw error; throw new AccessError(503, 'Workspace result is unconfirmed; inspect saved state before retrying writes'); }
  }
  async find(ctx, cls, query, limit = 30) {
    await ctx.recheck();
    const params = new URLSearchParams({ class: cls, query: JSON.stringify(query), options: JSON.stringify({ limit }) });
    const result = await this.request(this.transactor, `/api/v1/find-all/${ctx.member.workspace}?${params}`, ctx.token);
    await ctx.recheck();
    const rows = result?.dataType === 'TotalArray' ? result.value : result;
    if (!Array.isArray(rows) || rows.length > limit) throw new AccessError(503, 'Invalid Tracker response');
    // REST responses compact values already fixed by the query. Reconstitute
    // those exact values as the Platform REST client does (not caller identity).
    return rows.map(row => {
      const restored = { ...row, _class: row._class ?? cls };
      for (const [key, value] of Object.entries(query)) if (restored[key] == null && ['string', 'number', 'boolean'].includes(typeof value)) restored[key] = value;
      return restored;
    });
  }
  async project(ctx, id) {
    const [project] = await this.find(ctx, projectClass, { _id: id }, 1);
    if (!project || project.archived || (project.private && !project.members?.includes(ctx.member.account))) denied();
    return project;
  }
  async rawIssue(ctx, projectId, issueId) {
    await this.project(ctx, projectId);
    const [issue] = await this.find(ctx, issueClass, { _id: issueId, space: projectId }, 1);
    return issue;
  }
  async markup(ctx, id, method, payload) {
    await ctx.recheck();
    const document = [ctx.member.workspace, issueClass, id, 'description'].join('|');
    const result = await this.request(this.collaborator, '/rpc/' + encodeURIComponent(document), ctx.token, { method, payload });
    await ctx.recheck(); return result.content?.description;
  }
  async view(ctx, issue, project) {
    const markup = issue.description ? await this.markup(ctx, issue._id, 'getContent', { source: issue.description }) : '';
    let description = '';
    if (markup) {
      try { const collect = node => typeof node?.text === 'string' ? node.text : (node?.content ?? []).map(collect).join(node?.type === 'doc' ? '\n' : ''); description = collect(JSON.parse(markup)); }
      catch { throw new AccessError(503, 'Issue description could not be decoded'); }
    }
    return { id: issue._id, identifier: issue.identifier, title: issue.title, description, status: issue.status,
      projectId: project._id, projectName: project.name,
      url: `${this.origin}/workbench/${encodeURIComponent(ctx.workspaceSlug)}/tracker/${encodeURIComponent(issue.identifier)}` };
  }
  tx(ctx, cls, objectId, objectSpace, extra) {
    if (!validId(ctx.member.socialId)) throw new AccessError(403, 'Current member social identity is unavailable');
    return { _id: randomUUID().replaceAll('-', '').slice(0, 24), _class: cls, space: 'core:space:Tx',
      objectId, objectSpace, modifiedBy: ctx.member.socialId, modifiedOn: Date.now(), ...extra };
  }
  async write(ctx, tx) {
    await ctx.recheck();
    const result = await this.request(this.transactor, '/api/v1/tx/' + ctx.member.workspace, ctx.token, tx);
    await ctx.recheck(); return result;
  }
  async run(ctx, operation, args, objectId) {
    trackerInput(operation, args);
    if (operation === 'projects') return { projects: (await this.find(ctx, projectClass, { archived: false, ...(args.name ? { name: args.name } : {}) })).filter(p => !p.private || p.members?.includes(ctx.member.account)).map(p => ({ id: p._id, name: p.name, identifier: p.identifier })) };
    const project = await this.project(ctx, args.projectId);
    if (operation === 'issues') return { issues: (await this.find(ctx, issueClass, { space: project._id, ...(args.title ? { title: args.title } : {}) })).map(i => ({ id: i._id, identifier: i.identifier, title: i.title, status: i.status })) };
    if (operation === 'issue') {
      const issue = await this.rawIssue(ctx, project._id, args.issueId); if (!issue) denied();
      return this.view(ctx, issue, project);
    }
    if (operation === 'create_issue') {
      const found = await this.find(ctx, issueClass, { _id: objectId, space: project._id }, 1);
      if (found[0]) return this.view(ctx, found[0], project);
      const duplicate = await this.find(ctx, issueClass, { space: project._id, title: args.title }, 2);
      if (duplicate.length) throw new AccessError(409, 'An issue with this exact title already exists; read it instead of creating a duplicate');
      const kinds = await this.find(ctx, 'task:class:TaskType', { parent: project.type, ofClass: issueClass }, 10);
      const kind = kinds.find(k => k.statuses?.includes(project.defaultIssueStatus)) ?? kinds[0];
      const status = project.defaultIssueStatus ?? kind?.statuses?.[0];
      if (!kind || !validId(status)) throw new AccessError(409, 'Project issue type or default status is unavailable');
      const description = await this.markup(ctx, objectId, 'createContent', { content: { description: JSON.stringify({ type: 'doc', content: args.description.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) }) } });
      if (typeof description !== 'string') throw new AccessError(503, 'Description storage is unavailable');
      const sequence = await this.write(ctx, this.tx(ctx, 'core:class:TxUpdateDoc', project._id, project.space, { objectClass: projectClass, operations: { $inc: { sequence: 1 } }, retrieve: true }));
      const number = sequence?.object?.sequence;
      if (!Number.isSafeInteger(number) || number < 1) throw new AccessError(503, 'Issue number allocation is unconfirmed');
      await this.write(ctx, this.tx(ctx, 'core:class:TxCreateDoc', objectId, project._id, { objectClass: issueClass, createdBy: ctx.member.socialId,
        attachedTo: 'tracker:ids:NoParent', attachedToClass: issueClass, collection: 'subIssues',
        attributes: { title: args.title, description, number, identifier: `${project.identifier}-${number}`, status, priority: 0,
          assignee: null, component: null, milestone: null, rank: '', comments: 0, subIssues: 0, parents: [], reportedTime: 0,
          remainingTime: 0, estimation: 0, reports: 0, relations: [], childInfo: [], kind: kind._id } }));
      const saved = await this.rawIssue(ctx, project._id, objectId); if (!saved) throw new AccessError(503, 'Created issue readback is unconfirmed');
      return this.view(ctx, saved, project);
    }
    const issue = await this.rawIssue(ctx, project._id, args.issueId); if (!issue) denied();
    const changes = {};
    if (args.title !== undefined) { if (!args.title.trim()) throw new AccessError(400, 'Title cannot be empty'); changes.title = args.title; }
    if (args.status !== undefined) {
      const [kind] = await this.find(ctx, 'task:class:TaskType', { _id: issue.kind }, 1);
      if (!kind?.statuses?.includes(args.status)) throw new AccessError(400, 'Status is not allowed for this issue type');
      changes.status = args.status;
    }
    if (args.description !== undefined) throw new AccessError(400, 'Description updates are not supported yet; create descriptions and title/status updates are available');
    await this.write(ctx, this.tx(ctx, 'core:class:TxUpdateDoc', issue._id, project._id, { objectClass: issueClass, operations: changes }));
    return this.view(ctx, await this.rawIssue(ctx, project._id, issue._id), project);
  }
}
