import { normalizeOrigin } from '../core/credentials';
import {
  AutofillPickerSchema,
  AutofillPickSchema,
  AutofillQuerySchema,
  IpcChannels,
} from '../shared/ipc';
import { guardedOn, hostedHandle, hostedOn } from './ipcGuard';
import { log } from './log';
import { fixtureOrigins, state } from './state';
import { applyLayout, lowerShell, notifyShell, raiseShell } from './window';

// Navigation/teardown of the picker's sender must dismiss it; the listeners
// are armed once per sender and only fire while that sender owns the picker.
const armedSenders = new WeakSet<Electron.WebContents>();
function armPickerClose(sender: Electron.WebContents): void {
  if (armedSenders.has(sender)) return;
  armedSenders.add(sender);
  const close = () => {
    if (state.autofillPicker?.sender === sender) closeAutofillPicker();
  };
  sender.on('did-start-navigation', close);
  sender.on('destroyed', close);
}

export function closeAutofillPicker(): void {
  if (!state.autofillPicker) return;
  state.autofillPicker = null;
  lowerShell();
  applyLayout();
}

export function setupAutofillIpc(): void {
  // Never return or log usernames/hints — the response carries {id, username}
  // pairs only, and the log event carries counts + the origin.
  hostedHandle(IpcChannels.autofillQuery, async (event, payload: unknown) => {
    const parsed = AutofillQuerySchema.safeParse(payload);
    if (!parsed.success || !state.credentials) return undefined;
    const origin = normalizeOrigin(event.senderFrame?.url ?? '', fixtureOrigins);
    if (!origin) return undefined;
    const accounts = state.credentials.forOrigin(origin);
    const hint = parsed.data.hint;
    const candidates = hint ? accounts.filter((entry) => entry.username === hint) : accounts;
    const pool = candidates.length ? candidates : accounts;
    let fill: { id: string; username: string; password: string | null } | null = null;
    if (pool.length === 1) {
      const entry = pool[0]!;
      const password = parsed.data.hasPassword
        ? await state.credentials.reveal(entry.id)
        : null;
      fill = { id: entry.id, username: entry.username, password };
      if (password !== null) state.credentials.touch(entry.id);
    }
    log('shell', 'autofill-query', {
      detail: {
        origin,
        accounts: accounts.length,
        filled: fill !== null,
        password: parsed.data.hasPassword && fill !== null,
      },
    });
    return {
      accounts: accounts.map((entry) => ({ id: entry.id, username: entry.username })),
      fill,
    };
  });

  hostedOn(IpcChannels.autofillPicker, (event, payload: unknown) => {
    const parsed = AutofillPickerSchema.safeParse(payload);
    if (!parsed.success || !state.credentials || !state.windowRef) return;
    const sender = event.sender;
    const origin = normalizeOrigin(event.senderFrame?.url ?? '', fixtureOrigins);
    if (!origin) return;
    const accounts = state.credentials.forOrigin(origin);
    if (accounts.length < 2) return;
    const view =
      state.devinView?.webContents === sender
        ? state.devinView
        : (state.tabManager?.getViews().find((v) => v.webContents === sender) ?? null);
    if (!view) return;
    const bounds = view.getBounds();
    const zoom = sender.getZoomFactor();
    const rect = parsed.data.rect;
    state.autofillPicker = {
      sender,
      accounts: accounts.map((entry) => ({ id: entry.id, username: entry.username })),
      anchor: {
        x: Math.round(bounds.x + rect.x * zoom),
        y: Math.round(bounds.y + rect.y * zoom),
        width: Math.round(rect.width * zoom),
        height: Math.round(rect.height * zoom),
      },
    };
    armPickerClose(sender);
    raiseShell();
    notifyShell();
    log('shell', 'autofill-picker', { detail: { origin, accounts: accounts.length } });
  });

  guardedOn(IpcChannels.autofillPick, (_event, payload: unknown) => {
    const parsed = AutofillPickSchema.safeParse(payload);
    const picker = state.autofillPicker;
    if (!parsed.success || !picker || picker.sender.isDestroyed() || !state.credentials) {
      return;
    }
    const account = picker.accounts.find((entry) => entry.id === parsed.data.id);
    if (!account) return;
    const sender = picker.sender;
    void state.credentials.reveal(account.id).then((password) => {
      if (password === null || sender.isDestroyed()) return;
      sender.send(IpcChannels.autofillFill, {
        id: account.id,
        username: account.username,
        password,
      });
      state.credentials?.touch(account.id);
    });
    closeAutofillPicker();
  });

  guardedOn(IpcChannels.autofillPickerClose, () => closeAutofillPicker());
}
