# Chief development Podman connection

The Windows personal Chief launcher can opt into the owner's existing default
rootless Podman machine using `--with-local-vm`. The choice persists as
`localVm: "podman"` in the private `.chief-local/preview.json` manifest.

`scripts/chief-podman-env.ts` discovers the installed Podman CLI and validates
the default machine's loopback SSH connection and rootless socket. It references
the existing SSH identity without copying the key. Only CLI discovery paths and
the explicit machine connection enter the backend environment; its isolated
provider home remains unchanged. A missing machine configuration produces a
warning without preventing personal Chief from starting.

Verification:

```powershell
npx vitest run scripts/chief-podman-env.test.ts
node --experimental-strip-types scripts/verify-chief-podman.ts
```

The first checks connection validation. The second uses a disposable backend
and read-only runtime discovery against the selected local machine, writing
`evidence/chief-podman.json`. It never creates or starts desktop containers.
Engine discovery does not establish that Chief's desktop image is installed or
that its desktop container is ready. Those are separate setup steps.

Applying the launcher change needs only a personal Chief restart. Existing
workspace Docker containers, agent data, and mobile pairing files are preserved.
