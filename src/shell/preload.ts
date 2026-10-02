import { contextBridge, ipcRenderer } from 'electron';
import type { AppNotification } from '../core/notificationModel';
import type { CredentialEntry } from '../core/credentials';
import {
  IpcChannels,
  type SessionPr,
  type LocalResult,
  type LocalSessionSummary,
  type LocalStatePublic,
  type ScopeSummary,
  type Settings,
  type ShellState,
  type Surface,
  type TerminalSummary,
} from '../shared/ipc';

const isString = (value: unknown): value is string => typeof value === 'string';
const testEnvNumber = (name: string): number | undefined => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const localApi = {
  getLocalState: () => ipcRenderer.invoke(IpcChannels.localState) as Promise<LocalStatePublic>,
  onLocalState: (callback: (state: LocalStatePublic) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== 'object') return;
      callback(value as LocalStatePublic);
    };
    ipcRenderer.on(IpcChannels.localUpdate, listener);
    return () => ipcRenderer.removeListener(IpcChannels.localUpdate, listener);
  },
  localPickWorkspace: () =>
    ipcRenderer.invoke(IpcChannels.localWorkspacePick) as Promise<LocalResult<string | null>>,
  localAddWorkspace: (path: string) =>
    ipcRenderer.invoke(IpcChannels.localWorkspaceAdd, { path }) as Promise<LocalResult<string>>,
  localRemoveWorkspace: (path: string) =>
    ipcRenderer.invoke(IpcChannels.localWorkspaceRemove, { path }) as Promise<LocalResult<null>>,
  localNewSession: (workspace: string) =>
    ipcRenderer.invoke(IpcChannels.localSessionNew, { workspace }) as Promise<LocalResult<string>>,
  localListSessions: (workspace: string) =>
    ipcRenderer.invoke(IpcChannels.localSessionList, { workspace }) as Promise<
      LocalResult<LocalSessionSummary[]>
    >,
  localLoadSession: (workspace: string, sessionId: string) =>
    ipcRenderer.invoke(IpcChannels.localSessionLoad, { workspace, sessionId }) as Promise<
      LocalResult<null>
    >,
  localPrompt: (sessionId: string, text: string) =>
    ipcRenderer.invoke(IpcChannels.localPrompt, { sessionId, text }) as Promise<LocalResult<string>>,
  localCancel: (sessionId: string) =>
    ipcRenderer.invoke(IpcChannels.localCancel, { sessionId }) as Promise<LocalResult<null>>,
  localPermission: (sessionId: string, requestId: string, optionId: string) =>
    ipcRenderer.invoke(IpcChannels.localPermission, { sessionId, requestId, optionId }) as Promise<
      LocalResult<null>
    >,
  localOpenLink: (url: string) => {
    if (isString(url) && url.length < 8192) ipcRenderer.send(IpcChannels.localOpenLink, { url });
  },
};

// P4b embedded terminal + F5 dock.
const terminalApi = {
  terminalOpen: (
    options:
      | { kind: 'devin'; workspace: string }
      | { kind: 'shell'; cwd?: string; profile?: string },
  ) =>
    ipcRenderer.invoke(IpcChannels.terminalOpen, options) as Promise<
      { ok: true; id: string } | { ok: false; error: string }
    >,
  terminalList: () => ipcRenderer.invoke(IpcChannels.terminalList) as Promise<TerminalSummary[]>,
  terminalCwdOptions: () =>
    ipcRenderer.invoke(IpcChannels.terminalCwdOptions) as Promise<string[]>,
  terminalProfiles: () =>
    ipcRenderer.invoke(IpcChannels.terminalProfiles) as Promise<
      { guid: string; name: string; default: boolean; available: boolean }[]
    >,
  terminalToggle: () => ipcRenderer.send(IpcChannels.terminalToggle),
  terminalActivate: (id: string) => {
    if (isString(id)) ipcRenderer.send(IpcChannels.terminalActivate, { id });
  },
  terminalTitle: (id: string, title: string) => {
    if (isString(id) && isString(title)) {
      ipcRenderer.send(IpcChannels.terminalTitle, { id, title: title.slice(0, 256) });
    }
  },
  terminalInput: (id: string, data: string) => {
    if (isString(id) && isString(data) && data.length <= 65536) {
      ipcRenderer.send(IpcChannels.terminalInput, { id, data });
    }
  },
  terminalResize: (id: string, cols: number, rows: number) => {
    if (isString(id) && Number.isInteger(cols) && Number.isInteger(rows)) {
      ipcRenderer.send(IpcChannels.terminalResize, { id, cols, rows });
    }
  },
  terminalClose: (id: string) => {
    if (isString(id)) ipcRenderer.send(IpcChannels.terminalClose, { id });
  },
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') callback(payload as { id: string; data: string });
    };
    ipcRenderer.on(IpcChannels.terminalData, listener);
    return () => ipcRenderer.removeListener(IpcChannels.terminalData, listener);
  },
  onTerminalExit: (callback: (payload: { id: string; exitCode: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object')
        callback(payload as { id: string; exitCode: number });
    };
    ipcRenderer.on(IpcChannels.terminalExit, listener);
    return () => ipcRenderer.removeListener(IpcChannels.terminalExit, listener);
  },
};

