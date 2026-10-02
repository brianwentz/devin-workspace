import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shutdown } from './index';
import { log } from './log';
import { notificationStore } from './notifications';
import { testMode } from './state';
import type { UpdateState } from '../shared/ipc';
import { notifyShell } from './window';

const INITIAL_DELAY_MS = 30_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let downloadedVersion: string | null = null;
let availableVersion: string | null = null;

export function updateState(): UpdateState {
  return { version: app.getVersion(), available: availableVersion, downloaded: downloadedVersion };
}

export function updateAvailable(version: string): void {
  availableVersion = version;
  notifyShell();
}

export function hasDownloadedUpdate(): boolean {
  return downloadedVersion !== null;
}

// Called from shutdown() instead of app.exit(0) when an update is ready —
// app.exit skips the quit lifecycle so autoInstallOnAppQuit would never run.
export function quitAndInstall(): void {
  log('shell', 'update-install', { detail: { version: downloadedVersion } });
  autoUpdater.quitAndInstall(true, true);
}

// P6: clicking an 'update' notification installs it. In test mode this only
// logs — the e2e exercises the path without quitting.
export function installUpdate(): void {
  const version = downloadedVersion;
  // Remove the update entry (there may be other notifications in the list).
  const entry = notificationStore().entries().find((item) => item.kind === 'update');
  if (entry) notificationStore().remove(entry.id);
  if (testMode) {
    log('shell', 'update-install', { detail: { version, testMode: true } });
    return;
  }
    // Dynamic import would need an .cjs/.js suffix under nodenext; keep it
  // static — index.ts already imports updater.ts, cycles resolve at call time.
  void shutdown({ installUpdate: true });
}

// Called from updater's update-downloaded event and the test hook.
export function updateDownloaded(version: string): void {
  downloadedVersion = version;
  availableVersion = version;
  log('shell', 'update-downloaded', { detail: { version } });
  notificationStore().add({
    kind: 'update',
    version,
    sessionId: null,
    sessionTitle: 'Devin Workspaces',
    title: `Update v${version} ready`,
    body: 'Click to restart and install',
    createdAt: Date.now(),
  });
}

// Re-add the entry when a quit was vetoed by a beforeunload prompt — the
// install notification must survive cancelled shutdowns.
export function restoreUpdateEntry(): void {
  if (downloadedVersion) updateDownloadedKeep();
}
function updateDownloadedKeep(): void {
  if (!downloadedVersion) return;
  notificationStore().add({
    kind: 'update',
    version: downloadedVersion,
    sessionId: null,
    sessionTitle: 'Devin Workspaces',
    title: `Update v${downloadedVersion} ready`,
    body: 'Click to restart and install',
    createdAt: Date.now(),
  });
}

// GitHub Releases auto-update (feed from build.publish in package.json, baked
// into resources/app-update.yml by electron-builder). Downloads silently and
// installs via the 'update' notification. Skipped in dev and under
// DEVIN_WORKSPACES_TEST so the smoke/e2e suites never touch the network.
export function setupUpdater(): void {
  if (!app.isPackaged || testMode) {
    log('shell', 'updater-disabled', { detail: { isPackaged: app.isPackaged, testMode } });
    return;
  }
  // electron-updater on darwin throws for unsigned apps; scripts/after-pack.cjs
  // records whether the build was signed so unsigned Mac builds skip the
  // updater instead of erroring on every check.
  if (process.platform === 'darwin') {
    let signed = false;
    try {
      const marker = JSON.parse(
        readFileSync(join(process.resourcesPath, 'signing.json'), 'utf8'),
      ) as { signed?: unknown };
      signed = marker.signed === true;
    } catch {
      signed = false;
    }
    if (!signed) {
      log('shell', 'updater-disabled', {
        detail: { isPackaged: app.isPackaged, testMode, reason: 'unsigned-mac' },
      });
      return;
    }
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => log('shell', 'update-check'));
  autoUpdater.on('update-available', (info) => {
    log('shell', 'update-available', { detail: { version: info.version } });
    updateAvailable(info.version);
  });
  autoUpdater.on('update-not-available', (info) =>
    log('shell', 'update-not-available', { detail: { version: info.version } }),
  );
  autoUpdater.on('update-downloaded', (info) => updateDownloaded(info.version));
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
