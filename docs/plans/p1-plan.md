# P1 — Shell + Cloud (implementation plan)

Master plan: `devin-desk-plan.md` §4, §5-P1, §6, §7. Prerequisite: P0 gates G1–G6 (done, `docs/spike-p0.md`; G2 pending one manual GitHub sign-in, non-blocking for P1).

**Goal.** Turn the throwaway P0 spike into the real product skeleton: production project structure, React + Tailwind shell (rail, splitter, tab strip), hosted Cloud surface, settings, and the §4.2 hardening — such that acceptance rows **R1–R5** pass on the real tenant with a second client.

**Exit criteria (from §5).** §7 rows R1–R5 pass on `cloudbeds.devinenterprise.com` against a normal browser signed in as the same user; evidence recorded in `docs/acceptance-p1.md`.

## Scope

In:
- Repo/product restructure; rename off `devin-workspaces-p0`.
- `core` package (platform-free): LinkRouter, TabModel, computeBounds — reuse spike implementations.
- Shell app in React + TypeScript + Vite + Tailwind, loaded via `app://`, only view with a preload.
- Main process split into modules (WindowLayout, TabManager, SettingsStore, routing, downloads, shortcuts, drag).
- SettingsStore: tenant URL, API base (`https://api.devin.ai`), workspaces list, pane state, tab snapshot (JSON in userData, atomic write).
- §4.2 items not yet in the spike: zod-validated IPC args, `@electron/fuses` (RunAsNode off, cookie encryption on, ASAR integrity on).
- Current-session tracking: `did-navigate(-in-page)` on devinView matching `/sessions/<id>` → exposed in state (feeds `originSessionId` in P2).
- Sidebar-breakpoint mitigation (spike finding): pane default width leaves devinView above the Devin sidebar breakpoint at common sizes; auto-collapse pane below a window-width threshold.
- Keep the spike's GitHub pane functional (it validates shell composition and G3 evidence); P2 hardens it to spec.

Out (later phases):
- P2: router unit table completion, E2E routing matrix, PR-subpath dedupe, memory measurement (O6), tab strip polish (dnd-kit, overflow).
- P3: NSIS packaging/updater. P4: Local ACP surface (rail button may exist but shows "coming in P4" stub). P5: PAT/notifications/PR quick-open. P6/P7.

## Work breakdown

### 1. Project restructure
```
package.json           name "devin-workspaces"; add react, react-dom, tailwindcss,
                       @tailwindcss/vite, vite, zod, @electron/fuses, dnd-kit (P2)
src/core/              linkRouter.ts, tabModel.ts, layout.ts (moved as-is)
src/main/              index.ts, window.ts, layout.ts (applyLayout/drag), tabs.ts,
                       routing.ts, settings.ts, downloads.ts, shortcuts.ts, sessions.ts
src/shell/             Vite React app (index.html, src/*), preload.ts
src/shared/            IPC channel names + zod schemas (main ↔ preload ↔ shell)
tests/                 unit (vitest), e2e (Playwright _electron), fixtures (unchanged)
```
- Keep esbuild for `main`/`preload` CJS bundles (already works with Electron 44 CJS entry); add Vite build for the shell renderer only, output to `out/shell`. No electron-vite — one bundler for renderer, existing pipeline for node side. Alternative noted: electron-vite if the dual pipeline becomes painful.
- `app://` protocol handler stays; shell assets served from `out/shell` with existing path-escape guard.
- Delete spike-only scripts (`os-input.ts` kept under `scripts/` for manual use; acp-probe kept for P4).
- `npm run dev` stays build-then-launch; add `npm run dev:watch` (vite --watch + esbuild --watch + electron reload) — optional, do it only if cheap.

### 2. SettingsStore (`src/main/settings.ts`)
- JSON file in userData (`settings.json`), atomic write (tmp+rename, swallow ENOSPC like spike logger).
- Shape: `{ tenantUrl, apiBase, workspaces: string[], routing: {openExternalEnabled}, pane: {open,width}, tabs: snapshot }`.
- IPC: `settings:get` (invoke), `settings:set` (zod-validated partial update); tenant URL change requires app relaunch of devinView (loadURL is enough — same partition keeps SSO).
- Pane state and tab snapshot move out of `spike-state.json` into this store; migrate: read old file once if settings.json absent.