const api = {
  platform: process.platform,
  ...localApi,
  ...terminalApi,
  getState: () => ipcRenderer.invoke(IpcChannels.stateGet) as Promise<ShellState>,
  onState: (callback: (state: ShellState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== 'object') return;
      callback(value as ShellState);
    };
    ipcRenderer.on(IpcChannels.stateUpdate, listener);
    return () => ipcRenderer.removeListener(IpcChannels.stateUpdate, listener);
  },
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet) as Promise<Settings>,
  setSettings: (patch: unknown) =>
    ipcRenderer.invoke(IpcChannels.settingsSet, patch) as Promise<Settings>,
  togglePane: () => ipcRenderer.send(IpcChannels.paneToggle),
  activateTab: (id: string) => {
    if (typeof id === 'string') ipcRenderer.send(IpcChannels.tabActivate, id);
  },
  closeTab: (id: string) => {
    if (typeof id === 'string') ipcRenderer.send(IpcChannels.tabClose, id);
  },
  reorderTab: (id: string, toIndex: number) => {
    if (typeof id === 'string' && Number.isInteger(toIndex)) {
      ipcRenderer.send(IpcChannels.tabReorder, id, toIndex);
    }
  },
  listScopes: () =>
    ipcRenderer.invoke(IpcChannels.tabsListScopes) as Promise<ScopeSummary[]>,
  closeScope: (scope: string) => {
    if (typeof scope === 'string') ipcRenderer.send(IpcChannels.tabsCloseScope, { scope });
  },
  openScopeMenu: (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      ipcRenderer.send(IpcChannels.tabsScopeMenu, { x, y });
    }
  },
  navigate: (action: 'back' | 'forward' | 'reload') => {
    if (action === 'back' || action === 'forward' || action === 'reload') {
      ipcRenderer.send(IpcChannels.navAction, action);
    }
  },
  setSurface: (surface: Surface) => {
    if (surface === 'cloud' || surface === 'local' || surface === 'settings') {
      ipcRenderer.send(IpcChannels.surfaceSet, surface);
    }
  },
  openLink: (url: string) => {
    if (typeof url === 'string' && url.length < 8192) ipcRenderer.send(IpcChannels.linkOpen, url);
  },
  dragStart: (axis: 'x' | 'y', pos: number) => {
    if ((axis === 'x' || axis === 'y') && Number.isFinite(pos)) {
      ipcRenderer.send(IpcChannels.layoutDragStart, { axis, pos });
    }
  },
  dragMove: (pos: number) => {
    if (Number.isFinite(pos)) ipcRenderer.send(IpcChannels.layoutDragMove, pos);
  },
  dragEnd: (pos: number) => {
    if (Number.isFinite(pos)) ipcRenderer.send(IpcChannels.layoutDragEnd, pos);
  },
  dragCancel: (reason: 'escape' | 'pointer-cancel' = 'pointer-cancel') => {
    if (reason === 'escape' || reason === 'pointer-cancel')
      ipcRenderer.send(IpcChannels.layoutDragCancel, reason);
  },
  listCredentials: () =>
    ipcRenderer.invoke(IpcChannels.credentialsList) as Promise<CredentialEntry[]>,
  saveCredential: (credential: { origin: string; username: string; password: string }) =>
    ipcRenderer.invoke(IpcChannels.credentialsSave, credential) as Promise<
      { ok: true; entry: CredentialEntry } | { ok: false; error: string }
    >,
  updateCredential: (id: string, patch: { username?: string; password?: string }) =>
    ipcRenderer.invoke(IpcChannels.credentialsUpdate, { id, ...patch }) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  deleteCredential: (id: string) =>
    ipcRenderer.invoke(IpcChannels.credentialsDelete, { id }) as Promise<boolean>,
  revealCredential: (id: string) =>
    ipcRenderer.invoke(IpcChannels.credentialsReveal, { id }) as Promise<string | null>,
  fillCredential: (options: {
    id: string;
    field: 'username' | 'password';
    pressEnter: boolean;
  }) => ipcRenderer.invoke(IpcChannels.credentialsFill, options) as Promise<string>,
  openCredentialsMenu: () => ipcRenderer.send(IpcChannels.credentialsMenu),
  onDragGuide: (callback: (guide: { axis: 'x' | 'y'; pos: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (
        payload &&
        typeof payload === 'object' &&
        typeof (payload as { pos?: unknown }).pos === 'number' &&
        ((payload as { axis?: unknown }).axis === 'x' ||
          (payload as { axis?: unknown }).axis === 'y')
      ) {
        callback(payload as { axis: 'x' | 'y'; pos: number });
      }
    };
    ipcRenderer.on(IpcChannels.layoutDragGuide, listener);
    return () => ipcRenderer.removeListener(IpcChannels.layoutDragGuide, listener);
  },
  onDragReset: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IpcChannels.layoutDragReset, listener);
    return () => ipcRenderer.removeListener(IpcChannels.layoutDragReset, listener);
  },
  // P5: the token only travels renderer -> main; main never echoes it back.
  hasPat: () => ipcRenderer.invoke(IpcChannels.secretsHasPat) as Promise<boolean>,
  setPat: (pat: string) =>
    ipcRenderer.invoke(IpcChannels.secretsSetPat, { pat }) as Promise<SecretResult>,
  clearPat: () => ipcRenderer.invoke(IpcChannels.secretsClearPat) as Promise<SecretResult>,
  listPrs: () => ipcRenderer.invoke(IpcChannels.prsList) as Promise<SessionPr[]>,
  openPrMenu: () => ipcRenderer.send(IpcChannels.prsPopup),
  // P6 notification center
  notificationsList: () =>
    ipcRenderer.invoke(IpcChannels.notificationsList) as Promise<AppNotification[]>,
  notificationsMarkRead: (id: string) => ipcRenderer.send(IpcChannels.notificationsMarkRead, { id }),
  notificationsMarkAllRead: () => ipcRenderer.send(IpcChannels.notificationsMarkAllRead),
  notificationsRemove: (id: string) => ipcRenderer.send(IpcChannels.notificationsRemove, { id }),
  notificationsClear: () => ipcRenderer.send(IpcChannels.notificationsClear),
  notificationsOpen: (id: string) => ipcRenderer.send(IpcChannels.notificationsOpen, { id }),
  notificationsPanel: (open: boolean) => ipcRenderer.send(IpcChannels.notificationsPanel, { open }),
  // DEVIN_WORKSPACES_TEST_BANNER_MS shortens the banner auto-hide in tests.
  bannerMs: testEnvNumber('DEVIN_WORKSPACES_TEST_BANNER_MS'),
  onNotificationBanner: (callback: (entry: AppNotification) => void) => {
    const listener = (_event: unknown, entry: AppNotification) => callback(entry);
    ipcRenderer.on(IpcChannels.notificationBanner, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.notificationBanner, listener);
    };
  },
};

export type SecretResult = { ok: true } | { ok: false; error: string };

contextBridge.exposeInMainWorld('devinworkspaces', api);

export type DevinWorkspacesApi = typeof api;
