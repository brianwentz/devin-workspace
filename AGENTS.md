# Devin Workspaces — project rules

Electron desktop client for Devin (BaseWindow + WebContentsViews; React shell is the only view with a preload).

## Commands
- `npm run typecheck` — `tsc --noEmit`
- `npm run test:unit` — vitest, `tests/unit` (pure logic only)
- `npm run build` — esbuild (main/preload/scripts → `out/*.cjs`) + `vite build` (shell → `out/shell`)
- `npm run test:e2e` — build + Playwright `_electron` (`tests/e2e`, fixture servers in `tests/fixtures/http.ts`)
- `npm run dist:win` — build + electron-builder NSIS per-user x64 installer → `dist/DevinWorkspaces-Setup-<version>.exe` (unsigned, fuses flipped in `scripts/after-pack.cjs`, icon from `build/icon.ico` via `npm run icon`)
- `npm run smoke:install` — `scripts/smoke-install.ps1`: silent install → `tests/smoke/installed.spec.ts` (CDP-driven, `playwright.smoke.config.ts`) → upgrade-in-place → uninstall; evidence in `docs/evidence/p3-smoke*`
- `npm start` / `npm run acp:probe`
- CI: `.github/workflows/windows.yml` (push/PR: typecheck, unit, build, e2e, dist:win, smoke:install); `release.yml` (tag `v*`: `electron-builder --publish always` to GitHub Releases, feed used by `src/main/updater.ts`)

## Env vars
`DEVIN_WORKSPACES_TEST=1` enables `__devinworkspaces` hooks; `DEVIN_WORKSPACES_TENANT_URL` (overrides settings.tenantUrl); `DEVIN_WORKSPACES_USER_DATA` (default userData is `%APPDATA%\devin-workspaces` (from package.json `name`)), `DEVIN_WORKSPACES_LOG`, `DEVIN_WORKSPACES_DOWNLOAD_DIR`, `DEVIN_WORKSPACES_SCALE`, `DEVIN_WORKSPACES_ALLOW_EXTERNAL` (test override for `settings.routing.allowExternal`), `DEVIN_WORKSPACES_TEST_GITHUB_ORIGINS` (comma-separated), `DEVIN_WORKSPACES_TEST_BEFOREUNLOAD`, `DEVIN_WORKSPACES_TEST_KEEPALIVE_MS` (test override for `settings.tabs.keepAliveHours`; 0 = discard hidden-scope tabs on switch), `DEVIN_WORKSPACES_LOG_MAX_BYTES` (test-only event-log rotation cap, default 10 MB). Smoke only: `DEVIN_WORKSPACES_INSTALLED_EXE`, `DEVIN_WORKSPACES_SMOKE_PROFILE`, `DEVIN_WORKSPACES_SMOKE_PHASE` (`fresh`|`upgrade`), `DEVIN_WORKSPACES_SMOKE_EVIDENCE`. `DEVIN_WORKSPACES_TEST=1` also disables the auto-updater. `DEVIN_WORKSPACES_EVIDENCE=1` makes the routing e2e write its event log to `docs/evidence/e2e-fixture-events.jsonl` (default: temp profile, to avoid churning tracked evidence).
P5 (test mode only): `DEVIN_WORKSPACES_API_BASE` (overrides `settings.apiBase` for the v3 poller), `DEVIN_WORKSPACES_POLL_MS` (poll interval for active and idle), `DEVIN_WORKSPACES_TEST_TOAST=1` (re-enable OS toasts, which are otherwise suppressed under `DEVIN_WORKSPACES_TEST=1`; `notification-shown` is logged either way).
- `npm run acp:contract` — P4 contract run against the real `devin acp` (initialize/new/prompt/cancel/list/load); writes `docs/evidence/p4-acp-contract.jsonl`; exit 0 also when the CLI is missing/unauthenticated (reported in the file)
`DEVIN_WORKSPACES_LOCAL_AGENT_CMD` (test mode only, e.g. `node out/fixtures/fakeAcpAgent.cjs`) replaces the `devin acp` spawn with a full command; the fake agent reads `FAKE_ACP_LIST=1` / `FAKE_ACP_LOAD=1` / `FAKE_ACP_LINK_URL`. `DEVIN_CLI` overrides the binary for `acp:probe` / `acp:contract`.
`DEVIN_WORKSPACES_TEST_TERMINAL_CMD` (test mode only, e.g. `node out/fixtures/fakePty.cjs`) replaces the `devin` binary the embedded terminal spawns.

## Versions
Requires Node ≥ 22.12; currently developed on Node 24.x. All deps are pinned exact — package.json is the source of truth.

## Conventions
- `src/core/` is pure TS — no `electron` imports (unit-testable).
- All IPC payloads are validated with the zod schemas in `src/shared/ipc.ts`; add a schema when adding a channel.
- IPC handlers go through `ipcGuard` (`guardedHandle`/`guardedOn`) — shell sender only.
- Log URLs/ids/lengths only — never page or process output text (terminal output, ACP stderr, credential usernames/passwords are all excluded).
- `tenantUrl`/`apiBase` must be https (localhost http only in tests via `DEVIN_WORKSPACES_TENANT_URL`).
- Remote views (devin + `gh:*` tabs) never get a preload; sandbox + contextIsolation stay on; partitions `persist:devin` / `persist:github` stay separate.
- Shell loads only `app://shell/...`; strict CSP — `script-src 'self'`, no inline script; `style-src` allows `'unsafe-inline'` only because xterm.js injects `<style>` elements (P4b) — keep all other directives unchanged.
- Explicit `webContents.close()` on tab/window teardown; keep the splitter z-order-raise drag protocol intact.
- Secrets (vault passwords) never reach renderers or logs; credential IPC handlers must not log payloads.
- The Devin API token lives only in `src/main/secrets.ts` (safeStorage-encrypted `userData/secrets.json`) and main-process memory: never add it to `ShellState`, IPC replies, or `log()` calls. Scrub error strings with `sanitizeMessage`.
- Devin Local (`src/main/local/`, `src/shell/local/`, reducers in `src/core/localModel.ts`): spawn the external `devin` binary (`acp`), never fork Node (RunAsNode fuse is off). Gate `session/list` / `session/load` on `agentCapabilities.sessionCapabilities.list` / `agentCapabilities.loadSession`. Log prompt/message lengths and ids, never content.
- P4b terminal: `node-pty` is N-API, so its win32-x64 prebuild works in Electron without a rebuild — no postinstall; `npm run rebuild:native` (electron-builder install-app-deps) exists if a rebuild is ever needed (requires MSVC). node-pty is esbuild-external + `asarUnpack`ed and `build.files`-listed. Terminal output is never logged (byte counts only).
