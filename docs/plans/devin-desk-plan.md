# Devin Workspaces — plan (cb:plan-review)

**Rounds Completed: 3 of 3**

## Final Plan Summary
Electron (React + TypeScript + Vite + Tailwind) Windows-x64-first desktop app. The Cloud surface is the **real Devin web app hosted in a Chromium `WebContentsView`**, because session folders and the full worklog have no documented public API — so folders, live status, session interaction, creation and two-way sync come from the web app itself instead of a re-implementation. The app adds what the web cannot: a right-docked GitHub pane (one `WebContentsView` per tab, titles/close/reorder) fed by a link router that sends every GitHub link there, a Devin Local surface driving `devin acp` (ACP v1), and native extras (toasts, PR quick-open). Pure logic lives in a platform-free `core` package for a later macOS build (same code) and a mobile feasibility study.

## Key Design Decisions
| Decision | Choice | Why | Rejected |
|---|---|---|---|
| Cloud UI | Host the real Devin web app | Folders personal + no public API; v3 `messages` lacks worklog/approvals | Native sidebar/chat on v3 (breaks R1/R2/R4); private-endpoint automation |
| Framework | Electron | Stable multi-view composition, identical Chromium on Win/mac, web-stack UI, team precedent | Tauri (unstable `add_child`, WKWebView on mac), RN-Windows (thin multi-webview), WinUI3 (Windows-only), Flutter |
| GitHub pane | `WebContentsView` per tab, `persist:github` partition | Reuse Chromium, no custom engine | Single navigating view (no tabs), `<webview>` tag (discouraged) |
| Link routing | Pure `LinkRouter` in `core`; route only new-window + link-initiated nav from devinView; redirects/SSO stay in place | Every GitHub link in-app without splitting auth chains | Global URL interception |
| Tab scope | One global strip, tabs carry `originSessionId` | Simplest; context retained | Per-session tab sets |
| Local | ACP v1 chat UI via `@agentclientprotocol/sdk`; terminal only if P0 G6 fails | One Local surface; matches Devin web look | Building both terminal and chat |
| Splitter | Raise shellView to top z-order during drag | Reliable pointer-up over hosted views | Cursor polling (no button state) |
| Memory | No eviction by default; measured, state-safe discard if needed | Avoid losing drafts | Fixed LRU N |
| Auth | Sign in inside the hosted views; separate partitions | Same as a browser profile | UA spoofing, cookie copying |

## Complexity Accepted
- 150–200 MB installer and per-tab renderer memory (Electron).
- Main-process z-order juggling for splitter drag; manual bounds layout of native views.
- ACP capability negotiation with fallbacks.
- App-owned download handling for GitHub.

## Simplifications Made
- No native re-implementation of the Devin sidebar, conversation, folders or create flow.
- No address bar, bookmarks, history, copy-URL/external-open buttons, reopen-closed-tab, find-in-page.
- One Local surface (ACP chat), not chat + terminal.
- Global tabs, not per-session tab sets. Code signing deferred (personal use).

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
  G1 Devin tenant SSO completes in devinView (record actual IdP chain). G2 GitHub SAML for the cloudbeds org in `persist:github`. G3 `_blank`, `window.open`, iframe link, top-level navigation to github from real Devin worklog/PR cards are intercepted. G4 splitter drag (z-order raise) started in the strip, moved and released over devinView and over a gh tab, and cancelled with Escape, at 100/150/200 % scaling; while raised, the shell page's own CSS is transparent outside the splitter so the hosted views stay visible. G5 shortcuts captured while focus is inside each view. G6 `devin acp` `initialize` capture (protocolVersion, capabilities), new/prompt/cancel round trip.
  Fallbacks: G1/G2 blocked → use an IdP-supported sign-in method that permits embedded browsers (e.g. Okta directly rather than a Google OAuth hop); if none exists → **stop and re-decide with the user**. Never spoof the user agent to evade an IdP's embedded-webview policy; never copy cookies between profiles. G4 fails → fixed-width presets + keyboard resize. G6 lacks session ops → Local surface becomes embedded terminal (xterm.js + node-pty running `devin`) and must meet the same R6 rows.
