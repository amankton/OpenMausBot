import { atomicJson, digest } from './core.mjs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

export async function importSelected({ catalog, selected, home, request, protocol, modelSelection, roles = {} }) {
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(id => !catalog.agents.some(a => a.id === id))) throw Error('Invalid agent selection');
  const mappingFile = join(home, 'agent-mapping.json');
  let mapping = {}; try { mapping = JSON.parse(await readFile(mappingFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const response = await request('/api/bots'), bots = Array.isArray(response) ? response : response.bots;
  if (!Array.isArray(bots)) throw Error('Chief agent inventory is unavailable');
  const outcomes = [];
  for (const id of [...selected.filter(id => id !== roles.coordinator), ...selected.filter(id => id === roles.coordinator)]) {
    const role = catalog.agents.find(a => a.id === id), marker = `<!-- chief-catalog:${id} -->`;
    const matches = bots.filter(b => b.id === mapping[id]?.targetId || b.soul?.includes(marker));
    if (matches.length > 1) { outcomes.push({ id, state: 'conflict', message: 'More than one existing profile matches this catalog entry' }); continue; }
    if (matches.length === 1) {
      mapping[id] = { ...mapping[id], targetId: matches[0].id, revision: mapping[id]?.revision || role.revision };
      await atomicJson(mappingFile, mapping); outcomes.push({ id, state: 'existing', targetId: matches[0].id }); continue;
    }
    if (bots.some(b => b.name.toLowerCase() === role.name.toLowerCase())) { outcomes.push({ id, state: 'conflict', message: 'An existing agent has this name; it was preserved' }); continue; }
    mapping[id] = { revision: role.revision, state: 'pending', markerHash: digest(marker) }; await atomicJson(mappingFile, mapping);
    // The marker allows reconciliation after a committed POST loses its response.
    // Existing profiles are never overwritten, including customer-edited ones.
    const created = await request('/api/bots', { method: 'POST', body: { useDefaults: false, settings: {
      name: role.name, title: role.title, description: role.description, section: role.division, color: role.color,
      soul: `${role.soul}\n\n${protocol}\n\n${marker}`, cwd: join(home, 'work'), approvalMode: 'auto', notifications: true,
      ...(modelSelection ? { modelSelection } : {}),
      ...(id === roles.coordinator ? { chiefOfStaff: true } : {}),
    } } });
    const bot = created.bot || created; if (!bot.id) throw Error('Agent creation did not return an identity');
    bots.push(bot); mapping[id] = { targetId: bot.id, revision: role.revision, state: 'installed' }; await atomicJson(mappingFile, mapping);
    outcomes.push({ id, state: 'created', targetId: bot.id });
  }
  return outcomes;
}
