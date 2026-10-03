import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { normalizeOrigin, SUGGESTED_ORIGINS, type CredentialEntry } from '../../core/credentials';

const inputClass =
  'w-full max-w-md px-2 py-1.5 rounded-md border border-[#39475a] bg-[#0d141d] text-sm text-[#e8edf5]';
const saveClass =
  'px-3 py-1.5 rounded-md border border-[#39475a] bg-[#1a2330] hover:bg-[#2a394d] text-sm disabled:hover:bg-[#1a2330]';

const REVEAL_MS = 30_000;
const CONFIRM_DELETE_MS = 3_000;

function relativeLastUsed(lastUsedAt: number | null): string {
  if (lastUsedAt === null) return 'never';
  const delta = Date.now() - lastUsedAt;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'last used just now';
  if (minutes < 60) return `last used ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last used ${hours}h ago`;
  return `last used ${Math.floor(hours / 24)}d ago`;
}

function PasswordRow({ entry }: { entry: CredentialEntry }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editUsername, setEditUsername] = useState(entry.username);
  const [editPassword, setEditPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const show = async () => {
    const value = await window.devinworkspaces.revealCredential(entry.id);
    if (value === null) {
      setError('Could not decrypt this password');
      return;
    }
    setError(null);
    setRevealed(value);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
  };

  const hide = () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    setRevealed(null);
  };

  const copy = async () => {
    const value = revealed ?? (await window.devinworkspaces.revealCredential(entry.id));
    if (value === null) {
      setError('Could not decrypt this password');
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2_000);
  };

  const saveEdit = async () => {
    const patch: { username?: string; password?: string } = {};
    if (editUsername && editUsername !== entry.username) patch.username = editUsername;
    if (editPassword) patch.password = editPassword;
    const result = await window.devinworkspaces.updateCredential(entry.id, patch);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setEditing(false);
    setEditPassword('');
  };

  const remove = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      deleteTimer.current = setTimeout(() => setConfirmDelete(false), CONFIRM_DELETE_MS);
      return;
    }
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    void window.devinworkspaces.deleteCredential(entry.id);
  };

  return (
    <li data-credential-id={entry.id} className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs">{entry.username}</span>
        <span className="text-xs text-[#7f8ca0]">{relativeLastUsed(entry.lastUsedAt)}</span>
        <span className="flex-1" />
        <button
          id={`credentialReveal-${entry.id}`}
          type="button"
          className={saveClass}
          aria-label={revealed === null ? 'Show password' : 'Hide password'}
          onClick={() => (revealed === null ? void show() : hide())}
        >
          {revealed === null ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          id={`credentialCopy-${entry.id}`}
          type="button"
          className={saveClass}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          id={`credentialEdit-${entry.id}`}
          type="button"
          className={saveClass}
          onClick={() => {
            setEditing((value) => !value);
            setEditUsername(entry.username);
            setEditPassword('');
            setError(null);
          }}
        >
          Edit
        </button>
        <button
          id={`credentialDelete-${entry.id}`}
          type="button"
          className={saveClass}
          onClick={remove}
        >
          {confirmDelete ? 'Confirm delete' : 'Delete'}
        </button>
      </div>
      {revealed !== null && (
        <input
          className={inputClass}
          readOnly
          value={revealed}
          aria-label="Revealed password"
          onBlur={hide}
        />
      )}
      {editing && (
        <div className="flex items-center gap-2">
          <input
            id={`credentialEditUsername-${entry.id}`}
            className={inputClass}
            value={editUsername}
            onChange={(event) => setEditUsername(event.target.value)}
            placeholder="Username"
            autoComplete="off"
          />
          <input
            id={`credentialEditPassword-${entry.id}`}
            className={inputClass}
            type="password"
            value={editPassword}
            onChange={(event) => setEditPassword(event.target.value)}
            placeholder="New password (unchanged if blank)"
            autoComplete="off"
          />
          <button
            id={`credentialEditSave-${entry.id}`}
            type="button"
            className={saveClass}
            onClick={() => void saveEdit()}
          >
            Save
          </button>
          <button type="button" className={saveClass} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && <span className="text-sm text-[#ff8a8a]">{error}</span>}
    </li>
  );
}

export function PasswordsSection({
  credentials,
  tenantUrl,
}: {
  credentials: CredentialEntry[];
  tenantUrl: string;
}) {
  const tenantOrigin = normalizeOrigin(tenantUrl);
  const originOptions = [...SUGGESTED_ORIGINS, ...(tenantOrigin ? [tenantOrigin] : [])];
  const [originChoice, setOriginChoice] = useState(originOptions[0] ?? 'custom');
  const [customOrigin, setCustomOrigin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const save = () => {
    const raw = originChoice === 'custom' ? customOrigin : originChoice;
    const origin = normalizeOrigin(raw);
    if (!origin) {
      setError('Origin must be a valid https:// origin');
      return;
    }
    if (!username || !password) {
      setError('Username and password are required');
      return;
    }
    setError(null);
    void window.devinworkspaces
      .saveCredential({ origin, username, password })
      .then((result) => {
        if (!result.ok) setError(result.error);
        else {
          setUsername('');
          setPassword('');
        }
      });
  };

  const query = search.trim().toLowerCase();
  const visible = credentials.filter(
    (entry) =>
      !query ||
      entry.origin.toLowerCase().includes(query) ||
      entry.username.toLowerCase().includes(query),
  );
  const groups = new Map<string, CredentialEntry[]>();
  for (const entry of visible) {
    const list = groups.get(entry.origin) ?? [];
    list.push(entry);
    groups.set(entry.origin, list);
  }

  return (
    <section id="credentialsSection" className="flex flex-col gap-3">
      <p className="text-xs text-[#7f8ca0] max-w-md">
        Saved passwords are filled automatically in GitHub tabs and the Devin view. Stored
        encrypted with the OS keychain (Windows DPAPI / macOS Keychain).
      </p>
      {credentials.length > 5 && (
        <input
          id="credentialSearch"
          className={inputClass}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search passwords"
          autoComplete="off"
        />
      )}
      <div className="flex flex-col gap-3 max-w-md">
        {[...groups.entries()].map(([origin, entries]) => (
          <div key={origin} className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-[#7f8ca0]">{origin}</h3>
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => (
                <PasswordRow key={entry.id} entry={entry} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 max-w-md">
        <select
          id="credentialOrigin"
          className={inputClass}
          value={originChoice}
          onChange={(event) => setOriginChoice(event.target.value)}
        >
          {originOptions.map((origin) => (
            <option key={origin} value={origin}>
              {origin}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {originChoice === 'custom' && (
          <input
            id="credentialOriginCustom"
            className={inputClass}
            value={customOrigin}
            onChange={(event) => setCustomOrigin(event.target.value)}
            placeholder="https://login.example.com"
          />
        )}
        <input
          id="credentialUsername"
          className={inputClass}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          autoComplete="off"
        />
        <input
          id="credentialPassword"
          className={inputClass}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="off"
        />
        <div className="flex items-center gap-3">
          <button id="credentialSave" type="button" className={saveClass} onClick={save}>
            Add password
          </button>
          {error && <span className="text-sm text-[#ff8a8a]">{error}</span>}
        </div>
      </div>
      <p className="text-xs text-[#7f8ca0] max-w-md">
        Sign-in tips: Prefer passkeys — enroll a passkey (Windows Hello) at Okta and GitHub for
        one-prompt sign-in.
      </p>
    </section>
  );
}
