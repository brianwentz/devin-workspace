# P8 — Session-scoped GitHub tabs: acceptance

Spec: `docs/plans/session-tabs-plan.md`. Automated coverage: `tests/unit/tabModel.test.ts`
(scope derivation, per-scope dedupe, in-scope neighbour close, scope-relative reorder with
interleaved scopes, v1→v2 restore, pruneScopes, LRU cap helper) and
`tests/e2e/sessionTabs.spec.ts` (visible-set swap, no-reload + form-state persistence,
keepAlive=0 discard/restore, maxLiveTabs LRU + beforeunload skip, restart persistence,
v1 migration).

## Manual rows (real tenant)

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Per-session strips | Open session X, open 2 PRs from its worklog; open session Y, open 1 PR | Strip shows X's 2 tabs, then Y's 1; rail badge counts only visible |  |
| 2 | No reload on switch | In X, type a draft comment on a PR tab; switch to Y and back over ~10 min | Same tabs/order/active; no reload flash; draft text intact |  |
| 3 | Lazy restore | Leave X's tabs open overnight (> keepAliveHours), return to X | Active tab reloads once (tab-restore in events); others reload on click |  |
| 4 | Overflow menu | With tabs in 2+ sessions, click "⋯ N in other sessions" | Native menu lists each session with counts; "Switch to session" navigates Cloud; "Close its tabs" clears them |  |
| 5 | Empty scope | Open a session with no tabs | Strip shows "No GitHub tabs for this session — links from the worklog open here." |  |
| 6 | GLOBAL | From tenant root (no session) open a GitHub link | Tab visible only while outside a session |  |
| 7 | Archived session | Archive session X in Devin (PAT configured); wait for poll (~60 s) | X's tabs auto-close; `tabs-scope-archived` in events.jsonl |  |
| 8 | Settings | Settings → "Keep hidden tabs live for N hours", "Max live tabs" | Both persist; out-of-range values rejected |  |
| 9 | Memory | maxLiveTabs=8, open 9+ heavy PR tabs across sessions | ≤8 live tab webContents (≈3 GB worst case); oldest discarded LRU |  |

## Evidence

- `docs/evidence/p8-memory.md` — RSS at cap (manual, pending real-tenant run).
- e2e events: `tab-discard`, `tab-restore`, `tab-discard-cancelled`, `tabs-scope-switch`,
  `tabs-scope-closed`, `tabs-scope-archived`, `keepalive-threshold`, `max-live-tabs`.
