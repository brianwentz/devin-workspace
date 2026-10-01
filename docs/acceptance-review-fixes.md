# Review fixes F1–F10 — acceptance

Each fix from `docs/plans/review-fixes-plan.md`, its automated evidence, and the
manual row where UI/platform behaviour can't be fully automated.

| Fix | Automated evidence | Status |
| --- | --- | --- |
| F1 gh-tab clipboard writes | `tests/e2e/permissions.spec.ts` — `permissions.query({name:'clipboard-write'})` → `granted` in a gh tab, `notifications` → `denied`, `permission-check` allow/deny events logged. Note: `writeText` from a gesture-less `evaluate` still returns `NotAllowedError` (Chromium gesture gate) — real clicks work; the permission grant is what the fix adds. | e2e |
| F2 log volume + rotation | `terminal-data` sampled to 1 line/5 s/terminal + final on exit (`terminal.spec.ts` stays green, no per-flush branch); `logModel` unit tests + `logrotate.spec.ts` (`DEVIN_WORKSPACES_LOG_MAX_BYTES=2000` → `events.1.jsonl` appears). | e2e + unit |
| F3 https-only tenantUrl/apiBase | `settings.test.ts` — `file://`/remote-http dropped to defaults; localhost http allowed. SettingsPanel shows the https message client-side. | unit |
| F4 IPC sender guard | `ipcGuard.ts` wraps every `ipcMain` registration (`guardedHandle`/`guardedOn` → `ipc-rejected` on foreign sender); `__devinworkspaces.ipcProbe()` exposes the predicate (`foreign:false`, `shell:true`) — e2e-covered indirectly via all specs using shell IPC. | typecheck + hook |
| F5 ACP stderr content | `agent-stderr` logs `{workspace, length}` only — `local.spec.ts` green (no stderr-text assertion existed, so the env branch was dropped unconditionally). | e2e |
| F6 username in credential logs | `credential-save`/`credential-fill` log origin+field only. | e2e (credentials.spec) |
| F7 scope-menu GLOBAL nav | `loadInDevinView` reused for both branches (sets `surface='cloud'`); covered by `sessionTabs`/routing e2e (GLOBAL switch path). | e2e |
| F8 quit with unsaved drafts | `shutdown.spec.ts` — `shutdown-probe` + `shutdown-vetoed`, app stays, tab intact; second close with "quit" → `window-close-complete`. Probe runs before terminal dispose (no P4b regression — `terminal.spec.ts` green). | e2e |
| F9 strict flags | `exactOptionalPropertyTypes` + `noImplicitOverride` + `noFallthroughCasesInSwitch` on; 19 errors fixed by widening (no conditional spreads). `tsc --noEmit` clean. | typecheck |
| F10 scope titles | `scopeLabel` unit tests (title/short-id/GLOBAL/60-char truncation); menu uses it. | unit |

## Manual rows

| Row | Steps | Expected |
| --- | --- | --- |
| F1 real GitHub copy | Open a real GitHub PR tab; click a "Copy SHA"/copy button. | Check-mark/confirmation shows; clipboard holds the SHA (paste to verify). |
| F8 real draft + quit | Open a GitHub PR tab, type an unsent comment draft, close the window. | One dialog "1 GitHub tab(s) have unsaved changes. Quit anyway?"; Cancel keeps app + draft; Quit exits cleanly. |
