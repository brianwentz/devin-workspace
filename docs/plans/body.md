# Devin Workspaces — desktop client for Devin Cloud + Devin Local

## 1. Requirements (non-negotiable)
| ID | Requirement (user) |
|---|---|
| R1 | Organize/manage sessions like the Devin web UI sidebar, including **folders** |
| R2 | Selecting a session shows the session window; interact exactly like the web UI |
| R3 | Create new sessions |
| R4 | Changes in the app show in the web UI and vice-versa |
| R5 | Organization section is live: status changes/states like the web |
| R6 | Devin Cloud **and** Devin Local |
| R7 | Any github.com link opens in an in-app hosted Chromium browser, never a new external browser |
| R8 | Reuse browser-hosting components; host Chromium, don't build a browser |
| R9 | Browser section docked right of the conversation; tabs show page titles, can be closed and reordered |
| R10 | Primary Windows x64; possible later macOS and mobile with few changes |
| R11 | Investigate the framework that gives fast, good-looking UI in the Devin web style + portability (RN, Tauri, others) |
| R12 | Simple design; copy the web design, "local controls if feasible" |

## 2. Decisive finding
- Folders are personal with **no documented public API** (Devin release note 2026-06-12). v3 covers sessions/status/messages/create/archive/tags/PRs, but `messages` is chat only — no worklog panels, approvals, PR cards, network-access prompts.
- => Native Cloud controls are **not feasible with the documented public API**; reproducing them would break R1/R2/R4. No private-endpoint automation.
- **Decision: the Cloud surface IS the real Devin web app hosted in a Chromium view.** R1–R5 come from the web app itself; all state is server-side, so sync is the web app's own behaviour (still proven by acceptance tests, §7). The app owns only what the web can't do: the GitHub pane + link routing, Devin Local, native shell extras.

## 3. Framework decision (R10, R11)
| Criterion | **Electron (chosen)** | Tauri v2 | React Native (Win/mac + mobile) | WinUI 3 + WebView2 | Flutter |
|---|---|---|---|---|---|
| Engine | Bundled Chromium, identical Win/mac | WebView2 (Chromium) on Win, **WKWebView on mac** | WebView2 on Win, WKWebView mac/iOS | WebView2 (Win only) | plugin WebView2 |
| N web views in one window | `BaseWindow` + `WebContentsView`, stable | `add_child` behind `unstable`; Win deadlock caveat | possible; thin Windows ecosystem | good | weak |
| Intercept popups/navigation incl. iframes | `setWindowOpenHandler`, `will-navigate`, `will-frame-navigate` | hooks exist, less proven | partial, platform-dependent | `NewWindowRequested` good | plugin-dependent |
| Devin-web-style UI velocity | React + Tailwind (web stack) | same | RN primitives, restyle | XAML | Dart widgets |
| Languages | TS | TS + Rust | TS + native modules | C# | Dart |
| macOS | same code | same code, different engine | RN-macOS | rewrite | ok |
| Mobile | no (reuse `core` in Expo) | Tauri mobile, single webview | best | MAUI rewrite | good |
| Size | ~150–200 MB | small | medium | small | medium |
| Precedent here | automation-hub prototype: "easier start, identical rendering" | prototype: lighter, needs Rust | none | none | none |

**Electron + React + TypeScript + Vite + Tailwind** is the best fit: the product is mostly hosted web content composed in one window; Electron's composition primitive is stable and Chromium-identical on Windows and macOS; our own UI is small and stays in the Devin web stack. Accepted: download size/RAM. WinUI3+WebView2 is the credible Windows-only alternative, rejected for macOS cost. Tauri rejected for unstable multi-webview + WKWebView on mac.
**Mobile path:** keep logic in a platform-free `core` package (LinkRouter, TabModel, API client, ACP types). A future Expo/React Native shell + `react-native-webview` hosts the same (responsive) Devin web app and a GitHub tab sheet. P7 is a feasibility gate, not a support claim.

