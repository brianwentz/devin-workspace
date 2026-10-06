import { describe, expect, it } from 'vitest';
import { parseCloudCache, serializeCloudCache } from '../../src/core/cloudCache';
import type { CloudSessionState } from '../../src/shared/ipc';

const TENANT = 'https://tenant.example.com/';

const session: CloudSessionState = {
  id: 'abc123',
  acpId: 'devin-abc123',
  title: 'Test session',
  url: 'https://tenant.example.com/sessions/abc123',
  status: 'suspended',
  statusEnum: 'finished',
  userActionRequired: null,
  folder: 'Alpha',
  parentId: null,
  isPinned: false,
  isUnread: true,
  isStarred: false,
  directChildrenCount: 0,
  hasMoreChildren: false,
  prs: { open: 1, queued: 0, draft: 0, merged: 0, closed: 0 },
  isArchived: false,
  updatedAt: 1759500000000,
};

const input = {
  tenantUrl: TENANT,
  savedAt: '2025-10-03T12:00:00.000Z',
  sessions: [session],
  folders: ['Alpha', 'pinned'],
  folderTotals: { Alpha: 3 },
};

describe('cloudCache', () => {
  it('round-trips a serialized cache', () => {
    const parsed = parseCloudCache(serializeCloudCache(input), TENANT);
    expect(parsed).toEqual({ version: 1, ...input });
  });

  it('matches the tenant ignoring trailing slashes', () => {
    const json = serializeCloudCache(input);
    expect(parseCloudCache(json, 'https://tenant.example.com')).not.toBeNull();
  });

  it('returns null on a tenant mismatch', () => {
    const json = serializeCloudCache(input);
    expect(parseCloudCache(json, 'https://other.example.com')).toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseCloudCache('not json', TENANT)).toBeNull();
    expect(parseCloudCache('{}', TENANT)).toBeNull();
  });

  it('returns null on a wrong version', () => {
    const json = JSON.stringify({ version: 2, ...input });
    expect(parseCloudCache(json, TENANT)).toBeNull();
  });
});
