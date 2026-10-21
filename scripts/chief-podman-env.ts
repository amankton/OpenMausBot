import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

export function podmanConnectionEnvironment(connection: { URI?: string; Identity?: string; IsMachine?: boolean; Default?: boolean }, executable: string, systemRoot: string) {
  const url = new URL(connection.URI ?? '');
  if (!connection.IsMachine || !connection.Default || url.protocol !== 'ssh:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.port || !url.username || url.username === 'root' || url.password || url.search || url.hash ||
      !/^\/run\/user\/\d+\/podman\/podman.sock$/.test(url.pathname) || !connection.Identity || !isAbsolute(connection.Identity) || !isAbsolute(executable)) {
    throw Error('Chief requires an existing default rootless Podman machine on this computer.');
  }
  return { OMB_EXTRA_PATH: [dirname(executable), join(systemRoot, 'System32')].join(delimiter),
    CONTAINER_HOST: connection.URI!, CONTAINER_SSHKEY: connection.Identity };
}

/** Explicit opt-in for this development launcher, never ordinary test fixtures.
 * Read the owner's selected machine; reference its key without copying it into
 * Chief's data or portable backups. Leave the isolated provider home intact. */
export function chiefPodmanEnvironment(hostEnv = process.env) {
  const candidates = [join(hostEnv.LOCALAPPDATA ?? '', 'Programs', 'Podman', 'podman.exe'),
    join(hostEnv.ProgramFiles ?? 'C:\\Program Files', 'RedHat', 'Podman', 'podman.exe'),
    join(hostEnv.ProgramFiles ?? 'C:\\Program Files', 'Podman', 'podman.exe')];
  const executable = candidates.find(path => existsSync(path));
  if (!executable) throw Error('Podman CLI is not installed in a supported Windows location.');
  // The launcher has the real user environment; the backend deliberately does not.
  const rows = JSON.parse(execFileSync(executable, ['system', 'connection', 'list', '--format', 'json'], {
    env: hostEnv, encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const selected = rows.filter((row: { Default?: boolean }) => row.Default);
  if (selected.length !== 1) throw Error('Select exactly one default Podman machine first.');
  const result = podmanConnectionEnvironment(selected[0], executable, hostEnv.SystemRoot ?? 'C:\\Windows');
  if (!existsSync(result.CONTAINER_SSHKEY)) throw Error('The existing Podman machine identity file is missing.');
  return result;
}
