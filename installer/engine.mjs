import { readFile, writeFile, mkdir, access, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { freemem, homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { atomicJson, execute, download, privateHome, acquireLock } from './core.mjs';
import { freePort, preparePlatform, composeArguments, parseVmMemory } from './platform.mjs';
import { importSelected } from './import-agents.mjs';

export const ACTIONS = ['toolchain', 'docker', 'personal', 'hermes', 'workspace', 'lifecycle', 'start', 'agents', 'reload', 'startup', 'verify', 'desktop'];
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export async function createEngine({ root, home, run = execute, platform = process.platform, arch = process.arch, fetcher = fetch }) {
  root = resolve(root); home = resolve(home);
  const identity = await privateHome(home), unlock = await acquireLock(home);
  if (identity.kind !== 'chief-local-pilot' || !/^[a-f0-9-]{36}$/.test(identity.id)) { await unlock(); throw Error('Invalid Chief installation identity'); }
  let busy = false, pipelineBusy = false;
  let state; try { state = JSON.parse(await readFile(join(home, 'state.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; state = { schemaVersion: 1, selected: ['bacca', 'solo'], roles: { coordinator: 'bacca', operator: 'solo' }, steps: {} }; }
  const deps = JSON.parse(await readFile(join(root, 'installer/dependencies.json'), 'utf8'));
  const catalog = JSON.parse(await readFile(join(root, 'installer/payload/agents.json'), 'utf8'));
  const payload = JSON.parse(await readFile(join(root, 'installer/payload/platform/manifest.json'), 'utf8'));
  let runtime; try { runtime = JSON.parse(await readFile(join(home, 'runtime.json'), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const allocated = new Set(), port = async () => { for (;;) { const value = await freePort(); if (!allocated.has(value)) { allocated.add(value); return value; } } };
    runtime = { id: identity.id, root, ports: { personal: await port(), webhook: await port(), workspace: await port(), hermes: await port() } };
    await atomicJson(join(home, 'runtime.json'), runtime);
  }
  if (runtime.root !== root) throw Error('This installation is bound to another extracted source folder; keep that folder or use a separate CHIEF_SETUP_HOME');
  const persist = () => atomicJson(join(home, 'state.json'), state);
  const toolchain = join(home, 'toolchain');
  const pnpm = join(toolchain, 'node_modules/pnpm/bin/pnpm.cjs');
  const uvName = platform === 'win32' ? 'uv.exe' : 'uv';
  const uv = join(toolchain, uvName);
  const python = platform === 'win32' ? join(home, 'hermes-venv/Scripts/python.exe') : join(home, 'hermes-venv/bin/python');
  const dockerCandidates = platform === 'win32' ? [join(process.env.ProgramFiles || 'C:/Program Files', 'Docker/Docker/resources/bin/docker.exe'), join(process.env.LOCALAPPDATA || home, 'Programs/DockerDesktop/resources/bin/docker.exe')] : [join(homedir(), '.docker/bin/docker'), '/usr/local/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker'];
  const docker = dockerCandidates.find(existsSync) || 'docker';
  const env = { ...process.env, CI: '1', OMB_SKIP_HOOKS: '1', OMB_INCLUDE_ENTERPRISE: '0', HERMES_HOME: join(home, 'hermes'), UV_PROJECT_ENVIRONMENT: join(home, 'hermes-venv') };
  env.PATH = [dirname(process.execPath), env.PATH || ''].join(platform === 'win32' ? ';' : ':');
  // Never inherit an unrelated Compose project or Docker endpoint from the caller.
  for (const key of Object.keys(env)) if (/^(COMPOSE_|CHIEF_PLATFORM_|CHIEF_CAPTURE_|DOCKER_HOST$)/.test(key)) delete env[key];
  const loggedRun = async (command, args, options = {}) => {
    let tail = '';
    try { return await run(command, args, { cwd: root, env, ...options, onOutput: text => { tail = (tail + text).slice(-1024 * 1024); } }); }
    finally {
      const log = tail.replace(/(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[^\s"']+)/g, '[REDACTED]');
      await mkdir(join(home, 'logs'), { recursive: true, mode: 0o700 });
      await appendFile(join(home, 'logs/install.log'), log.slice(-1024 * 1024) + '\n', { mode: 0o600 });
    }
  };
  let dockerContext;
  const dkr = async (...args) => loggedRun(docker, dockerContext ? ['--context', dockerContext, ...args] : args);
  async function localDocker() {
    const name = await dkr('context', 'show'), endpoint = await dkr('context', 'inspect', name.trim(), '--format', '{{.Endpoints.docker.Host}}');
    if (!/^(unix|npipe):\/\//.test(endpoint.trim())) throw Error('Select a local Docker Desktop context; remote Docker is not used');
    dockerContext = name.trim(); runtime.dockerContext = dockerContext; runtime.docker = docker; await atomicJson(join(home, 'runtime.json'), runtime);
    const os = await dkr('info', '--format', '{{.OSType}}'); if (os.trim() !== 'linux') throw Error('Docker Desktop must run Linux containers');
  }
  async function chiefRequest(path, options = {}) {
    const base = `http://127.0.0.1:${runtime.ports.personal}`;
    const children = JSON.parse(await readFile(join(home, 'runtime-children.json'), 'utf8'));
    const healthResponse = await fetcher(base + '/api/health', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    const health = await healthResponse.json();
    if (!healthResponse.ok || health.app !== 'openmausbot' || health.pid !== children.chief?.pid || children.chief?.installationId !== identity.id) throw Error('The local port is not this installation’s Chief process; no agent configuration was changed');
    if (path === '/api/health') return health;
    const response = await fetcher(base + path, { method: options.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: base }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`Chief ${path} returned ${response.status}; connect the model in Chief and retry`);
    return response.json();
  }
  async function configurePersonal() {
    await mkdir(join(home, 'personal'), { recursive: true, mode: 0o700 }); await mkdir(join(home, 'work'), { recursive: true, mode: 0o700 });
    const file = join(home, 'personal/config.json');
    try { await access(file); } catch {
      await atomicJson(file, { instances: { hermes: { driver: 'hermesAgent', config: { transport: 'http', routineApprovals: true, commandReview: true } } }, defaultModelSelection: { instanceId: 'hermes', model: 'hermes-default' } });
    }
    const secrets = join(home, 'runtime-secrets.json');
    try { await access(secrets); } catch { await atomicJson(secrets, { hermesKey: randomBytes(32).toString('hex') }); }
  }
  const actions = {
    async toolchain() {
      await mkdir(toolchain, { recursive: true, mode: 0o700 });
      const npmCli = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);
      if (!npmCli) throw Error('Install the official Node.js distribution, including npm, then retry');
      const pnpmArchive = join(toolchain, 'pnpm.tgz'); await download(deps.pnpm, pnpmArchive, { fetcher });
      await loggedRun(process.execPath, [npmCli, 'install', '--prefix', toolchain, '--ignore-scripts', '--no-audit', '--no-fund', pnpmArchive]);
      const archiveName = platform === 'win32' ? 'uv-x86_64-pc-windows-msvc.zip' : `uv-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin.tar.gz`;
      const artifact = deps.uv[archiveName]; if (!artifact) throw Error('No locked uv distribution for this architecture');
      const archive = join(toolchain, archiveName); await download(artifact, archive, { fetcher });
      if (platform === 'win32') await loggedRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(join(toolchain, 'uv-extracted'))} -Force`]);
      else await loggedRun('/usr/bin/tar', ['-xzf', archive, '-C', toolchain]);
      const candidates = [join(toolchain, 'uv-extracted', uvName), join(toolchain, archiveName.replace('.tar.gz', ''), uvName)];
      const found = candidates.find(existsSync); if (!found) throw Error('uv extraction did not produce its executable');
      const { copyFile, chmod } = await import('node:fs/promises'); await copyFile(found, uv); if (platform !== 'win32') await chmod(uv, 0o700);
      return { state: 'installed', message: 'Private pnpm and uv toolchain installed' };
    },
    async docker() {
      try { await localDocker(); return { state: 'ready', message: 'Local Linux Docker daemon is available' }; } catch { /* install or first launch */ }
      let installed = false; try { await loggedRun(docker, ['--version'], { timeout: 10000 }); installed = true; } catch { /* no existing client */ }
      if (installed) return { state: 'needs permission', message: 'Docker is already installed. Start its existing Linux daemon and complete any WSL or permissions setup, then retry. Setup did not replace it.' };
      const artifact = deps.docker?.[`${platform}-${arch}`]; if (!artifact) throw Error('This architecture has no locked Docker Desktop installer');
      const target = join(toolchain, platform === 'win32' ? 'Docker-Installer.exe' : 'Docker.dmg'); await download(artifact, target, { fetcher });
      if (platform === 'win32') await loggedRun('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath ${psQuote(target)} -ArgumentList 'install' -Wait`]);
      else await loggedRun('/usr/bin/open', [target]);
      return { state: 'needs permission', message: 'Complete Docker Desktop installation, accept its license if appropriate, start Linux containers, then click this step again. On Windows, finish any WSL/restart prompt.' };
    },
    async personal() {
      if (!existsSync(pnpm)) throw Error('Install the private toolchain first');
      await loggedRun(process.execPath, [pnpm, 'install', '--frozen-lockfile'], { timeout: 3600000 });
      await loggedRun(process.execPath, [pnpm, 'exec', 'vite', 'build'], { timeout: 1800000 });
      await configurePersonal();
      return { state: 'installed', message: 'Chief personal web application built. Use Build desktop package for the native app.' };
    },
    async hermes() {
      if (!existsSync(uv)) throw Error('Install the private toolchain first');
      const source = join(root, 'installer/payload/hermes-source');
      await loggedRun(uv, ['sync', '--frozen', '--python', '3.14', '--no-dev'], { cwd: source, timeout: 3600000 });
      await loggedRun(python, ['-c', 'import chief_budget; import httpx; assert httpx.Client.send.chief_budget_guard'], { cwd: source, env: { ...env, PYTHONPATH: source } });
      await configurePersonal(); await mkdir(join(home, 'hermes/plugins/chief-http-tools'), { recursive: true, mode: 0o700 });
      const { copyFile } = await import('node:fs/promises');
      for (const name of ['plugin.yaml', '__init__.py', 'command_review.py']) await copyFile(join(root, 'integrations/hermes-http-tools', name), join(home, 'hermes/plugins/chief-http-tools', name));
      const configFile = join(home, 'hermes/config.yaml');
      if (!existsSync(configFile)) await writeFile(configFile, 'plugins:\n  enabled: [chief-http-tools]\nplatform_toolsets:\n  api_server: [terminal, file, skills, chief_http_tools]\nplatforms:\n  webhook:\n    enabled: false\n  api_server:\n    enabled: true\n    host: 127.0.0.1\n    port: ' + runtime.ports.hermes + '\n', { mode: 0o600, flag: 'wx' });
      return { state: 'needs connection', message: 'Hermes and the Chief plugin are installed. Use Connect AI to complete your own provider sign-in.' };
    },
    async workspace() {
      await localDocker();
      if (freemem() < 2 * 1024 ** 3) throw Error('Less than 2 GiB host memory available; close optional work yourself or add capacity, then retry');
      const lock = JSON.parse(await readFile(join(root, 'integrations/platform/image-lock.json'), 'utf8'));
      const probeImage = lock.images.nginx.digest;
      await dkr('pull', '--platform', 'linux/amd64', probeImage);
      const memory = parseVmMemory(await dkr('run', '--rm', '--network=none', '--platform', 'linux/amd64', '--entrypoint', 'cat', probeImage, '/proc/meminfo'));
      if (memory < 5 * 1024 ** 3) throw Error('Docker VM needs at least 5 GiB available for the retained workspace. Increase Docker resources and retry.');
      const prepared = await preparePlatform(root, home, identity, runtime.ports, payload);
      for (const image of new Set(Object.values(lock.images).map(row => row.digest))) await dkr('pull', '--platform', 'linux/amd64', image);
      for (const [name] of Object.entries(payload.images)) await dkr('build', '--platform', 'linux/amd64', '--pull=false', '--network=none', '-t', prepared.images[name], join(root, 'installer/payload/platform', name));
      await atomicJson(join(home, 'platform/manifest.json'), { project: 'chief-platform', installationProject: prepared.project, url: `http://localhost:${runtime.ports.workspace}`, status: 'prepared' });
      return { state: 'installed', message: 'Private shared workspace images and fresh configuration prepared (Linux amd64; ARM Macs use Docker emulation)' };
    },
    async lifecycle() {
      const operator = catalog.agents.find(a => a.id === state.roles?.operator && state.selected.includes(a.id));
      if (!operator || !state.roles?.coordinator || !state.selected.includes(state.roles.coordinator)) return { state: 'needs connection', message: 'Select distinct coordinator and operator profiles, save the team, then resume. Member provisioning uses your selected operator template.' };
      const protocol = await readFile(join(root, 'installer/customer-protocol.txt'), 'utf8');
      await atomicJson(join(home, 'member-template.json'), { name: operator.name, soul: operator.soul + '\n\n' + protocol + '\nThis profile represents one authenticated workspace member. Read only this member’s own working folder and use the paired Huly tools for workspace access. Ask the owner to grant any additional capability; do not borrow another member’s connection.', modelSelection: { instanceId: 'hermes', model: 'hermes-default' } });
      await localDocker();
      const compose = JSON.parse(await readFile(join(home, 'platform/compose.json'), 'utf8'));
      const image = compose.services['chief-lifecycle']?.image;
      if (!image) throw Error('Prepare the shared workspace for this release first');
      await dkr('build', '--platform', 'linux/amd64', '-t', image, join(root, 'integrations/platform/lifecycle'));
      await dkr(...composeArguments(home, 'up', '-d', '--pull', 'never', '--no-build', 'cockroach'));
      let initialized = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          await run(docker, ['--context', dockerContext, ...composeArguments(home, 'exec', '-T', '--user', '0', 'cockroach', './cockroach', 'sql', '--certs-dir=certs', '--host=127.0.0.1:26257', '--user=root', '--database=defaultdb', '--file=/chief-bootstrap/initialize.sql')], { cwd: root, env, timeout: 10000 }); initialized = true; break;
        } catch { await new Promise(done => setTimeout(done, 1000)); }
      }
      if (!initialized) throw Error('Fresh database initialization did not complete; verify this installation’s Cockroach service and retry. SQL containing credentials is not logged.');
      await dkr(...composeArguments(home, 'run', '--rm', '--no-deps', 'chief-lifecycle-migrate'));
      await dkr(...composeArguments(home, 'exec', '-T', '--user', '0', 'cockroach', './cockroach', 'sql', '--certs-dir=certs', '--host=127.0.0.1:26257', '--user=root', '--database=defaultdb', '--file=/chief-bootstrap/grants.sql'));
      return { state: 'installed', message: 'Fresh databases, restricted lifecycle role, migrations and automatic verified-member profile policy installed. Workspace access still requires two-sided pairing.' };
    },
    async start() {
      if (!existsSync(join(root, 'dist/index.html')) || !existsSync(python)) throw Error('Build personal Chief and install Hermes first');
      await localDocker();
      await dkr(...composeArguments(home, 'up', '-d', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '300'));
      await atomicJson(join(home, 'platform/manifest.json'), { project: 'chief-platform', url: `http://localhost:${runtime.ports.workspace}`, status: 'ready' });
      let already = false;
      try { const previous = JSON.parse(await readFile(join(home, 'supervisor.json'), 'utf8')); process.kill(previous.pid, 0); already = true; } catch { /* not running */ }
      if (!already) {
        await mkdir(join(home, 'logs'), { recursive: true, mode: 0o700 }); const { open } = await import('node:fs/promises'); const log = await open(join(home, 'logs/supervisor.log'), 'a', 0o600);
        const child = spawn(process.execPath, [join(root, 'installer/supervisor.mjs'), home, root], { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] }); child.unref(); await log.close();
      }
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) { try { const health = await chiefRequest('/api/health'); if (health.app === 'openmausbot') return { state: 'needs connection', message: 'Both environments started. Create your shared-workspace account and connect your AI provider, then verify.' }; } catch { /* warming */ } await new Promise(done => setTimeout(done, 750)); }
      throw Error('Chief did not become healthy; services and logs were preserved for repair');
    },
    async agents() {
      const protocol = await readFile(join(root, 'installer/customer-protocol.txt'), 'utf8');
      const outcomes = await importSelected({ catalog, selected: state.selected, home, request: chiefRequest, protocol, modelSelection: { instanceId: 'hermes', model: 'hermes-default' }, roles: state.roles });
      state.agentOutcomes = outcomes;
      return { state: outcomes.some(o => o.state === 'conflict') ? 'needs connection' : 'installed', message: `${outcomes.filter(o => o.state === 'created').length} added; ${outcomes.filter(o => o.state === 'existing').length} retained; ${outcomes.filter(o => o.state === 'conflict').length} conflicts. Model sign-in and workspace grants remain separate.` };
    },
    async startup() {
      const name = 'ChiefPilot-' + identity.id.replaceAll('-', '').slice(0, 12), script = join(root, 'installer/supervisor.mjs');
      if (platform === 'darwin') {
        const folder = join(homedir(), 'Library/LaunchAgents'); await mkdir(folder, { recursive: true });
        const path = join(folder, `io.chief.${name}.plist`);
        const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>io.chief.${xml(name)}</string><key>ProgramArguments</key><array>${[process.execPath, script, home, root].map(arg => `<string>${xml(arg)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(join(home, 'logs/login.log'))}</string><key>StandardErrorPath</key><string>${xml(join(home, 'logs/login.log'))}</string></dict></plist>`;
        await writeFile(path, plist, { mode: 0o600 }); await loggedRun('/usr/bin/plutil', ['-lint', path]);
        // Enable at next login; do not start a second supervisor now.
        return { state: 'installed', message: 'Login LaunchAgent saved. Enable Docker Desktop login startup and test restart/login. The Mac must be awake and signed in.' };
      }
      const args = [script, home, root].map(x => `"${x.replaceAll('"', '')}"`).join(' ');
      await loggedRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$a=New-ScheduledTaskAction -Execute ${psQuote(process.execPath)} -Argument ${psQuote(args)}; $t=New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name); $s=New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable; Register-ScheduledTask -TaskName ${psQuote(name)} -Action $a -Trigger $t -Settings $s -Description 'Customer-owned Chief pilot; both local environments' -Force | Out-Null`]);
      return { state: 'installed', message: 'Current-user login task registered. Enable Docker Desktop login startup and test restart/login.' };
    },
    async reload() {
      const workflow = await chiefRequest('/api/customer-workflow');
      if (workflow.background.some(row => !row.terminal)) throw Error('Stop active or waiting background workflows before applying AI connection changes');
      const bots = await chiefRequest('/api/bots');
      if (bots.bots.some(bot => bot.busy || bot.tasks?.some(task => task.busy))) throw Error('Finish or stop current chats before restarting this installation’s AI runtime');
      const before = JSON.parse(await readFile(join(home, 'runtime-children.json'), 'utf8'));
      const nonce = randomBytes(16).toString('hex');
      await atomicJson(join(home, 'supervisor-control.json'), { installationId: identity.id, nonce, action: 'reload-hermes', expiresAt: Date.now() + 60000 });
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        try {
          const receipt = JSON.parse(await readFile(join(home, 'supervisor-control-receipt.json'), 'utf8'));
          const after = JSON.parse(await readFile(join(home, 'runtime-children.json'), 'utf8'));
          if (receipt.nonce === nonce && after.hermes?.pid && after.hermes.pid !== before.hermes?.pid) {
            const secrets = JSON.parse(await readFile(join(home, 'runtime-secrets.json'), 'utf8'));
            const response = await fetcher(`http://127.0.0.1:${runtime.ports.hermes}/v1/models`, { headers: { Authorization: `Bearer ${secrets.hermesKey}` }, redirect: 'error', signal: AbortSignal.timeout(3000) });
            if (response.ok) return { state: 'installed', message: 'This installation’s AI runtime restarted with your saved provider connection. Run Verify, then perform a draft-and-delivery task.' };
          }
        } catch { /* Owned child is restarting. */ }
        await new Promise(done => setTimeout(done, 500));
      }
      throw Error('AI reload did not become ready; inspect this installation’s Hermes log before retrying');
    },
    async verify() {
      const checks = {};
      try { checks.personal = (await chiefRequest('/api/health')).app === 'openmausbot'; } catch { checks.personal = false; }
      try { const r = await fetcher(`http://localhost:${runtime.ports.workspace}/config.json`, { redirect: 'error', signal: AbortSignal.timeout(5000) }); checks.sharedWorkspace = r.ok && typeof await r.json() === 'object'; } catch { checks.sharedWorkspace = false; }
      const secrets = JSON.parse(await readFile(join(home, 'runtime-secrets.json'), 'utf8'));
      try { const r = await fetcher(`http://127.0.0.1:${runtime.ports.hermes}/v1/models`, { headers: { Authorization: `Bearer ${secrets.hermesKey}` }, redirect: 'error', signal: AbortSignal.timeout(5000) }); checks.hermesApi = r.ok; } catch { checks.hermesApi = false; }
      try {
        const read = async path => { const r = await fetcher(`http://127.0.0.1:${runtime.ports.hermes}` + path, { headers: { Authorization: `Bearer ${secrets.hermesKey}` }, redirect: 'error', signal: AbortSignal.timeout(5000) }); if (!r.ok) throw Error('Hermes unavailable'); return r.json(); };
        const capabilities = await read('/v1/capabilities'), tools = await read('/v1/toolsets');
        checks.hermesRuntimeContract = capabilities.features?.run_submission === true && capabilities.features?.run_events_sse === true && capabilities.features?.run_stop === true;
        checks.chiefToolBridge = Array.isArray(tools.data) && tools.data.some(row => row.enabled && row.tools?.includes('chief_tools'));
      } catch { checks.hermesRuntimeContract = false; checks.chiefToolBridge = false; }
      checks.selectedAgents = (state.agentOutcomes?.length || 0) === state.selected.length && state.agentOutcomes?.every(o => ['created', 'existing'].includes(o.state));
      let workflow;
      try { workflow = await chiefRequest('/api/customer-workflow'); checks.automaticProvisioning = workflow.automaticMemberProvisioning === true; checks.backgroundBudgets = workflow.scheduler?.policy?.requests === 20 && workflow.scheduler?.policy?.activeMs === 600000; } catch { checks.automaticProvisioning = false; checks.backgroundBudgets = false; }
      try { const r = await fetcher(`http://localhost:${runtime.ports.workspace}/chief/v1/status`, { redirect: 'error', signal: AbortSignal.timeout(5000) }); checks.lifecycle = r.ok && (await r.json()).enabled === true; } catch { checks.lifecycle = false; }
      const report = { checkedAt: new Date().toISOString(), installationId: identity.id, platform, arch, checks, state: Object.values(checks).every(Boolean) ? 'installed-needs-workflow-test' : 'needs connection',
        workflow, pending: ['Sign into shared workspace to provision your member profile, then confirm two-sided member/agent pairing', 'Real model task and delivered artifact', 'Approval denial/Stop and zero-card routine workflow on this machine', 'Target scheduled run and provider guard acceptance', 'Native restart/login and sleep/wake', 'Native package signing and distribution acceptance'] };
      await atomicJson(join(home, 'verification.json'), report); state.verification = report;
      return { state: 'needs connection', message: 'Connectivity checks saved. Full proactive workflow remains unverified until the listed acceptance cases pass.' };
    },
    async desktop() {
      if (!existsSync(pnpm)) throw Error('Install toolchain first');
      await loggedRun(process.execPath, [pnpm, 'run', platform === 'darwin' ? 'package:mac' : 'package:win'], { timeout: 7200000 });
      return { state: 'installed', message: 'Native desktop artifacts built in app/release. Install and test the target artifact; signing/notarization is separate.' };
    },
  };
  const engine = {
    catalog, home, identity,
    async status() {
      return { busy: busy || pipelineBusy, platform, arch, supported: ['darwin', 'win32'].includes(platform) && (platform !== 'win32' || arch === 'x64'), node: process.version, home, state, ports: runtime.ports,
        urls: { personal: `http://127.0.0.1:${runtime.ports.personal}`, shared: `http://localhost:${runtime.ports.workspace}` },
        notes: ['Engineering test build; no production readiness claim', 'Shared workspace binaries use Linux amd64, including emulation on ARM Macs', 'Keep the extracted folder in its current location', 'Readiness requires your own sign-ins and a real end-to-end test'] };
    },
    async select(ids, roles = state.roles || {}) {
      if (busy || pipelineBusy) throw Error('Wait for the current installation step');
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !catalog.agents.some(a => a.id === id))) throw Error('Choose valid catalog agents');
      for (const key of ['coordinator', 'operator']) if (roles[key] && !ids.includes(roles[key])) roles = { ...roles, [key]: '' };
      if (roles.coordinator && roles.coordinator === roles.operator) throw Error('Choose distinct coordinator and operator profiles');
      state.selected = ids; state.roles = { coordinator: roles.coordinator || '', operator: roles.operator || '' }; await persist();
    },
    async action(name) {
      if (!ACTIONS.includes(name)) throw Error('Unknown setup action'); if (busy) throw Error('Another installation step is running');
      if (!['win32', 'darwin'].includes(platform) || (platform === 'win32' && arch !== 'x64')) throw Error('This testing package targets Windows x64 and macOS x64/arm64');
      busy = true; state.steps[name] = { state: 'checking', startedAt: new Date().toISOString() }; await persist();
      try { const outcome = await actions[name](); state.steps[name] = { ...state.steps[name], ...outcome, completedAt: new Date().toISOString() }; }
      catch (e) { state.steps[name] = { ...state.steps[name], state: 'failed', message: e.message }; }
      finally { busy = false; await persist(); }
      return state.steps[name];
    },
    async connectAi() {
      if (!existsSync(python)) throw Error('Install Hermes first');
      const args = ['-m', 'hermes_cli.main', 'setup'];
      const connectionPath = [toolchain, dirname(python), dirname(process.execPath), process.env.PATH || ''].join(platform === 'win32' ? ';' : ':');
      if (platform === 'win32') {
        const command = `$env:HERMES_HOME=${psQuote(join(home, 'hermes'))}; $env:PATH=${psQuote(connectionPath)}; $env:PYTHONPATH=${psQuote(join(root, 'installer/payload/hermes-source'))}; & ${psQuote(python)} ${args.map(psQuote).join(' ')}`;
        const encoded = Buffer.from(command, 'utf16le').toString('base64'); spawn('powershell.exe', ['-NoProfile', '-NoExit', '-EncodedCommand', encoded], { detached: true, windowsHide: false, stdio: 'ignore' }).unref();
      } else {
        const shellQuote = s => "'" + s.replaceAll("'", "'\\''") + "'";
        const file = join(home, 'Connect-AI.command');
        await writeFile(file, '#!/bin/bash\nexport PATH=' + shellQuote(connectionPath) + '\nexport HERMES_HOME=' + shellQuote(join(home, 'hermes')) + '\nexport PYTHONPATH=' + shellQuote(join(root, 'installer/payload/hermes-source')) + '\n' + [python, ...args].map(shellQuote).join(' ') + '\n', { mode: 0o700 });
        await loggedRun('/usr/bin/open', [file]);
      }
    },
    close: unlock,
  };
  engine.install = async ({ startup = true } = {}) => {
    if (busy || pipelineBusy) throw Error('An installation step is already running');
    pipelineBusy = true;
    try {
      for (const name of ['toolchain', 'docker', 'personal', 'hermes', 'workspace', 'lifecycle', 'start', 'agents', ...(startup ? ['startup'] : []), 'verify']) {
        // Replayable preparation steps preserve existing state. Completed heavy
        // build steps can be repaired individually from their own buttons.
        if (['toolchain', 'personal', 'workspace'].includes(name) && state.steps[name]?.state === 'installed') continue;
        if (name === 'hermes' && existsSync(python) && existsSync(join(home, 'hermes/plugins/chief-http-tools/command_review.py'))) continue;
        const result = await engine.action(name);
        if (name === 'lifecycle' && result.state !== 'installed') return result;
        if (['failed', 'needs permission'].includes(result.state)) return result;
      }
      return { state: 'needs connection', message: 'Software setup finished. Complete your sign-ins and the listed workflow acceptance tests.' };
    } finally { pipelineBusy = false; }
  };
  return engine;
}
