# P1 acceptance — Shell + Cloud (R1–R5)

Exit criterion (plan §5-P1): §7 rows R1–R5 pass on the real tenant with a second client (a normal browser, same user). Fill one block per release; keep screenshots under `docs/evidence/p1/`.

| Field | Value |
|---|---|
| Build | `git rev-parse --short HEAD`: |
| Tenant | `https://cloudbeds.devinenterprise.com` |
| Second client | Browser + version: |
| Display scale(s) tested | 100% / 150% / 200% |
| Date / tester | |

## Setup
1. Launch the app, sign in through Okta inside the Cloud view (G1 path).
2. Open the same tenant in a normal browser, same user. Keep both visible side by side.
3. Window ≥ 1400 px content width so the Devin sidebar is visible (see "Sidebar breakpoint" below).

## R1 — Folders (sidebar organisation)
| Step (in app) | Expected | Result | Evidence |
|---|---|---|---|
| Create folder `P1-test` | Folder appears in app sidebar | | |
| Rename to `P1-test-renamed` | Name updates | | |
| Drag a session into the folder | Session shown under folder | | |
| Drag it back out | Session back at root | | |
| Collapse / expand folder | State toggles | | |
| Reload app (Ctrl+R in Cloud view) | Folder, name, membership persist | | |

## R2 — Session interaction
| Step | Expected | Result | Evidence |
|---|---|---|---|
| Select a running session | Session view opens | | |
| Send a message | Streaming reply visible | | |
| Open worklog shell / browser panels | Panels render and scroll | | |
| Approve a pending request (if any) | Approval accepted, session proceeds | | |
| Click a PR card / GitHub link | Opens in right-docked GitHub tab, Cloud view URL unchanged | | `events.jsonl` `window-open decision=github-tab` |

## R3 — Create session
| Step | Expected | Result | Evidence |
|---|---|---|---|
| New session from app UI | Appears in app sidebar | | |
| Refresh second client | Same session visible | | |

## R4 — Two-way sync
| Action | Where | Visible in other client after refresh? | Latency vs web-only (approx.) | Evidence |
|---|---|---|---|---|
| Create folder | app → browser | | | |
| Create folder | browser → app | | | |
| Move session into folder | app → browser | | | |
| Move session into folder | browser → app | | | |
| Archive session | app → browser | | | |
| Archive session | browser → app | | | |
| Create session | browser → app | | | |

## R5 — Live status
Observe one session through `working → waiting_for_user → finished` (or `blocked`). Record wall-clock timestamps when each state appears in **both** clients without reload.

| Transition | App timestamp | Browser timestamp | Δ | Evidence |
|---|---|---|---|---|
| working → waiting_for_user | | | | |
| waiting_for_user → working | | | | |
| working → finished | | | | |

Pass if Δ ≤ the web app's own refresh latency (i.e., no systematic lag introduced by the host).

## Sidebar breakpoint measurement (feeds `MIN_DEVIN_WIDTH`)
With the GitHub pane open, shrink the window until the Devin sidebar hides; record the Cloud-view width at the threshold (from `events.jsonl` layout log or DevTools). Repeat at each scale.

| Scale | Cloud-view CSS width where sidebar hides | Auto-collapse triggered? |
|---|---|---|
| 100% | | |
| 150% | | |
| 200% | | |

Current constant: `MIN_DEVIN_WIDTH` in `src/core/layout.ts`. Update it to the measured value + margin and note the change here.

## Shell checks
| Check | Result |
|---|---|
| Splitter drag start/move/release over Cloud view and over a GitHub tab, Escape cancels, at each scale | |
| Ctrl+Shift+G toggles pane with focus in Cloud view / GitHub tab / shell | |
| Settings: change tenant URL → Cloud view reloads; restart → persisted | |
| No shell console errors (`events.jsonl` `console-message` level ≥ 2) | |
| Window close leaves no orphan webContents (`window-close-complete` before == after count 0) | |

## Verdict
R1 ☐  R2 ☐  R3 ☐  R4 ☐  R5 ☐  — P1 exit: ☐ PASS / ☐ FAIL (notes below)

### Run log
- 2026-10-01 — first real-tenant run by the user (Node 24.11.1, Electron 44.4.5, launched from WebStorm). Outcome reported as "working great"; per-row results and the sidebar breakpoint measurement were not recorded yet — fill the tables above on the next pass.
