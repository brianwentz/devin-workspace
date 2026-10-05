import { screen, View, type WebContentsView } from 'electron';
import {
  clampPaneWidth,
  clampSessionsWidth,
  clampTerminalHeight,
  computeBounds,
  fractionFromPx,
  leftChrome,
  MIN_DEVIN_WIDTH,
  paneToggleWindowWidth,
  RAIL_WIDTH,
  SPLITTER_WIDTH,
  type LayoutState,
  type Rect,
} from '../core/layout';
import { openPullRequests } from '../core/notifyModel';
import { unreadPrCount, visiblePrs } from '../core/prPanelModel';
import { effectiveScope } from '../core/tabModel';
import { IpcChannels, SettingsSchema, type ShellState } from '../shared/ipc';

import { ensureAnalyticsView } from './analytics';
import { cloudSessions } from './cloudSessions';
import { cloudViews } from './cloudViews';
import { terminalHost } from './local/terminalHost';
import { log } from './log';
import { notificationsUnread } from './notifications';
import { prStore } from './prs';
import { state } from './state';
import { updateState } from './updater';

// The dock is a Cloud-surface feature unless the user opts in for all surfaces.
export function terminalVisible(): boolean {
  return (
    state.terminalOpen &&
    (state.surface === 'cloud' || (state.settings?.current.terminal.allSurfaces ?? false))
  );
}

function nativeBounds(rect: Rect | null): Electron.Rectangle {
  return rect
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : { x: 0, y: 0, width: 0, height: 0 };
}

// Toggling the GitHub pane resizes the WINDOW (the devin column keeps its px
// width) instead of re-splitting a fixed window. The window's minimum width
// follows the pane state so the resize isn't clamped by the old minimum.
export const MIN_WINDOW_WIDTH_OPEN = 1000; // keeps the 1000–1021 auto-collapse band
export const MIN_WINDOW_WIDTH_CLOSED = RAIL_WIDTH + MIN_DEVIN_WIDTH; // 696
export const MIN_WINDOW_HEIGHT = 640;

export function applyMinimumSize(): void {
  state.windowRef?.setMinimumSize(
    state.paneOpen ? MIN_WINDOW_WIDTH_OPEN : MIN_WINDOW_WIDTH_CLOSED,
    MIN_WINDOW_HEIGHT,
  );
}

// Single seam for every paneOpen change (rail button, shortcut, settings,
// test hooks, tab auto-open). Maximised/fullscreen windows keep the in-window
// split — resizing a maximised window is meaningless and the min size is left
// untouched until the next non-maximised toggle.
export function setPaneOpen(open: boolean, source: string): void {
  if (open === state.paneOpen) return;
  const win = state.windowRef;
  if (!win) {
    state.paneOpen = open;
    applyLayout();
    return;
  }
  if (win.isMaximized() || win.isFullScreen()) {
    state.paneOpen = open;
    applyLayout();
    log('shell', 'pane-toggle', {
      detail: { paneOpen: open, source, resized: false, maximized: true },
    });
    return;
  }
  const content = win.getContentBounds();
  const display = screen.getDisplayMatching(win.getBounds());
  const maxWidth = display.workArea.x + display.workArea.width - content.x;
  // Layout BEFORE the flip describes the current split.
  const target = paneToggleWindowWidth(open, content.width, layoutState(), maxWidth);
  state.paneOpen = open;
  // Closing lowers the minimum first so the smaller size is allowed; opening
  // raises it only after the window has grown.
  if (!open) applyMinimumSize();
  if (target !== null) win.setContentSize(target, content.height);
  if (open) applyMinimumSize();
  applyLayout();
  log('shell', 'pane-toggle', {
    detail: {
      paneOpen: open,
      source,
      resized: target !== null,
      fromWidth: content.width,
      toWidth: target ?? content.width,
      maximized: false,
    },
  });
}

export function layoutState(): LayoutState {
  return {
    paneOpen: state.paneOpen,
    paneFraction: state.paneFraction,
    terminalOpen: terminalVisible(),
    terminalHeight: state.terminalHeight,
    // The sessions column only occupies space on the Cloud surface.
    sessionsOpen: state.sessionsOpen && state.surface === 'cloud',
    sessionsWidth: state.sessionsWidth,
  };
}

