import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app, BaseWindow, dialog, screen, session, webContents, WebContentsView } from 'electron';
import { clampPaneWidth } from '../core/layout';
import { auditCookies, startCookieAudit } from './cookieAudit';
import { CredentialStore } from './credentials';
import { setupDownloads } from './downloads';
import { setupIpc } from './ipc';
import { setupLocal, localHost } from './local/ipc';
import { terminalHost } from './local/terminalHost';
import { log, logFile } from './log';
import { setPermissions } from './permissions';
import { installProtocol } from './protocol';
import { attachSessionTracking } from './sessions';
import { SettingsStore } from './settings';
import { fixtureOrigins, state, testMode } from './state';
import { registerTestHooks } from './testHooks';
import { keepAliveMs, TabManager } from './tabs';
import { applyLayout, cancelDrag, detachView, notifyShell } from './window';
import { attachRouting } from './routing';
import { setupUpdater } from './updater';
import { notifier } from './notifier';
import { SecretStore } from './secrets';

// Windows toasts require an AppUserModelID; match electron-builder's appId.
if (process.platform === 'win32') app.setAppUserModelId('ai.devin.workspaces');

if (process.env.DEVIN_WORKSPACES_SCALE) {
  app.commandLine.appendSwitch('force-device-scale-factor', process.env.DEVIN_WORKSPACES_SCALE);
}
app.enableSandbox();

const requestedUserData = process.env.DEVIN_WORKSPACES_USER_DATA;
if (requestedUserData) app.setPath('userData', resolve(requestedUserData));

const userData = app.getPath('userData');
mkdirSync(userData, { recursive: true });

function onBeforeUnload(tabId: string, event: Electron.Event): boolean {
  let leave = false;
  if (testMode) {
    leave = process.env.DEVIN_WORKSPACES_TEST_BEFOREUNLOAD !== 'stay';
  } else {
    const options: Electron.MessageBoxSyncOptions = {
      type: 'warning',
      buttons: ['Close tab', 'Stay'],
      defaultId: 0,
      cancelId: 1,
      message: 'This page wants to prevent this tab from closing.',
    };
    const result = state.windowRef
      ? dialog.showMessageBoxSync(state.windowRef, options)
      : dialog.showMessageBoxSync(options);
    leave = result === 0;
  }
  if (leave) event.preventDefault();
  log(`gh:${tabId}`, 'beforeunload-prompt', { decision: leave ? 'close' : 'stay' });
  return leave;
}

