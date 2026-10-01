# Review fixes — branch review of `feat/initial-app` (2026-10-01)

Status: IMPLEMENTED (merged 2026-10-01; Q1 answered: 10 MB, one rotated file). Source: full-branch review at `aaaa388` (findings 1–10). One phase, one worktree, landed as 3 commits (behaviour / hardening / types+nits).

## F1 Clipboard writes in GitHub tabs
**Problem.** `permissions.ts` grants `clipboard-sanitized-write` only to the Devin view on the tenant origin; `gh:*` views deny everything, so GitHub's copy buttons (`navigator.clipboard.writeText`) silently fail.
**Fix.** In `setPermissions`, allow `clipboard-sanitized-write` when `viewName` starts with `gh:` and `isGitHubHost(new URL(origin).hostname)` (import from `core/linkRouter`; under `DEVIN_WORKSPACES_TEST` also accept `fixtureOrigins` so the e2e fixture host qualifies). Everything else stays denied. Keep the per-decision log.
**Test.** e2e (`routing.spec.ts` or new `permissions.spec.ts`): in a GitHub fixture tab, `evaluateInView(() => navigator.clipboard.writeText('x').then(() => 'ok', e => e.name))` → `'ok'`, and the same call in the Devin fixture page for `notifications` → still denied; `events.jsonl` has `permission-check` with `decision: 'allow'` for the gh view. Note: clipboard write from `evaluate` may need `webContents.focus()` first (user-activation); if Chromium still refuses without a gesture, assert on the `permission-check allow` log line instead and record that in the spec comment.
**Manual.** Real GitHub PR: "Copy SHA" shows the check-mark and the clipboard holds the SHA.

## F2 Event-log volume and rotation
**Problem.** `log()` is `appendFileSync` on the main thread per event; `terminalHost.flush()` logs `terminal-data` every ≤8 ms flush. No size cap.
**Fix.**
- `terminalHost`: drop the per-flush log. Keep a per-terminal counter (`bytesOut`) and log `terminal-data` once every 5 s while output is flowing (`{id, bytes}` cumulative since last report), plus on exit/close. Test mode keeps per-flush logging only if `DEVIN_WORKSPACES_TEST=1` (the terminal e2e asserts on `terminal-data`) — check `terminal.spec.ts` first; if it only needs ≥1 event, the sampled log satisfies it and no test-mode branch is needed.
- `log.ts`: rotate when the file exceeds **10 MB** → rename to `events.1.jsonl` (overwriting any previous one), start fresh. Check size cheaply: track bytes written in-process since start + `statSync` once at startup. Sync write stays (the e2e `waitForEvent` helpers rely on immediate visibility); the volume fix is what matters.
**Test.** Unit (`core`): factor `shouldRotate(currentBytes, lineBytes, limit)`? Too trivial — instead a small e2e-free unit for the terminal sampler if it is pure (`sampleTerminalLog(now, last, bytes)`); otherwise cover by the existing terminal e2e still passing. Rotation: unit-test a pure `nextLogFiles(path)` helper; manual check by setting `DEVIN_WORKSPACES_LOG_MAX_BYTES` (test-mode env, default 10 MB) to 2000 in a quick e2e assertion that `events.1.jsonl` appears.

## F3 `tenantUrl` / `apiBase` scheme restriction
**Fix.** In `src/shared/ipc.ts`, `const HttpsUrl = z.url().refine(isAllowedAppUrl, 'must be https (http allowed for localhost only)')` where `isAllowedAppUrl` (pure, in `core/settings.ts` or `core/sessions.ts`) accepts `https:` any host, `http:` only for `localhost` / `127.0.0.1` / `[::1]`. Apply to `tenantUrl` and `apiBase`. `DEVIN_WORKSPACES_TENANT_URL` env (fixtures use `http://localhost:PORT`) already bypasses the schema; keep it that way. `parseSettingsFile` repair path will drop an invalid persisted value and fall back to the default — add a unit test for that (`file://` → default + `dropped` includes `tenantUrl`).
**Shell.** Settings panel shows the zod message when `setSettings` returns unchanged (it already echoes the resulting settings; if there is no error channel, show "Must be an https URL" client-side using the same pure helper).

## F4 IPC sender guard
**Fix.** `src/main/ipcGuard.ts`: `export function fromShell(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean` → `event.sender === state.shellView?.webContents` (and `event.senderFrame === null || event.senderFrame.url.startsWith('app://shell/')`). Wrap registration: a tiny `handle(channel, fn)` / `on(channel, fn)` pair that logs `ipc-rejected {channel}` and returns `undefined` when the guard fails. Apply in `ipc.ts`, `local/ipc.ts`, `local/terminalIpc.ts` (the local ipc already has a `handle` helper — extend it rather than duplicating).
**Test.** Unit for the pure predicate is meaningless; e2e: from the Devin fixture view (no preload) there is no `ipcRenderer`, so the negative path can't be exercised from a page. Cover with a main-side test hook instead: `__devinworkspaces.ipcProbe()` emits a synthetic event with a foreign sender → expect `ipc-rejected`. If that's awkward, accept "guard present + typecheck" and note it in the acceptance doc.

