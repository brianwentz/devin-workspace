import { app, dialog } from 'electron';
import { guardedHandle, guardedOn } from '../ipcGuard';
import type { ZodType } from 'zod';
import {
  IpcChannels,
  LocalCancelArg,
  LocalOpenLinkArg,
  LocalPermissionArg,
  LocalPromptArg,
  LocalSessionListArg,
  LocalSessionLoadArg,
  LocalSessionNewArg,
  LocalWorkspaceArg,
  type LocalResult,
} from '../../shared/ipc';
import { log } from '../log';
import { handleLink } from '../routing';
import { state, testMode } from '../state';
import { DevinLocalHost } from './acpHost';
import { publicLocalState } from './localState';
import { setupTerminalIpc } from './terminalIpc';
import { terminalHost } from './terminalHost';

let host: DevinLocalHost | null = null;

export function localHost(): DevinLocalHost | null {
  return host;
}

function ok<T>(value: T): LocalResult<T> {
  return { ok: true, value };
}

function fail(error: unknown): LocalResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

// Wrap an invoke handler: validate the payload with zod, run, and convert
// exceptions to a LocalResult so the renderer can render them inline.
function handle<Arg>(
  channel: string,
  schema: ZodType<Arg>,
  run: (arg: Arg) => Promise<unknown> | unknown,
): void {
  guardedHandle(channel, async (_event, payload: unknown) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return fail(new Error(`invalid payload for ${channel}`));
    try {
      return ok(await run(parsed.data));
    } catch (error) {
      return fail(error);
    }
  });
}

function requireHost(): DevinLocalHost {
  if (!host) throw new Error('local host not started');
  return host;
}

export function setupLocal(): void {
  const settings = state.settings;
  host = new DevinLocalHost({
    userData: app.getPath('userData'),
    appPath: app.getAppPath(),
    testMode,
    devinPathOverride: settings?.current.local.devinPath ?? null,
    workspaces: settings?.current.workspaces ?? [],
    onWorkspacesChanged: (workspaces) => {
      state.settings?.merge({ workspaces });
    },
  });
  setupTerminalIpc();
  app.on('before-quit', () => host?.dispose());

  guardedHandle(IpcChannels.localState, () => publicLocalState());

  guardedHandle(IpcChannels.localWorkspacePick, async (): Promise<LocalResult<string | null>> => {
    try {
      const options: Electron.OpenDialogOptions = {
        title: 'Add workspace folder',
        properties: ['openDirectory'],
      };
      const result = state.windowRef
        ? await dialog.showOpenDialog(state.windowRef, options)
        : await dialog.showOpenDialog(options);
      const picked = result.canceled ? null : (result.filePaths[0] ?? null);
      if (!picked) return ok(null);
      return ok(requireHost().addWorkspace(picked));
    } catch (error) {
      return fail(error);
    }
  });

  handle(IpcChannels.localWorkspaceAdd, LocalWorkspaceArg, ({ path }) => requireHost().addWorkspace(path));
  handle(IpcChannels.localWorkspaceRemove, LocalWorkspaceArg, ({ path }) => {
    terminalHost.closeForWorkspace(path);
    requireHost().removeWorkspace(path);
    return null;
  });
  handle(IpcChannels.localSessionNew, LocalSessionNewArg, ({ workspace }) =>
    requireHost().newSession(workspace),
  );
  handle(IpcChannels.localSessionList, LocalSessionListArg, ({ workspace }) =>
    requireHost().listSessions(workspace),
  );
  handle(IpcChannels.localSessionLoad, LocalSessionLoadArg, async ({ workspace, sessionId }) => {
    await requireHost().loadSession(workspace, sessionId);
    return null;
  });
  handle(IpcChannels.localPrompt, LocalPromptArg, ({ sessionId, text }) =>
    requireHost().prompt(sessionId, text),
  );
  handle(IpcChannels.localCancel, LocalCancelArg, async ({ sessionId }) => {
    await requireHost().cancel(sessionId);
    return null;
  });
  handle(IpcChannels.localPermission, LocalPermissionArg, ({ sessionId, requestId, optionId }) => {
    requireHost().resolvePermission(sessionId, requestId, optionId);
    return null;
  });
  guardedOn(IpcChannels.localOpenLink, (_event, payload: unknown) => {
    const parsed = LocalOpenLinkArg.safeParse(payload);
    if (!parsed.success) return;
    log('local', 'link-click', { url: parsed.data.url });
    handleLink(parsed.data.url, 'local');
  });
}
