# P8 — Session-scoped GitHub tabs

Status: IMPLEMENTED (merged 2026-10-01). Depends on: P2 TabManager (discard, dedupe), P1 session tracking.

## Goal
The GitHub pane shows only the tabs that belong to the Devin session currently open in the Cloud view. Switching sessions swaps the visible tab set; returning to a session restores exactly the tabs (order, active tab, scroll/form state) it had. Hidden tabs stay live — no reload — for a configurable keep-alive window (default 24 h); beyond that they are state-safe-discarded and resume (reload) on first activation.

## What already exists (reuse, don't rebuild)
- `state.currentSessionId` from `attachSessionTracking` (`src/main/sessions.ts`), updated on `did-navigate`/`did-navigate-in-page`; `parseSessionId` handles `/sessions/<id>` on the tenant host.
- Every tab opened from the Cloud view carries `originSessionId` (`src/main/routing.ts:51`), already persisted in `settings.tabs`.
- `TabManager.discard()` (O6): closes the webContents of an inactive tab, keeps id/title/favicon/order, reloads on `activate()`; `beforeunload` (draft comment) cancels it. `discardIdleMinutes` setting + sweep timer.
- Views are only attached to the window when active (`activate()` adds/removes child views), so a hidden-but-live tab costs memory, not layout.
- O5 in the master plan explicitly deferred "per-session filter later if wanted" — this is that work.

## Design

### Scope key
`scope = originSessionId ?? GLOBAL` where `GLOBAL = ''`. The visible scope is `state.currentSessionId ?? GLOBAL`.
- Tabs opened while the Cloud view is not inside a session (folder list, settings, tenant root) go to GLOBAL and are shown only when no session is open.
- Tabs opened from Local chat (`shell:openLink`) go to the current visible scope (they are "what I was looking at while in this session"), not GLOBAL.
- A tab's scope never changes after creation (no drag-between-sessions in this phase).

### Core model (`src/core/tabModel.ts`, pure)
```ts
interface TabState {
  tabs: BrowserTab[];                      // all scopes, strip order within scope = array order
  activeByScope: Record<string, string>;   // scope -> active tab id
  lastSeenByScope: Record<string, number>; // scope -> ms epoch of last visible
}
visibleTabs(state, scope): BrowserTab[]
activeId(state, scope): string | null
openTab(state, url, { scope, ... })        // dedupe (PR key + exact URL) WITHIN scope only
closeTab(state, id)                        // neighbour selection within the tab's scope
reorderTab(state, id, toIndex)             // index relative to the scope's visible list
setScopeSeen(state, scope, now)
pruneScopes(state, now, maxAgeMs)          // drop whole scopes not seen for 30 d (persist hygiene)
serializeTabs / restoreTabs                // migrate v1 {tabs, activeId}: activeId -> activeByScope[scope of that tab]
```
`BrowserTab.originSessionId` stays as the persisted field; `scopeOf(tab)` derives the key. `PublicState.tabs` sent to the shell = `visibleTabs` only, plus `hiddenTabCount` and `scope` so the strip can show "3 tabs in other sessions".

### Lifecycle (`src/main/tabs.ts`)
- `TabManager.setScope(scope)`: detach the current active view (no close), record `lastSeenByScope[prev]`, set `activeViewId` from `activeByScope[scope]` if that tab exists (`ensureView` → restores if discarded), `onChange()`. Called from `attachSessionTracking` after `currentSessionId` changes. Pane visibility is untouched; an empty scope shows an empty-state in the pane area (shell renders it; no native view attached).
- **Keep-alive**: replace the single `discardIdleMinutes` clock with two tiers:
  - `tabs.keepAliveHours` (default **24**, 0 = discard hidden-scope tabs immediately on switch) — applies to every tab that is not the visible scope's active tab. Idle = `now - lastActiveAt`; for tabs in a hidden scope, `lastActiveAt` is frozen at the moment the scope was hidden (today's `activate()` already stamps the previous tab).
  - `tabs.maxLiveTabs` (default **8**) — hard cap on live webContents across all scopes, excluding the visible active tab. Enforced LRU on every `open`/`activate`/`setScope`: discard the least-recently-active live tab(s) until under the cap. `beforeunload`-protected tabs are skipped (kept live) and the next candidate is tried. Rationale: P2 measured ~8 GB at 20 live PR tabs (~400 MB each); 8 live ≈ 3 GB worst case. Setting is exposed so the user can raise it.
  - The existing `discardIdleMinutes` setting is **removed** (migrated: if a user had set it, `keepAliveHours = ceil(minutes/60)`; default 30 min → 24 h). One clock is simpler to explain than two.
- Discarded tabs in a hidden scope restore lazily: `setScope` only `ensureView`s the scope's active tab; the others reload when clicked (current behaviour).
- Shortcuts (`Ctrl+W`, `Ctrl+Tab`, `Ctrl+Shift+G`) and IPC `tab:activate/close/reorder` operate on the visible scope; `close` of a tab in a hidden scope is still allowed by id (used by "Close all tabs for this session").

