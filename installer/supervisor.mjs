import { spawn } from 'node:child_process';
import { readFile, mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, acquireLock, execute } from './core.mjs';
import { composeArguments } from './platform.mjs';

export async function supervise(home, root, { signal } = {}) {
  const settings = JSON.parse(await readFile(join(home, 'runtime.json'), 'utf8'));
  await mkdir(join(home, 'supervisor-state'), { recursive: true, mode: 0o700 });
  const releaseLock = await acquireLock(join(home, 'supervisor-state'));
  const secrets = JSON.parse(await readFile(join(home, 'runtime-secrets.json'), 'utf8'));
  await mkdir(join(home, 'logs'), { recursive: true, mode: 0o700 });
  const runtimeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|ComSpec|TEMP|TMP|TMPDIR|LANG|LC_[A-Z_]+|USER|USERNAME|LOGNAME|SHELL|XDG_[A-Z_]+|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/i.test(key)));
  const runtimePath = [join(home, 'toolchain'), join(home, process.platform === 'win32' ? 'hermes-venv/Scripts' : 'hermes-venv/bin'), process.env.PATH || ''].join(process.platform === 'win32' ? ';' : ':');
  runtimeEnvironment.PATH = runtimePath;
  const children = new Set(), byName = new Map(), childRecords = {}; let stopping = false;
  const run = async (name, command, args, env) => {
    while (!stopping) {
      const log = await open(join(home, 'logs', `${name}.log`), 'a', 0o600);
      const child = spawn(command, args, { cwd: root, windowsHide: true, env: { ...runtimeEnvironment, ...env }, stdio: ['ignore', log.fd, log.fd] });
      byName.set(name, child);
      const exited = new Promise(done => { child.once('exit', done); child.once('error', done); });
      childRecords[name] = { pid: child.pid, installationId: settings.id };
      await atomicJson(join(home, 'runtime-children.json'), childRecords);
      children.add(child); await log.close();
      await exited; children.delete(child);
      if (byName.get(name) === child) byName.delete(name);
      if (!stopping) await new Promise(done => setTimeout(done, 3000));
    }
  };
  const chiefEnv = {
    OMB_DATA_DIR: join(home, 'personal'), OMB_PORT: String(settings.ports.personal), OMB_WEBHOOK_PORT: String(settings.ports.webhook), OMB_STATIC_DIR: join(root, 'dist'),
    CHIEF_OFFICE_ENABLED: '1', CHIEF_PLATFORM_MANIFEST: join(home, 'platform/manifest.json'),
    HERMES_HOME: join(home, 'hermes'), HERMES_API_BASE_URL: `http://127.0.0.1:${settings.ports.hermes}`, HERMES_API_KEY: secrets.hermesKey,
    CHIEF_CUSTOMER_INSTALLATION: '1', HERMES_TOOL_BRIDGE_ENABLED: '1',
    CHIEF_BUDGET_GUARD: '1', CHIEF_LIFECYCLE_ORIGIN: `http://localhost:${settings.ports.workspace}`,
    CHIEF_MEMBER_BRIDGE_DIR: join(home, 'member-bridge'), CHIEF_MEMBER_BRIDGE_KEY_FILE: join(home, 'platform/.secrets/member_key'), CHIEF_MEMBER_TEMPLATE_FILE: join(home, 'member-template.json'), CHIEF_WORK_ROOT: join(home, 'work'),
    HERMES_PYTHON: join(home, process.platform === 'win32' ? 'hermes-venv/Scripts/python.exe' : 'hermes-venv/bin/python'), PYTHONPATH: join(root, 'installer/payload/hermes-source'),
    PATH: runtimePath,
  };
  const hermesSource = join(root, 'installer/payload/hermes-source');
  const python = process.platform === 'win32' ? join(home, 'hermes-venv/Scripts/python.exe') : join(home, 'hermes-venv/bin/python');
  const stop = () => { stopping = true; for (const child of children) child.kill(); };
  let controlBusy = false, previousControl;
  const controlTimer = setInterval(async () => {
    if (stopping || controlBusy) return; controlBusy = true;
    try {
      const request = JSON.parse(await readFile(join(home, 'supervisor-control.json'), 'utf8'));
      if (request.installationId !== settings.id || request.action !== 'reload-hermes' || !/^[a-f0-9]{32}$/.test(request.nonce) || request.nonce === previousControl || request.expiresAt <= Date.now()) return;
      const child = byName.get('hermes'); if (!child) return;
      previousControl = request.nonce; child.kill();
      await atomicJson(join(home, 'supervisor-control-receipt.json'), { nonce: request.nonce, installationId: settings.id, state: 'restarting' });
    } catch { /* No unauthenticated file or stale request controls a child. */ }
    finally { controlBusy = false; }
  }, 500); controlTimer.unref();
  process.once('SIGINT', stop); process.once('SIGTERM', stop); signal?.addEventListener('abort', stop, { once: true });
  await atomicJson(join(home, 'supervisor.json'), { pid: process.pid, installationId: settings.id, startedAt: new Date().toISOString() });
  await writeFile(join(home, 'supervisor-command.txt'), 'Stop using the operating system login task/service for this installation. Do not kill unrelated Node or Hermes processes.\n', { mode: 0o600 });
  const workspace = async () => {
    while (!stopping) {
      try {
        const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DOCKER_HOST$|COMPOSE_|CHIEF_PLATFORM_)/.test(key)));
        const docker = settings.docker || 'docker', context = settings.dockerContext;
        if (!context) throw Error('No verified Docker context');
        const endpoint = await execute(docker, ['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'], { env: cleanEnv, timeout: 10000 });
        if (!/^(unix|npipe):\/\//.test(endpoint)) throw Error('Docker context is no longer local');
        await execute(docker, ['--context', context, ...composeArguments(home, 'up', '-d', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '120')], { env: cleanEnv, timeout: 180000 });
      } catch { /* Docker may still be starting at login; retry only this owned project. */ }
      await new Promise(done => { const timer = setTimeout(done, 30000); timer.unref(); signal?.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true }); });
    }
  };
  await Promise.all([
    run('chief', process.execPath, ['--experimental-strip-types', join(root, 'server/index.ts')], chiefEnv),
    run('hermes', python, ['-m', 'hermes_cli.main', 'gateway', 'run'], { HERMES_HOME: join(home, 'hermes'), PYTHONPATH: hermesSource, CHIEF_MANAGED_REQUESTS_ONLY: '1', PYTHONDONTWRITEBYTECODE: '1', API_SERVER_MODEL_NAME: 'hermes-agent', API_SERVER_PORT: String(settings.ports.hermes), API_SERVER_HOST: '127.0.0.1', API_SERVER_KEY: secrets.hermesKey }),
    workspace(),
  ]);
  clearInterval(controlTimer);
  await releaseLock();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) supervise(process.argv[2], process.argv[3]).catch(() => { console.error('Chief supervisor stopped; inspect the private installation logs.'); process.exitCode = 1; });