- **P1 Shell + Cloud** → R1–R5 via web parity; exit = §7 rows R1–R5 pass on real tenant with a second client (a normal browser, same user).
- **P1.5 Sign-in persistence & credentials** (added 2026-10-01, see `credentials-plan.md`) → sessions survive restarts and are measured; passkeys via Windows Hello (gate G7); app-owned DPAPI credential vault with click-to-fill as fallback. Google Password Manager passwords are not reachable from a non-Chrome app; shared passkeys are the equivalent. Exit = cookie-lifetime table, next-day relaunch without sign-in (or server-enforced reason documented), G7 recorded, vault fill proven on real Okta + GitHub forms with no secret in logs/renderer.
- **P2 GitHub pane** → R7–R9; exit = router unit table + E2E routing matrix + tab behaviours + persistence + cleanup pass.
- **P3 Windows packaging**: electron-builder NSIS per-user x64; electron-updater from GitHub Releases; unsigned initially (SmartScreen warning accepted for personal use), signing via Azure Trusted Signing later. Exit = installed-artifact smoke (install, launch, views created, partitions/settings persist across restart and upgrade, uninstall).
- **P4 Devin Local** → R6 Local; exit = real `devin acp` contract run + packaged-Windows Local session create/prompt/approve/cancel/restart.
- **P5 Extras**: toasts/badge, session PR quick-open, `Ctrl+N` (navigate devinView to new-session). Exit = PAT encrypted at rest, absent from renderer/logs; toast fires within one poll interval.
- **P4b Local terminal** (decided 2026-10-01): add an embedded terminal tab (xterm.js + node-pty running the `devin` CLI in the selected workspace) alongside the ACP chat — a second Local surface for troubleshooting/raw CLI use. Must spawn the external `devin` binary (RunAsNode fuse off); node-pty is a native module → verify it rebuilds for Electron 44 and packages in NSIS. Exit = open terminal per workspace, run `devin --help`, resize, close without orphan pty; packaged smoke.
- **P8 Session-scoped tabs** (planned 2026-10-01, see `session-tabs-plan.md`): GitHub pane shows only the tabs of the open Devin session; switching sessions swaps the set, returning restores order/active/page state. Hidden tabs stay live for `tabs.keepAliveHours` (default 24) under an LRU cap `tabs.maxLiveTabs` (default 8), then state-safe-discard and resume on activation. Replaces `discardIdleMinutes`; resolves O5's deferred per-session filter. Exit = unit + `sessionTabs.spec.ts` green, no-reload proof, memory at cap recorded.
- **P6 macOS** (signing/notarization, same code). ~~**P7 Mobile feasibility**~~ **Dropped 2026-10-01** (user decision; O4 closed). Remaining text kept for history: (Expo + `core`, hosted Devin + GitHub tab sheet). A phone cannot run the `devin` CLI, so R6-Local on mobile can only mean remote control of the desktop's Devin Local; P7 evaluates that path explicitly and the mobile decision stays pending (O4) — a Cloud-only mobile shell is not counted as requirement-complete.

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
- ~~O4 Mobile + Local~~ closed 2026-10-01: mobile dropped.
- O5 Tab scope: global strip with `originSessionId` (P2); per-session filter → **P8** (planned 2026-10-01).
- O6 Memory budget for the GitHub pane (P2 measurement decides whether discard is enabled).
- O7 Devin session lifetime and the tenant's `prompt=login` on the Okta redirect (forces re-auth each time; ask Cognition) — P1.5.
- O8 Okta org policy on passkey/FIDO2 enrollment — P1.5 G7.
- O9 Availability of a Windows passkey provider (Google Password Manager / 1Password) on the user's PC — P1.5.

