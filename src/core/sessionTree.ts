// Lays CloudListResult sessions out as the sidebar tree: pinned section,
// folder sections in the server-provided order, then an unfoldered 'recent'
// section. Pure — the renderer and tests consume this directly.

import type { CloudListResult, CloudSession } from './cloudAcp';

export interface SessionTreeNode {
  session: CloudSession;
  children: SessionTreeNode[];
  depth: number;
  current: boolean;
}

export interface SessionTreeSection {
  kind: 'pinned' | 'folder' | 'recent';
  name: string;
  collapsed: boolean;
  /** folderTotals total for this section, null when unknown. */
  total: number | null;
  nodes: SessionTreeNode[];
  hasMore: boolean;
}

export interface SessionTree {
  sections: SessionTreeSection[];
}

const PINNED = 'pinned';

export function buildSessionTree(
  result: Pick<CloudListResult, 'sessions' | 'folders' | 'folderTotals'>,
  opts: { collapsedFolders: string[]; currentSessionId: string | null },
): SessionTree {
  const collapsed = new Set(opts.collapsedFolders);
  const byId = new Map(result.sessions.map((s) => [s.id, s]));

  // Children attach to their parent anywhere in the list; a child whose
  // parent is absent (or pinned — pinned sessions lift to the pinned section,
  // which is the only place a pinned session appears) becomes a root.
  const childrenOf = new Map<string, CloudSession[]>();
  const roots: CloudSession[] = [];
  for (const session of result.sessions) {
    const parent =
      session.parentId && !session.isPinned ? byId.get(session.parentId) : undefined;
    if (parent) {
      const list = childrenOf.get(parent.id) ?? [];
      list.push(session);
      childrenOf.set(parent.id, list);
    } else {
      roots.push(session);
    }
  }

  const byUpdatedDesc = (a: CloudSession, b: CloudSession) => b.updatedAt - a.updatedAt;

  const toNode = (session: CloudSession, depth: number): SessionTreeNode => ({
    session,
    children: (childrenOf.get(session.id) ?? [])
      .sort(byUpdatedDesc)
      .map((child) => toNode(child, depth + 1)),
    depth,
    current: session.id === opts.currentSessionId,
  });

  const makeSection = (
    kind: SessionTreeSection['kind'],
    name: string,
    sectionRoots: CloudSession[],
    keepEmpty: boolean,
  ): SessionTreeSection | null => {
    if (!keepEmpty && sectionRoots.length === 0) return null;
    const total = result.folderTotals[name] ?? null;
    return {
      kind,
      name,
      collapsed: collapsed.has(name),
      total,
      nodes: sectionRoots.sort(byUpdatedDesc).map((s) => toNode(s, 0)),
      hasMore: total !== null && total > sectionRoots.length,
    };
  };

  const pinnedRoots = roots.filter((s) => s.isPinned);
  const unpinned = roots.filter((s) => !s.isPinned);

  const sections: SessionTreeSection[] = [];
  const pinnedSection = makeSection('pinned', PINNED, pinnedRoots, false);
  if (pinnedSection) sections.push(pinnedSection);

  // Folder sections in server order ('pinned' excluded — it is a section, not
  // a folder here); names seen on sessions but absent from the order list are
  // appended alphabetically.
  const seenNames = new Set(
    unpinned.map((s) => s.folder).filter((f): f is string => f !== null),
  );
  const ordered = result.folders.filter((name) => name !== PINNED);
  const extra = [...seenNames].filter((name) => !ordered.includes(name)).sort();
  for (const name of [...ordered, ...extra]) {
    const section = makeSection(
      'folder',
      name,
      unpinned.filter((s) => s.folder === name),
      true,
    );
    if (section) sections.push(section);
  }

  const recent = makeSection(
    'recent',
    'recent',
    unpinned.filter((s) => s.folder === null),
    false,
  );
  if (recent) sections.push(recent);

  return { sections };
}

// --- optimistic sidebar mutations ----------------------------------------
// Applied to a local copy while the REST call is in flight; the next
// cloud.list (success or recorded error) replaces them.

export type CloudListData = Pick<
  CloudListResult,
  'sessions' | 'folders' | 'folderTotals'
>;

const withoutSessions = (data: CloudListData, patch: (s: CloudSession) => CloudSession): CloudListData => ({
  ...data,
  sessions: data.sessions.map(patch),
});

export function moveSession(data: CloudListData, id: string, folder: string | null): CloudListData {
  return withoutSessions(data, (s) =>
    s.id === id ? { ...s, folder, isPinned: folder === PINNED } : s,
  );
}

export function reorderFolders(data: CloudListData, names: string[]): CloudListData {
  const next = names.filter((name) => name !== PINNED);
  const missing = data.folders.filter((name) => name !== PINNED && !next.includes(name));
  return { ...data, folders: [...next, ...missing] };
}

export function addFolder(data: CloudListData, name: string): CloudListData {
  if (data.folders.includes(name)) return data;
  return { ...data, folders: [...data.folders, name] };
}

export function renameFolder(data: CloudListData, oldName: string, newName: string): CloudListData {
  if (oldName === newName) return data;
  const totals = { ...data.folderTotals };
  if (oldName in totals) {
    totals[newName] = totals[oldName]!;
    delete totals[oldName];
  }
  return {
    ...data,
    folders: data.folders.map((f) => (f === oldName ? newName : f)),
    folderTotals: totals,
    sessions: data.sessions.map((s) => (s.folder === oldName ? { ...s, folder: newName } : s)),
  };
}

export function removeFolder(data: CloudListData, name: string): CloudListData {
  const totals = { ...data.folderTotals };
  delete totals[name];
  return {
    ...data,
    folders: data.folders.filter((f) => f !== name),
    folderTotals: totals,
    sessions: data.sessions.map((s) => (s.folder === name ? { ...s, folder: null } : s)),
  };
}

export function setArchived(data: CloudListData, id: string, archived: boolean): CloudListData {
  return withoutSessions(data, (s) => (s.id === id ? { ...s, isArchived: archived } : s));
}
