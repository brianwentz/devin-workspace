import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log } from './log';
import { testMode } from './state';

const INITIAL_DELAY_MS = 30_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

// GitHub Releases auto-update (feed from build.publish in package.json, baked
// into resources/app-update.yml by electron-builder). No UI yet: downloads
// silently and installs on quit. Skipped in dev and under DEVIN_WORKSPACES_TEST so
// the smoke/e2e suites never touch the network.
export function setupUpdater(): void {
  if (!app.isPackaged || testMode) {
    log('shell', 'updater-disabled', { detail: { isPackaged: app.isPackaged, testMode } });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => log('shell', 'update-check'));
  autoUpdater.on('update-available', (info) =>
    log('shell', 'update-available', { detail: { version: info.version } }),
  );
  autoUpdater.on('update-not-available', (info) =>
    log('shell', 'update-not-available', { detail: { version: info.version } }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    log('shell', 'update-downloaded', { detail: { version: info.version } }),
  );
  autoUpdater.on('error', (error) =>
    log('shell', 'update-error', { detail: { message: String(error?.message ?? error) } }),
  );

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      log('shell', 'update-error', { detail: { message: String(error) } });
    });
  };
  setTimeout(check, INITIAL_DELAY_MS).unref();
  setInterval(check, INTERVAL_MS).unref();
}
