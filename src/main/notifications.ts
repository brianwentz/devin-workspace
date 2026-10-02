import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nativeImage } from 'electron';
import { z } from 'zod';
import { badgeDataUrl } from '../core/badgePng';
import {
  addNotification,
  clearNotifications,
  markAllRead,
  markRead,
  MAX_NOTIFICATIONS,
  removeNotification,
  unreadCount,
  type AppNotification,
  type NewNotification,
} from '../core/notificationModel';
import { IpcChannels } from '../shared/ipc';
import { log } from './log';
import { state } from './state';
import { notifyShell } from './window';

const AppNotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(['waiting', 'approval', 'blocked', 'finished', 'pr-opened', 'pr-completed', 'update']),
  sessionId: z.string().nullable(),
  sessionTitle: z.string(),
  prUrl: z.string().optional(),
  prState: z.string().optional(),
  version: z.string().optional(),
  title: z.string(),
  body: z.string(),
  createdAt: z.number(),
  readAt: z.number().nullable(),
});

const SAVE_DEBOUNCE_MS = 300;

// In-app notification center state: persisted history (minus 'update' entries,
// which are runtime-only), the taskbar overlay count, and the title-bar banner
// push. The panel itself is DOM in the shell; main only tracks open/closed so
// the z-order raise survives relayout.
export class NotificationStore {
  private list: AppNotification[] = [];
  private readonly file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(userData: string) {
    this.file = join(userData, 'notifications.json');
    try {
      const parsed = AppNotificationSchema.array().safeParse(
        JSON.parse(readFileSync(this.file, 'utf8')),
      );
      this.list = parsed.success ? parsed.data.slice(0, MAX_NOTIFICATIONS) : [];
    } catch {
      this.list = [];
    }
  }

  entries(): AppNotification[] {
    return this.list;
  }

  add(next: NewNotification): AppNotification {
    this.list = addNotification(this.list, next, randomUUID());
    // Dedupe either prepended or refreshed in place — the entry is the unread
    // one matching the identity tuple either way.
    const entry = this.list.find(
      (item) =>
        item.readAt === null &&
        item.kind === next.kind &&
        item.sessionId === next.sessionId &&
        (item.prUrl ?? null) === (next.prUrl ?? null) &&
        (item.version ?? null) === (next.version ?? null),
    )!;
    this.persist();
    this.changed();
    this.updateBadge();
    if (state.settings?.current.notifications.banner) {
      state.shellView?.webContents.send(IpcChannels.notificationBanner, entry);
    }
    log('shell', 'notification-added', {
      detail: { id: entry.id, kind: entry.kind, sessionId: entry.sessionId },
    });
    return entry;
  }

  markRead(id: string): void {
    this.list = markRead(this.list, id, Date.now());
    this.persist();
    this.changed();
    this.updateBadge();
  }

  markAllRead(): void {
    this.list = markAllRead(this.list, Date.now());
    this.persist();
    this.changed();
    this.updateBadge();
  }

  remove(id: string): void {
    this.list = removeNotification(this.list, id);
    this.persist();
    this.changed();
    this.updateBadge();
  }

  clear(): void {
    this.list = clearNotifications(this.list);
    this.persist();
    this.changed();
    this.updateBadge();
  }

  unread(): number {
    return unreadCount(this.list);
  }

  private changed(): void {
    notifyShell();
  }

  // Taskbar overlay = unread count (the only surviving OS-level surface).
  private updateBadge(): void {
    const windowRef = state.windowRef;
    if (!windowRef || windowRef.isDestroyed()) return;
    try {
      const count = this.unread();
      windowRef.setOverlayIcon(
        count > 0 ? nativeImage.createFromDataURL(badgeDataUrl(count)) : null,
        count > 0 ? `${count} unread notification${count === 1 ? '' : 's'}` : '',
      );
      log('shell', 'badge', { detail: { count } });
    } catch (error) {
      log('shell', 'badge-error', { detail: { message: String(error) } });
    }
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(join(this.file, '..'), { recursive: true });
        // 'update' entries are runtime-only — never persisted.
        const stored = this.list.filter((item) => item.kind !== 'update');
        writeFileSync(this.file, JSON.stringify(stored.slice(0, MAX_NOTIFICATIONS)));
      } catch (error) {
        log('shell', 'notifications-save-error', { detail: { message: String(error) } });
      }
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      const stored = this.list.filter((item) => item.kind !== 'update');
      writeFileSync(this.file, JSON.stringify(stored.slice(0, MAX_NOTIFICATIONS)));
    } catch {
      // best effort at shutdown
    }
  }
}

let store: NotificationStore | null = null;

export function notificationStore(userData?: string): NotificationStore {
  if (!store) {
    if (!userData) throw new Error('notificationStore not initialised');
    store = new NotificationStore(userData);
  }
  return store;
}

// publicState-safe: zero before the store exists (called before createWindow).
export function notificationsUnread(): number {
  return store?.unread() ?? 0;
}

export function notificationsFlush(): void {
  store?.flush();
}
