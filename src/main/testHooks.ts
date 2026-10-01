import { webContents } from 'electron';
import { clampPaneWidth } from '../core/layout';
import { auditCookies } from './cookieAudit';
import { currentFillTarget } from './credentials';
import { fromShell } from './ipcGuard';
import { terminalHost } from './local/terminalHost';
import type { Surface } from '../shared/ipc';
import { currentSessionPrs, notifier } from './notifier';
import { handleLink } from './routing';
import { historyAction, navigationTarget, openNewSession } from './shortcuts';
import { state, testMode } from './state';
import { applyLayout, publicState } from './window';
import { shutdown } from './index';
import { localHost } from './local/ipc';
import { publicLocalState } from './local/localState';

export function registerTestHooks(): void {
  if (!testMode) return;
  Object.assign(globalThis, {
    __devinworkspaces: {
      state: () => publicState(),
      open: (url: string) => {
        const id = state.tabManager?.open(url);
        if (!id) return '';
        state.paneOpen = true;
        applyLayout();
        return id;
      },
      routeLink: (url: string) => handleLink(url),
      activate: (id: string) => state.tabManager?.activate(id),
      close: (id: string) => state.tabManager?.close(id),
      reorder: (id: string, index: number) => state.tabManager?.reorder(id, index),
      // Also pin lastFocused: on a background CI desktop the OS 'focus' event
      // may never fire, which made the credential fill target non-deterministic.
      focus: (id: string) => {
        const contents = state.tabManager?.getView(id)?.webContents;
        if (!contents) return;
        state.lastFocused = contents;
        contents.focus();
      },
      setPaneOpen: (value: boolean) => {
        state.paneOpen = value;
        applyLayout();
      },
      setPaneWidth: (value: number) => {
        state.paneWidth = clampPaneWidth(
          value,
          state.windowRef?.getContentBounds().width ?? 1400,
        );
        applyLayout();
      },
      setSurface: (value: Surface) => {
        state.surface = value;
        applyLayout();
      },
      navigate: (action: 'back' | 'forward' | 'reload') => {
        const contents = navigationTarget();
        if (contents) historyAction(action, contents);
      },
      setBeforeUnloadDecision: (value: 'stay' | 'leave') => {
        process.env.DEVIN_WORKSPACES_TEST_BEFOREUNLOAD = value;
      },
      getShellWebContents: () => state.shellView?.webContents ?? null,
      getWebContentsCount: () => webContents.getAllWebContents().length,
      getWindowBounds: () => state.windowRef?.getBounds() ?? null,
      setWindowSize: (width: number, height: number) => {
        state.windowRef?.setContentSize(width, height);
        applyLayout();
        return state.windowRef?.getContentBounds() ?? null;
      },
      loadDevinUrl: (url: string) => {
        state.devinView?.webContents.loadURL(url).catch(() => undefined);
      },
      getTabBounds: (id: string) => state.tabManager?.getView(id)?.getBounds() ?? null,
      saveCredential: (credential: { origin: string; username: string; password: string }) =>
        state.credentials?.save(credential).then(() => true),
      getFillTargetUrl: () => currentFillTarget()?.getURL() ?? null,
      // Deterministic fill into a specific tab (target selection is asserted
      // separately via getFillTargetUrl; OS focus is unreliable on CI).
      fillInto: (id: string, field: 'username' | 'password', pressEnter: boolean) => {
        const contents = state.tabManager?.getView(id)?.webContents;
        if (!contents || !state.credentials) return 'unavailable';
        return state.credentials.fill(contents, field, pressEnter);
      },
      // F4: would a foreign webContents (the devin view) pass the IPC guard?
      ipcProbe: () => ({
        foreign: fromShell({ sender: state.devinView?.webContents, senderFrame: null } as never),
        shell: state.shellView
          ? fromShell({ sender: state.shellView.webContents, senderFrame: null } as never)
          : null,
      }),
      auditCookies: () => auditCookies(),
      closeWindow: () => shutdown(),
      getTabWebContents: (id: string) => state.tabManager?.getView(id)?.webContents ?? null,
      openBackground: (url: string) => state.tabManager?.open(url, { background: true }) ?? '',
      discard: (id: string) => state.tabManager?.discard(id) ?? Promise.resolve(false),
      discardIdle: () => state.tabManager?.discardIdle() ?? Promise.resolve([]),
      setKeepAliveMs: (ms: number) => state.tabManager?.setKeepAliveMs(ms),
      getKeepAliveMs: () => state.tabManager?.keepAliveThresholdMs ?? null,
      listScopes: () => state.tabManager?.listScopes() ?? [],
      currentScope: () => state.tabManager?.currentScope ?? '',
      // P5: secrets / notifier hooks. setPat goes through the same store as
      // the IPC path; nothing here ever returns the token.
      setPat: async (pat: string) => {
        await state.secrets?.setPat(pat);
        notifier.restart('test-set-pat');
        return state.secrets?.hasPat() ?? false;
      },
      clearPat: async () => {
        await state.secrets?.clearPat();
        notifier.restart('test-clear-pat');
      },
      hasPat: () => state.secrets?.hasPat() ?? false,
      pollNow: () => notifier.pollNow(),
      listPrs: () => currentSessionPrs(),
      clickNotification: (sessionId: string) => notifier.openSession(sessionId, 'test-click'),
      newSession: () => openNewSession(),
      testNotification: () => notifier.showTestNotification(),
      // Devin Local (P4)
      localState: () => publicLocalState(),
      localAddWorkspace: (path: string) => localHost()?.addWorkspace(path) ?? null,
      localRemoveWorkspace: (path: string) => localHost()?.removeWorkspace(path),
      localNewSession: (workspace: string) => localHost()?.newSession(workspace),
      localPrompt: (sessionId: string, text: string) => localHost()?.prompt(sessionId, text),
      localCancel: (sessionId: string) => localHost()?.cancel(sessionId),
      localListSessions: (workspace: string) => localHost()?.listSessions(workspace),
      localLoadSession: (workspace: string, sessionId: string) =>
        localHost()?.loadSession(workspace, sessionId),
      localAgentPid: (workspace: string) => localHost()?.agentPid(workspace) ?? null,
      // P4b terminal
      terminalOpen: (workspace: string) => terminalHost.open(workspace),
      terminalInput: (id: string, data: string) => terminalHost.write(id, data),
      terminalResize: (id: string, cols: number, rows: number) =>
        terminalHost.resize(id, cols, rows),
      terminalClose: (id: string) => terminalHost.close(id),
      terminalRead: (id: string) => terminalHost.read(id),
      terminalPid: (id: string) => terminalHost.pid(id),
    },
  });
}