// Sessions column toggle — unlike the pane, this is an in-window shell
// overlay column: no window resize, just a relayout + shell notify.
export function setSessionsOpen(open: boolean, source: string): void {
  if (state.sessionsOpen === open) return;
  state.sessionsOpen = open;
  applyLayout();
  log('shell', 'sessions-panel', { detail: { open, source } });
}

export function publicState(): ShellState {
  return {
    paneOpen: state.paneOpen,
    paneFraction: state.paneFraction,
    paneCollapsed: state.paneCollapsed,
    sessionsOpen: state.sessionsOpen,
    sessionsWidth: state.sessionsWidth,
    sessionsCollapsed: state.sessionsCollapsed,
    surface: state.surface,
    currentSessionId: state.currentSessionId,
    localSessionId: state.localSessionId,
    settings: state.settings?.current ?? SettingsSchema.parse({}),
    tabs: state.tabManager?.publicState() ?? { tabs: [], activeId: null, scope: '', hiddenTabCount: 0 },
    credentials: state.credentials?.list() ?? [],
    autofill: {
      picker: state.autofillPicker
        ? {
            accounts: state.autofillPicker.accounts,
            anchor: state.autofillPicker.anchor,
          }
        : null,
      prompt: state.autofillPrompt
        ? {
            kind: state.autofillPrompt.kind,
            origin: state.autofillPrompt.origin,
            username: state.autofillPrompt.username,
            anchor: state.autofillPrompt.anchor,
          }
        : null,
    },
    notifications: {
      ...state.notifications,
      collect: state.settings?.current.notifications.collect ?? true,
      banner: state.settings?.current.notifications.banner ?? true,
      hasToken: state.secrets?.hasPat() ?? false,
      openPrCount: visiblePrs(prStore().records(), openPullRequests(state.apiSessions)).length,
      unreadPrCount: unreadPrCount(prStore().records(), openPullRequests(state.apiSessions)),
      prsPanelOpen: state.prsPanelOpen,
      unreadCount: notificationsUnread(),
      panelOpen: state.notificationsPanelOpen,
    },
    cloud: cloudSessions().snapshot(),
    cloudZoomFactor: state.devinView?.webContents.getZoomFactor() ?? 1,
    update: updateState(),
    terminalOpen: state.terminalOpen,
    terminalHeight: state.terminalHeight,
    terminals: terminalHost.list(),
    activeTerminalId: (() => {
      const terminals = terminalHost.list();
      return terminals.some((entry) => entry.id === state.activeTerminalId)
        ? state.activeTerminalId
        : (terminals.at(-1)?.id ?? null);
    })(),
  };
}

export function notifyShell(): void {
  // During shutdown the TabManager is disposed before its webContents finish closing; any
  // late event must not overwrite the persisted tab snapshot with an empty list.
  if (!state.shuttingDown) state.settings?.syncFromState();
  if (state.shellView && !state.shellView.webContents.isDestroyed()) {
    state.shellView.webContents.send(IpcChannels.stateUpdate, publicState());
  }
}

export function detachView(view: View | null | undefined): void {
  if (!view || !state.windowRef || !state.windowRef.contentView.children.includes(view)) return;
  state.windowRef.contentView.removeChildView(view);
}

export function ensureShellBottom(): void {
  if (!state.windowRef || !state.shellView) return;
  if (state.windowRef.contentView.children[0] === state.shellView) return;
  detachView(state.shellView);
  state.windowRef.contentView.addChildView(state.shellView, 0);
}

export function addAtTop(view: View | null): void {
  if (!state.windowRef || !view) return;
  const attached = state.windowRef.contentView.children.includes(view);
  if (attached) state.windowRef.contentView.removeChildView(view);
  state.windowRef.contentView.addChildView(view);
}

// Re-parenting a WebContentsView leaves its page visibilityState "hidden", so only attach when missing.
export function ensureAttached(view: View | null): void {
  if (!state.windowRef || !view || state.windowRef.contentView.children.includes(view)) return;
  state.windowRef.contentView.addChildView(view);
}

// Raise the shell DOM over every hosted view (transparent bg so they still
// paint beneath) — used by the splitter drag and the notifications panel.
export function raiseShell(): void {
  // Overlay restacking during teardown re-adds views whose webContents are
  // being destroyed — a synchronous native call that isn't bounded by any
  // shutdown await.
  if (state.shuttingDown) return;
  const { windowRef, shellView } = state;
  if (!windowRef || !shellView) return;
  shellView.setBackgroundColor('#00000000');
  windowRef.contentView.addChildView(shellView);
}

