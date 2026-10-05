import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { CloudSessionState } from '../../shared/ipc';
import { buildSessionTree, type SessionTreeNode } from '../../core/sessionTree';
import type { Rect } from '../../core/layout';
import { useShellState } from '../store';
import { relativeTime } from './relativeTime';

// statusEnum → status dot color.
const STATUS_COLOR: Record<string, string> = {
  blocked: '#e0a03c',
  waiting: '#e0a03c',
  waiting_for_user: '#e0a03c',
  waiting_for_approval: '#e0a03c',
  working: '#6e9bd0',
  running: '#6e9bd0',
  finished: '#3fa35f',
  exit: '#3fa35f',
  crashed: '#d93a2f',
  error: '#d93a2f',
};
const statusColor = (statusEnum: string | null, status: string) =>
  STATUS_COLOR[statusEnum ?? status] ?? '#8b9bb0';

const SECTION_LABELS: Record<string, string> = {
  pinned: 'Pinned',
  recent: 'Recent',
  participated: 'Participated',
};

function statusText(cloud: ReturnType<typeof useCloud>): string {
  switch (cloud.status) {
    case 'ready':
      return cloud.lastSyncAt
        ? (() => {
            const rel = relativeTime(Date.parse(cloud.lastSyncAt), Date.now());
            return rel === 'just now' ? 'synced just now' : `synced ${rel} ago`;
          })()
        : 'synced';
    case 'connecting':
      return 'Connecting…';
    case 'no-token':
      return 'Sign in to Devin to load sessions';
    case 'error':
      return cloud.error ?? 'Error';
    default:
      return 'Unavailable';
  }
}

function useCloud() {
  return useShellState()!.cloud;
}

function Row({
  node,
  collapsedChildren,
  onToggleChildren,
  registerRow,
}: {
  node: SessionTreeNode;
  collapsedChildren: Set<string>;
  onToggleChildren: (id: string) => void;
  registerRow: (el: HTMLButtonElement | null) => void;
}) {
  const s = node.session;
  const hasChildren = node.children.length > 0 || s.directChildrenCount > 0;
  const childrenVisible = !collapsedChildren.has(s.id);
  return (
    <>
      <div className="flex items-center" style={{ paddingLeft: node.depth * 12 }}>
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={childrenVisible ? 'Collapse children' : 'Expand children'}
            className="w-4 h-4 shrink-0 flex items-center justify-center text-[#8b9bb0] hover:text-[#c9d4e3]"
            onClick={(e) => {
              e.stopPropagation();
              onToggleChildren(s.id);
            }}
          >
            {childrenVisible ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          ref={registerRow}
          data-session-id={s.id}
          data-depth={node.depth}
          data-current={node.current}
          data-unread={s.isUnread}
          data-status-enum={s.statusEnum ?? s.status}
          title={s.title || 'Untitled session'}
          className="session-row flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-[13px] text-[#c9d4e3] hover:bg-[#1a2735] focus:bg-[#1f2f42] focus:outline-none data-[current=true]:bg-[#1f2f42]"
          onClick={() => window.devinworkspaces.cloudOpen(s.id)}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: statusColor(s.statusEnum, s.status) }}
          />
          <span
            className={`flex-1 min-w-0 truncate ${s.isUnread ? 'font-semibold text-white' : ''}`}
          >
            {s.title || 'Untitled session'}
          </span>
          {s.prCount > 0 && (
            <span className="shrink-0 text-[10px] px-1 rounded bg-[#31455f] text-[#9fc4ea]">
              {s.prCount} PR
            </span>
          )}
          <span className="shrink-0 text-[10px] text-[#8b9bb0]">
            {relativeTime(s.updatedAt, Date.now())}
          </span>
        </button>
      </div>
      {childrenVisible &&
        node.children.map((child) => (
          <Row
            key={child.session.id}
            node={child}
            collapsedChildren={collapsedChildren}
            onToggleChildren={onToggleChildren}
            registerRow={registerRow}
          />
        ))}
    </>
  );
}

