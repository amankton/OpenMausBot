import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TrackerClient, trackerInput } from './tracker.mjs';
import { AccessError } from './security.mjs';

test('Tracker schemas reject arbitrary routes, fields, workspaces and unstable write IDs', () => {
  assert.equal(trackerInput('projects', {}), 'tracker:read');
  assert.equal(trackerInput('create_issue', { projectId: 'project', title: 'Title', description: 'Text', requestId: randomUUID() }), 'tracker:write');
  for (const [op, args] of [['delete_issue', {}], ['issue', { projectId: '../other', issueId: 'x' }], ['projects', { token: 'secret' }], ['projects', { workspace: randomUUID() }], ['create_issue', { projectId: 'p', title: 'T', description: '', requestId: 'retry' }]]) assert.throws(() => trackerInput(op, args), AccessError);
});

test('ordinary member access, private space isolation, saved markup readback and no write retry', async () => {
  const account = randomUUID(), workspace = randomUUID();
  const project = { _id: 'project', space: 'core:space:Space', name: 'Synthetic project', identifier: 'FIX', sequence: 0, type: 'project-kind', defaultIssueStatus: 'todo', private: true, members: [account] };
  const issues = new Map(); let creates = 0, rechecks = 0; let failWrite = false; let markup = '';
  const client = new TrackerClient({ origin: 'http://localhost:18087', transactorUrl: 'http://transactor', collaboratorUrl: 'http://collaborator', fetcher: async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer ordinary-member-fixture');
    assert.equal(init.redirect, 'error'); assert.ok(String(url).includes(workspace));
    if (String(url).startsWith('http://collaborator')) {
      const body = JSON.parse(init.body);
      if (body.method === 'createContent') { markup = body.payload.content.description; return Response.json({ content: { description: 'markup-ref' } }); }
      return Response.json({ content: { description: markup } });
    }
    if (String(url).includes('find-all')) {
      const u = new URL(url), cls = u.searchParams.get('class'), query = JSON.parse(u.searchParams.get('query'));
      if (cls === 'tracker:class:Project') return Response.json({ dataType: 'TotalArray', value: [project] });
      if (cls === 'task:class:TaskType') return Response.json([{ _id: 'kind', statuses: ['todo'] }]);
      return Response.json([...issues.values()].filter(i => (!query._id || i._id === query._id) && (!query.title || i.title === query.title) && i.space === query.space));
    }
    const tx = JSON.parse(init.body);
    if (tx.objectClass === 'tracker:class:Project') return Response.json({ object: { sequence: ++project.sequence } });
    creates++; if (failWrite) throw Error('network lost');
    issues.set(tx.objectId, { _id: tx.objectId, space: tx.objectSpace, ...tx.attributes });
    assert.equal(tx.modifiedBy, 'member-social-id');
    return Response.json({});
  } });
  const ctx = { member: { account, workspace, socialId: 'member-social-id' }, token: 'ordinary-member-fixture', workspaceSlug: 'synthetic', recheck: async () => { rechecks++; } };
  const args = { projectId: 'project', title: 'Task', description: 'Saved test description', requestId: randomUUID() };
  const result = await client.run(ctx, 'create_issue', args, 'deterministic-id');
  assert.equal(result.description, args.description); assert.equal(result.identifier, 'FIX-1'); assert.equal(creates, 1); assert.ok(rechecks > 5);
  assert.deepEqual(await client.run(ctx, 'create_issue', args, 'deterministic-id'), result); assert.equal(creates, 1);
  await assert.rejects(() => client.run(ctx, 'create_issue', args, 'other-id'), e => e.status === 409);
  const other = { ...ctx, member: { ...ctx.member, account: randomUUID() } };
  assert.deepEqual(await client.run(other, 'projects', {}), { projects: [] });
  await assert.rejects(() => client.run(other, 'issue', { projectId: 'project', issueId: 'deterministic-id' }), e => e.status === 403);
  failWrite = true;
  await assert.rejects(() => client.run(ctx, 'create_issue', { ...args, title: 'Other task' }, 'uncertain-id'), e => e.status === 503);
  assert.equal(creates, 2);
});
