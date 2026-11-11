const $ = id => document.getElementById(id);
const steps = [
  ['toolchain', 'Install private toolchain', 'Pinned pnpm and uv; no global package-manager replacement.'],
  ['docker', 'Check or install Docker Desktop', 'Finish any native license, WSL or restart steps, then retry this check.'],
  ['personal', 'Build personal Chief', 'Install locked app dependencies and build the full browser interface.'],
  ['hermes', 'Install Hermes and Chief tools', 'Private Python environment and the matching Chief plugin.'],
  ['workspace', 'Prepare shared workspace', 'Download pinned Linux images and build the bundled Chief overlays. This can be a large download.'],
  ['lifecycle', 'Install member provisioning and budgets', 'Initialize private databases and lifecycle policy. Verified members receive individual profiles; each background workflow shares 20 provider requests and 10 minutes of active work.'],
  ['start', 'Start both environments', 'New isolated storage, accounts and local ports.'],
  ['agents', 'Install selected agents', 'Add profiles without overwriting existing agents or importing private history.'],
  ['reload', 'Apply AI connection changes', 'After Connect AI finishes, restart only this installation’s idle AI runtime and load your saved provider connection.'],
  ['startup', 'Set up login startup', 'Create this installation’s native login task. Also enable Docker Desktop login startup.'],
  ['verify', 'Verify installation', 'Check actual services and list the remaining workflow tests.'],
  ['desktop', 'Build native desktop package', 'Optional native NSIS or DMG/ZIP build. On Mac, finish Apple Command Line Tools first.'],
];
let agents = [], selected = new Set(), current = null, unsaved = false, roles = { coordinator: 'bacca', operator: 'solo' };
async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chief-Setup': '1' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Setup request failed'); return data;
}
async function action(fn) { $('error').textContent = ''; try { const result = await fn(); if (result?.message) $('notice').textContent = result.message; await refresh(); } catch (e) { $('error').textContent = e.message; } }
function shown() { const term = $('search').value.trim().toLowerCase(), division = $('division').value; return agents.filter(a => (!division || a.division === division) && `${a.name} ${a.description} ${a.title}`.toLowerCase().includes(term)); }
function renderCatalog() {
  const rows = shown(); $('catalog').replaceChildren(); $('empty').hidden = rows.length !== 0;
  for (const agent of rows) {
    const label = document.createElement('label'); label.className = 'agent';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(agent.id); input.disabled = !!current?.busy;
    input.addEventListener('change', () => { if (input.checked) selected.add(agent.id); else selected.delete(agent.id); unsaved = true; renderCount(); renderRoles(); });
    const text = document.createElement('span'), title = document.createElement('strong'), division = document.createElement('span'), detail = document.createElement('small');
    title.textContent = agent.name; division.textContent = agent.division; division.className = 'tag'; detail.textContent = agent.description || agent.title;
    text.append(title, division, detail); label.append(input, text); $('catalog').append(label);
  }
  renderCount();
  renderRoles();
}
function renderCount() { $('count').textContent = `${selected.size} selected`; $('role-status').textContent = selected.has(roles.coordinator) && selected.has(roles.operator) ? 'Coordinator and operator selected. Model/tool access and cross-division delegation still require explicit grants in Chief. Existing profiles are preserved.' : 'A required role is unassigned. Both spaces can be installed; the full proactive workflow is not ready.'; }
function renderRoles() { for (const key of ['coordinator', 'operator']) { const select = $(key); select.replaceChildren(); const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Not assigned'; select.append(blank); for (const a of agents.filter(a => selected.has(a.id))) { const option = document.createElement('option'); option.value = a.id; option.textContent = a.name; select.append(option); } if (!selected.has(roles[key])) roles[key] = ''; select.value = roles[key]; } }
function renderSteps() {
  for (const [id, title, hint] of steps) {
    const existing = document.getElementById('step-' + id);
    if (existing) { existing.querySelector('p').textContent = current.state.steps[id]?.message || hint; const badge = existing.querySelector('.status'); badge.textContent = current.state.steps[id]?.state || 'not installed'; badge.className = 'status' + (badge.textContent === 'failed' ? ' failed' : ''); existing.querySelector('button').disabled = current.busy || !current.supported; continue; }
    const li = document.createElement('li'); li.className = 'step'; const text = document.createElement('div'), heading = document.createElement('strong'), note = document.createElement('p'), status = document.createElement('span'), button = document.createElement('button');
    li.id = 'step-' + id;
    heading.textContent = title; note.textContent = current.state.steps[id]?.message || hint; status.textContent = current.state.steps[id]?.state || 'not installed'; status.className = 'status' + (status.textContent === 'failed' ? ' failed' : '');
    button.type = 'button'; button.textContent = current.state.steps[id] ? 'Check / retry' : 'Run step'; button.disabled = current.busy || !current.supported; button.setAttribute('aria-label', `${button.textContent}: ${title}`);
    button.addEventListener('click', () => action(async () => { if (unsaved) { await request('/api/selection', { selected: [...selected], roles }); unsaved = false; } return request('/api/action/' + id, {}); }));
    text.append(heading, note, status); li.append(text, button); $('steps').append(li);
  }
}
async function refresh() {
  current = await request('/api/status'); if (!unsaved) { selected = new Set(current.state.selected); roles = current.state.roles || roles; }
  $('machine').textContent = `${current.platform === 'darwin' ? 'macOS' : current.platform === 'win32' ? 'Windows' : current.platform} · ${current.arch} · Node ${current.node}${current.supported ? '' : ' · unsupported testing target'}`;
  $('location').textContent = 'Private installation state: ' + current.home; $('personal').href = current.urls.personal; $('shared').href = current.urls.shared;
  $('save').disabled = current.busy; $('connect').disabled = current.busy; $('install').disabled = current.busy; $('reload-ai').disabled = current.busy;
  if (current.state.verification) $('report').textContent = JSON.stringify(current.state.verification, null, 2);
  renderSteps();
}
async function init() {
  const capability = location.hash.slice(1); history.replaceState(null, '', '/');
  if (capability) await request('/api/session', { capability });
  agents = (await request('/api/catalog')).agents;
  for (const division of [...new Set(agents.map(a => a.division))].sort()) { const option = document.createElement('option'); option.value = division; option.textContent = division; $('division').append(option); }
  await refresh(); renderCatalog();
  $('search').addEventListener('input', renderCatalog); $('division').addEventListener('change', renderCatalog);
  $('select-visible').addEventListener('click', () => { for (const a of shown()) selected.add(a.id); unsaved = true; renderCatalog(); });
  $('clear-visible').addEventListener('click', () => { for (const a of shown()) selected.delete(a.id); unsaved = true; renderCatalog(); });
  for (const key of ['coordinator', 'operator']) $(key).addEventListener('change', () => { roles[key] = $(key).value; unsaved = true; renderCount(); });
  $('save').addEventListener('click', () => action(async () => { await request('/api/selection', { selected: [...selected], roles }); unsaved = false; return { message: 'Your team selection is saved.' }; }));
  $('connect').addEventListener('click', () => action(() => request('/api/connect', {})));
  $('reload-ai').addEventListener('click', () => action(() => request('/api/action/reload', {})));
  $('install').addEventListener('click', () => action(async () => { await request('/api/selection', { selected: [...selected], roles }); unsaved = false; return request('/api/install', { startup: $('autostart').checked }); }));
  setInterval(() => refresh().catch(e => { $('error').textContent = e.message; }), 2000);
}
init().catch(e => { $('error').textContent = e.message; });
