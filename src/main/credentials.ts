import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { safeStorage } from 'electron';
import { matchOrigin, normalizeOrigin, type CredentialEntry } from '../core/credentials';
import { state } from './state';

export type CredentialLog = (event: string, detail?: Record<string, unknown>) => void;
const noopLog: CredentialLog = () => undefined;

export interface CredentialEncryptor {
  isAvailable(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export class CredentialsUnavailableError extends Error {
  constructor() {
    super('OS encryption is not available; credentials were not saved');
    this.name = 'CredentialsUnavailableError';
  }
}

export const safeStorageEncryptor: CredentialEncryptor = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptStringAsync(value),
  decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
};

interface StoredEntry {
  origin: string;
  username: string;
  passwordEnc: string;
}

export class CredentialStore {
  private readonly entries = new Map<string, StoredEntry>();

  constructor(
    private readonly file: string,
    private readonly encryptor: CredentialEncryptor = safeStorageEncryptor,
    private readonly allowInsecure: readonly string[] = [],
    private readonly log: CredentialLog = noopLog,
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { entries?: StoredEntry[] };
      for (const entry of raw.entries ?? []) {
        if (
          typeof entry?.origin === 'string' &&
          typeof entry.username === 'string' &&
          typeof entry.passwordEnc === 'string'
        ) {
          this.entries.set(entry.origin, entry);
        }
      }
    } catch (error) {
      this.log('credentials-load-failed', { error: String(error) });
    }
  }

  list(): CredentialEntry[] {
    return [...this.entries.values()].map(({ origin, username }) => ({ origin, username }));
  }

  get origins(): string[] {
    return [...this.entries.keys()];
  }

  matchForUrl(url: string): CredentialEntry | null {
    const origin = matchOrigin(url, this.origins, this.allowInsecure);
    if (!origin) return null;
    const entry = this.entries.get(origin);
    return entry ? { origin: entry.origin, username: entry.username } : null;
  }

  async save(input: { origin: string; username: string; password: string }): Promise<void> {
    const origin = normalizeOrigin(input.origin, this.allowInsecure);
    if (!origin) throw new Error(`Not a valid https origin: ${input.origin}`);
    if (!(await this.encryptor.isAvailable())) throw new CredentialsUnavailableError();
    const passwordEnc = (await this.encryptor.encrypt(input.password)).toString('base64');
    this.entries.set(origin, { origin, username: input.username, passwordEnc });
    this.persist();
    // F6: never log the username — identifiers are semi-sensitive too.
    this.log('credential-save', { origin });
  }

  delete(origin: string): boolean {
    const removed = this.entries.delete(origin);
    if (removed) {
      this.persist();
      this.log('credential-delete', { origin });
    }
    return removed;
  }

  async fill(
    contents: Electron.WebContents,
    field: 'username' | 'password',
    pressEnter: boolean,
  ): Promise<'filled' | 'no-match' | 'unavailable'> {
    const url = contents.getURL();
    const origin = matchOrigin(url, this.origins, this.allowInsecure);
    if (!origin) {
      this.log('credential-fill-denied', { origin: normalizeOrigin(url, this.allowInsecure) });
      return 'no-match';
    }
    const frameUrl = contents.focusedFrame?.url;
    if (frameUrl && matchOrigin(frameUrl, [origin], this.allowInsecure) !== origin) {
      this.log('credential-fill-denied', {
        origin,
        frameOrigin: normalizeOrigin(frameUrl, this.allowInsecure),
        reason: 'focused-frame-origin',
      });
      return 'no-match';
    }
    const entry = this.entries.get(origin);
    if (!entry) return 'no-match';
    let value: string;
    if (field === 'password') {
      if (!(await this.encryptor.isAvailable())) return 'unavailable';
      try {
        value = await this.encryptor.decrypt(Buffer.from(entry.passwordEnc, 'base64'));
      } catch {
        return 'unavailable';
      }
    } else {
      value = entry.username;
    }
    contents.insertText(value);
    value = '';
    if (pressEnter) {
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      contents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
    this.log('credential-fill', { origin, field, pressEnter });
    return 'filled';
  }

  private persist(): void {
    const serialized = JSON.stringify({
      version: 1,
      entries: [...this.entries.values()],
    });
    const temporary = `${this.file}.tmp`;
    try {
      writeFileSync(temporary, serialized, 'utf8');
      renameSync(temporary, this.file);
    } catch (error) {
      this.log('credentials-persist-failed', { error: String(error) });
    }
  }
}

// The view a fill applies to: the focused hosted view if it is the devin view
// or the active GitHub tab (never the shell); falls back to devinView on the
// cloud surface when nothing else is focused.
export function currentFillTarget(): Electron.WebContents | null {
  const candidates = [
    state.devinView?.webContents,
    state.tabManager?.activeWebContents,
  ].filter((item): item is Electron.WebContents => Boolean(item && !item.isDestroyed()));
  if (
    state.lastFocused &&
    !state.lastFocused.isDestroyed() &&
    candidates.includes(state.lastFocused)
  ) {
    return state.lastFocused;
  }
  const focused = candidates.find((contents) => contents.isFocused());
  if (focused) return focused;
  if (state.surface === 'cloud' && state.devinView && !state.devinView.webContents.isDestroyed()) {
    return state.devinView.webContents;
  }
  return null;
}
