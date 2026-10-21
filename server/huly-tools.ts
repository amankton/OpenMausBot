import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ChiefPairingRuntime } from './chief-pairing.ts';
import { PAIRING_PRIVATE_DIRECTORY, PAIRING_PRIVATE_FILE } from './chief-pairing-storage.ts';
import { SPAWNED_PROXIES } from './proxy-paths.ts';

export function hulyIntegration(directory: string, origin: string | undefined, botId: string) {
  if (!origin || !existsSync(join(directory, PAIRING_PRIVATE_DIRECTORY, PAIRING_PRIVATE_FILE))) return undefined;
  const runtime = new ChiefPairingRuntime({ directory, origin, hasBot: id => id === botId });
  if (!runtime.list().some(c => c.state === 'active' && c.bots.includes(botId) && c.scopes.includes('tracker:read') && Date.parse(c.expiresAt) > Date.now())) return undefined;
  return { command: process.execPath, args: [SPAWNED_PROXIES.huly], env: { ELECTRON_RUN_AS_NODE: '1',
    CHIEF_HULY_DIRECTORY: directory, CHIEF_HULY_ORIGIN: origin, CHIEF_HULY_BOT: botId } };
}

const id = { type: 'string', pattern: '^[\\w:-]{1,128}$' };
const requestId = { type: 'string', format: 'uuid' };
const parameters = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: { connectionId: { type: 'string', format: 'uuid' }, ...properties }, required: ['connectionId', ...required], additionalProperties: false });
export const hulyToolDefinitions = [
  { name: 'connections', description: 'List this agent’s active member-scoped Huly Tracker connections. Choose an exact connectionId; do not use Local VM/browser tools for Huly.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'projects', description: 'List up to 30 visible existing Huly Tracker projects, optionally by exact name. No project creation.', inputSchema: parameters({ name: { type: 'string', maxLength: 200 } }, []) },
  { name: 'issues', description: 'Find up to 30 issues in an exact existing project, optionally by exact title. Search before creating to avoid duplicates.', inputSchema: parameters({ projectId: id, title: { type: 'string', maxLength: 240 } }, ['projectId']) },
  { name: 'issue', description: 'Read saved Huly issue title, description, identifier, project, status and direct link as the current member.', inputSchema: parameters({ projectId: id, issueId: id }, ['projectId', 'issueId']) },
  { name: 'create_issue', description: 'Create one Huly issue with plain-text description in an existing project using default status and no assignee. Reuse the same requestId with identical arguments; never retry an uncertain write with a new ID. Returns saved readback.', inputSchema: parameters({ projectId: id, title: { type: 'string', minLength: 1, maxLength: 240 }, description: { type: 'string', maxLength: 8000 }, requestId }, ['projectId', 'title', 'description', 'requestId']) },
  { name: 'update_issue', description: 'Update only title/status of an existing Huly issue as the paired member. Requires a stable requestId and exact projectId/issueId. No deletes, moves, membership or permission changes.', inputSchema: parameters({ projectId: id, issueId: id, title: { type: 'string', minLength: 1, maxLength: 240 }, status: id, requestId }, ['projectId', 'issueId', 'requestId']) },
];