## 4. Architecture
```
BaseWindow
├─ shellView  WebContentsView, bundled React app (app://), only view with a preload (typed IPC)
│             rail | GitHub tab strip | splitter strip | Local UI | settings
├─ devinView  WebContentsView -> https://<tenant>.devinenterprise.com, partition persist:devin, no preload
└─ ghTab[i]   WebContentsView per tab, partition persist:github, no preload; only active attached
Main: WindowLayout · LinkRouter · TabManager · DevinLocalHost · SettingsStore · (P5) DevinApiClient, Notifier
```
Layout L→R: **Rail** 48px (Cloud / Local / Settings) | **Main** (devinView or Local UI) | **Splitter** 6px shell-owned | **GitHub pane** (tab strip 36px above active ghTab). Toggle `Ctrl+Shift+G`; width + open state persisted. Native views paint over shellView ⇒ shell chrome never overlaps view rects; menus are native `Menu.popup`.

### 4.1 Components and contracts
- **WindowLayout** (main): pure `computeBounds(windowSize, paneState) -> {devin, ghTab, shellRegions}`; applied on resize/toggle/drag. Splitter drag: pointer-down in the shell-owned strip → IPC `layout:dragStart` → main re-adds shellView on top of the z-order (`contentView.addChildView(shellView)`) with full-window bounds and a transparent background, so the shell receives every `pointermove`/`pointerup`/`Escape` while the pointer is over the hosted views' area → on release main restores shellView to the bottom and applies the new width. No hosted content is covered outside a drag. P0 G4 proves it; fallback = width presets + keyboard resize.
- **LinkRouter** (`core`, pure): `route(url, source: 'devin'|'github'|'local'|'shell', disposition: 'new-window'|'navigate'|'background') -> {kind:'gh-tab', background} | {kind:'in-place'} | {kind:'devin'} | {kind:'external'} | {kind:'download'} | {kind:'deny'}`.
  GitHub hosts = `github.com` plus every `*.github.com` and `*.githubusercontent.com` host. **Every GitHub link opens in the pane — no exceptions, no "open in system browser" for GitHub.** Downloads a GitHub page triggers are app-owned (`session.on('will-download')` → native save dialog, progress on the tab).
  Rules: new-window (`_blank`, `window.open`, ctrl/middle-click) → GitHub host ⇒ gh-tab; tenant host ⇒ devin; other http(s) ⇒ external (system browser; R7 covers GitHub only); `mailto:` ⇒ external; other schemes ⇒ deny. Link-initiated top-frame navigation (`will-navigate`/`will-frame-navigate`) **from devinView** to a GitHub host ⇒ `preventDefault` + gh-tab. Everything else — server redirects (`will-redirect`), form posts, IdP/SSO hops, any navigation inside a gh tab — stays **in place** in the view where it started, so Devin SSO and GitHub SAML chains are never split across views.
  Wiring: devinView and ghTabs `setWindowOpenHandler` (catches nested iframes) → `{action:'deny'}` + route; devinView `will-navigate`/`will-frame-navigate` as above. Local chat links call `shell:openLink` IPC → router.
