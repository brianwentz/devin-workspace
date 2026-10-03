import { IpcChannels } from '../shared/ipc';
import { log } from './log';
import { state } from './state';

let waiter: ((result: { pending: boolean; ok: boolean }) => void) | null = null;

// Called by the settings:flushDone handler in ipc.ts.
export function settingsFlushDone(payload: { pending: boolean; ok: boolean }): void {
  const resolve = waiter;
  waiter = null;
  resolve?.(payload);
}

// Ask the shell to commit a dirty settings draft before quit. Never blocks
// longer than 1 s and resolves cleanly when the shell isn't loaded.
export async function requestSettingsFlush(): Promise<{
  pending: boolean;
  ok: boolean;
  timedOut: boolean;
}> {
  const contents = state.shellView?.webContents;
  let result: { pending: boolean; ok: boolean; timedOut: boolean };
  if (!contents || contents.isDestroyed()) {
    result = { pending: false, ok: true, timedOut: false };
  } else {
    result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiter = null;
        resolve({ pending: false, ok: false, timedOut: true });
      }, 1000);
      waiter = (reply) => {
        clearTimeout(timer);
        resolve({ pending: reply.pending, ok: reply.ok, timedOut: false });
      };
      try {
        contents.send(IpcChannels.settingsFlush);
      } catch {
        clearTimeout(timer);
        waiter = null;
        resolve({ pending: false, ok: false, timedOut: true });
      }
    });
  }
  log('shell', 'settings-flush', { detail: result });
  return result;
}