## F5 ACP stderr content
**Fix.** `acpHost.ts:291`: log `{workspace, length}` only; drop `text.slice(0, 500)`. Under `DEVIN_WORKSPACES_TEST=1` keep the text (the fake-agent e2e may assert on it — check `local.spec.ts`; if not, drop unconditionally).

## F6 Username in credential logs
**Fix.** `credentials.ts` `credential-save` / `credential-fill` / menu: log `origin` + `field` only. Update any unit test asserting on `username` in the log detail.

## F7 Scope menu "Switch to session" (GLOBAL)
**Fix.** `ipc.ts` GLOBAL branch: set `state.surface = 'cloud'` before `loadURL`, same as the session branch. Factor both into one `navigateCloud(url)` helper in `routing.ts` (`loadInDevinView` already exists and sets the surface — reuse it; export it).

## F8 Quit with unsaved GitHub drafts
**Problem.** `shutdown()` closes tab webContents with plain `close()`; a `beforeunload` veto is ignored → draft lost silently.
**Fix (decided: one consolidated prompt, not silent loss).** Restructure `shutdown()` into two stages:
1. **Probe stage** (before any teardown): for each live tab, `close({ waitForBeforeUnload: true })` with the existing 3 s/`destroyed` race (reuse `TabManager.close()` semantics, but with `onBeforeUnload` replaced by a shutdown-aware callback that records the veto instead of prompting per tab). If ≥1 tab vetoes → one dialog: "N GitHub tab(s) have unsaved changes. Quit anyway?" `[Quit] [Cancel]`. **Cancel** → `state.shuttingDown = false`, `state.shutdownPromise = null`, the vetoing tabs stay (they were never destroyed), `applyLayout()`, return without quitting. **Quit** → fall through.
2. **Teardown stage** (current body): tabs already closed in stage 1 are skipped; vetoing tabs are now closed with plain `close()`.
Under `DEVIN_WORKSPACES_TEST=1` the dialog is replaced by `DEVIN_WORKSPACES_TEST_BEFOREUNLOAD` (`stay` → Cancel path, else Quit) — same env the tab-close path uses.
**Test.** e2e: open a fixture tab with the beforeunload hook, trigger window close with `DEVIN_WORKSPACES_TEST_BEFOREUNLOAD=stay` → app still running, tab still in `publicState`, `events.jsonl` has `shutdown-vetoed`; then with default → exits cleanly, `window-close-complete` logged. Must also keep the terminal "no orphan on quit" spec green (stage order: probe → terminal dispose → rest).
**Risk.** This touches the shutdown path that P4b just fixed (`app.exit(0)` hang). Keep `app.exit(0)` at the end; the probe stage runs before `terminalHost.dispose()`.

## F9 `exactOptionalPropertyTypes`
**Fix.** Enable in `tsconfig.json`; fix the 19 errors by widening the declared types (`signal?: AbortSignal | undefined`, `detail?: Record<string, unknown> | undefined`, `favicon?: string | undefined`, etc.) rather than sprinkling conditional spreads — the former is the idiomatic fix. Also enable `noImplicitOverride` and `noFallthroughCasesInSwitch` (expected 0 errors; if `noImplicitOverride` finds any, add `override`).

## F10 Session titles in the scope menu
**Fix.** `ipc.ts` scope menu label: look up `state.apiSessions.find(s => s.session_id === scope)?.title`; label = `title` (truncate 60 chars) if present else `Session <id.slice(0,8)>`. Pure `scopeLabel(scope, sessions)` in `core/notifyModel.ts` with a unit test (title / no title / GLOBAL).

## Order and packaging
- Worktree `../Devin-console-fixes`, branch `review-fixes`.
- Commit A (behaviour): F1, F7, F10, F8.
- Commit B (hardening/logging): F2, F3, F4, F5, F6.
- Commit C (types): F9.
- Gate: typecheck, unit, full e2e; `npm run dist:win` **not** required (no packaging change) — but run the terminal e2e explicitly since F2 and F8 touch it.
- Docs: `AGENTS.md` conventions gain: "IPC handlers go through `ipcGuard` (shell sender only)", "log URLs/ids/lengths only — never page or process output text", "`tenantUrl`/`apiBase` must be https (localhost http in tests)". New env `DEVIN_WORKSPACES_LOG_MAX_BYTES` (test only). Append to `docs/acceptance-p8.md` or new `docs/acceptance-review-fixes.md`: manual rows for F1 (real GitHub copy button) and F8 (real draft comment + quit).

## Decisions made in this review
- **F8 gets a real prompt** rather than documenting silent loss — a lost PR review comment is exactly the state the discard logic already protects; quitting shouldn't be the one path that drops it. Cost: shutdown restructure (the riskiest item here; isolated in its own part of commit A so it can be reverted alone).
- **Sync log write stays** (e2e relies on immediate visibility); the fix targets volume (terminal sampling) and growth (rotation), which is where the cost was.
- **Types widened, not spread-guarded** for F9 — keeps call sites readable.
- **F4 guard is best-effort testable** — the negative path has no renderer-side trigger; a test hook is acceptable, "present + typecheck" is the fallback.

## Open question
- **Q1** F2 rotation limit 10 MB and keeping one rotated file (`events.1.jsonl`) — fine, or keep more history?
