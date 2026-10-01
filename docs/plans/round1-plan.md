# Devin Workspaces — desktop client for Devin Cloud + Devin Local (Round 1 draft)

## 1. Requirements (verbatim intent, non-negotiable)
R1 Organize/manage sessions like the Devin web UI sidebar incl. **folders**.
R2 Select a session -> session window, interact exactly like the web UI.
R3 Create sessions.
R4 Two-way sync with the web UI (changes here visible there and vice-versa).
R5 Live organization section: status changes/states like the web.
R6 Support Devin Cloud **and** Devin Local.
R7 Any github.com link opens in an in-app hosted Chromium browser, not an external browser.
R8 Reuse browser hosting components; do not build a browser.
R9 Browser section docked right of the conversation, with tabs: page titles, close, reorder.
R10 Primary target Windows x64; possible later macOS and mobile with few changes.
R11 Framework investigation (React Native, Tauri, others) for fast, nice UI matching Devin web style.
R12 Simple design; "copy that design but build with local controls if feasible".

## 2. Key finding that shapes the design
- Folders are personal and have no public API (brief #1). The v3 API covers sessions/status/messages/create/archive/tags/PRs, but the **messages** endpoint returns chat messages only, not the full worklog (shell/browser/IDE panels, approvals, PR cards, network-access prompts).
- Therefore a native (local-controls) sidebar + native conversation view **cannot** satisfy R1+R2+R4 today. Building with local controls is *not feasible* for parity (R12 conditional "if feasible").
- Decision: **host the real Devin web app** as the Cloud surface inside a Chromium view. Parity (R1-R5) and sync (R4) hold by construction — it is the web UI, all state is server-side. Our app owns only the chrome around it: the GitHub pane, link routing, Devin Local, and native extras.

## 3. Framework evaluation (R10, R11)
| Criterion | **Electron** | Tauri v2 | React Native (Windows/macOS + mobile) | Flutter | .NET MAUI / WinUI3 + WebView2 |
|---|---|---|---|---|---|
| Hosts Chromium | Bundled Chromium, identical on Win/mac | WebView2 (Chromium) on Win; **WKWebView** on mac (violates "host chromium" there) | react-native-webview -> WebView2 on Win, WKWebView on mac/iOS | community `webview_windows` plugin | WebView2 on Win; WKWebView on Mac Catalyst |
| Multiple web views in one window (Devin + N tabs) | `BaseWindow` + `WebContentsView`, stable, documented | `add_child` behind `unstable`; Windows deadlock caveat (brief #6) | Possible, ecosystem thin on Windows; window.open interception limited | Weak | Good on Windows (WebView2 controls) |
| Intercept window.open / navigation from embedded site | `setWindowOpenHandler`, `will-navigate`, `will-frame-navigate` (incl. iframes) | navigation/new-window hooks exist; verify parity | partial (`onShouldStartLoadWithRequest`, `onOpenWindow` platform-dependent) | plugin-dependent | WebView2 `NewWindowRequested` (good) |
| UI velocity / Devin web look | React + Tailwind, same stack as web | Same (web frontend) | RN primitives, not CSS; restyle | Dart widgets | XAML |
| Languages | TS only | TS + Rust | TS (+ C++/C# native modules on Windows) | Dart | C# |
| Mobile path | none (reuse `core` TS pkg in Expo app) | Tauri mobile (single webview per window) | best | good | MAUI |
| Size / RAM | ~150-200 MB, heavier | small | medium | medium | small |
| Institutional precedent | prototype `b2292ed06`, "easier start" (brief #5) | prototype `6a4e28c2e`, needs Rust | none | none | none |

**Recommendation: Electron + React + TypeScript + Vite + Tailwind.** Rationale: the app is mostly *hosted web content* (Devin web, GitHub) composed into one window; Electron's `WebContentsView` is the only stable, documented, cross-platform-identical primitive for that, and Chromium is identical on Windows and macOS (R8, R10). Our own UI surface is tiny (rail, tab strip, settings, local chat), so velocity favors staying in the web stack. Accepted cost: size/RAM.
**Mobile (R10):** Electron does not run on mobile. Strategy: keep all non-Electron logic in a platform-free `@devin-workspaces/core` package (link router, tab model, Devin API client, ACP types). A later mobile app = Expo/React Native shell + `react-native-webview` hosting the same Devin web app (already responsive) + a GitHub tab sheet, reusing `core`. Devin Local is desktop-only by nature.
Rejected: Tauri (unstable multiwebview, non-Chromium on mac); RN-Windows (thin webview/desktop ecosystem for multi-view + interception); Flutter/MAUI (abandon web styling, webview maturity).

## 4. Architecture
```
BaseWindow
├─ shellView   (WebContentsView, our React app, preload w/ typed IPC)  rail | tab strip | splitter | settings | local chat
├─ devinView   (WebContentsView, https://<tenant>.devinenterprise.com, partition persist:devin, no preload)
└─ ghTabs[]    (WebContentsView per tab, partition persist:github, no preload)  — only active tab attached
Main process: WindowLayout, LinkRouter, TabManager, DevinLocalHost (spawns `devin acp`), DevinApiClient (optional), SettingsStore, Notifier
```
Layout (left->right): **Rail** (Cloud / Local / Settings icons, ~48px, shellView) | **Main** (devinView for Cloud, or shellView Local UI) | **Splitter** | **GitHub pane** (tab strip in shellView on top, active ghTab view below). Pane toggle `Ctrl+Shift+G`; width persisted.
Native views paint above shellView, so shell chrome never overlaps web views: tab strip sits above the view rect; menus use native `Menu.popup`.

### 4.1 Components
- **WindowLayout** (main): computes bounds for devinView/ghTab/shell regions on resize, pane toggle, splitter drag.
- **LinkRouter** (`core`, pure): `route(url, source: 'devin'|'github'|'local', disposition) -> OpenInGithubPane{newTab,background} | NavigateInPlace | OpenInDevinView | OpenExternal | Deny`. Rules: host `github.com` (+ `gist.github.com`, `*.githubusercontent.com` download links -> download) -> GitHub pane; Devin tenant host from GitHub tab -> devinView; other http(s) -> system browser; non-http schemes -> deny except allowlisted (`mailto:`).
- Wiring: devinView `setWindowOpenHandler` (covers target=_blank incl. from nested iframes) + `will-navigate`/`will-frame-navigate` for top-level github navigations -> `deny` + route. GitHub tabs: same-host navigation in place; `_blank`/ctrl-click -> new tab.
- **TabManager** (main) + **TabModel** (`core`, pure reducer): `open(url,{background})` dedupes by normalized URL (PR `/pull/N` + subpaths -> same tab, navigate), `close(id)` activates right neighbor else left, `move(id,toIndex)`, `activate(id)`; subscribes to `page-title-updated`, `page-favicon-updated`, `did-start/stop-loading`, `did-navigate`; on close calls `webContents.close()` (brief #9). Persist `{url,title}[]` + active id; restore lazily (create webContents on first activation).
- **TabStrip** (shellView React): title + favicon + spinner, close ×, middle-click close, drag reorder (dnd-kit), overflow scroll, back/forward/reload, copy URL, "open in system browser". Shortcuts via `before-input-event` on every webContents so they work when focus is inside a page: Ctrl+W, Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+Shift+T reopen.
- **Devin Cloud surface**: devinView pointed at configurable tenant base URL (default `https://cloudbeds.devinenterprise.com`). Tracks current session id from `did-navigate`/`did-navigate-in-page` (`/sessions/<id>`). SSO in-view, cookies persisted in `persist:devin`.
- **Devin Local (R6)**: `DevinLocalHost` spawns `devin acp` per workspace folder (stdio JSON-RPC via ACP TS SDK), `initialize`, `session/new`, `session/prompt`, streams `session/update` (message chunks, tool calls, plan), answers `session/request_permission` with an approval UI; history via `session/list` + `session/load` if advertised (brief #8). Local UI in shellView: workspace list + local session list + chat, styled like Devin web. GitHub links in local chat go through LinkRouter. Cloud handoff exposed via existing CLI `/handoff` (session then appears in devinView).
- **DevinApiClient (optional, Phase 5)**: PAT in `safeStorage` (DPAPI). Uses v3 list with status-aware polling (brief #4) for Windows toast + taskbar badge on `waiting_for_user`/`waiting_for_approval`, and "Open this session's PRs" action (session `pull_requests`) into tabs.
- **SettingsStore**: tenant URL, API base (`https://api.devin.ai`), link-routing toggles, workspace folders, pane state (electron-store / JSON in userData).

### 4.2 Security
- Remote views: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **no preload**; session-level `setPermissionRequestHandler` deny-by-default (allow notifications + clipboard-write for Devin host only); separate partitions for Devin and GitHub.
- shellView only loads bundled `app://` content; IPC validated by schema; CSP strict.
- Electron fuses (RunAsNode off, cookie encryption on, ASAR integrity), `app.enableSandbox()`.
- PAT never sent to renderers; API calls in main only.

## 5. Phases
P0 Spike (exit: go/no-go): BaseWindow + devinView SSO login to tenant; confirm window.open from worklog/PR cards is interceptable; GitHub SAML SSO in `persist:github`; splitter drag across native views; shortcut capture.
P1 Shell + Cloud: rail, devinView, persisted partitions, LinkRouter (external links), settings, window state. -> R1-R5 delivered via web parity.
P2 GitHub pane: TabManager/TabStrip full behaviors, routing from devinView, persistence, pane toggle/resize. -> R7-R9.
P3 Windows packaging: electron-builder NSIS per-user x64, auto-update (electron-updater, GitHub Releases), fuses; code signing optional.
P4 Devin Local: P4a embedded terminal (xterm.js + node-pty) running `devin` per workspace (fast parity with CLI); P4b ACP chat UI.
P5 Native extras: API token, toasts/badge, session PR quick-open, Ctrl+N new session (navigate devinView to new-session page).
P6 macOS build (signing/notarization). P7 mobile evaluation (Expo + core).

## 6. Test approach / evidence
- Unit (vitest, `core`): LinkRouter table-driven (github/gist/devin/external/mailto/javascript:), TabModel reducer (open/dedupe/close-neighbor/move/restore).
- E2E (Playwright `_electron`) with local fixture servers standing in for Devin and GitHub: fixture "devin" page with `target=_blank` github link, iframe link, `window.open`; fixture "github" pages with titles; assert tab created, title shown, close/reorder, routing back to devinView, external link -> `shell.openExternal` stub.
- ACP: fake ACP agent (stdio) fixture for client tests; manual contract check vs real `devin acp`.
- Packaging: CI `windows-latest` builds NSIS, installs silently, launches, runs smoke E2E.
- Manual checklist with real tenant: SSO, folder move in app visible in browser web UI and vice versa (R4), live status change, PR link opens tab.

## 7. Open items
O1 Folder API from Cognition (would enable native sidebar later). O2 `devin acp` capabilities (`session/list`/`load`). O3 Okta/SSO behaviour inside Electron. O4 Tab scope: global vs per-session (draft: global).
