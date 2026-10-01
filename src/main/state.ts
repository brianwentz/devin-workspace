import type { BaseWindow, WebContentsView } from 'electron';
import { DEFAULT_PANE_WIDTH } from '../core/layout';
import type { Surface } from '../shared/ipc';
import type { CredentialStore } from './credentials';
import type { SettingsStore } from './settings';
import type { TabManager } from './tabs';
import type { DevinSession } from '../core/devinApi';
import type { SecretStore } from './secrets';

export type ViewName = 'shell' | 'devin' | 'local' | `gh:${string}`;

export const testMode = process.env.DEVIN_WORKSPACES_TEST === '1';
export const fixtureOrigins = (testMode ? process.env.DEVIN_WORKSPACES_TEST_GITHUB_ORIGINS ?? '' : '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Single shared mutable state so the main-process split stays behavior-preserving.
export const state = {
  windowRef: null as BaseWindow | null,
  shellView: null as WebContentsView | null,
  devinView: null as WebContentsView | null,
  tabManager: null as TabManager | null,
  settings: null as SettingsStore | null,
  credentials: null as CredentialStore | null,
  tenantUrl: 'https://cloudbeds.devinenterprise.com',
  paneOpen: true,
  paneWidth: DEFAULT_PANE_WIDTH,
  paneCollapsed: false,
  surface: 'cloud' as Surface,
  currentSessionId: null as string | null,
  dragStartWidth: DEFAULT_PANE_WIDTH,
  dragLastX: 0,
  dragTimer: null as NodeJS.Timeout | null,
  dragging: false,
  shuttingDown: false,
  shutdownPromise: null as Promise<void> | null,
  lastFocused: null as Electron.WebContents | null,
  // P5: secrets + poller state. The PAT itself lives only inside SecretStore.
  secrets: null as SecretStore | null,
  apiSessions: [] as DevinSession[],
  notifications: {
    waitingCount: 0,
    lastPollAt: null as string | null,
    authError: false,
    lastError: null as string | null,
  },
};
