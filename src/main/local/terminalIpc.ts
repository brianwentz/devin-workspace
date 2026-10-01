import { guardedHandle, guardedOn } from '../ipcGuard';
import {
  IpcChannels,
  TerminalCloseArg,
  TerminalInputArg,
  TerminalOpenArg,
  TerminalResizeArg,
} from '../../shared/ipc';
import { terminalHost } from './terminalHost';

// Handlers for the embedded terminal (P4b). Payloads are zod-validated;
// terminal content is never logged.
export function setupTerminalIpc(): void {
  guardedHandle(IpcChannels.terminalOpen, (_event, payload: unknown) => {
    const parsed = TerminalOpenArg.safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'invalid payload' };
    return terminalHost.open(parsed.data.workspace);
  });
  guardedOn(IpcChannels.terminalInput, (_event, payload: unknown) => {
    const parsed = TerminalInputArg.safeParse(payload);
    if (!parsed.success) return;
    terminalHost.write(parsed.data.id, parsed.data.data);
  });
  guardedOn(IpcChannels.terminalResize, (_event, payload: unknown) => {
    const parsed = TerminalResizeArg.safeParse(payload);
    if (!parsed.success) return;
    terminalHost.resize(parsed.data.id, parsed.data.cols, parsed.data.rows);
  });
  guardedOn(IpcChannels.terminalClose, (_event, payload: unknown) => {
    const parsed = TerminalCloseArg.safeParse(payload);
    if (!parsed.success) return;
    terminalHost.close(parsed.data.id);
  });
}