export function SessionSidebar({ rect }: { rect: Rect }) {
  const state = useShellState();
  const [query, setQuery] = useState('');
  const [collapsedChildren, setCollapsedChildren] = useState<Set<string>>(new Set());
  const rowRefs = useRef<HTMLButtonElement[]>([]);
  rowRefs.current = [];

  const cloud = state!.cloud;
  const collapsedFolders = state!.settings.sessions.collapsedFolders;
  const tree = useMemo(
    () =>
      buildSessionTree(cloud, {
        collapsedFolders,
        currentSessionId: state!.currentSessionId,
      }),
    [cloud, collapsedFolders, state!.currentSessionId],
  );

  const toggleFolder = (name: string) => {
    const next = collapsedFolders.includes(name)
      ? collapsedFolders.filter((f) => f !== name)
      : [...collapsedFolders, name];
    void window.devinworkspaces.setSettings({ sessions: { collapsedFolders: next } });
  };

  const toggleChildren = (id: string) => {
    setCollapsedChildren((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const registerRow = (el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.push(el);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = rowRefs.current.filter((el) => el.isConnected);
    if (rows.length === 0) return;
    event.preventDefault();
    const active = document.activeElement;
    const index = rows.findIndex((el) => el === active);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      index === -1
        ? (delta + rows.length) % rows.length
        : (index + delta + rows.length) % rows.length;
    rows[next]?.focus();
  };

  const q = query.trim().toLowerCase();
  const filtered: CloudSessionState[] = q
    ? cloud.sessions.filter((s) => s.title.toLowerCase().includes(q))
    : [];

  return (
    <section
      id="sessionsPanel"
      className="shell-chrome absolute flex flex-col bg-[#0d141d] border-r border-[#1e2a38] text-[#c9d4e3]"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="text-[13px] font-semibold flex-1">Sessions</span>
        <button
          id="cloudRefresh"
          type="button"
          aria-label="Refresh sessions"
          title="Refresh"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#1a2735] text-[#8b9bb0] hover:text-[#c9d4e3]"
          onClick={() => window.devinworkspaces.cloudRefresh()}
        >
          <RefreshCw size={13} className={cloud.status === 'connecting' ? 'animate-spin' : ''} />
        </button>
      </div>
      <div
        id="cloudStatus"
        data-cloud-status={cloud.status}
        className="px-3 pb-1.5 text-[11px] text-[#8b9bb0] truncate"
        title={cloud.status === 'error' ? (cloud.error ?? '') : undefined}
      >
        {statusText(cloud)}
      </div>
      <div className="px-3 pb-2">
        <input
          id="sessionSearch"
          type="text"
          placeholder="Filter sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full h-7 px-2 rounded bg-[#141d29] border border-[#2c3949] text-[12px] placeholder-[#5c6b80] focus:outline-none focus:border-[#54749c]"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {q ? (
          filtered.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-[#5c6b80]">No matches</div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                ref={registerRow}
                data-session-id={s.id}
                data-depth={0}
                data-current={s.id === state!.currentSessionId}
                data-unread={s.isUnread}
                data-status-enum={s.statusEnum ?? s.status}
                title={s.title || 'Untitled session'}
                className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left text-[13px] hover:bg-[#1a2735] focus:bg-[#1f2f42] focus:outline-none"
                onClick={() => window.devinworkspaces.cloudOpen(s.id)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: statusColor(s.statusEnum, s.status) }}
                />
                <span
                  className={`flex-1 min-w-0 truncate ${s.isUnread ? 'font-semibold text-white' : ''}`}
                >
                  {s.title || 'Untitled session'}
                </span>
                <span className="shrink-0 text-[10px] text-[#8b9bb0]">
                  {relativeTime(s.updatedAt, Date.now())}
                </span>
              </button>
            ))
          )
        ) : tree.sections.length === 0 && cloud.status === 'ready' ? (
          <div className="px-2 py-3 text-[12px] text-[#5c6b80]">No sessions yet</div>
        ) : (
          tree.sections.map((sectionItem) => (
            <div key={`${sectionItem.kind}:${sectionItem.name}`} className="mb-1">
              <button
                type="button"
                data-section-kind={sectionItem.kind}
                data-section-name={sectionItem.name}
                className="w-full flex items-center gap-1 px-1 py-1 text-[11px] uppercase tracking-wide text-[#8b9bb0] hover:text-[#c9d4e3]"
                onClick={() => toggleFolder(sectionItem.name)}
              >
                {sectionItem.collapsed ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                <span className="flex-1 text-left truncate">
                  {SECTION_LABELS[sectionItem.name] ?? sectionItem.name}
                </span>
                <span className="text-[10px] text-[#5c6b80]">
                  {sectionItem.total !== null
                    ? `${sectionItem.nodes.length} / ${sectionItem.total}`
                    : sectionItem.nodes.length}
                </span>
              </button>
              {!sectionItem.collapsed && (
                <>
                  {sectionItem.nodes.length === 0 ? (
                    <div className="pl-6 py-1 text-[11px] text-[#5c6b80]">No sessions</div>
                  ) : (
                    sectionItem.nodes.map((node) => (
                      <Row
                        key={node.session.id}
                        node={node}
                        collapsedChildren={collapsedChildren}
                        onToggleChildren={toggleChildren}
                        registerRow={registerRow}
                      />
                    ))
                  )}
                  {sectionItem.hasMore && (
                    <button
                      type="button"
                      data-load-more={sectionItem.name}
                      className="w-full pl-6 py-1 text-left text-[11px] text-[#6e9bd0] hover:text-[#9fc4ea]"
                      onClick={() => window.devinworkspaces.cloudLoadMore(sectionItem.name)}
                    >
                      Show more
                    </button>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
