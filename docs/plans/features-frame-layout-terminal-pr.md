# Plan — frame, layout persistence, terminal dock, PR auto-open

Status: approved for implementation (2026-10-02). Four parallel worktrees off `main`
after the current branch merges, preceded by one small prep commit on `main`.

## Requested features

| # | Request |
|---|---|
| F1 | When a Devin session creates a PR, automatically open a tab to it in that session |
| F2 | Remove S/M/L pane presets; default 50/50 split; persist pane resize implicitly. Persist window size/position per display configuration; unknown config → defaults, OS positions the window |
| F3 | Remove the menu bar |
| F4 | Move the GitHub tab strip into the window title-bar row; tab content height == Devin view height |
| F5 | Terminal dock (tabbed, OS default shell) under the Devin chat area, rail toggle above the GH button, resizable + persisted like the pane |

Decisions taken with the user:
- F1 detection = v3 API poller `pull_requests` diff (no DOM access to remote views). Tabs always open in the **background**, scoped to the PR's session. Toggle `prs.autoOpenTabs` (default on).
- F2/F5 split values are **global** (pane as a fraction, terminal height in px); only window bounds are per display configuration.
- F5 = embedded xterm.js + node-pty running the user's default shell (Windows: `pwsh.exe` → `powershell.exe` → `%COMSPEC%`; macOS/Linux: `$SHELL`). Host terminal apps cannot be embedded.
- F5 dock is **Cloud-only by default**; setting `terminal.allSurfaces` (default off) shows it on Local/Settings too.
- F3 is folded into F4 (both reshape the frame; F3 alone is ~5 lines).

## Codebase facts the plan relies on

- Layout is the pure `computeBounds(windowSize, paneState)` in `src/core/layout.ts`, applied by `applyLayout()` in `src/main/window.ts`. Shell chrome (rail, tab strip, nav bar, splitter) is React in `shellView`, bottom of the z-order; hosted views never overlap it except during the splitter drag (z-order-raise protocol — keep intact).
- `BaseWindow` is created with the default frame and Electron's default application menu (`src/main/index.ts`; no `Menu.setApplicationMenu` anywhere).
- The v3 poller already fetches `pull_requests` per session every 10 s (active) / 60 s (idle) (`src/main/notifier.ts`), and `TabManager.open(url, { background, originSessionId })` opens into a hidden session scope with `owner/repo/pull/N` dedupe (`src/main/tabs.ts`).
- A node-pty + xterm.js terminal host exists (`src/main/local/terminalHost.ts`, `src/shell/local/TerminalView.tsx`) but is one pty per workspace and spawns only the `devin` binary.
- Settings: zod schema in `src/shared/ipc.ts`; `SettingsStore.syncFromState()` writes pane/surface/tabSnapshot on every `notifyShell()`; `migrateSettingsRaw` in `src/core/settings.ts` handles shape migrations.

## Conflict map and streams

F2, F4, F5 all rewrite `computeBounds`/`applyLayout`; F3/F4 both touch window construction.

### Prep commit on `main` (before branching)

Widen the layout contract once so each stream fills in its own part:

```ts
// src/core/layout.ts
export interface LayoutState {
  paneOpen: boolean;
  paneFraction: number;      // stream B (derived from paneWidth until B lands)
  terminalOpen: boolean;     // stream C (false until C lands)
  terminalHeight: number;    // stream C
}
export interface WindowBounds {
  // existing fields, plus:
  titleBar: Rect | null;          // stream A
  terminal: Rect | null;          // stream C
  terminalSplitter: Rect | null;  // stream C
}
```

New rects are `null`, behaviour unchanged, `layout.test.ts` updated for the new shape.

### Streams

