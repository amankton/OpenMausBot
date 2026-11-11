# Chief complete local setup — engineering implementation

Both Windows x64 and macOS Intel/Apple Silicon entry points use `setup.mjs` and
`engine.mjs`. The retained workspace container binaries are Linux amd64; ARM Mac
emulation remains a native test gate. See `BUILD-REPORT.md` for precise implemented
scope and remaining work, and `TEST-ON-TARGET.md` for the transfer workflow.

Run setup from the generated package's native entry point, not directly from the
developer checkout. The package supplies `payload/` and its transfer inventory;
the checkout deliberately has neither live profiles nor a committed generated
payload. Software downloads require internet and native first-launch permissions.

Verification from the developer checkout:

```sh
node --test installer/installer.test.mjs
node --experimental-strip-types installer/source-smoke.mjs
node node_modules/vitest/vitest.mjs run server/drivers/hermes-customer-read-scope.test.ts server/drivers/hermes-routine-approval.test.ts server/drivers/hermes-command-review.test.ts server/drivers/hermes-command-review-bridge.test.ts server/drivers/hermes-tool-bridge.test.ts
```

`wizard-smoke.mjs` uses the installed development Playwright dependency and a
scripted local engine; it never installs software or calls an AI provider.

`package-testing.py` is the current build-machine exporter. Its explicit source
locations refer to the existing reviewed Windows build inputs. It exports only
role fields, tracked source and allowlisted immutable-image code; it does not
export containers' environment, databases, volumes or user homes. It stops on
credential-pattern matches and verifies the compiled frontend/backend outputs.
An engineering stage may be resumed only inside this checkout's release folder
with its ownership/source marker. Do not use this exporter as a customer backup.

Member provisioning and shared background budgets are implemented. Native target
acceptance and signing remain, as listed in `BUILD-REPORT.md`; this engineering
candidate must not be marketed as an accepted customer release.
