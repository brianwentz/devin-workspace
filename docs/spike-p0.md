# Devin Workspaces P0 feasibility spike

This is a throwaway feasibility spike, not a complete desktop client. Cloud UI is the real tenant site in Chromium; GitHub tabs are `WebContentsView`s in a separate persistent partition. The local surface is an ACP probe, not a full Local chat UI.

## Pinned versions

| Package | Version | Published |
|---|---:|---|
| Electron | 44.4.5 | 2026-09-23 |
| `@playwright/test` | 1.63.0 | 2026-09-04 |
| `@agentclientprotocol/sdk` | 1.5.0 | 2026-09-21 |
| `electron-builder` | 26.16.1 | 2026-09-07 |
| TypeScript | 6.0.3 | 2026-04-16 |
| esbuild | 0.28.2 | 2026-08-08 |
| Vitest | 3.2.4 | 2025-06-17 |
| `@types/node` | 20.17.0 | 2024-10-23 |

## Gates

| Gate | Status | Evidence |
|---|---|---|
| G1 — Devin tenant SSO in `devinView` | PASS — signed in through Cloudbeds Okta inside the embedded view; chain `cloudbeds.okta.com` → `auth.devin.ai` → tenant `/auth/callback` | Real-tenant event log (kept local, not committed: it holds one-time OAuth codes) |
| G2 — GitHub SAML in `persist:github` | PENDING — GitHub tab loads, but no GitHub sign-in yet, so private-repo PRs show GitHub's 404 | Sign in through the tab's "Sign in" button and verify the session persists across restarts. |
| G3-real — GitHub links in a real Devin worklog | PASS — a PR link in a real session opened through `window.open` and was routed to an embedded GitHub tab (`window-open … decision=github-tab`); tab persisted across restart | Real-tenant event log, `spike-state.json` |
| G3-fixture — link routing and fixture redirects | PASS — Playwright fixture suite, 1/1 test | `docs/evidence/e2e-fixture-run.log`, `docs/evidence/e2e-fixture-events.jsonl` |
| G4 — real pointer splitter drag | PASS — cross-view release and Escape restore at 1x, 1.5x, and 2x | `docs/evidence/os-input-run.log`; per-scale JSON, JSONL, and mid-drag PNGs |
| G5 — shortcuts from shell, Devin, and GitHub | PASS — shell, Devin, and both GitHub tabs at all three scales | `docs/evidence/os-input-run.log`; per-scale JSONL event logs |
| G6 — Devin ACP initialize and session round trip | PASS (local) — initialize, `session/new`, prompt with streamed thought/message chunks, `session/cancel` (`stopReason: cancelled`), `session/list`, and `session/load` history replay all succeed after `devin auth login`; `devin acp --cloud` now initializes too | `docs/evidence/acp-initialize.json`, `acp-initialize-cloud.json`, `acp-roundtrip.jsonl` |

G1, G2, and G3-real require a real tenant and remain intentionally outside the automated fixture tests.

### Real-tenant findings

- The Devin web UI hides its session sidebar below its own responsive width breakpoint. With the GitHub pane open, the Devin view needs roughly a maximized window at 1.5x scale before the sidebar shows. The product build should account for this (e.g. a default pane width that leaves Devin above the breakpoint, or auto-collapse of the pane).
- A full disk made `console.log` throw `ENOSPC` in the main process and Electron showed an uncaught-exception dialog when a PR link was clicked. Logging and state persistence now swallow write failures.
- The real Devin PR link arrives as `window.open`, not as a navigation, so the `setWindowOpenHandler` route is the critical path for G3.

## Run

Use Node.js 22.12 or newer for Electron 44.4.5. The bundled app defaults to `https://cloudbeds.devinenterprise.com`; override it with `DEVIN_WORKSPACES_TENANT_URL`. `DEVIN_WORKSPACES_USER_DATA` and `DEVIN_WORKSPACES_LOG` override the profile and JSONL event log locations. External links are logged but not opened unless `DEVIN_WORKSPACES_ALLOW_EXTERNAL=1`.

Fixture origins from `DEVIN_WORKSPACES_TEST_GITHUB_ORIGINS` and the `__spike` automation hooks are honored only with `DEVIN_WORKSPACES_TEST=1`. `DEVIN_WORKSPACES_DOWNLOAD_DIR` selects a download directory without a dialog; `DEVIN_WORKSPACES_SCALE` sets the Linux scale factor used by the OS-input proof.

```sh
npm run typecheck
npm run test:unit
npm run test:e2e
npm run os:input
npm run acp:probe
npm run acp:probe -- --cloud
npm run dist:win
```

The fixture E2E suite is gated by `DEVIN_WORKSPACES_TEST=1` and uses local Devin, GitHub, and IdP HTTP servers. The OS-input script requires `DISPLAY=:0`, `xdotool`, and ImageMagick's `import`; it uses X11 input rather than Playwright mouse events. The ACP probe spawns the installed `devin` executable over stdio, rejects permission requests, and writes its transcripts under `docs/evidence/`. `--cloud` runs only `devin acp --cloud` initialization.

The Windows deliverable is an unsigned x64 ZIP only; no NSIS installer is built in this spike. The built artifact is `dist/Devin Workspaces P0-0.1.0-win.zip` (153,811,450 bytes); build output is in `docs/evidence/dist-win.log`.

After `devin auth login`, the local ACP probe completed a full round trip: protocol version 1, `loadSession` and session listing advertised, a prompt answered with streamed chunks, a second prompt cancelled, and the session listed and reloaded with its history.
