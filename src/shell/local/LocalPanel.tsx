import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { LocalStatePublic } from '../../shared/ipc';
import { AgentBadge, MessageView, PermissionCard, PlanList, buttonClass } from './Cards';
import { TerminalView } from './TerminalView';
import { useLocalState } from './store';

type Session = LocalStatePublic['sessions'][string];

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sessionsOf(state: LocalStatePublic, workspace: string | null): Session[] {
  if (!workspace) return [];
  return Object.values(state.sessions)
    .filter((session) => session.workspace === workspace)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function LocalPanel({ style }: { style: CSSProperties }) {
  const local = useLocalState();
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'chat' | 'terminal'>('chat');
  // Lazily open the workspace's devin pty only once the Terminal tab is opened;
  // keep the view mounted (display:none) afterwards so scrollback survives.
  const [terminalActive, setTerminalActive] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [terminalWorkspace, setTerminalWorkspace] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const listedFor = useRef<Set<string>>(new Set());

  const workspaces = useMemo(() => Object.keys(local?.agents ?? {}).sort(), [local]);

  // Pick a default workspace, and auto-list its sessions once.
  useEffect(() => {
    if (!local) return;
    if (!workspace || !local.agents[workspace]) {
      setWorkspace(workspaces[0] ?? null);
      setSessionId(null);
    }
  }, [local, workspace, workspaces]);

  // Open (or reuse) the workspace devin pty when the Terminal tab is shown.
  useEffect(() => {
    if (!terminalActive || !workspace || (terminalWorkspace === workspace && terminalId)) return;
    let cancelled = false;
    void window.devinworkspaces
      .terminalOpen({ kind: 'devin', workspace })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setTerminalId(result.id);
          setTerminalWorkspace(workspace);
          setTerminalError(null);
        } else {
          setTerminalError(result.error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [terminalActive, workspace, terminalWorkspace, terminalId]);

  useEffect(() => {
    if (!workspace || listedFor.current.has(workspace)) return;
    listedFor.current.add(workspace);
    void window.devinworkspaces.localListSessions(workspace).then((result) => {
      if (!result.ok) setError(result.error);
    });
  }, [workspace]);

  const sessions = local ? sessionsOf(local, workspace) : [];
  const session = sessionId && local ? (local.sessions[sessionId] ?? null) : null;
  const agent = workspace && local ? local.agents[workspace] : undefined;

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [session?.messages.length, session?.plan, session?.pendingPermission?.requestId]);

  const run = async <T,>(
    action: Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  ): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await action;
      if (!result.ok) {
        setError(result.error);
        return undefined;
      }
      setError(null);
      return result.value;
    } finally {
      setBusy(false);
    }
  };

  const addWorkspace = async () => {
    const picked = await run(window.devinworkspaces.localPickWorkspace());
    if (picked) {
      setWorkspace(picked);
      setSessionId(null);
    }
  };

  const removeWorkspace = async (path: string) => {
    await run(window.devinworkspaces.localRemoveWorkspace(path));
    listedFor.current.delete(path);
    if (workspace === path) {
      setWorkspace(null);
      setSessionId(null);
    }
  };

  const newSession = async () => {
    if (!workspace) return;
    const id = await run(window.devinworkspaces.localNewSession(workspace));
    if (id) setSessionId(id);
  };

  const openSession = async (target: Session) => {
    setSessionId(target.id);
    setError(null);
    if (!target.loaded && workspace) {
      const result = await window.devinworkspaces.localLoadSession(workspace, target.id);
      if (!result.ok) setError(result.error);
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !session || session.running) return;
    setDraft('');
    setError(null);
    void window.devinworkspaces.localPrompt(session.id, text).then((result) => {
      if (!result.ok) setError(result.error);
    });
  };

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const cancel = () => {
    if (session) void window.devinworkspaces.localCancel(session.id);
  };

  return (
    <main id="localPanel" className="shell-chrome flex bg-[#111925] text-[#e8edf5]" style={style}>
      {/* Left column: workspaces + sessions */}
      <aside className="flex w-64 flex-none flex-col border-r border-[#39475a] bg-[#101722]">
        <div className="flex items-center justify-between border-b border-[#39475a] px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-[#7f8ca0]">Workspaces</span>
          <button id="wsAdd" type="button" className={buttonClass} onClick={() => void addWorkspace()} disabled={busy}>
            + Add
          </button>
        </div>
        <ul id="wsList" className="m-0 flex list-none flex-col p-0">
          {workspaces.length === 0 && (
            <li className="px-3 py-2 text-xs text-[#7f8ca0]">No workspaces yet — add a folder to start.</li>
          )}
          {workspaces.map((path) => {
            const status = local?.agents[path]?.status ?? 'stopped';
            return (
              <li
                key={path}
                className={`ws-item flex items-center gap-2 px-3 py-1.5 text-xs ${
                  path === workspace ? 'bg-[#27364a]' : 'hover:bg-[#18212e]'
                }`}
                data-workspace={path}
                data-status={status}
              >
                <button
                  type="button"
                  className="ws-select flex-1 truncate text-left"
                  title={path}
                  onClick={() => {
                    setWorkspace(path);
                    setSessionId(null);
                  }}
                >
                  <span
                    className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                      status === 'ready'
                        ? 'bg-[#8fd18f]'
                        : status === 'starting'
                          ? 'bg-[#83b6ff]'
                          : status === 'crashed' || status === 'missing-cli'
                            ? 'bg-[#ff8a8a]'
                            : 'bg-[#39475a]'
                    }`}
                  />
                  {baseName(path)}
                </button>
                <button
                  type="button"
                  className="ws-remove closeMark"
                  title="Remove workspace"
                  aria-label={`Remove ${baseName(path)}`}
                  onClick={() => void removeWorkspace(path)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex items-center justify-between border-y border-[#39475a] px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-[#7f8ca0]">Sessions</span>
          <button
            id="sessionNew"
            type="button"
            className={buttonClass}
            disabled={!workspace || busy || !local?.cliPath}
            onClick={() => void newSession()}
          >
            New session
          </button>
        </div>
        <ul id="sessionList" className="m-0 flex flex-1 list-none flex-col overflow-auto p-0">
          {sessions.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`session-item w-full px-3 py-1.5 text-left text-xs ${
                  item.id === sessionId ? 'bg-[#27364a]' : 'hover:bg-[#18212e]'
                }`}
                data-session-id={item.id}
                data-history-source={item.historySource}
                onClick={() => void openSession(item)}
              >
                <div className="session-title truncate">{item.title || 'Untitled session'}</div>
                <div className="flex items-center gap-2 text-[10px] text-[#7f8ca0]">
                  <span>{formatDate(item.createdAt)}</span>
                  {item.running && <span className="spinner" />}
                  {item.historySource === 'local-index' && (
                    <span className="history-label text-[#e0a03c]">history not supported by agent</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Right column: chat | terminal */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[#39475a] px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{session?.title || (workspace ? baseName(workspace) : 'Devin Local')}</div>
            <div className="truncate font-mono text-[10px] text-[#7f8ca0]">{workspace ?? ''}</div>
          </div>
          <div id="localViewTabs" className="flex overflow-hidden rounded-md border border-[#39475a]">
            {(['chat', 'terminal'] as const).map((tab) => (
              <button
                key={tab}
                id={`view-${tab}`}
                type="button"
                className={`px-3 py-1 text-xs ${
                  view === tab ? 'bg-[#27364a] text-[#e8edf5]' : 'text-[#7f8ca0] hover:bg-[#18212e]'
                }`}
                onClick={() => {
                  setView(tab);
                  if (tab === 'terminal') setTerminalActive(true);
                }}
              >
                {tab === 'chat' ? 'Chat' : 'Terminal'}
              </button>
            ))}
          </div>
          <AgentBadge agent={agent} installGuidance={local?.installGuidance ?? ''} />
        </header>
        <div
          id="terminalPane"
          className="flex min-h-0 flex-1 flex-col"
          style={{ display: view === 'terminal' ? 'flex' : 'none' }}
        >
          {terminalActive && workspace && (
            <>
              {terminalWorkspace !== workspace || !terminalId ? null : (
                <TerminalView
                  key={terminalId}
                  id={terminalId}
                  onRestart={() => {
                    window.devinworkspaces.terminalClose(terminalId);
                    setTerminalId(null);
                  }}
                />
              )}
              {terminalError && (
                <div className="border-b border-[#39475a] px-3 py-1.5 text-xs text-[#ff8a8a]">
                  {terminalError}
                </div>
              )}
            </>
          )}
        </div>
        <div
          id="chatPane"
          className="flex min-h-0 flex-1 flex-col"
          style={{ display: view === 'chat' ? 'flex' : 'none' }}
        >
        <div ref={scroller} id="messageList" className="flex flex-1 flex-col gap-2 overflow-auto px-4 py-3">
          {!session && (
            <p className="text-sm text-[#7f8ca0]">
              {workspace
                ? 'Select a session or start a new one.'
                : 'Add a workspace folder, then start a session with the Devin CLI.'}
            </p>
          )}
          {session?.messages.map((message, index) => (
            <MessageView key={index} message={message} session={session} />
          ))}
          {session?.plan && session.plan.length > 0 && <PlanList plan={session.plan} />}
          {session?.pendingPermission && (
            <PermissionCard sessionId={session.id} permission={session.pendingPermission} />
          )}
          {session?.lastStopReason && session.lastStopReason !== 'end_turn' && (
            <div id="stopReason" className="text-xs text-[#e0a03c]" data-stop-reason={session.lastStopReason}>
              Turn ended: {session.lastStopReason}
              {session.error ? ` — ${session.error}` : ''}
            </div>
          )}
        </div>
        {error && (
          <div id="localError" className="border-t border-[#39475a] px-4 py-1.5 text-xs text-[#ff8a8a]">
            {error}
          </div>
        )}
        <footer className="border-t border-[#39475a] px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              id="composer"
              className="min-h-[44px] max-h-40 flex-1 resize-y rounded-md border border-[#39475a] bg-[#0d141d] px-2 py-1.5 text-sm text-[#e8edf5]"
              placeholder={session ? 'Message Devin…' : 'Start a session to chat'}
              value={draft}
              disabled={!session}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKey}
              rows={2}
            />
            {session?.running ? (
              <button id="cancelButton" type="button" className={buttonClass} onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button
                id="sendButton"
                type="button"
                className={buttonClass}
                disabled={!session || !draft.trim()}
                onClick={send}
              >
                Send
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-[#7f8ca0]">
            Enter sends · Shift+Enter newline · type <code>/handoff</code> to move this session to Devin Cloud
          </p>
        </footer>
        </div>
      </section>
    </main>
  );
}
