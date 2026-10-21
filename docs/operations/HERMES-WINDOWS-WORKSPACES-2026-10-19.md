# Nolan and swarm Windows filesystem workspaces

The owner authorized creating folders inside the `.hermes` workspace instead of the invalid Linux roots. The affected profiles run natively on Windows. Each filesystem MCP now has a separate allowed directory under `C:/Users/amank/.hermes/workspace/`:

`nolan`, `swarm2`, `swarm4`, `swarm5`, `swarm6`, `swarm7`, `swarm8`, `swarm9`, `swarm10`, `swarm11`, `swarm12`.

Nolan previously specified `/home/amon`; all ten swarm profiles specified `/path/to/root`. Only the final filesystem-server argument changed in each installed profile's `config.yaml`. The command remains `npx -y @modelcontextprotocol/server-filesystem`. No other settings, tools, credentials or existing files were changed. Hermes' atomic configuration writer was used with a before/after decoded equality check; per-profile backups are recorded in the evidence.

All 11 actual filesystem MCP subprocesses initialized and advertised 14 tools. Each successfully wrote and read a unique temporary marker inside its assigned root, then rejected an attempted read of a synthetic marker outside that root. All markers were removed and subprocess clients closed. This verifies the MCP server's allowed-root boundary, not a Windows-wide sandbox for other agent tools. The first verifier run encountered an SDK field-name mismatch (`is_error` versus `isError`); the verifier was corrected and all 11 checks rerun successfully. No production code change was required.

Evidence: `work/performance-20261019/filesystem-workspaces-verification.json`; implementation and verification harness: `repair-filesystem-workspaces.py` in the same directory. Each entry records the old root, new root, exact backup path and test results.

The gateway confirmed zero active agents at 17:54:25 PDT, accepted a graceful drain, and its old process identity exited at 17:54:39. The canonical Windows startup path was requested at 17:54:47. Live activation verification is recorded separately in `C:/Users/amank/AppData/Local/hermes/reports/filesystem-workspaces-activation-20261019.json`.

At 17:56:52 PDT the live control endpoint confirmed the new gateway (PID 65024, process start fingerprint 179245768232) running with all 21 profiles and all six platform connections ready. Current-boot logs confirm all 11 repaired profiles launched with their assigned Windows root and registered 14 filesystem tools, with zero invalid-root failures. Evidence: `work/performance-20261019/filesystem-workspaces-live.json` and its read-only verifier `verify-filesystem-live.py`.

During activation, six Docker samples returned HTTP 200 in 252–291 ms with all 40 containers running. The final service audit confirmed all 40 original containers present and ready, Chief UI responding in 18 ms, Chief backend in 10 ms, and Hermes in 39 ms. Chief discovery reported Hermes available and authenticated. Evidence: `filesystem-activation-docker.json` and `filesystem-final-service-audit.json` in the same evidence directory. These timings are service response checks; this change verifies actual filesystem operations but does not establish faster model responses or resolve provider cold-start variability.

Rollback, only if requested: restore each filesystem argument to its recorded previous value using a scoped config update, or review the per-profile backup before restoration. Do not overwrite later unrelated changes with a whole-file backup. The newly created directories should remain if they contain user work.