| Stream | Features | Files touched |
|---|---|---|
| **A — Frame** | F3 + F4 | `main/index.ts` (window opts, menu), `core/layout.ts` (titleBar rect; drop tabStrip/navBar rows), `shell/App.tsx`, new `shell/components/TitleBar.tsx`, `TabStrip.tsx`, `NavBar.tsx` (folds into title bar), `main/shortcuts.ts` (zoom/devtools), `styles.css`, `tests/unit/layout.test.ts`, `tests/e2e/shell.spec.ts`, `tabstrip.spec.ts` |
| **B — Layout persistence** | F2 | `core/layout.ts` (fraction clamp), `NavBar.tsx` (remove S/M/L), new `core/windowPlacement.ts`, new `main/windowPlacement.ts`, `shared/ipc.ts` + `core/settings.ts` (schema + migration), `main/shortcuts.ts`, `main/ipc.ts`, `main/testHooks.ts`, `main/state.ts`, tests |
| **C — Terminal dock** | F5 | `main/local/terminalHost.ts` (generalize), `terminalIpc.ts`, `shared/ipc.ts`, `shell/preload.ts`, `core/layout.ts` (terminal rects), `main/window.ts` (axis-aware drag), `shell/components/Rail.tsx`, new `shell/components/TerminalDock.tsx`, `shell/local/TerminalView.tsx`, `shell/local/LocalPanel.tsx`, `SettingsPanel.tsx`, tests |
| **D — PR auto-open** | F1 | `core/notifyModel.ts`, `main/notifier.ts`, `main/tabs.ts` (lazy open), `shared/ipc.ts`, `shell/components/NotificationSettings.tsx`, `tests/unit/notifyModel.test.ts`, `tests/e2e/notify.spec.ts` |

Coordination:
- A and B both touch `NavBar.tsx`: B deletes the presets first; A rebases (or simply does not carry presets into the title bar).
- B, C, D each add distinct settings keys (`pane.fraction`, `windowPlacements`, `layout.*`, `terminal.*`, `prs.*`) — trivial merges in `shared/ipc.ts` / `core/settings.ts`.
- D is otherwise independent.

Order: prep commit → A's 1-hour drag-region spike → A/B/C/D in parallel → final gate on the merged result (`typecheck`, `test:unit`, `test:e2e`, `smoke:install` because the settings schema changes).

---

## Stream A — Custom title bar with browser tabs, no menu (F3, F4)

### Design
- `BaseWindow({ ..., titleBarStyle: 'hidden', titleBarOverlay: { color: '#101722', symbolColor: '#e8edf5', height: TITLE_BAR_HEIGHT } })`; `Menu.setApplicationMenu(null)` before window creation (also stops Alt from revealing a menu). Keep `minWidth/minHeight`.
- `TITLE_BAR_HEIGHT = 36`, a full-width row rendered by the shell (`TitleBar.tsx`, `-webkit-app-region: drag`). Left→right: app title over the rail column (drag), drag region over the main column, the **tab strip + compact back/forward/reload** over the pane column (`app-region: no-drag`), and a reserved gap for the window-controls overlay (`navigator.windowControlsOverlay.getTitlebarAreaRect()`, fallback 138 px on win32; on macOS reserve the traffic-light area on the left instead).
- `computeBounds`: `devin.y = ghTab.y = TITLE_BAR_HEIGHT`, both `height = h - TITLE_BAR_HEIGHT` → tab content and Devin content are the same size. `tabStrip`/`navBar` rects and `TAB_STRIP_HEIGHT`/`NAV_BAR_HEIGHT` are removed in favour of `titleBar`. With the pane closed/collapsed the pane region of the title bar is plain drag space. Rail stays full height.
- Shortcuts lost with the default menu are re-added in `handleShortcut`: Ctrl+= / Ctrl+- / Ctrl+0 zoom the focused hosted view; F12 / Ctrl+Shift+I open devtools only when `!app.isPackaged || testMode`.
- Splitter drag protocol unchanged (splitter still spans from `y = 0`).

### Risk — spike first (≤1 h)
`-webkit-app-region: drag` inside a `WebContentsView` child of a `BaseWindow` on Electron 44: verify drag, double-click maximize, and the overlay rect. Fallback: `frame: false` with minimize/maximize/close buttons in `TitleBar.tsx`.

### Tests
- `layout.test.ts`: new expectations (titleBar rect, devin/ghTab y and height).
- e2e `shell.spec.ts`: `#titleBar` present, `#navBar` absent, devin bounds `y === 36`, gh tab height === devin height; `DEVIN_WORKSPACES_TEST_WINDOW_SIZE` still honoured (content size ≈ window size now — adjust the fail-fast log).
- `tabstrip.spec.ts`: selectors updated to the title-bar strip.

### Done
Menu bar gone; tabs live in the title row; window drags/maximizes from the title row; all existing e2e green.

---

## Stream B — 50/50 split and placement persistence (F2)

