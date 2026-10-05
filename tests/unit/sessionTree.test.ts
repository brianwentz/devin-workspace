import { describe, expect, it } from 'vitest';
import type { CloudListResult, CloudSession } from '../../src/core/cloudAcp';
import {
  addFolder,
  buildSessionTree,
  moveSession,
  removeFolder,
  renameFolder,
  reorderFolders,
  setArchived,
} from '../../src/core/sessionTree';

let seq = 0;
function session(partial: Partial<CloudSession> & { id: string }): CloudSession {
  return {
    acpId: `devin-${partial.id}`,
    title: `s-${partial.id}`,
    url: `https://t.invalid/sessions/${partial.id}`,
    status: 'suspended',
    statusEnum: 'finished',
    userActionRequired: null,
    folder: null,
    parentId: null,
    isPinned: false,
    isUnread: false,
    isStarred: false,
    directChildrenCount: 0,
    hasMoreChildren: false,
    prs: { open: 0, queued: 0, draft: 0, merged: 0, closed: 0 },
    isArchived: false,
    updatedAt: 1000 + seq++,
    ...partial,
  };
}

function tree(result: CloudListResult, opts?: { collapsedFolders?: string[]; currentSessionId?: string | null }) {
  return buildSessionTree(result, {
    collapsedFolders: opts?.collapsedFolders ?? [],
    currentSessionId: opts?.currentSessionId ?? null,
  });
}

const section = (t: ReturnType<typeof tree>, name: string) =>
  t.sections.find((s) => s.name === name);

describe('buildSessionTree', () => {
  it('orders sections: pinned, folders in order (minus pinned), extras, recent', () => {
    const result: CloudListResult = {
      folders: ['Beta', 'Alpha', 'pinned', 'participated'],
      folderTotals: {},
      nextCursor: null,
      sessions: [
        session({ id: 'p', isPinned: true, folder: 'Alpha' }),
        session({ id: 'a', folder: 'Alpha' }),
        session({ id: 'b', folder: 'Beta' }),
        session({ id: 'x', folder: 'Zeta' }), // folder not in the order list
        session({ id: 'part', folder: 'participated' }),
        session({ id: 'r' }),
      ],
    };
    const t = tree(result);
    expect(t.sections.map((s) => s.name)).toEqual([
      'pinned',
      'Beta',
      'Alpha',
      'participated',
      'Zeta',
      'recent',
    ]);
    expect(section(t, 'pinned')!.kind).toBe('pinned');
    expect(section(t, 'Zeta')!.kind).toBe('folder');
    expect(section(t, 'recent')!.nodes.map((n) => n.session.id)).toEqual(['r']);
  });

  it('pinned sessions appear only in pinned, even when foldered', () => {
    const result: CloudListResult = {
      folders: ['Alpha'],
      folderTotals: {},
      nextCursor: null,
      sessions: [
        session({ id: 'p', isPinned: true, folder: 'Alpha' }),
        session({ id: 'a', folder: 'Alpha' }),
      ],
    };
    const t = tree(result);
    expect(section(t, 'pinned')!.nodes.map((n) => n.session.id)).toEqual(['p']);
    expect(section(t, 'Alpha')!.nodes.map((n) => n.session.id)).toEqual(['a']);
  });

  it('nests children under their parent; orphans become roots', () => {
    const result: CloudListResult = {
      folders: ['Alpha'],
      folderTotals: {},
      nextCursor: null,
      sessions: [
        session({ id: 'root', folder: 'Alpha', directChildrenCount: 2 }),
        session({ id: 'c1', folder: 'Alpha', parentId: 'root', updatedAt: 10 }),
        session({ id: 'c2', folder: 'Alpha', parentId: 'root', updatedAt: 20 }),
        session({ id: 'gc', folder: 'Alpha', parentId: 'c2', updatedAt: 30 }),
        session({ id: 'orphan', folder: 'Alpha', parentId: 'missing', updatedAt: 5 }),
      ],
    };
    const t = tree(result);
    const alpha = section(t, 'Alpha')!;
    const ids = alpha.nodes.map((n) => n.session.id);
    expect(ids).toEqual(['root', 'orphan']);
    const root = alpha.nodes[0]!;
    expect(root.children.map((n) => n.session.id)).toEqual(['c2', 'c1']); // updatedAt desc
    expect(root.children[0]!.depth).toBe(1);
    expect(root.children[0]!.children.map((n) => n.session.id)).toEqual(['gc']);
    expect(root.children[0]!.children[0]!.depth).toBe(2);
  });

  it('sorts roots by updatedAt desc inside a section', () => {
    const result: CloudListResult = {
      folders: ['Alpha'],
      folderTotals: {},
      nextCursor: null,
      sessions: [
        session({ id: 'old', folder: 'Alpha', updatedAt: 1 }),
        session({ id: 'new', folder: 'Alpha', updatedAt: 2 }),
      ],
    };
    expect(section(tree(result), 'Alpha')!.nodes.map((n) => n.session.id)).toEqual([
      'new',
      'old',
    ]);
  });

  it('computes total/hasMore from folderTotals and keeps empty folders', () => {
    const result: CloudListResult = {
      folders: ['Alpha', 'Empty'],
      folderTotals: { Alpha: 5, Empty: 0 },
      nextCursor: null,
      sessions: [session({ id: 'a', folder: 'Alpha' }), session({ id: 'a2', folder: 'Alpha' })],
    };
    const t = tree(result);
    expect(section(t, 'Alpha')!.total).toBe(5);
    expect(section(t, 'Alpha')!.hasMore).toBe(true);
    const empty = section(t, 'Empty')!;
    expect(empty.nodes).toEqual([]);
    expect(empty.hasMore).toBe(false);
  });

  it('hasMore is false when total is null', () => {
    const result: CloudListResult = {
      folders: ['Alpha'],
      folderTotals: {},
      nextCursor: null,
      sessions: [session({ id: 'a', folder: 'Alpha' })],
    };
    expect(section(tree(result), 'Alpha')!.hasMore).toBe(false);
  });

  it('applies collapsed flag and current marker', () => {
    const result: CloudListResult = {
      folders: ['Alpha'],
      folderTotals: {},
      nextCursor: null,
      sessions: [session({ id: 'a', folder: 'Alpha' }), session({ id: 'b' })],
    };
    const t = tree(result, { collapsedFolders: ['Alpha'], currentSessionId: 'b' });
    expect(section(t, 'Alpha')!.collapsed).toBe(true);
    expect(section(t, 'recent')!.collapsed).toBe(false);
    expect(section(t, 'recent')!.nodes[0]!.current).toBe(true);
    expect(section(t, 'Alpha')!.nodes[0]!.current).toBe(false);
  });

  it('omits pinned and recent sections when empty', () => {
    const result: CloudListResult = {
      folders: ['Alpha'],
      folderTotals: {},
      nextCursor: null,
      sessions: [session({ id: 'a', folder: 'Alpha' })],
    };
    const t = tree(result);
    expect(t.sections.map((s) => s.name)).toEqual(['Alpha']);
  });
});