## Evidence Requirements
- P0 spike doc `docs/spike-p0.md`: pinned versions; G1–G6 pass/fail with screenshots; IdP chain; `devin acp` `initialize` transcript.
- Unit + E2E (Playwright `_electron`, pinned to a release containing microsoft/playwright PR #39912) green in CI on `windows-latest`, including installed-artifact smoke.
- §7 acceptance matrix filled per release with real-tenant, two-client evidence (screenshots/timestamps).
- P2 memory measurement (5/10/20 tabs) recorded against O6.

## Institutional Context
<!-- cb:context-brief -->
# Institutional Context Brief — Devin desktop client ("Devin Workspaces")

| # | Gotcha / precedent | Source | What breaks if ignored |
|---|---|---|---|
| 1 | Session folders are **personal** and have **no documented public API** (release note 2026-06-12: "Folders are personal, so each user defines their own layout"; no v3 folder endpoint in API reference). | docs.devin.ai/release-notes/overview#june-12-2026 | A native sidebar built on v3 cannot read/write the user's web folders -> violates "changes locally reflected in web and vice-versa". |
| 2 | v3 credential reach measured in this org: `cog_` service user reaches sessions list/detail/messages; a Windsurf token from `devin` CLI login reaches session list only (403 elsewhere); legacy `apk_` 403 on all v3. Base URL used for Cloudbeds org: `https://api.devin.ai`. | automation-hub `backend/config/integrations/devin.ts` | Wrong token type -> silent 403s for messages/PR data; wrong base URL. |
| 3 | v3 session list is cursor-paged, `first` capped at 200, newest first; full read is slow -> automation-hub keeps a server snapshot and single-flights refresh. | automation-hub `backend/db/migrations/0054_devin_sessions_snapshot.sql`, `backend/services/devin/devin-sessions-service.ts` | Naive full-list polling every few seconds -> slow UI, 429s. |
| 4 | Prior Devin session viewer used status-based polling: 10s for new/claimed/running/resuming, 60s for suspended/blocked, stop when finished; evidence was mocked only. | cloudbeds/automation-hub PR #213 | Uniform fast polling wastes rate budget; mocked-only evidence missed real payload shape. |
| 5 | ADR 0001 (2026-09-23): Electron and Tauri prototypes of automation-hub both worked; conclusion "Electron is the easier start (JavaScript only, identical rendering everywhere), and Tauri is the lighter download"; Electron ~150-200 MB; Tauri needs Rust toolchain and renders differently on macOS/Linux (WKWebView/WebKitGTK). | automation-hub `docs/decisions/0001-hub-stays-a-website.md`; prototypes `b2292ed06` (Electron), `6a4e28c2e` (Tauri) | Re-learning the same tradeoffs; picking Tauri and hitting non-Chromium rendering on macOS. |
| 6 | Tauri child webviews (`Window::add_child`, `WebviewBuilder`) are behind crate feature `unstable`; on Windows, creating webviews deadlocks in sync commands/event handlers (WebView2 issue) — must use async commands/threads. | docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html | Tab pane built on unstable API; UI hangs on Windows. |
| 7 | Devin Desktop: cloud sessions stay in sync with web app (server-side send queue survives reloads). Devin Local exposed via `devin acp` (JSON-RPC over stdio). | docs.devin.ai/desktop/devin | Reimplementing cloud sync logic that the server already owns. |
| 8 | ACP: `session/list` (v1 optional capability; v2 mandatory for agents with session surface) + `session/load`/`session/resume` for history. | agentclientprotocol.com/protocol/v1/session-list | Local session history UI depends on a capability the `devin` agent may not advertise. |
| 9 | Electron `WebContentsView` contents are not destroyed when the `BaseWindow` closes; must `webContents.close()` explicitly. | electronjs.org docs (WebContentsView) | Leaked renderer processes / memory per closed tab. |
| 10 | Session URL pattern in this enterprise: `https://cloudbeds.devinenterprise.com/sessions/<id>`; app base differs from `app.devin.ai`. | session environment; webmcp-local-dev-tools PR #4 (`app-base-url`) | Hard-coding app.devin.ai breaks SSO/enterprise. |

Suggested convention updates: none.
<!-- /cb:context-brief -->

## Gotchas Surfaced
- Native views paint above the shell renderer: no shell menus/popovers over web views (use `Menu.popup`); splitter needs the z-order raise.
- `WebContentsView` webContents are not destroyed with the window: close every one explicitly on tab and window close.
- `before-input-event` is keyboard-only; `screen.getCursorScreenPoint()` has no button state.
- Google blocks OAuth in embedded webviews; GitHub SAML needs its own sign-in in the app's partition and periodic re-auth.
- ACP v1 vs v2 differ on history (`session/load` vs `session/resume`); capability paths `agentCapabilities.sessionCapabilities.list`, `agentCapabilities.loadSession`.
- Tauri `add_child` is `unstable` and deadlocks in sync handlers on Windows.
- v3 list is cursor-paged (`first` ≤ 200): poll status-aware, single-flight, back off on 429.
- RunAsNode fuse off: spawn the external `devin` binary, never `fork` a Node script.
- Enterprise tenant URL (`cloudbeds.devinenterprise.com`) differs from `app.devin.ai`; API base `api.devin.ai`.

## Suggested Convention Updates
None.

## Discussion Highlights
- R1: Validation required requirement-level acceptance and two-client proof of sync → §7 matrix + phase exits. Challenge confirmed hosting the web app over a native sidebar and pushed for one Local surface, an auth go/no-go gate, memory and splitter risks.
- R2: Both lenses blocked on (a) an "open in system browser" control and a githubusercontent download exception conflicting with R7, (b) cursor polling not detecting mouse-up, (c) UA spoofing as SSO fallback, (d) arbitrary N=8 eviction, (e) mobile dropping Local. All five were changed, not rebutted.
- R3: Validation CONSENSUS, Challenge CONSENSUS. Verified against Electron docs: re-adding a child view raises it, `View.setBackgroundColor` accepts alpha, `webContents.close({ waitForBeforeUnload: true })` + `will-prevent-unload`, `will-redirect`, `session` `will-download` + `DownloadItem` progress. Added: shell CSS must be transparent during the raised drag overlay (G4).
- Disagreement kept: back/forward/reload stay (Challenge preferred proving need first); planner kept them because PR file/commit views navigate inside a tab.

## Recommendation
**READY** — for P0 (go/no-go spike). P1+ proceed only if P0 gates G1–G6 pass; G1/G2 failure without a supported embedded sign-in method returns to NEEDS CLARIFICATION. Open items O1–O6 do not block P0.

## Status log
- 2026-10-01 — P0, P1, P1.5, P2, P3, P4, P5 implemented on `feat/initial-app` (283 unit / 20 E2E green). Decisions: stay local, no release/push yet; no v0.1.0 tag until after the manual acceptance pass; P4b Local terminal added; P7 mobile dropped. Pending user: manual acceptance rows, cookie-lifetime table, G7 passkeys, PAT/org_id check, signing.
- 2026-10-01 — Review fixes F1–F10 merged (`fa7a25b`): gh-tab clipboard-write permission, 10 MB event-log rotation (`events.1.jsonl`) + sampled terminal-data logging, https-only tenant/api URLs, `ipcGuard` shell-sender check on all IPC, ACP stderr/username out of logs, GLOBAL scope-menu nav, shutdown probe honours beforeunload (veto → one consolidated quit/cancel prompt), `exactOptionalPropertyTypes`+`noImplicitOverride`+`noFallthroughCasesInSwitch` enabled, session titles in scope menu.
- 2026-10-01 — P8 session-scoped tabs merged (`43b2af9`): GitHub strip shows only the current session's tabs (per-scope dedupe/order/active), hidden tabs stay live under `keepAliveHours` (default 24 h, 0 = discard on switch) with a `maxLiveTabs` LRU cap (default 8), archive auto-close via the v3 poller, 30-day scope prune, `tabs:closeScope`/`listScopes`/`scopeMenu` IPC + native overflow menu, v1→v2 snapshot + `discardIdleMinutes` migration.
- 2026-10-01 — P4b Local terminal merged (`8eb578b`): xterm.js + node-pty (N-API prebuild, `asarUnpack`, no rebuild), pty spawn gated to configured workspaces, packaged verification `docs/evidence/p4b-packaged-terminal.jsonl`, installer ~122 MB (+5 MB). Secrets review of tracked files: clean; event log now redacts URL query/hash outside test mode. All automatable work is done — remaining items (P6 macOS, signing, release) are gated on the user.