### Pane split
- `pane.width: number` → `pane.fraction: number` (0–1, default `0.5`) = pane share of `windowWidth - RAIL_WIDTH - SPLITTER_WIDTH`.
- `clampPaneFraction(fraction, windowWidth)` keeps the px guards `MIN_PANE_WIDTH = 320` / `MIN_DEVIN_WIDTH = 768` and the auto-collapse rule; the 1200 px cap is dropped.
- Drag: `endDrag` stores `fraction = panePx / available`. Ctrl+Shift+[ / ] step ±80 px, converted to fraction.
- Remove the S/M/L buttons and the `pane:width` IPC; `ShellState.paneWidth` and the `setPaneWidth` test hook become `paneFraction` / `setPaneFraction`. Tests that set 500/760/420 px (`shell.spec.ts`, `routing.spec.ts`, `tabstrip.spec.ts`, `tests/smoke/installed.spec.ts`) are converted to fractions.
- Migration in `migrateSettingsRaw`: `pane.width` present → `fraction = width / (1400 - 56 - 6)` clamped to [0, 1]; drop `width`.
- Persistence stays implicit through `syncFromState()`; no settings UI.

### Window placement
- New pure `core/windowPlacement.ts`:
  - `displayKey(displays: { bounds: Rect; scaleFactor: number }[]): string` — sort by `(x, y)`, join `"${x},${y},${w},${h}@${scale}"`. Geometry, not display ids (ids drift on Windows).
  - `Placement = { bounds: Rect; maximized: boolean; savedAt: number }`.
  - `pickPlacement(saved, key, displays): Placement | null` — only when ≥ 50 % of `bounds` intersects some display `workArea`.
  - `rememberPlacement(saved, key, placement, max = 20)` — LRU by `savedAt`.
- New `main/windowPlacement.ts`: on create compute the key; match → create the window with those `bounds` (no `center()`), `maximize()` if flagged; no match → `1400×900`, **no `center()`**, OS chooses position. `resize`/`move`/`maximize`/`unmaximize` debounced 500 ms → save `getNormalBounds()` + `isMaximized()` under the current key; also save in `shutdown()`. `screen` `display-added` / `display-removed` / `display-metrics-changed` → save under the old key, recompute, and apply the new key's placement if one validates (dock/undock jumps to the remembered layout). Entire module is a no-op in `testMode` (e2e sets explicit sizes); pure logic unit-tested. Log `window-placement { key, source: 'restored' | 'default' | 'display-change' }` — bounds only.
- Settings: `windowPlacements: Record<string, Placement>` default `{}`, written through `SettingsStore.merge` (not `syncFromState`).

### Tests
- Unit: fraction clamp + migration table; `displayKey` ordering/scale; `pickPlacement` on/off-screen; LRU cap.
- e2e: restart restores a saved fraction (replaces the `paneWidth: 500` restart tests).
- Manual: laptop-only vs docked produce two entries; unknown config opens at defaults.

### Done
Fresh install opens 50/50; drag persists across restart; two display configs remembered independently; unknown config → default size, OS-chosen position.

---

## Stream C — Terminal dock (F5)

