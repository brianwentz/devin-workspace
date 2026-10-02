import { ipcMain } from 'electron';
import { normalizeOrigin } from '../core/credentials';
import { log } from './log';
import { fixtureOrigins, state } from './state';

// F4: every IPC channel exists for the shell renderer only. A foreign
// webContents (hosted views, future plugins) that somehow obtains
// ipcRenderer gets rejected and logged.
export function fromShell(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): boolean {
  const shell = state.shellView?.webContents;
  if (!shell || shell.isDestroyed() || event.sender !== shell) return false;
  const frame = event.senderFrame;
  return !frame || !frame.url || frame.url.startsWith('app://shell/');
}

export function guardedHandle(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromShell(event)) {
      log('shell', 'ipc-rejected', { detail: { channel } });
      return undefined;
    }
    return listener(event, ...args);
  });
}

export function guardedOn(
  channel: string,
  listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void,
): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!fromShell(event)) {
      log('shell', 'ipc-rejected', { detail: { channel } });
      return;
    }
    listener(event, ...args);
  });
}

// Autofill IPC: the sender must be a hosted view (the devin view or a managed
// tab) and the sending frame must be its top frame or a same-origin subframe —
// a cross-origin iframe could otherwise request credentials for its own origin
// while posing as the top document.
export function fromHostedView(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): boolean {
  const sender = event.sender;
  if (!sender || sender.isDestroyed()) return false;
  const hosted =
    (state.devinView !== null && sender === state.devinView.webContents) ||
    (state.tabManager?.getViews().some((view) => view.webContents === sender) ?? false);
  if (!hosted) return false;
  const frame = event.senderFrame;
  if (!frame || !frame.url) return false;
  const frameOrigin = normalizeOrigin(frame.url, fixtureOrigins);
  const mainOrigin = normalizeOrigin(sender.mainFrame?.url ?? '', fixtureOrigins);
  return frameOrigin !== null && frameOrigin === mainOrigin;
}

export function hostedHandle(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromHostedView(event)) {
      log('shell', 'ipc-rejected', { detail: { channel, hosted: true } });
      return undefined;
    }
    return listener(event, ...args);
  });
}

export function hostedOn(
  channel: string,
  listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void,
): void {
  ipcMain.on(channel, (event, ...args) => {
    if (!fromHostedView(event)) {
      log('shell', 'ipc-rejected', { detail: { channel, hosted: true } });
      return;
    }
    listener(event, ...args);
  });
}