### 3. Shell rewrite (React + Tailwind)
- `src/shell` becomes a Vite React app; strict CSP unchanged (`script-src 'self'`, no inline).
- Components: `Rail` (Cloud / Local / Settings, 48px, icon + tooltip), `TabStrip` (port existing behaviors: title/favicon/spinner/×/middle-click/drag reorder/back-forward-reload/presets), `Splitter` (existing pointer protocol: dragStart/Move/End/Cancel + Escape + safety timeout + `layout:dragReset`), `SettingsPanel` (tenant URL, workspaces, routing toggles), `LocalPanel` stub.
- State: single `state:update` push channel + `state:get`, same shape as spike + `currentSessionId` + `settings`; a small reducer/`useSyncExternalStore` store in the shell.
- Devin-web look: dark `#111827`-family background, 36px strip, 6px splitter — match the web app's density, not a browser chrome.
- Menus that must overlay hosted views use `Menu.popup` (e.g. rail context actions), never shell DOM popovers.

### 4. Main-process refactor (behavior-preserving)
- Split `main.ts` into the §4 component boundaries; keep the proven mechanics verbatim: z-order raise during drag (full-window transparent shell overlay), `will-navigate`/`will-frame-navigate`/`setWindowOpenHandler` routing, `before-input-event` shortcuts (Ctrl+W, Ctrl+Tab, Ctrl+Shift+G, Alt+←/→, Ctrl+Shift+[/]), permission handlers, downloads, explicit `webContents.close()` teardown, `__spike` test hooks (rename `__devinworkspaces`, still `DEVIN_WORKSPACES_TEST`-gated).
- **Session tracking:** on devinView `did-navigate`/`did-navigate-in-page`, regex `/sessions/([^/?#]+)` on the tenant host → `currentSessionId` in state; cleared when navigating elsewhere.
- **Sidebar breakpoint fix:** compute a minimum devinView width (~1024px effective, verify the real breakpoint during implementation); if `windowWidth - rail - paneWidth - splitter < min`, auto-collapse pane (`paneOpen=false` for layout, keep user pref) and surface a subtle "pane hidden — widen window" affordance in the rail.

### 5. Hardening to §4.2
- zod schemas in `src/shared/ipc.ts` for every IPC payload (replace per-handler `typeof` checks).
- `@electron/fuses` at packaging time: `RunAsNode` off, `EnableCookieEncryption` on, `EnableEmbeddedAsarIntegrityValidation` on; assert in a postbuild script (fuse flip is cheap to wire now even though signing is P3).
- Re-verify: `app.enableSandbox()` before ready, remote views have no preload, deny-by-default permission handlers on both partitions, no cookie copying.
- CSP stays in `index.html` meta; confirm Vite emits no inline scripts/styles (tailwind via emitted CSS file, not style injection — build, don't `vite dev`, in the packaged path).

### 6. Tests
- Unit (vitest, `core`): keep existing suites; add cases for the auto-collapse rule in `computeBounds` and session-id URL parsing.
- E2E (Playwright `_electron`, existing fixture servers + `--host-resolver-rules`): port `routing.spec.ts`; add shell-level tests — rail surface switch, splitter drag via `__devinworkspaces` hooks + synthetic pointer, settings round-trip (set tenant URL → devinView reloads → persists across restart), session-id tracking via a fake `/sessions/abc` page, auto-collapse at narrow width.
- Keep `DEVIN_WORKSPACES_TEST`-gated fixture origins; no new BrowserWindow assertion; no-orphan-webContents assertion on close.

### 7. Manual acceptance (`docs/acceptance-p1.md`)
Fill §7 rows R1–R5 on the real tenant, second client = normal browser, same user:
- R1 folders: create/rename/move/drag-drop/collapse, reload persists.
- R2 session interaction incl. worklog panels + approval.
- R3 create session, visible in both clients.
- R4 bidirectional sync incl. archive, within web's own latency.
- R5 live status transitions, timestamps recorded.
- Also record: devinView width at which the tenant sidebar appears (feeds the auto-collapse constant), screenshots at 100/150/200% scaling.

## Risks / watch items
- **Vite + CSP + ASAR:** hashed asset names only; verify no `eval`/inline in emitted bundle.
- **React rewrite regression:** the shell splitter protocol is subtle (z-order raise + Escape + safety timeout) — port behavior first, polish later; the spike shell stays in git history as reference.
- **Auto-collapse correctness:** real breakpoint must be measured on the tenant, not guessed — do this early (cheap: resize dev window, note when sidebar appears).
- **Settings migration:** dev profiles may hold `spike-state.json`; one-time migrate, don't keep both formats alive.
- Fuses: confirm the `devin acp` spawn path is unaffected by RunAsNode-off (it's a separate binary — verify in P3 packaging smoke, note now).

## Suggested commit order
1. Restructure + deps + renamed package, tests green unchanged.
2. SettingsStore + IPC schemas.
3. Shell React rewrite (rail, splitter, strip, settings panel).
4. Session tracking + auto-collapse.
5. Fuses + hardening pass.
6. E2E additions + acceptance doc.
