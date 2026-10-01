# Acceptance — P4b Local terminal

| Row | Result |
|---|---|
| Local surface: "Chat \| Terminal" segmented control per selected workspace | e2e + manual |
| Terminal opens `devin` CLI (external binary) in the workspace cwd | manual: `docs/evidence/p4b-terminal.png` |
| `devin --help` runs interactively in the embedded terminal | manual |
| Resize propagates (SIGWINCH-equivalent via ConPTY resize) | e2e `terminalResize` returns true; manual |
| Close exits the pty — no orphan `devin`/conhost processes | e2e: pid dead after close |
| Quitting the app with an open terminal leaves no orphan processes | e2e: `pidAlive(pid) === false` after quit |
| Terminal survives Chat↔Terminal toggles (mounted hidden, pty kept) | manual |
| Workspace removal closes its terminal | code path: `localWorkspaceRemove` → `terminalHost.closeForWorkspace` |
| Packaged exe (`dist/win-unpacked`) opens a terminal — node-pty loaded from unpacked asar | PASS: `docs/evidence/p4b-packaged-terminal.jsonl` (terminal-open ok:true + terminal-data, driven over CDP per smoke-install pattern) |
| Missing CLI → `{ok:false}` + install guidance (same text as chat) | e2e + unit path |

## Evidence
- E2E: `tests/e2e/terminal.spec.ts` (fixture `node out/fixtures/fakePty.cjs` via `DEVIN_WORKSPACES_TEST_TERMINAL_CMD`).
- Screenshot: `docs/evidence/p4b-terminal.png`.
- events.jsonl: `terminal-open` detail `{id, workspace, ok, pid}`; `terminal-data` logs **byte counts only**; `terminal-exit`/`terminal-close` log ids. Terminal content is never logged.
