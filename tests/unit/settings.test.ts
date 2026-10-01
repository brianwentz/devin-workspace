import { describe, expect, it } from 'vitest';
import { mergeSettings, parseSettingsFile } from '../../src/core/settings';
import { SettingsPatchSchema, SettingsSchema, type Settings } from '../../src/shared/ipc';

describe('parseSettingsFile', () => {
  it('parses a valid file unchanged', () => {
    const raw = {
      tenantUrl: 'https://tenant.example.com',
      apiBase: 'https://api.example.com',
      workspaces: ['C:\\work'],
      routing: { allowExternal: false },
      pane: { open: false, width: 500 },
      surface: 'local',
      tabs: { keepAliveHours: 48, maxLiveTabs: 12 },
    };
    const { settings, dropped } = parseSettingsFile(raw);
    expect(dropped).toEqual([]);
    expect(settings.tenantUrl).toBe('https://tenant.example.com');
    expect(settings.routing.allowExternal).toBe(false);
    expect(settings.pane).toEqual({ open: false, width: 500 });
    expect(settings.surface).toBe('local');
  });

  it('returns defaults for missing or non-object input (corrupt JSON path)', () => {
    for (const raw of [undefined, null, 'not json {{{', 42]) {
      const { settings, dropped } = parseSettingsFile(raw);
      expect(settings).toEqual(SettingsSchema.parse({}));
      expect(settings.tenantUrl).toBe('https://cloudbeds.devinenterprise.com');
      expect(dropped).toEqual(raw && typeof raw === 'object' ? dropped : []);
    }
  });

  it('drops only the invalid field and keeps the rest', () => {
    const { settings, dropped } = parseSettingsFile({
      tenantUrl: 42,
      apiBase: 'https://api.example.com',
      pane: { open: false, width: 500 },
      surface: 'local',
    });
    expect(dropped).toEqual(['tenantUrl']);
    expect(settings.tenantUrl).toBe('https://cloudbeds.devinenterprise.com');
    expect(settings.apiBase).toBe('https://api.example.com');
    expect(settings.pane).toEqual({ open: false, width: 500 });
    expect(settings.surface).toBe('local');
  });

  it('F3: rejects non-https tenant/api URLs (http only for localhost)', () => {
    const { settings, dropped } = parseSettingsFile({
      tenantUrl: 'file:///c:/evil',
      apiBase: 'http://remote.example.com',
      workspaces: [],
    });
    expect(dropped).toEqual(['tenantUrl', 'apiBase']);
    expect(settings.tenantUrl).toBe('https://cloudbeds.devinenterprise.com');
    expect(settings.apiBase).toBe('https://api.devin.ai');
    // http on loopback is allowed.
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:8080/x', 'http://[::1]:9']) {
      const result = parseSettingsFile({ tenantUrl: url });
      expect(result.dropped).toEqual([]);
      expect(result.settings.tenantUrl).toBe(url);
    }
  });
});

describe('mergeSettings', () => {
  const current: Settings = {
    ...SettingsSchema.parse({}),
    tenantUrl: 'https://x.example',
    pane: { open: false, width: 560 },
  };

  it('does not leak defaults into the patch schema', () => {
    expect(SettingsPatchSchema.parse({})).toEqual({});
    expect(SettingsPatchSchema.parse({ pane: { width: 700 } })).toEqual({
      pane: { width: 700 },
    });
  });

  it('updates only the patched pane field', () => {
    const next = mergeSettings(current, { pane: { width: 700 } });
    expect(next.tenantUrl).toBe('https://x.example');
    expect(next.pane).toEqual({ open: false, width: 700 });
  });

  it('updates only the patched tabs field', () => {
    const next = mergeSettings(current, { tabs: { keepAliveHours: 6 } });
    expect(next.tabs).toEqual({ keepAliveHours: 6, maxLiveTabs: 8 });
    const again = mergeSettings(next, { tabs: { maxLiveTabs: 20 } });
    expect(again.tabs).toEqual({ keepAliveHours: 6, maxLiveTabs: 20 });
  });

  it('updates only the patched routing field', () => {
    const next = mergeSettings(current, { routing: { allowExternal: false } });
    expect(next.routing.allowExternal).toBe(false);
    expect(next.tenantUrl).toBe('https://x.example');
    expect(next.pane).toEqual({ open: false, width: 560 });
  });

  it('is a no-op for an empty patch', () => {
    expect(mergeSettings(current, {})).toEqual(current);
  });

  it('returns current unchanged for an invalid patch', () => {
    expect(mergeSettings(current, { tenantUrl: 42 })).toBe(current);
  });
});

describe('P8 migration', () => {
  it('moves a legacy `tabs` snapshot to tabSnapshot', () => {
    const snapshot = { tabs: [{ id: 'a', url: 'https://x', title: 'x' }], activeId: 'a' };
    const { settings } = parseSettingsFile({ tabs: snapshot });
    expect(settings.tabSnapshot).toEqual(snapshot);
    expect(settings.tabs).toEqual({ keepAliveHours: 24, maxLiveTabs: 8 });
  });

  it('maps a non-default discardIdleMinutes to keepAliveHours', () => {
    expect(parseSettingsFile({ discardIdleMinutes: 90 }).settings.tabs.keepAliveHours).toBe(2);
    expect(parseSettingsFile({ discardIdleMinutes: 30 }).settings.tabs.keepAliveHours).toBe(24);
    expect(parseSettingsFile({ discardIdleMinutes: 5 }).settings.tabs.keepAliveHours).toBe(1);
    expect(parseSettingsFile({ discardIdleMinutes: 0 }).settings.tabs.keepAliveHours).toBe(1);
  });

  it('does not overwrite an explicit keepAliveHours', () => {
    const { settings } = parseSettingsFile({
      discardIdleMinutes: 60,
      tabs: { keepAliveHours: 10, maxLiveTabs: 4 },
    });
    expect(settings.tabs).toEqual({ keepAliveHours: 10, maxLiveTabs: 4 });
  });
});

describe('notifications settings (P5)', () => {
  it('defaults to enabled with no org override and merges shallowly', () => {
    const base = SettingsSchema.parse({});
    expect(base.notifications).toEqual({ enabled: true, orgId: '' });
    const merged = mergeSettings(base, { notifications: { enabled: false } });
    expect(merged.notifications).toEqual({ enabled: false, orgId: '' });
    const withOrg = mergeSettings(merged, { notifications: { orgId: 'org-123' } });
    expect(withOrg.notifications).toEqual({ enabled: false, orgId: 'org-123' });
    expect(SettingsPatchSchema.safeParse({ notifications: { enabled: 'yes' } }).success).toBe(false);
  });
});
