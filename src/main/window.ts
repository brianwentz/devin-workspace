import { View, type WebContentsView } from 'electron';
import {
  clampPaneWidth,
  clampTerminalHeight,
  computeBounds,
  fractionFromPx,
  SPLITTER_WIDTH,
  type LayoutState,
  type Rect,
} from '../core/layout';
import { prsForSession } from '../core/notifyModel';
import { IpcChannels, SettingsSchema, type ShellState } from '../shared/ipc';
import { currentFillTarget } from './credentials';
import { terminalHost } from './local/terminalHost';
import { log } from './log';
import { notificationsUnread } from './notifications';
import { state } from './state';

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

export function layoutState(): LayoutState {
  return {
    paneOpen: state.paneOpen,
    paneFraction: state.paneFraction,
    terminalOpen: terminalVisible(),
    terminalHeight: state.terminalHeight,
  };
}

export function publicState(): ShellState {
  return {
    paneOpen: state.paneOpen,
    paneFraction: state.paneFraction,
    paneCollapsed: state.paneCollapsed,
    surface: state.surface,
    currentSessionId: state.currentSessionId,
    settings: state.settings?.current ?? SettingsSchema.parse({}),
    tabs: state.tabManager?.publicState() ?? { tabs: [], activeId: null, scope: '', hiddenTabCount: 0 },
    credentialMatch: (() => {
      const target = currentFillTarget();
      return target && state.credentials ? state.credentials.matchForUrl(target.getURL()) : null;
    })(),
    credentials: state.credentials?.list() ?? [],
    notifications: {
      ...state.notifications,
      collect: state.settings?.current.notifications.collect ?? true,
      banner: state.settings?.current.notifications.banner ?? true,
      hasToken: state.secrets?.hasPat() ?? false,
      currentSessionPrCount: prsForSession(state.apiSessions, state.currentSessionId).length,
      unreadCount: notificationsUnread(),
      panelOpen: state.notificationsPanelOpen,
    },
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
  const { windowRef, shellView } = state;
  if (!windowRef || !shellView) return;
  shellView.setBackgroundColor('#00000000');
  windowRef.contentView.addChildView(shellView);
}

// Restore the normal stacking order (shell bottom, hosted views above).
export function lowerShell(): void {
  const { windowRef, shellView, devinView, tabManager } = state;
  if (!windowRef || !shellView) return;
  shellView.setBackgroundColor('#111827');
  const children = [...windowRef.contentView.children];
  for (const child of children) {
    if (
      child === shellView ||
      child === devinView ||
      tabManager?.getViews().includes(child as WebContentsView)
    ) {
      windowRef.contentView.removeChildView(child);
    }
  }
  windowRef.contentView.addChildView(shellView, 0);
  if (state.surface === 'cloud' && devinView) windowRef.contentView.addChildView(devinView);
  if (state.paneOpen && !state.paneCollapsed) addAtTop(tabManager?.activeView ?? null);
}

export function applyLayout(): void {
  const { windowRef, shellView, devinView, tabManager } = state;
  if (!windowRef || !shellView || !devinView || !tabManager) return;
  const bounds = computeBounds(windowRef.getContentBounds(), layoutState());
  state.paneCollapsed = bounds.paneCollapsed;
  const size = windowRef.getContentBounds();
  shellView.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
  if (state.surface === 'cloud') {
    devinView.setBounds(nativeBounds(bounds.devin));
  } else {
    devinView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  const paneVisible = state.paneOpen && !bounds.paneCollapsed;
  tabManager.setBounds(paneVisible ? nativeBounds(bounds.ghTab) : null);
  if (!state.dragging) {
    ensureShellBottom();
    if (state.surface === 'cloud') ensureAttached(devinView);
    else detachView(devinView);
    const activeTabView = paneVisible ? tabManager.activeView : null;
    if (activeTabView) ensureAttached(activeTabView);
    else if (tabManager.activeView) detachView(tabManager.activeView);
    // The notifications panel is a shell-DOM modal over hosted views — the
    // raise must survive relayout.
    if (state.notificationsPanelOpen) raiseShell();
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

export function beginDrag(axis: 'x' | 'y', pos: number): void {
  const { windowRef, shellView } = state;
  if (!windowRef || !shellView || state.dragging) return;
  if (axis === 'x' && (!state.paneOpen || state.paneCollapsed)) return;
  if (axis === 'y' && !terminalVisible()) return;
  state.dragging = true;
  state.dragAxis = axis;
  state.dragStartFraction = state.paneFraction;
  state.dragStartHeight = state.terminalHeight;
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
    const panePx = clampPaneWidth(content.width - pos - SPLITTER_WIDTH, content.width);
    state.paneFraction = fractionFromPx(panePx, content.width);
  } else {
    state.terminalHeight = clampTerminalHeight(
      content.height - pos - SPLITTER_WIDTH / 2,
      content.height,
    );
  }
  const bounds = computeBounds(content, layoutState());
  const guideRect = state.dragAxis === 'x' ? bounds.splitter : bounds.terminalSplitter;
  if (guideRect) {
    const { width, height } = content;
    shellView?.setBounds({ x: 0, y: 0, width, height });
    shellView?.webContents.send(IpcChannels.layoutDragGuide, {
      axis: state.dragAxis,
      pos: state.dragAxis === 'x' ? guideRect.x : guideRect.y,
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
  state.notificationsPanelOpen = open;
  if (open) raiseShell();
  else lowerShell();
  applyLayout();
  log('shell', 'notifications-panel', { detail: { open } });
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