### Settings / IPC
- `settings.tabs = { keepAliveHours: number (0–168), maxLiveTabs: number (1–40) }` in `src/core/settings.ts` with repair defaults; zod in `src/shared/ipc.ts`; `settings:set` pushes both into `TabManager` live.
- New IPC: `tabs:closeScope(scope)` (menu action), `tabs:listScopes()` → `[{ scope, count, liveCount, lastSeen }]` for the strip overflow menu.
- `ShellState.tabs` gains `scope`, `hiddenTabCount`.

### Shell (`src/shell/components/TabStrip.tsx`, `SettingsPanel.tsx`)
- Strip renders only visible tabs (dnd-kit reorder unchanged; indices are scope-relative). Empty scope → centered hint "No GitHub tabs for this session — links from the worklog open here."
- Trailing "⋯ N in other sessions" button → `Menu.popup` (native, since views paint over the shell) listing scopes (session id short form + count, live/discarded) with "Switch to session" (navigates Cloud view via `sessionUrl`) and "Close its tabs".
- Settings: "Keep hidden tabs live for N hours (0 = discard on switch)" and "Max live tabs". Discard-idle control removed.

### Persistence & migration
- `settings.tabs` snapshot v2 = `{ version: 2, tabs, activeByScope, lastSeenByScope }`. `restoreTabs` accepts v1 (`{tabs, activeId}`) and v2. On load: `pruneScopes(30 d)`. All tabs restore as discarded (as today) — only the visible scope's active tab is loaded at startup.

### Test plan
Unit (vitest, `core`): scope derivation; dedupe is per-scope (same PR in two sessions → two tabs); close picks neighbour within scope; reorder index mapping with interleaved scopes; v1→v2 migration incl. `activeId` placement; `pruneScopes`; LRU candidate ordering helper (pure: `(entries, cap, now) → ids to discard`, skips protected).

E2E (Playwright, fixture devin host): add `/sessions/A` and `/sessions/B` pages to `tests/fixtures/http.ts` with distinct GitHub links; new `tests/e2e/sessionTabs.spec.ts`:
1. In A open 2 tabs, in B open 1 → strip shows 2 then 1; `hiddenTabCount` correct; `ShellState.tabs.scope` matches.
2. Return to A: same ids/order/active; the webContents id of A's active tab is unchanged and `did-start-loading` count for it did not increase (no reload); form text typed into the fixture page before switching is still present.
3. `DEVIN_WORKSPACES_TEST_KEEPALIVE_MS=0`: switching away discards A's tabs (`tab-discard` events); returning restores active tab (`tab-restore`) and others on click.
4. `maxLiveTabs=2`: open 4 across scopes → exactly 2 live + active (`webContents.getAllWebContents()` count), LRU order correct; a `beforeunload` tab is skipped.
5. Restart: scopes/active persist; v1 snapshot file migrates.
6. Routing-matrix regressions still pass (dedupe within scope).

Manual (`docs/acceptance-p8.md`): real tenant — open PRs from two sessions, flip between them via the sidebar for ~10 min, confirm no reload flashes and comment drafts survive; leave overnight, confirm tabs resume next day; measure RSS at cap.

### Exit criteria
Unit + E2E above green; manual rows recorded; memory at `maxLiveTabs=8` with heavy PR pages recorded in `docs/evidence/p8-memory.md` (feeds the default).

## Decisions made in review
- **Per-scope dedupe, not global.** Global dedupe would have to "move" a tab between sessions on open, surprising the session you took it from. Cost: the same PR open twice uses two webContents; the cap bounds it.
- **Single keep-alive clock replaces `discardIdleMinutes`.** Two clocks (30 min in-scope idle vs 24 h hidden-scope) are hard to reason about and the user's stated intent is "keep live for a day". The LRU cap, not the clock, is what protects memory.
- **Scope frozen at creation.** Moving tabs between sessions (drag onto a session, "send to current session") is deferred; strip menu offers "Switch to session" instead.
- **GLOBAL scope shown only outside sessions.** Alternative (show GLOBAL everywhere) was rejected: it reintroduces the "unrelated tabs" clutter this feature removes. Open question Q1 below.
- **No pane auto-open on scope switch.** Pane open/collapsed state is the user's; switching to a session with tabs while the pane is closed just updates the rail badge.

## Decisions (user, 2026-10-01)
- **Q1** GLOBAL tabs hidden while in a session — confirmed.
- **Q2** Defaults `keepAliveHours=24`, `maxLiveTabs=8` — confirmed.
- **Q3** Both: auto-close a session's tabs when the v3 poller (P5, requires PAT) reports it archived (`status === 'archived'` or missing from the list after being present — use the poller's existing session map; log `tabs-scope-archived`), **and** keep the 30-day prune as the PAT-less fallback.

## Risks
- `did-navigate` → `setScope` → view detach happens on every Cloud navigation; must be a no-op when the scope is unchanged (already deduped in `attachSessionTracking`).
- Shortcut handlers and `applyLayout` assume `tabManager.activeView` is the visible one — `setScope` must update `activeViewId` before `applyLayout` runs (call order in `attachSessionTracking`).
- The strip's dnd-kit `toIndex` is currently absolute; the scope-relative mapping is the most error-prone pure function — unit-test it with interleaved scopes.
- Memory: a user who raises `maxLiveTabs` can still OOM; the setting UI should show the ≈400 MB/tab estimate.
