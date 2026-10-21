# MausBot mobile and Windows Hermes terminal repair

## Mobile connection

Tailscale was Running/Online with no health warnings. The saved mobile connector task had exited with code 1 and ports 18910, 18911 and 18912 were absent. Its error was the private Windows pairing-storage ACL guard during optional hosted-connection startup; this was separate from Tailscale reachability. The same ACL check succeeded during this repair, with the owner and SYSTEM retaining the intended private grants. The original startup failure's deeper cause is unconfirmed; no ACL or credential bypass was applied.

Restarted the existing `Chief Mobile Connector (Dev)` scheduled task. Its existing three retries / one-minute interval were retained. It follows the saved Chief backend automatically. Port 18910 serves the authenticated companion; owner setup/control ports 18911 and 18912 remain loopback-only. The companion returned the correct app identity over the actual Tailscale DNS address, and anonymous `/api/bots` returned 401. The existing iPhone answered Tailscale ping in 15 ms.

The owner then explicitly confirmed **Connected and received a reply** after being asked to reconnect with Tailscale enabled, Wi-Fi off, and exchange a message. This closes the previously pending cellular message/reply acceptance. Pairing was retained; there was no credential reset or re-pairing.

Connection: `http://the-box.tail0d3f36.ts.net:18910`.

## Terminal failure and fix

The two reported `stdin is not a tty` errors were actual native Hermes terminal results (13:20 and 13:53), not transcript comparison failures. Read-only inspection of the exact session's stored terminal calls identified a `node -e` command reading the existing reconnect transcript and bridge-result evidence.

Reproduction on the installed Windows LocalEnvironment:

- `TERM=xterm-256color`: `node` resolved to the Git login-profile alias `winpty node.exe`; exit 1, `stdin is not a tty`.
- `TERM=dumb`: `node` resolved directly; exit 0, output 42.

Hermes supplies pipes/DEVNULL for these commands. Git's xterm-only convenience alias therefore selected a console wrapper for a process without a console.

Changed only the Windows piped-shell launch in installed `tools/environments/local.py`: construct the existing sanitized child environment, then set its `TERM=dumb` before starting Bash. Both login snapshot and subsequent command launches use the correction. No global Windows environment, user Git profile, provider credential, model setting or Linux/WSL file changed. Interactive/background terminal paths are not replaced by this function.

Added `tests/tools/test_local_windows_noninteractive.py`. It uses real Windows Bash/Node/winpty with an owned fixture reproducing the installed Git profile's conditional alias, and verifies that both Node execution and persistent exported values work. The test isolates PM store lookups from the real installed home. It failed with the exact tty error before the fix and passed afterward.

The canonical runner's related-file run recorded **20 passed, 7 skipped, 5 failed**. The five broader failures were blocked by the installed-home I/O guard when existing helpers attempted to read the payload `manifest.json`; they were not tty failures. That broader run is not reported as fully passing. Linux-only cases were skipped on Windows. Scoped whitespace validation passed.

A fresh LocalEnvironment reran the **exact original verification command**, under both inherited xterm and dumb values. Both exited 0 and returned:

```json
{"renderedContainsExpected":true,"sentinelInStored":true,"sentinelInRendered":true}
```

These checks compare previously generated evidence; they do not generate another reconnect trial.

## Deployment and live verification

The API gateway was confirmed idle (no active agents, API runs, or Chief bots). Its official PID/start-time scoped planned-stop marker produced exit 0 / graceful_shutdown. The existing supervisor was relaunched through its dependency-equipped Hermes virtual-environment interpreter. An initial attempt to use the underlying bare Python could not import psutil and exited before starting a gateway; the correct interpreter resolved that launch error. No package installation was performed.

The live acceptance fixture uses the production Chief HTTP driver and native Hermes terminal, with an isolated Chief bot and normal allow-once approval. It requires exactly one execution of the original command, then independently inspects the persisted native terminal result for exit 0 and all three true comparisons. See `.chief-local/terminal-repair-live-result.json` for the final result and gateway identity.

**Final live result: PASS, 2026-10-20T21:05:09.184Z.** Gateway PID 59628 is running with the API connected. The exact command executed once, received one native-terminal allow-once approval, exited 0, and all three comparison flags were true in the persisted tool result. The fixture was restricted to the native terminal. An earlier unrestricted fixture selected a VM execution tool instead; it was stopped before permission/execution, and was not counted as native-terminal proof.

Chief backend, Tailscale companion, and Hermes API returned 200 after the reload. No live Chief conversation was used as an automated test target.

Phone pairing and Chief's live conversations are preserved. WSL remains untouched. The native Desktop backend was not restarted; the source correction applies there when it next launches.