describe('optimistic mutations', () => {
  const data = () => ({
    folders: ['Alpha', 'pinned', 'Beta'],
    folderTotals: { Alpha: 2, Beta: 1 },
    sessions: [
      session({ id: 'a', folder: 'Alpha' }),
      session({ id: 'b', folder: 'Beta' }),
      session({ id: 'c' }),
    ],
  });

  it('moveSession sets/clears the folder', () => {
    expect(moveSession(data(), 'c', 'Alpha').sessions[2]!.folder).toBe('Alpha');
    expect(moveSession(data(), 'a', null).sessions[0]!.folder).toBeNull();
    // Unknown id is a no-op.
    const d = data();
    expect(moveSession(d, 'zz', 'Alpha').sessions).toEqual(d.sessions);
  });

  it('reorderFolders reorders user folders and keeps stragglers', () => {
    const next = reorderFolders(data(), ['Beta', 'Alpha']);
    expect(next.folders).toEqual(['Beta', 'Alpha']);
    // 'pinned' can never be reintroduced into the folder order.
    expect(reorderFolders(data(), ['pinned', 'Alpha']).folders).toEqual(['Alpha', 'Beta']);
  });

  it('addFolder appends once', () => {
    expect(addFolder(data(), 'Gamma').folders).toEqual(['Alpha', 'pinned', 'Beta', 'Gamma']);
    expect(addFolder(data(), 'Alpha').folders).toEqual(data().folders);
  });

  it('renameFolder renames folder, sessions and totals', () => {
    const next = renameFolder(data(), 'Alpha', 'Greek');
    expect(next.folders).toEqual(['Greek', 'pinned', 'Beta']);
    expect(next.sessions[0]!.folder).toBe('Greek');
    expect(next.folderTotals).toEqual({ Greek: 2, Beta: 1 });
  });

  it('removeFolder unfolders sessions and drops totals', () => {
    const next = removeFolder(data(), 'Alpha');
    expect(next.folders).toEqual(['pinned', 'Beta']);
    expect(next.sessions[0]!.folder).toBeNull();
    expect(next.folderTotals).toEqual({ Beta: 1 });
  });

  it('setArchived toggles the flag', () => {
    expect(setArchived(data(), 'a', true).sessions[0]!.isArchived).toBe(true);
    expect(setArchived(data(), 'a', false).sessions[0]!.isArchived).toBe(false);
  });
});