### Host
- `TerminalHost.open({ cwd, kind: 'devin' | 'shell' }) → { ok, id }`; many terminals, each `{ id, kind, cwd, title, pid, exitCode }`. `byWorkspace` reuse kept only for `kind: 'devin'` (LocalPanel's Terminal tab unchanged).
- Shell resolution in main: win32 `pwsh.exe` on PATH → `powershell.exe` → `%COMSPEC%`; darwin/linux `$SHELL` → `/bin/zsh` → `/bin/bash`. Test mode keeps `DEVIN_WORKSPACES_TEST_TERMINAL_CMD`.
- `cwd` allow-list = `settings.workspaces` + `os.homedir()`; the renderer only picks from that list (default: first workspace, else home). Title = last path segment, replaced by an OSC 0/2 title parsed in the renderer and sent via `terminal:title` (string, never logged).
- IPC: `terminalOpen` arg → `{ cwd?: string; kind: 'devin' | 'shell' }` (workspace form kept for `devin`), new `terminal:list` (invoke) and `terminal:title` (send). `ShellState.terminals` carries `{ id, kind, cwd, title, exitCode }[]` + `activeTerminalId`. pty output still never logged (byte counts only).

### Layout and UI
- `LayoutState.terminalOpen / terminalHeight` (px; default 280, min 120, max `h - TITLE_BAR_HEIGHT - 200`). `terminalVisible = terminalOpen && (surface === 'cloud' || settings.terminal.allSurfaces)`. When visible the main column shrinks: `devin.height -= terminalHeight + SPLITTER_WIDTH`; `terminalSplitter` and `terminal` rects sit below it spanning `rail.width → splitterX`. The pane is unaffected.
- `TerminalDock.tsx` (shell): tab strip reusing `.tab` styles, `+` with a cwd dropdown, × / middle-click close (kills pty), one `TerminalView` per terminal kept mounted (`display:none` when inactive so pty + scrollback survive; also while the dock is hidden on a non-Cloud surface), fit on resize. `TerminalView` takes `{ id }` (host-owned) instead of `workspace`.
- Horizontal splitter: `beginDrag/moveDrag/endDrag` gain `{ axis: 'x' | 'y' }`; same z-order-raise protocol, `layoutDragGuide` payload becomes `{ axis, pos }`, same Escape / 10 s safety timeout.
- Persistence: `layout.terminalOpen`, `layout.terminalHeight` via `syncFromState()` (no settings UI). Setting `terminal.allSurfaces: boolean` default `false`, checkbox in `SettingsPanel` ("Show terminal dock on Local and Settings too").
- Rail: `#terminalToggle` (`>_`, `aria-pressed = terminalOpen`) directly above `#paneToggle`; dimmed with tooltip "Terminal dock shows on Cloud — enable for all surfaces in Settings" when on a non-Cloud surface with `allSurfaces` off. Shortcut Ctrl+` toggles.
- Shutdown: `terminalHost.dispose()` kills ptys; terminals are not restored across runs (only open state + height).

### Tests
- Unit: `computeBounds` with terminal open/closed/min/max/tiny window; `terminalVisible` for each surface × `allSurfaces`.
- e2e `terminal.spec.ts`: toggle via rail; two shell tabs via the fake pty; input round-trip via `terminalRead`; close kills pid; devin bounds shrink by exactly `terminalHeight + 6`; hidden on Local by default, visible after enabling `terminal.allSurfaces`; height persists across restart; Escape cancels the drag.

### Done
Rail button toggles a tabbed shell dock under the Devin view on Cloud; drag resize + persistence work; LocalPanel terminal unaffected; zero terminal text in the event log.

---

## Stream D — Auto-open PR tabs (F1)

### Design
- Pure `newPullRequests(previous: DevinSession[], next: DevinSession[]): { sessionId: string; url: string }[]` in `core/notifyModel.ts`: for each session **present in `previous`**, PR URLs in `next` absent from `previous`. Sessions first seen in `next` are a baseline, so the first poll (and the first after `notifier.restart()`, which clears `state.apiSessions`) opens nothing; user-closed tabs never reopen because the URL was already in `previous`.
- `Notifier.poll()` after `state.apiSessions = sessions`: if `prs.autoOpenTabs`, for each new PR whose `route()` decision is `gh-tab` → `tabManager.open(url, { background: true, originSessionId, lazy: true })`; log `pr-auto-open { sessionId, url }`.
- `TabManager.open` gains `lazy: true` → creates a **discarded placeholder** (no webContents until first activation) so a PR burst neither loads N pages nor churns the live cap. Existing dedupe prevents duplicates when the user already opened it.
- Polling gate: `poll()` currently bails when `notifications.enabled` is false; it now bails only when neither `notifications.enabled` nor `prs.autoOpenTabs` is on (PAT still required). `onSettingsChanged` restarts on `prs.autoOpenTabs` changes.
- Setting `prs.autoOpenTabs: boolean` default `true`; checkbox in `NotificationSettings` ("Open a tab when a session creates a PR").

### Tests
- Unit table for `newPullRequests`: baseline, add, remove, archived session, reorder, URL-only change.
- e2e `notify.spec.ts` with the fixture API: first poll opens nothing; add `pull_requests` → `tab-open` with `originSessionId`, tab `discarded: true`, no focus change; appears after `loadDevinUrl(sessions/<id>)`; close + next poll → no reopen; toggle off → no open.

### Done
Within one poll interval of Devin registering a PR, the tab exists in that session's scope, in the background, unloaded until viewed.

---

## Final gate (merged result)
`npm run typecheck`, `npm run test:unit`, `npm run test:e2e`, `npm run smoke:install` (settings schema changed), plus the manual checks listed per stream. Update `AGENTS.md` with new env/settings keys (`terminal.allSurfaces`, `prs.autoOpenTabs`, `windowPlacements`, `pane.fraction`, `layout.*`) and the removed `pane:width` channel.
