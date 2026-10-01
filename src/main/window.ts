import { View, type WebContentsView } from 'electron';
import { clampPaneWidth, computeBounds, type Rect } from '../core/layout';
import { prsForSession } from '../core/notifyModel';
import { IpcChannels, SettingsSchema, type ShellState } from '../shared/ipc';
import { currentFillTarget } from './credentials';
import { log } from './log';
import { state } from './state';

function nativeBounds(rect: Rect | null): Electron.Rectangle {
  return rect
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : { x: 0, y: 0, width: 0, height: 0 };
}

export function publicState(): ShellState {
  return {
    paneOpen: state.paneOpen,
    paneWidth: state.paneWidth,
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
      enabled: state.settings?.current.notifications.enabled ?? true,
      hasToken: state.secrets?.hasPat() ?? false,
      currentSessionPrCount: prsForSession(state.apiSessions, state.currentSessionId).length,
    },
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

export function applyLayout(): void {
  const { windowRef, shellView, devinView, tabManager } = state;
  if (!windowRef || !shellView || !devinView || !tabManager) return;
  const bounds = computeBounds(windowRef.getContentBounds(), {
    paneOpen: state.paneOpen,
    paneWidth: state.paneWidth,
  });
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
  }
  notifyShell();
}

export function cancelDrag(restoreWidth: boolean, reason: string): void {
  if (!state.dragging) return;
  state.dragging = false;
  if (state.dragTimer) clearTimeout(state.dragTimer);
  state.dragTimer = null;
  if (restoreWidth) state.paneWidth = state.dragStartWidth;
  if (state.shellView) state.shellView.setBackgroundColor('#111827');
  const { windowRef, shellView, devinView, tabManager } = state;
  if (windowRef && shellView) {
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
    if (!windowRef.contentView.children.includes(shellView)) {
      windowRef.contentView.addChildView(shellView, 0);
    }
  }
  log('shell', 'drag-cancel', {
    detail: { reason, restoreWidth, paneWidth: state.paneWidth, x: state.dragLastX },
  });
  applyLayout();
  state.shellView?.webContents.send(IpcChannels.layoutDragReset);
}

export function beginDrag(x: number): void {
  const { windowRef, shellView } = state;
  if (!windowRef || !shellView || !state.paneOpen || state.paneCollapsed || state.dragging) return;
  state.dragging = true;
  state.dragStartWidth = state.paneWidth;
  state.dragLastX = x;
  if (state.dragTimer) clearTimeout(state.dragTimer);
  shellView.setBackgroundColor('#00000000');
  windowRef.contentView.addChildView(shellView);
  state.dragTimer = setTimeout(() => cancelDrag(true, 'safety-timeout'), 10_000);
  log('shell', 'drag-start', { detail: { x, paneWidth: state.paneWidth } });
}

export function moveDrag(x: number): void {
  const { windowRef, shellView } = state;
  if (!state.dragging || !windowRef) return;
  state.dragLastX = x;
  state.paneWidth = clampPaneWidth(
    windowRef.getContentBounds().width - x - 6,
    windowRef.getContentBounds().width,
  );
  const bounds = computeBounds(windowRef.getContentBounds(), {
    paneOpen: state.paneOpen,
    paneWidth: state.paneWidth,
  });
  if (bounds.splitter) {
    const { width, height } = windowRef.getContentBounds();
    shellView?.setBounds({ x: 0, y: 0, width, height });
    shellView?.webContents.send(IpcChannels.layoutDragGuide, bounds.splitter.x);
  }
  log('shell', 'drag-move', { detail: { x, paneWidth: state.paneWidth } });
}

export function endDrag(x: number): void {
  if (!state.dragging) return;
  moveDrag(x);
  state.dragLastX = x;
  state.dragging = false;
  if (state.dragTimer) clearTimeout(state.dragTimer);
  state.dragTimer = null;
  if (state.shellView) state.shellView.setBackgroundColor('#111827');
  log('shell', 'drag-end', { detail: { x, paneWidth: state.paneWidth } });
  applyLayout();
}
