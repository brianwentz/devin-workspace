import { ipcMain } from 'electron';
import { log } from './log';
import { state } from './state';

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
