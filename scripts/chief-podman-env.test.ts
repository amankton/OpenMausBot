import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { podmanConnectionEnvironment } from './chief-podman-env.ts';

const connection = { URI: 'ssh://user@127.0.0.1:12345/run/user/1000/podman/podman.sock', Identity: resolve('synthetic-key'), IsMachine: true, Default: true };
describe('explicit Chief development Podman connection', () => {
  it('passes only the exact machine connection and CLI lookup paths', () => {
    const env = podmanConnectionEnvironment(connection, resolve('podman/podman.exe'), resolve('Windows'));
    expect(env.CONTAINER_HOST).toBe(connection.URI);
    expect(env.CONTAINER_SSHKEY).toBe(connection.Identity);
    expect(env.OMB_EXTRA_PATH).toContain(join('Windows', 'System32'));
    expect(Object.keys(env).sort()).toEqual(['CONTAINER_HOST', 'CONTAINER_SSHKEY', 'OMB_EXTRA_PATH']);
  });
  it.each([
    { URI: 'ssh://user@remote.example:12345/run/user/1000/podman/podman.sock' },
    { URI: 'ssh://root@127.0.0.1:12345/run/user/1000/podman/podman.sock' },
    { URI: 'ssh://user:password@127.0.0.1:12345/run/user/1000/podman/podman.sock' },
    { URI: 'ssh://user@127.0.0.1:12345/other.sock' },
    { Default: false }, { IsMachine: false }, { Identity: 'relative-key' },
  ])('rejects a different authority or ambiguous key: %j', patch => {
    expect(() => podmanConnectionEnvironment({ ...connection, ...patch }, resolve('podman.exe'), resolve('Windows'))).toThrow();
  });
});