// Any shell-DOM overlay raised above hosted views (notifications panel,
// autofill picker, autofill save/update prompt).
export function overlayOpen(): boolean {
  return (
    state.notificationsPanelOpen ||
    state.prsPanelOpen ||
    !!state.autofillPicker ||
    !!state.autofillPrompt
  );
}

// Restore the normal stacking order (shell bottom, hosted views above).
export function lowerShell(): void {
  // See raiseShell — never restack during shutdown.
  if (state.shuttingDown) return;
  const { windowRef, shellView, analyticsView, tabManager } = state;
  if (!windowRef || !shellView) return;
  shellView.setBackgroundColor('#111827');
  const pooled = cloudViews().views();
  const active = cloudViews().activeView();
  const children = [...windowRef.contentView.children];
  for (const child of children) {
    if (
      child === shellView ||
      pooled.includes(child as WebContentsView) ||
      child === analyticsView ||
      tabManager?.getViews().includes(child as WebContentsView)
    ) {
      windowRef.contentView.removeChildView(child);
    }
  }
  windowRef.contentView.addChildView(shellView, 0);
  if (state.surface === 'cloud' && active) windowRef.contentView.addChildView(active);
  if (state.surface === 'analytics' && analyticsView)
    windowRef.contentView.addChildView(analyticsView);
  if (state.paneOpen && !state.paneCollapsed) addAtTop(tabManager?.activeView ?? null);
}

// The tab strip's scope follows the visible surface: the selected local
// session on Local, else the Cloud session. setScope is a no-op when unchanged,
// so running it from applyLayout covers every surface/selection change without
// each caller having to know about scopes.
export function syncScope(): void {
  state.tabManager?.setScope(
    effectiveScope(state.surface, state.currentSessionId, state.localSessionId),
  );
}

