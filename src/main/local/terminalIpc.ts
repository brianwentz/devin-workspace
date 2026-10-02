import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { guardedHandle, guardedOn } from '../ipcGuard';
import {
  IpcChannels,
  TerminalActivateArg,
  TerminalCloseArg,
  TerminalInputArg,
  TerminalOpenArg,
  TerminalResizeArg,
  TerminalTitleArg,
} from '../../shared/ipc';
import { log } from '../log';
import { state } from '../state';
import { applyLayout, notifyShell } from '../window';
import { terminalHost } from './terminalHost';

// Handlers for the embedded terminal (P4b) and the F5 shell dock. Payloads are
// zod-validated; terminal content is never logged.
export function setupTerminalIpc(): void {
  guardedHandle(IpcChannels.terminalOpen, (_event, payload: unknown) => {
    const parsed = TerminalOpenArg.safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'invalid payload' };
    return terminalHost.open(parsed.data);
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
  guardedHandle(IpcChannels.terminalList, () => terminalHost.list());
  guardedHandle(IpcChannels.terminalCwdOptions, () => terminalCwdOptions());
  guardedHandle(IpcChannels.terminalProfiles, () => terminalHost.profiles());
  guardedOn(IpcChannels.terminalTitle, (_event, payload: unknown) => {
    const parsed = TerminalTitleArg.safeParse(payload);
    if (!parsed.success) return;
    terminalHost.setTitle(parsed.data.id, parsed.data.title);
  });
  guardedOn(IpcChannels.terminalToggle, () => {
    state.terminalOpen = !state.terminalOpen;
    log('shell', 'terminal-toggle', { detail: { open: state.terminalOpen } });
    applyLayout();
  });
  guardedOn(IpcChannels.terminalActivate, (_event, payload: unknown) => {
    const parsed = TerminalActivateArg.safeParse(payload);
    if (!parsed.success) return;
    if (!terminalHost.list().some((entry) => entry.id === parsed.data.id)) return;
    state.activeTerminalId = parsed.data.id;
    notifyShell();
  });
}

// Shared by the dock's "+" menu and the host's default cwd.
export function terminalCwdOptions(): string[] {
  return [...(state.settings?.current.workspaces ?? []).map((w) => resolve(w)), resolve(homedir())];
}
