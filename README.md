# Chief Executive Suite

An independent shared-office product for people and their personal agents, built on the OpenMausBot Apache-licensed core. This repository is a separate copy; it must not share runtime data with an existing OpenMausBot or Crewframe installation.

## Local development

Use Node.js 24 or newer and pnpm 10. Run `pnpm install --frozen-lockfile`, then `pnpm dev:server` and `pnpm dev` in separate terminals. The server defaults to 127.0.0.1:8899 and the UI to 127.0.0.1:5299. Data defaults to `~/.chief-executive-suite`. For verification use the isolated fixture launcher documented in [docs/verification/README.md](docs/verification/README.md); never use live app data as a fixture.

`pnpm build` checks types and builds the browser client. Media hosting and room authentication setup are documented with the office implementation. Unconfigured media must show an unavailable state; a local preview is not a hosted subscription service.

## Shared-office preview

From this repository in PowerShell, run:

```powershell
powershell -File scripts/start-chief-media.ps1
node --experimental-strip-types scripts/chief-preview.ts --with-local-media
```

Open [Chief](http://127.0.0.1:5299) or [the shared office](http://127.0.0.1:5299/office). The bottom-left navigation contains separate **Team map** (original agent canvas) and **Shared office** (human meeting spaces) entries in both interface modes. The preview initially seeds an isolated home with a simulated agent. Its room membership, invitations, notes and local LiveKit media are real. It does not import existing agents or provider credentials. Additional providers can be configured independently. Ctrl+C closes the preview but preserves its data; the next launch resumes the same saved workspace using `.chief-local/preview.json`. Its workspace path is under the operating system's temporary directory, so use `node --experimental-strip-types scripts/preserve-chief-preview.ts` for a private recovery snapshot before cleanup or migration. Localhost invitation links work only on this computer.

For the persistent independent development server, set `$env:CHIEF_OFFICE_ENABLED='1'` before `pnpm dev:server`. Calling also requires `CHIEF_LIVEKIT_URL`, `CHIEF_LIVEKIT_API_KEY` and `CHIEF_LIVEKIT_API_SECRET` in that server's environment. The preview launcher loads the locally generated values from ignored `.chief-local/media.json`; never commit or share that file. See [the office handoff](docs/CHIEF_OFFICE_HANDOFF.md) for setup, security boundaries, verification evidence and unfinished production work.

## Branding and licensing

The owner-supplied Chief logo variants are under `public/brand`. See [the branding and isolation audit](docs/CHIEF_BRANDING_AUDIT.md) for applied surfaces, independent runtime identity, tests and intentional upstream references. Application auto-update is disabled until a signed Chief release feed exists. No production deployment or invitation delivery is configured by this source copy.

OpenMausBot is by Milind Soni. [LICENSE](LICENSE), [NOTICE](NOTICE), [LICENSING.md](LICENSING.md) and third-party notices are retained. `enterprise/` has a separate license and is not made unrestricted by Chief branding. No entitlement checks were bypassed. The preserved [upstream README](docs/UPSTREAM_README.md) describes the original product and its external services; it is historical reference, not Chief launch instructions.