- **TabModel** (`core`, pure reducer) — state `{tabs:[{id,url,title,favicon,loading,originSessionId?}], activeId}`; actions `open(url,{background,originSessionId})` (dedupe: same `owner/repo/pull/N` ⇒ focus + navigate; else exact URL), `close(id)` (activate right neighbour else left), `move(id,toIndex)`, `activate(id)`, `update(id,patch)`, `restore(snapshot)`.
- **TabManager** (main): owns webContents per tab; restored tabs are created lazily on first activation; **no eviction by default**. P2 measures RSS with 5/10/20 open PR tabs; only if the budget (O6) is exceeded, enable state-safe discard: tabs idle ≥ 30 min are closed with `webContents.close({ waitForBeforeUnload: true })` — a page with unsaved state (e.g. a comment draft) cancels via `beforeunload` (`will-prevent-unload`) and is kept; discarded tabs keep id/title/favicon/order and reload on activation; listens `page-title-updated`, `page-favicon-updated`, `did-start/stop-loading`, `did-navigate(-in-page)`; on close / window close calls `webContents.close()`; persists tabs on change.
- **TabStrip** (shell React): title+favicon+spinner, ×, middle-click close, drag-reorder (dnd-kit), overflow scroll, back/forward/reload (kept: PR file/commit views navigate within a tab and need a way back). Nothing else: no address bar, bookmarks, history UI, copy-URL or external-open buttons. Shortcuts via `before-input-event` on every webContents: Ctrl+W, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+Shift+G, Alt+←/→.
- **Cloud surface**: devinView at configurable tenant URL (default `https://cloudbeds.devinenterprise.com`); tracks current session id from `did-navigate(-in-page)` matching `/sessions/<id>` (used for `originSessionId`). Creation/folders/status/interaction = web app.
- **DevinLocalHost** (main): resolves `devin` on PATH (settings override; install guidance if missing); one `devin acp` child per workspace folder; ACP **v1** via `@agentclientprotocol/sdk`; `initialize` → record capabilities; `session/new`, `session/prompt` (stream `session/update`: message chunks, tool calls, plan), `session/cancel`, `session/request_permission` → approval UI; history: `session/list` iff the `initialize` result has `agentCapabilities.sessionCapabilities.list`, `session/load` iff `agentCapabilities.loadSession === true` (both asserted in fake-agent fixtures), else app-local index of sessions created here (labelled "history not supported by agent"). Restart/backoff on crash.
- **Local UI** (shell React, Devin-web look): workspace list → local sessions → chat (markdown, tool-call cards, permission prompts, plan). Cloud handoff via the CLI's `/handoff` command typed in chat; the resulting cloud session then appears in devinView.
- **SettingsStore**: tenant URL, API base `https://api.devin.ai`, workspaces, routing toggles, pane state, tab snapshot (JSON in userData).
- **P5 DevinApiClient/Notifier** (main only): PAT via async `safeStorage` (DPAPI); v3 list polled status-aware (10 s active / 60 s idle, single-flight, 429 backoff); Windows toast + taskbar badge on `waiting_for_user`/`waiting_for_approval`; "Open session PRs" from `pull_requests`.

### 4.2 Security
- Remote views: `sandbox`, `contextIsolation`, no `nodeIntegration`, no preload; per-partition `setPermissionRequestHandler` deny-by-default (Devin host: notifications, clipboard-write); Devin and GitHub partitions separate; never copy cookies between profiles.
- shellView loads only `app://`; strict CSP; IPC args schema-validated (zod).
- `app.enableSandbox()` before ready; fuses: RunAsNode off, cookie encryption on, ASAR integrity on (ACP child spawned with `child_process.spawn` of the external `devin` binary, unaffected by RunAsNode; verify in P3).
- PAT never reaches renderers or logs.

