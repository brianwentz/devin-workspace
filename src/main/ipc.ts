import { Menu } from 'electron';
import { guardedHandle, guardedOn } from './ipcGuard';
import { clampFraction01 } from '../core/layout';
import { currentFillTarget } from './credentials';
import {
  CredentialDeleteSchema,
  CredentialFillSchema,
  CredentialRevealSchema,
  CredentialSaveSchema,
  CredentialUpdateSchema,
  DragCancelReasonArg,
  DragPosArg,
  DragStartArg,
  IpcChannels,
  LinkOpenArg,
  NavActionArg,
  SettingsPatchSchema,
  SettingsSchema,
  SetPatArg,
  SurfaceArg,
  TabIdArg,
  TabReorderArgs,
  TabsCloseScopeArg,
  TabsScopeMenuArg,
  type Settings,
} from '../shared/ipc';
import { GLOBAL } from '../core/tabModel';
import { sessionUrl } from '../core/sessions';
import { log } from './log';
import { scopeLabel } from '../core/notifyModel';
import { notificationStore } from './notifications';
import { currentSessionPrs, notifier, openNotification, popupPrMenu } from './notifier';
import { handleLink, loadInDevinView } from './routing';
import { historyAction, navigationTarget } from './shortcuts';
import { NotificationIdArg, NotificationPanelArg } from '../shared/ipc';
import { state } from './state';
import { keepAliveMs } from './tabs';
import {
  applyLayout,
  beginDrag,
  cancelDrag,
  endDrag,
  moveDrag,
  notifyShell,
  publicState,
  setNotificationsPanel,
} from './window';

