# P4 acceptance — Devin Local (R6-Local)

Exit criterion (plan §5-P4): real `devin acp` contract run **+** packaged-Windows Local session create / prompt / approve / cancel / restart. §7 row R6-Local: create, prompt, approve permission, cancel, history per capability, handoff to cloud.

| Field | Value |
|---|---|
| Build | `git rev-parse --short HEAD`: |
| Devin CLI | `devin --version`: 3000.11.3 (9c803229faa4) on the dev machine; packaged build: |
| ACP | protocolVersion 1 via `@agentclientprotocol/sdk` 1.5.0 (`ClientSideConnection` over stdio) |
| Date / tester | 2026-10-01 contract + dev-build smoke: automated (see below); packaged rows: |

## How it works (reference while testing)
- One `devin acp` child per workspace folder, spawned with `child_process.spawn(<devin path>, ['acp'], { cwd: workspace })`. The binary comes from `settings.local.devinPath` or `where devin` (PATH). RunAsNode is fused off; the app never forks Node in production — the `DEVIN_WORKSPACES_LOCAL_AGENT_CMD` override is honoured only when `DEVIN_WORKSPACES_TEST=1`.
- Capabilities recorded from `initialize`: `agentCapabilities.loadSession` (→ `session/load`) and `agentCapabilities.sessionCapabilities.list` (→ `session/list`). Without `list`, the session list comes from `userData/local-sessions.json` and is labelled "history not supported by agent"; without `loadSession`, opening such a session errors with `history not supported by agent`.
- Crash: child exit ⇒ agent `crashed`; next use restarts with backoff 1 s, 2 s, 4 s … 30 s (reset after a successful turn). With `loadSession` the UI history is cleared and replayed; without it a fresh remote session is bound and the UI history is kept.
- Permission: `session/request_permission` ⇒ card with the agent's options; the chosen `optionId` is returned; Cancel resolves it as `cancelled`.
- Links in agent markdown go through the LinkRouter (`local:openLink` → `handleLink`), so GitHub links land in the right-docked pane.

## Automated evidence (fake ACP v1 agent, `tests/fixtures/fakeAcpAgent.ts`)
Run: `npm run test:e2e` (also `npm run test:unit`). Unit reducers: `tests/unit/localModel.test.ts` (21 cases: chunk concatenation, thought blocks, messageId splits, tool_call → tool_call_update merge, plan replace, permission set/clear, finishPrompt for every stopReason, resetHistory, upsert/remove, install guidance).

| R6-Local row | Automated by | Status |
|---|---|---|
| Add workspace → agent ready, ACP v1 + capabilities visible | `local.spec.ts` › "with session/list + session/load" (agent status `ready`, `protocolVersion 1`, `capabilities {loadSession:true, sessionList:true}`, badge `#agentBadge[data-status=ready]`) | PASS |
| Create session | same test — `#sessionNew` click → one session in `localState()` and `.session-item` in DOM | PASS |
| Prompt — chunks concatenated, thought collapsed, tool-call card, plan | same test — `hello` via composer (Enter) → agent text `Hello from the fake agent. See [the pull request](…)`, `.thought` collapsed then expanded, `.tool-call[data-status=completed]`, 3 `.plan-entry` | PASS |
| GitHub link in agent message → GitHub pane | same test — click `#messageList .md a` → tab with fixture GitHub URL, `link-open decision=github-tab view=local` | PASS |
| Approve permission | same test — prompt `I need permission` → `.permission-card` with Allow/Reject, click Allow → `perm-1` completed, `end_turn`, `permission-resolved` event | PASS |
| Cancel | same test — prompt `please be slow` → `#cancelButton` → `stopReason: cancelled` (`#stopReason[data-stop-reason=cancelled]`) | PASS |
| History — agent capability | same test — `session/list` returns the session (`historySource: agent`), `session/load` replays 3 user messages + agent text | PASS |
| History — no capability | `local.spec.ts` › "without list/load" — list from `local-sessions.json` (`historySource: local-index`), UI label "history not supported by agent", `session/load` → error `history not supported by agent`; index survives relaunch | PASS |
| Crash → restart | both tests — external `process.kill(pid)` → `crashed` (restarts 1, badge) → next prompt restarts (new pid): rebinding via `load` (with capability) or `new` (without) | PASS |
| Shutdown kills agent children | both tests — `app.quit()` → fake-agent pids gone | PASS |

## Real `devin` CLI contract (`npm run acp:contract`)
Writes `docs/evidence/p4-acp-contract.jsonl`. Ran 2026-10-01 on Windows against `devin 3000.11.3` (logged in): **status `pass`, 9/9 checks** — `initialize.protocolVersion === 1`, `loadSession` boolean (true), `sessionCapabilities` present (list: true), `session/new` id, prompt `end_turn` with `agent_message_chunk`, `session/cancel` → `cancelled`, `session/list` includes the session, `session/load` replays `user_message_chunk`.

Dev-build smoke (Electron app, production spawn path, no test override): workspace added → `devin.exe` resolved via `where`, agent `ready` (affogato, ACP 1, list+load), new session, prompt "Reply with exactly: pong" → agent message `pong`, `session/list` → the session with the agent-supplied title.

## Manual rows — packaged Windows build (`npm run dist:win`)
| Step | Expected | Result | Evidence |
|---|---|---|---|
| Launch packaged app, Rail → Local, **+ Add** → pick a repo folder | Workspace listed, badge `starting` → `ready`, caps `ACP v1 · list yes · load yes` | | screenshot |
| **New session**, type a prompt, Enter | User bubble, streamed agent markdown, thought collapsed, tool cards update status | | `events.jsonl` `prompt-start`/`prompt-finish` |
| Ask Devin to run a command that needs approval (e.g. in Code mode "run `git status`") | Permission card with the agent's options; Allow → turn continues; Reject → agent reports denial | | `permission-request` / `permission-resolved` |
| Long task → **Cancel** | "Turn ended: cancelled", composer re-enabled | | `prompt-finish stopReason=cancelled` |
| Click a GitHub link in the reply | Opens in the GitHub pane, Local view unchanged | | `link-open decision=github-tab` |
| Restart app; select the workspace | Session list from `session/list`; clicking a session replays history | | `session-list source=agent`, `session-load` |
| Kill `devin.exe` in Task Manager, then send a prompt | Badge `crashed · retry…`, prompt restarts the agent and completes | | `agent-exit`, `agent-start`, `session-rebound` |
| Type `/handoff` in the composer | CLI moves the session to Devin Cloud; the new cloud session appears in the Cloud surface | | screenshot + Cloud URL |
| Uninstall / rename `devin.exe` (or set `settings.local.devinPath` to a bad path), relaunch | Badge `missing-cli` with install guidance (docs.devin.ai/desktop) | | screenshot |