export function applyLayout(): void {
  const { windowRef, shellView, tabManager } = state;
  const devinView = state.devinView;
  if (!windowRef || !shellView || !devinView || !tabManager) return;
  syncScope();
  const bounds = computeBounds(windowRef.getContentBounds(), layoutState());
  state.paneCollapsed = bounds.paneCollapsed;
  state.sessionsCollapsed = bounds.sessionsCollapsed;
  const size = windowRef.getContentBounds();
  shellView.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
  // Only the ACTIVE pooled view is laid out/attached; every other pooled view
  // gets zero bounds and stays detached.
  for (const view of cloudViews().views()) {
    if (view === devinView && state.surface === 'cloud') {
      view.setBounds(nativeBounds(bounds.devin));
    } else {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
  if (state.surface === 'analytics') {
    ensureAnalyticsView().setBounds(nativeBounds(bounds.devin));
  } else if (state.analyticsView) {
    state.analyticsView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  const paneVisible = state.paneOpen && !bounds.paneCollapsed;
  tabManager.setBounds(paneVisible ? nativeBounds(bounds.ghTab) : null);
  if (!state.dragging) {
    ensureShellBottom();
    for (const view of cloudViews().views()) {
      if (view === devinView && state.surface === 'cloud') ensureAttached(view);
      else detachView(view);
    }
    if (state.surface === 'analytics') ensureAttached(state.analyticsView);
    else detachView(state.analyticsView);
    const activeTabView = paneVisible ? tabManager.activeView : null;
    if (activeTabView) ensureAttached(activeTabView);
    else if (tabManager.activeView) detachView(tabManager.activeView);
    // The notifications panel and the autofill overlays are shell-DOM modals
    // over hosted views — the raise must survive relayout.
    if (overlayOpen()) raiseShell();
  }
  notifyShell();
}

export function cancelDrag(restore: boolean, reason: string): void {
  if (!state.dragging) return;
  state.dragging = false;
  if (state.dragTimer) clearTimeout(state.dragTimer);
  state.dragTimer = null;
  if (restore) {
    if (state.dragAxis === 'x') state.paneFraction = state.dragStartFraction;
    else if (state.dragAxis === 's') state.sessionsWidth = state.dragStartSessionsWidth;
    else state.terminalHeight = state.dragStartHeight;
  }
  lowerShell();
  log('shell', 'drag-cancel', {
    detail: {
      reason,
      restore,
      axis: state.dragAxis,
      paneFraction: state.paneFraction,
      terminalHeight: state.terminalHeight,
      x: state.dragLastX,
    },
  });
  applyLayout();
  state.shellView?.webContents.send(IpcChannels.layoutDragReset);
}

export function beginDrag(axis: 'x' | 'y' | 's', pos: number): void {
  const { windowRef, shellView } = state;
  if (!windowRef || !shellView || state.dragging) return;
  if (axis === 'x' && (!state.paneOpen || state.paneCollapsed)) return;
  if (axis === 'y' && !terminalVisible()) return;
  if (axis === 's' && (!state.sessionsOpen || state.sessionsCollapsed || state.surface !== 'cloud'))
    return;
  state.dragging = true;
  state.dragAxis = axis;
  state.dragStartFraction = state.paneFraction;
  state.dragStartHeight = state.terminalHeight;
  state.dragStartSessionsWidth = state.sessionsWidth;
  state.dragLastX = pos;
  if (state.dragTimer) clearTimeout(state.dragTimer);
  raiseShell();
  state.dragTimer = setTimeout(() => cancelDrag(true, 'safety-timeout'), 10_000);
  log('shell', 'drag-start', {
    detail: { axis, pos, paneFraction: state.paneFraction, terminalHeight: state.terminalHeight },
  });
}

export function moveDrag(pos: number): void {
  const { windowRef, shellView } = state;
  if (!state.dragging || !windowRef) return;
  state.dragLastX = pos;
  const content = windowRef.getContentBounds();
  if (state.dragAxis === 'x') {
    // Pointer → pane px (guarded) → stored as a fraction of the available width.
    const panePx = clampPaneWidth(
      content.width - pos - SPLITTER_WIDTH,
      content.width,
      leftChrome(layoutState(), content.width),
    );
    state.paneFraction = fractionFromPx(panePx, content.width);
  } else if (state.dragAxis === 's') {
    state.sessionsWidth = clampSessionsWidth(pos - RAIL_WIDTH, content.width);
  } else {
    state.terminalHeight = clampTerminalHeight(
      content.height - pos - SPLITTER_WIDTH / 2,
      content.height,
    );
  }
  const bounds = computeBounds(content, layoutState());
  const guideRect =
    state.dragAxis === 'x'
      ? bounds.splitter
      : state.dragAxis === 's'
        ? bounds.sessionsSplitter
        : bounds.terminalSplitter;
  if (guideRect) {
    const { width, height } = content;
    shellView?.setBounds({ x: 0, y: 0, width, height });
    shellView?.webContents.send(IpcChannels.layoutDragGuide, {
      axis: state.dragAxis,
      pos: state.dragAxis === 'y' ? guideRect.y : guideRect.x,
    });
  }
  log('shell', 'drag-move', {
    detail: { axis: state.dragAxis, pos, paneFraction: state.paneFraction, terminalHeight: state.terminalHeight },
  });
}

// P6: while the panel is open the shell is raised — hosted views paint beneath
// it but get no input. No timeout (unlike the drag raise).
export function setNotificationsPanel(open: boolean): void {
  if (state.notificationsPanelOpen === open) return;
  if (open) state.prsPanelOpen = false;
  state.notificationsPanelOpen = open;
  if (open) raiseShell();
  else if (!overlayOpen()) lowerShell();
  applyLayout();
  log('shell', 'notifications-panel', { detail: { open } });
}

// Same raise for the PR panel; opening it closes the notifications panel.
export function setPrsPanel(open: boolean): void {
  if (state.prsPanelOpen === open) return;
  if (open) state.notificationsPanelOpen = false;
  state.prsPanelOpen = open;
  if (open) raiseShell();
  else if (!overlayOpen()) lowerShell();
  applyLayout();
  log('shell', 'prs-panel', { detail: { open } });
}

export function endDrag(pos: number): void {
  if (!state.dragging) return;
  moveDrag(pos);
  state.dragLastX = pos;
  state.dragging = false;
  if (state.dragTimer) clearTimeout(state.dragTimer);
  state.dragTimer = null;
  if (state.shellView) state.shellView.setBackgroundColor('#111827');
  log('shell', 'drag-end', {
    detail: { axis: state.dragAxis, pos, paneFraction: state.paneFraction, terminalHeight: state.terminalHeight },
  });
  applyLayout();
}