export function setupIpc(): void {
  guardedHandle(IpcChannels.stateGet, () => publicState());
  guardedHandle(IpcChannels.settingsGet, () => state.settings?.current ?? SettingsSchema.parse({}));
  guardedHandle(IpcChannels.settingsSet, (_event, patch: unknown) => {
    const parsed = SettingsPatchSchema.safeParse(patch);
    if (!parsed.success || !state.settings) return state.settings?.current;
    const previousTenant = state.settings.current.tenantUrl;
    const previousSettings = state.settings.current;
    const next: Settings = state.settings.merge(parsed.data);
    notifier.onSettingsChanged(previousSettings, next);
    state.paneOpen = next.pane.open;
    // Raw 0..1 preference; the px guards are applied when laying out.
    state.paneFraction = clampFraction01(next.pane.fraction);
    state.surface = next.surface;
    state.tabManager?.setKeepAliveMs(keepAliveMs(next.tabs.keepAliveHours));
    state.tabManager?.setMaxLiveTabs(next.tabs.maxLiveTabs);
    if (next.tenantUrl !== previousTenant) {
      state.tenantUrl = next.tenantUrl;
      log('shell', 'tenant-changed', { url: next.tenantUrl });
      state.devinView?.webContents.loadURL(next.tenantUrl).catch((error: unknown) => {
        log('devin', 'load-error', { url: next.tenantUrl, detail: { message: String(error) } });
      });
    }
    applyLayout();
    return next;
  });
  guardedOn(IpcChannels.paneToggle, () => {
    state.paneOpen = !state.paneOpen;
    log('shell', 'pane-toggle', { detail: { paneOpen: state.paneOpen } });
    applyLayout();
  });
  guardedOn(IpcChannels.tabActivate, (_event, id: unknown) => {
    const parsed = TabIdArg.safeParse(id);
    if (!parsed.success) return;
    state.tabManager?.activate(parsed.data);
    applyLayout();
  });
  guardedOn(IpcChannels.tabClose, (_event, id: unknown) => {
    const parsed = TabIdArg.safeParse(id);
    if (!parsed.success) return;
    void state.tabManager?.close(parsed.data).then(applyLayout);
  });
  guardedOn(IpcChannels.tabReorder, (...args: unknown[]) => {
    const parsed = TabReorderArgs.safeParse(args.slice(1));
    if (!parsed.success) return;
    state.tabManager?.reorder(parsed.data[0], parsed.data[1]);
    // notifyShell is called via applyLayout in the spike; keep onChange-driven persistence
    applyLayout();
  });
  // P8: close every tab in a scope (used by the strip overflow menu and the
  // notifier's archived-session sweep).
  guardedOn(IpcChannels.tabsCloseScope, (_event, payload: unknown) => {
    const parsed = TabsCloseScopeArg.safeParse(payload);
    if (!parsed.success) return;
    void state.tabManager?.closeScope(parsed.data.scope).then(applyLayout);
  });
  guardedHandle(IpcChannels.tabsListScopes, () => state.tabManager?.listScopes() ?? []);
  // Native menu: hosted views paint over the shell, so this can't be DOM.
  guardedOn(IpcChannels.tabsScopeMenu, (_event, payload: unknown) => {
    const parsed = TabsScopeMenuArg.safeParse(payload);
    if (!parsed.success || !state.windowRef) return;
    const items = (state.tabManager?.listScopes() ?? []).filter(
      (entry) => entry.scope !== state.tabManager?.currentScope,
    );
    if (items.length === 0) return;
    const template: Electron.MenuItemConstructorOptions[] = items.flatMap((entry) => {
      const label = scopeLabel(entry.scope, state.apiSessions);
      return [
        {
          label: `${label} — ${entry.count} tab${entry.count === 1 ? '' : 's'} (${entry.liveCount} live)`,
          enabled: false,
        },
        {
          label: 'Switch to session',
          click: () => {
            // F7: loadInDevinView sets surface='cloud' for both paths.
            if (entry.scope === GLOBAL) loadInDevinView(state.tenantUrl);
            else loadInDevinView(sessionUrl(state.tenantUrl, entry.scope));
            applyLayout();
          },
        },
        {
          label: 'Close its tabs',
          click: () => void state.tabManager?.closeScope(entry.scope).then(applyLayout),
        },
        { type: 'separator' },
      ];
    });
    Menu.buildFromTemplate(template).popup({
      window: state.windowRef,
      x: Math.round(parsed.data.x),
      y: Math.round(parsed.data.y),
    });
  });
  guardedOn(IpcChannels.navAction, (_event, action: unknown) => {
    const parsed = NavActionArg.safeParse(action);
    if (!parsed.success) return;
    const contents = navigationTarget();
    if (contents) historyAction(parsed.data, contents);
  });
  guardedOn(IpcChannels.surfaceSet, (_event, next: unknown) => {
    const parsed = SurfaceArg.safeParse(next);
    if (!parsed.success) return;
    state.surface = parsed.data;
    setNotificationsPanel(false);
    log('shell', 'surface-set', { detail: { surface: state.surface } });
    applyLayout();
  });
  guardedOn(IpcChannels.linkOpen, (_event, url: unknown) => {
    const parsed = LinkOpenArg.safeParse(url);
    if (parsed.success) handleLink(parsed.data);
  });
  guardedOn(IpcChannels.layoutDragStart, (_event, payload: unknown) => {
    const parsed = DragStartArg.safeParse(payload);
    if (parsed.success) beginDrag(parsed.data.axis, parsed.data.pos);
  });
  guardedOn(IpcChannels.layoutDragMove, (_event, pos: unknown) => {
    const parsed = DragPosArg.safeParse(pos);
    if (parsed.success) moveDrag(parsed.data);
  });
  guardedOn(IpcChannels.layoutDragEnd, (_event, pos: unknown) => {
    const parsed = DragPosArg.safeParse(pos);
    if (parsed.success) endDrag(parsed.data);
  });
  guardedOn(IpcChannels.layoutDragCancel, (_event, reason: unknown) => {
    const parsed = DragCancelReasonArg.safeParse(reason);
    cancelDrag(true, parsed.success ? parsed.data : 'pointer-cancel');
  });
  // Credentials: never log IPC payloads (they may carry secrets).
  guardedHandle(IpcChannels.credentialsList, () => state.credentials?.list() ?? []);
  guardedHandle(IpcChannels.credentialsSave, async (_event, payload: unknown) => {
    const parsed = CredentialSaveSchema.safeParse(payload);
    if (!parsed.success || !state.credentials) {
      return { ok: false, error: 'invalid payload' };
    }
    try {
      const entry = await state.credentials.add(parsed.data);
      notifyShell();
      return { ok: true, entry };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  guardedHandle(IpcChannels.credentialsUpdate, async (_event, payload: unknown) => {
    const parsed = CredentialUpdateSchema.safeParse(payload);
    if (!parsed.success || !state.credentials) {
      return { ok: false, error: 'invalid payload' };
    }
    try {
      const { id, ...patch } = parsed.data;
      const entry = await state.credentials.update(id, patch);
      if (!entry) return { ok: false, error: 'Unknown credential' };
      notifyShell();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  guardedHandle(IpcChannels.credentialsDelete, (_event, payload: unknown) => {
    const parsed = CredentialDeleteSchema.safeParse(payload);
    if (!parsed.success || !state.credentials) return false;
    const removed = state.credentials.delete(parsed.data.id);
    if (removed) notifyShell();
    return removed;
  });
  // Never log the returned plaintext.
  guardedHandle(IpcChannels.credentialsReveal, async (_event, payload: unknown) => {
    const parsed = CredentialRevealSchema.safeParse(payload);
    if (!parsed.success || !state.credentials) return null;
    return state.credentials.reveal(parsed.data.id);
  });
  guardedHandle(IpcChannels.credentialsFill, async (_event, payload: unknown) => {
    const parsed = CredentialFillSchema.safeParse(payload);
    const target = currentFillTarget();
    if (!parsed.success || !state.credentials || !target) return 'unavailable';
    const result = await state.credentials.fill(
      target,
      parsed.data.id,
      parsed.data.field,
      parsed.data.pressEnter,
    );
    return result;
  });
  guardedOn(IpcChannels.credentialsMenu, () => {
    const target = currentFillTarget();
    const accounts =
      target && state.credentials ? state.credentials.matchForUrl(target.getURL()) : [];
    if (!accounts.length || !state.windowRef) return;
    const fill = (id: string, field: 'username' | 'password', pressEnter: boolean) => {
      if (target && state.credentials) {
        void state.credentials.fill(target, id, field, pressEnter);
      }
    };
    const menu = Menu.buildFromTemplate([
      ...accounts.flatMap((account): Electron.MenuItemConstructorOptions[] => [
        {
          label: `Fill username (${account.username})`,
          click: () => fill(account.id, 'username', false),
        },
        {
          label: `Fill password (${account.username})`,
          click: () => fill(account.id, 'password', false),
        },
        {
          label: `Fill password + Enter (${account.username})`,
          click: () => fill(account.id, 'password', true),
        },
      ]),
      { type: 'separator' },
      {
        label: 'Manage credentials…',
        click: () => {
          state.surface = 'settings';
          applyLayout();
        },
      },
    ]);
    menu.popup({ window: state.windowRef });
  });
  setupExtrasIpc();
}

// P5: secrets, PR quick-open and notifications. Handlers never return or log
// the token; setPat resolves to { ok, error? } so the renderer can show status.
function setupExtrasIpc(): void {
  guardedHandle(IpcChannels.secretsHasPat, () => state.secrets?.hasPat() ?? false);
  guardedHandle(IpcChannels.secretsSetPat, async (_event, arg: unknown) => {
    const parsed = SetPatArg.safeParse(arg);
    if (!parsed.success) return { ok: false, error: 'Token must be at least 10 characters.' };
    if (!state.secrets) return { ok: false, error: 'Secret store unavailable.' };
    try {
      await state.secrets.setPat(parsed.data.pat.trim());
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not store token.' };
    }
    notifier.restart('pat-set');
    return { ok: true };
  });
  guardedHandle(IpcChannels.secretsClearPat, async () => {
    if (!state.secrets) return { ok: false, error: 'Secret store unavailable.' };
    try {
      await state.secrets.clearPat();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not clear token.' };
    }
    notifier.restart('pat-cleared');
    return { ok: true };
  });
  guardedHandle(IpcChannels.prsList, () => currentSessionPrs());
  guardedOn(IpcChannels.prsPopup, () => {
    popupPrMenu();
  });
  // P6 notification center
  guardedHandle(IpcChannels.notificationsList, () => notificationStore().entries());
  guardedOn(IpcChannels.notificationsMarkRead, (_e, arg: unknown) => {
    const parsed = NotificationIdArg.safeParse(arg);
    if (parsed.success) notificationStore().markRead(parsed.data.id);
  });
  guardedOn(IpcChannels.notificationsMarkAllRead, () => notificationStore().markAllRead());
  guardedOn(IpcChannels.notificationsRemove, (_e, arg: unknown) => {
    const parsed = NotificationIdArg.safeParse(arg);
    if (parsed.success) notificationStore().remove(parsed.data.id);
  });
  guardedOn(IpcChannels.notificationsClear, () => notificationStore().clear());
  guardedOn(IpcChannels.notificationsOpen, (_e, arg: unknown) => {
    const parsed = NotificationIdArg.safeParse(arg);
    if (parsed.success) openNotification(parsed.data.id);
  });
  guardedOn(IpcChannels.notificationsPanel, (_e, arg: unknown) => {
    const parsed = NotificationPanelArg.safeParse(arg);
    if (parsed.success) setNotificationsPanel(parsed.data.open);
  });
}