export async function shutdown(): Promise<void> {
  if (state.shutdownPromise) return state.shutdownPromise;
  state.shuttingDown = true;
  state.shutdownPromise = (async () => {
    // F8 stage 1 — probe: close live GitHub tabs honouring beforeunload; a veto
    // is recorded (no per-tab prompt) and resolved by one consolidated dialog.
    const probe = (await state.tabManager?.probe().catch(() => undefined)) ?? {
      live: 0,
      vetoed: [],
    };
    log('shell', 'shutdown-probe', { detail: { live: probe.live, vetoed: probe.vetoed.length } });
    if (probe.vetoed.length > 0) {
      const quit = testMode
        ? process.env.DEVIN_WORKSPACES_TEST_BEFOREUNLOAD !== 'stay'
        : dialog.showMessageBoxSync(state.windowRef!, {
            type: 'warning',
            buttons: ['Quit', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: `${probe.vetoed.length} GitHub tab(s) have unsaved changes. Quit anyway?`,
          }) === 0;
      if (!quit) {
        log('shell', 'shutdown-vetoed', { detail: { vetoed: probe.vetoed } });
        state.shuttingDown = false;
        state.shutdownPromise = null;
        // The probe may have discarded the active tab — restore a tab in the
        // visible scope only (never pull a hidden-scope tab into the strip).
        state.tabManager?.restoreAfterProbeCancel(probe.vetoed);
        applyLayout();
        return;
      }
    }
    notifier.stop('window-close');
    if (state.dragging) cancelDrag(false, 'window-close');
    try {
      await auditCookies();
    } catch {
      // best effort at shutdown
    }
    localHost()?.dispose();
    state.settings?.syncFromState();
    await terminalHost.dispose();
    const contents = [
      state.shellView?.webContents,
      state.devinView?.webContents,
      ...(state.tabManager?.getViews().map((view) => view.webContents) ?? []),
    ].filter((item): item is Electron.WebContents => Boolean(item && !item.isDestroyed()));
    const before = webContents.getAllWebContents().length;
    log('shell', 'window-close-start', { detail: { webContentsCount: before } });
    state.tabManager?.dispose();
    detachView(state.devinView);
    detachView(state.shellView);
    for (const item of contents) {
      if (!item.isDestroyed()) item.close();
    }
    await Promise.all(
      contents.map(
        (item) =>
          new Promise<void>((resolveDestroyed) => {
            if (item.isDestroyed()) return resolveDestroyed();
            const timeout = setTimeout(resolveDestroyed, 1200);
            item.once('destroyed', () => {
              clearTimeout(timeout);
              resolveDestroyed();
            });
          }),
      ),
    );
    const after = webContents.getAllWebContents().length;
    log('shell', 'window-close-complete', {
      detail: { webContentsCountBefore: before, webContentsCountAfter: after },
    });
    state.windowRef?.destroy();
    state.windowRef = null;
    // app.quit() can be dropped while a quit is already in flight (the window
    // close was vetoed to run this cleanup); exit() is unconditional.
    app.exit(0);
  })();
  return state.shutdownPromise;
}

async function createWindow(): Promise<void> {
  state.settings = new SettingsStore(userData);
  state.secrets = new SecretStore(userData);
  await state.secrets.load();
  setupLocal();
  const saved = state.settings.current;
  state.paneOpen = saved.pane.open;
  state.paneWidth = clampPaneWidth(saved.pane.width, 1400);
  state.surface = saved.surface;
  // Env override wins over the persisted tenant URL (tests rely on it).
  state.tenantUrl = process.env.DEVIN_WORKSPACES_TENANT_URL ?? saved.tenantUrl;
  state.credentials = new CredentialStore(
    join(userData, 'credentials.json'),
    undefined,
    fixtureOrigins,
    (event, detail) => log('shell', event, { detail }),
  );

  const devinSession = session.fromPartition('persist:devin');
  const githubSession = session.fromPartition('persist:github');
  setPermissions(devinSession, 'devin');
  setPermissions(githubSession, 'gh:session');
  setupDownloads(githubSession);

  state.windowRef = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Devin Workspaces',
    show: true,
  });

  // Test mode: Chromium clamps creation bounds to the work area, which on
  // small CI displays (1024x768) auto-collapses the pane and silently breaks
  // pane-dependent specs. A post-creation setContentSize is not clamped on
  // Windows — force it and log what we actually got for the fail-fast check.
  if (testMode) {
    const match = /^(\d+)x(\d+)$/.exec(
      process.env.DEVIN_WORKSPACES_TEST_WINDOW_SIZE ?? '1400x900',
    );
    if (match) {
      const [w, h] = [Number(match[1]), Number(match[2])];
      state.windowRef.setContentSize(w, h);
      state.windowRef.center();
      log('shell', 'window-size', {
        detail: {
          requested: { w, h },
          actual: state.windowRef.getContentBounds(),
          display: screen.getPrimaryDisplay().workAreaSize,
        },
      });
    }
  }

  state.shellView = new WebContentsView({
    webPreferences: {
      preload: resolve(app.getAppPath(), 'out', 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  state.devinView = new WebContentsView({
    webPreferences: {
      partition: 'persist:devin',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  state.shellView.setBackgroundColor('#111827');
  state.devinView.setBackgroundColor('#ffffffff');
  state.windowRef.contentView.addChildView(state.shellView);
  state.windowRef.contentView.addChildView(state.devinView);
  attachRouting(state.shellView.webContents, 'shell');
  attachRouting(state.devinView.webContents, 'devin');
  attachSessionTracking(state.devinView.webContents);

  state.tabManager = new TabManager({
    parent: state.windowRef.contentView,
    session: githubSession,
    log: (event, detail, url) => log('shell', event, { detail, url }),
    onCreated: (tabId, view) => attachRouting(view.webContents, `gh:${tabId}`),
    onChange: notifyShell,
    onBeforeUnload,
    initialTabs: saved.tabSnapshot,
    testMode,
    keepAliveMs: keepAliveMs(saved.tabs.keepAliveHours),
    maxLiveTabs: saved.tabs.maxLiveTabs,
  });

  state.shellView.webContents.on('did-finish-load', () => {
    log('shell', 'shell-ready', { url: state.shellView?.webContents.getURL() });
    notifyShell();
  });
  state.shellView.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log('shell', 'console-message', {
      detail: { level, message, line, sourceId },
    });
  });
  state.windowRef.on('resize', applyLayout);
  state.windowRef.on('close', (event) => {
    if (state.shuttingDown) return;
    event.preventDefault();
    void shutdown();
  });
  state.windowRef.on('closed', () => {
    log('shell', 'window-closed');
    state.windowRef = null;
  });

  const activeId = state.tabManager.activeId;
  if (activeId) state.tabManager.activate(activeId);
  applyLayout();
  await state.shellView.webContents.loadURL('app://shell/index.html');
  state.devinView.webContents.loadURL(state.tenantUrl).catch((error: unknown) => {
    log('devin', 'load-error', { url: state.tenantUrl, detail: { message: String(error) } });
  });
  registerTestHooks();
  startCookieAudit();
  notifier.start();
  log('shell', 'window-created', {
    url: state.tenantUrl,
    detail: { userData, logFile, testMode, fixtureOrigins },
  });
}

app
  .whenReady()
  .then(() => {
    installProtocol();
    setupIpc();
    return createWindow();
  })
  .catch((error: unknown) => {
    log('shell', 'startup-error', { detail: { message: String(error) } });
    app.quit();
  });

app.on('activate', () => {
  if (!state.windowRef) void createWindow();
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(setupUpdater, () => undefined);
