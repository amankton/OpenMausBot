import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { delimiter, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { chiefPodmanEnvironment } from './chief-podman-env.ts';
import { launchVerificationServer } from './control-omb.ts';
import { containerComputerMcp, SHARED_LOCAL_VM_TARGET } from '../server/container-computer.ts';
import { waitForExit } from '../server/testing/cleanup.ts';

// Reproduce a sanitizing MCP client's child environment. No provider session,
// user prompt, desktop tool call, or container lifecycle action is performed.
const machine = chiefPodmanEnvironment();
const fixture = await launchVerificationServer(process.env, undefined, {
  binDir: machine.OMB_EXTRA_PATH.split(delimiter)[0], host: machine.CONTAINER_HOST,
  sshKey: machine.CONTAINER_SSHKEY, staticDir: resolve('dist'),
});
async function listTools(settings: Record<string, string>): Promise<string[]> {
  const spec = containerComputerMcp('podman', undefined, SHARED_LOCAL_VM_TARGET, settings);
  const child = spawn(spec.command, spec.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
    SystemRoot: process.env.SystemRoot, PATH: machine.OMB_EXTRA_PATH,
    HOME: fixture.info.dataDir, USERPROFILE: fixture.info.dataDir,
    TEMP: fixture.info.dataDir, TMP: fixture.info.dataDir, ...spec.env,
  } });
  child.stderr.resume(); // Never put connection credentials or arbitrary stderr in evidence.
  const lines = createInterface({ input: child.stdout });
  try {
    return await new Promise<string[]>((done, fail) => {
      const timer = setTimeout(() => fail(Error('MCP discovery timed out')), 20000);
      const finish = (error?: Error, names?: string[]) => {
        clearTimeout(timer);
        if (error) fail(error); else done(names!);
      };
      child.once('error', () => finish(Error('MCP bridge failed to start')));
      child.once('exit', () => finish(Error('MCP bridge exited before discovery')));
      child.stdin.on('error', () => finish(Error('MCP bridge input closed')));
      lines.on('line', line => {
        try {
          const message = JSON.parse(line);
          if (message.error) return finish(Error('MCP discovery returned an error'));
          if (message.id === 1) {
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
          } else if (message.id === 2) {
            assert.ok(Array.isArray(message.result?.tools));
            finish(undefined, message.result.tools.map((tool: { name: string }) => tool.name));
          }
        } catch { finish(Error('Invalid MCP discovery response')); }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chief-isolated-discovery', version: '1' },
      } }) + '\n');
    });
  } finally { lines.close(); child.stdin.end(); await waitForExit(child); }
}
try {
  const status = await (await fetch(fixture.info.url + '/api/local-computer')).json();
  assert.equal(status.daemonUp, true);
  assert.equal(status.container, 'running');
  await assert.rejects(listTools({}), /MCP/);
  const names = await listTools(machine);
  for (const name of ['get_desktop_state', 'click', 'browser_navigate', 'get_browser_state']) assert.ok(names.includes(name));
  const receipt = { passed: true, verifiedAt: new Date().toISOString(), isolatedServer: true,
    previousEnvironmentRejected: true, explicitEnvironmentConnected: true,
    desktopToolCalls: 0, containerLifecycleActions: 0, toolNames: names };
  writeFileSync('docs/verification/evidence/chief-vm-tools.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await fixture.close(); }