## 5. Phases and exit criteria
- **P0 Spike (go/no-go, 1 session).** Pin versions (Electron, Playwright ≥ release with PR #39912, `@agentclientprotocol/sdk`). Gates, recorded pass/fail in `docs/spike-p0.md`:
  G1 Devin tenant SSO completes in devinView (record actual IdP chain). G2 GitHub SAML for the cloudbeds org in `persist:github`. G3 `_blank`, `window.open`, iframe link, top-level navigation to github from real Devin worklog/PR cards are intercepted. G4 splitter drag (z-order raise) started in the strip, moved and released over devinView and over a gh tab, and cancelled with Escape, at 100/150/200 % scaling. G5 shortcuts captured while focus is inside each view. G6 `devin acp` `initialize` capture (protocolVersion, capabilities), new/prompt/cancel round trip.
  Fallbacks: G1/G2 blocked → use an IdP-supported sign-in method that permits embedded browsers (e.g. Okta directly rather than a Google OAuth hop); if none exists → **stop and re-decide with the user**. Never spoof the user agent to evade an IdP's embedded-webview policy; never copy cookies between profiles. G4 fails → fixed-width presets + keyboard resize. G6 lacks session ops → Local surface becomes embedded terminal (xterm.js + node-pty running `devin`) and must meet the same R6 rows.
- **P1 Shell + Cloud** → R1–R5 via web parity; exit = §7 rows R1–R5 pass on real tenant with a second client (a normal browser, same user).
- **P2 GitHub pane** → R7–R9; exit = router unit table + E2E routing matrix + tab behaviours + persistence + cleanup pass.
- **P3 Windows packaging**: electron-builder NSIS per-user x64; electron-updater from GitHub Releases; unsigned initially (SmartScreen warning accepted for personal use), signing via Azure Trusted Signing later. Exit = installed-artifact smoke (install, launch, views created, partitions/settings persist across restart and upgrade, uninstall).
- **P4 Devin Local** → R6 Local; exit = real `devin acp` contract run + packaged-Windows Local session create/prompt/approve/cancel/restart.
- **P5 Extras**: toasts/badge, session PR quick-open, `Ctrl+N` (navigate devinView to new-session). Exit = PAT encrypted at rest, absent from renderer/logs; toast fires within one poll interval.
- **P6 macOS** (signing/notarization, same code). **P7 Mobile feasibility** (Expo + `core`, hosted Devin + GitHub tab sheet). A phone cannot run the `devin` CLI, so R6-Local on mobile can only mean remote control of the desktop's Devin Local; P7 evaluates that path explicitly and the mobile decision stays pending (O4) — a Cloud-only mobile shell is not counted as requirement-complete.

## 6. Test approach
- **Unit (vitest, `core`)**: LinkRouter table (each host × source × disposition, incl. githubusercontent, gist, tenant, external, mailto, javascript:, data:); TabModel (open/background/dedupe PR subpaths/close-neighbour/move bounds/restore); computeBounds.
- **E2E (Playwright `_electron`, pinned)** against local fixture servers mapped to fake hosts via `--host-resolver-rules`: fake devin page (`_blank` link, `window.open`, iframe link, top-level nav, non-github link), fake github pages (titles, `_blank`, ctrl-click). Assert: tab created/focused, title shown, close activates neighbour, drag reorder order, external → stubbed `shell.openExternal`, no new BrowserWindow ever created, restart restores tabs, window close leaves no orphan webContents (`webContents.getAllWebContents()`).
- **ACP**: fake stdio agent fixture (scripted capabilities with/without list/load) for client tests; real `devin acp` contract script in P0/P4.
- **Packaging (CI `windows-latest`)**: build NSIS, silent install, launch installed exe, run smoke E2E, upgrade from previous artifact, uninstall.
- **Manual real-tenant checklist (§7)** recorded per release.

## 7. Acceptance matrix
| Req | Check | Evidence |
|---|---|---|
| R1 | In app: create folder, rename, move session in/out, drag-drop, collapse; reload app → persists | manual, screenshots |
| R2 | Select session; send message & see streaming; open worklog shell/browser panels; approve a request; PR card click → gh tab | manual |
| R3 | New session from app UI → appears in app sidebar and second-client web UI | manual |
| R4 | Each R1/R3/archive action in app visible in second client after refresh ≤ web's own latency; and the reverse | manual, two clients |
| R5 | Session going working→waiting_for_user→finished updates the app sidebar without reload, observed ≤ the web app's own latency in the second client | manual, timestamps |
| R6 | Cloud = R1–R5; Local: create, prompt, approve permission, cancel, history per capability, handoff to cloud | E2E fake agent + real contract |
| R7 | Every routing-matrix row (source × disposition × host incl. `*.github.com`, `*.githubusercontent.com`, redirects, SSO hops); zero `shell.openExternal` calls for GitHub hosts; GitHub download → in-app save dialog | unit + E2E |
| R8 | Only Electron `WebContentsView`; no custom engine/address bar | code review |
| R9 | Pane right of conversation; titles update; close; reorder; resize/collapse; persist | E2E + manual at 3 DPI scales |
| R10 | Installed Windows x64 smoke; macOS build in P6; mobile decision P7 | CI + docs |
| R11 | Framework table + P0 spike results | this doc + spike doc |
| R12 | Only rail/tab/Local/settings are custom UI | review |

## 8. Open items
- O1 Cognition folder/worklog API (would enable native Cloud controls later).
- O2 Real `devin acp` capabilities (P0 G6).
- O3 Tenant IdP chain inside Electron (P0 G1/G2).
- O4 Mobile + Local: on a phone, Local can only be remote control of the desktop's Devin Local — confirm whether that is wanted before P7.
- O5 Tab scope: global strip with `originSessionId` (decided); per-session filter later if wanted.
- O6 Memory budget for the GitHub pane (P2 measurement decides whether discard is enabled).
