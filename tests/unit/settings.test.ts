import { describe, expect, it } from 'vitest';
import { mergeSettings, migrateSettingsRaw, parseSettingsFile } from '../../src/core/settings';
import { SettingsPatchSchema, SettingsSchema, type Settings } from '../../src/shared/ipc';

describe('parseSettingsFile', () => {
  it('parses a valid file unchanged', () => {
    const raw = {
      tenantUrl: 'https://tenant.example.com',
      apiBase: 'https://api.example.com',
      workspaces: ['C:\\work'],
      routing: { allowExternal: false },
      pane: { open: false, fraction: 0.4 },
      surface: 'local',
      tabs: { keepAliveHours: 48, maxLiveTabs: 12 },
    };
    const { settings, dropped } = parseSettingsFile(raw);
    expect(dropped).toEqual([]);
    expect(settings.tenantUrl).toBe('https://tenant.example.com');
    expect(settings.routing.allowExternal).toBe(false);
    expect(settings.pane).toEqual({ open: false, fraction: 0.4 });
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
      pane: { open: false, fraction: 0.4 },
      surface: 'local',
    });
    expect(dropped).toEqual(['tenantUrl']);
    expect(settings.tenantUrl).toBe('https://cloudbeds.devinenterprise.com');
    expect(settings.apiBase).toBe('https://api.example.com');
    expect(settings.pane).toEqual({ open: false, fraction: 0.4 });
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
    pane: { open: false, fraction: 0.4 },
  };

  it('does not leak defaults into the patch schema', () => {
    expect(SettingsPatchSchema.parse({})).toEqual({});
    expect(SettingsPatchSchema.parse({ pane: { fraction: 0.6 } })).toEqual({
      pane: { fraction: 0.6 },
    });
    expect(SettingsPatchSchema.safeParse({ pane: { fraction: 1.5 } }).success).toBe(false);
  });

  it('updates only the patched pane field', () => {
    const next = mergeSettings(current, { pane: { fraction: 0.6 } });
    expect(next.tenantUrl).toBe('https://x.example');
    expect(next.pane).toEqual({ open: false, fraction: 0.6 });
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
    expect(next.pane).toEqual({ open: false, fraction: 0.4 });
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

describe('F2 pane fraction migration', () => {
  // Legacy px widths were recorded against the 1400 px default window: 1400 - 56 - 6 = 1338.
  it('converts pane.width px to pane.fraction and drops width', () => {
    const { settings, dropped } = parseSettingsFile({ pane: { open: true, width: 500 } });
    expect(dropped).toEqual([]);
    expect(settings.pane.fraction).toBeCloseTo(500 / 1338, 6);
    expect(settings.pane.open).toBe(true);
    expect('width' in settings.pane).toBe(false);
  });

  it('clamps out-of-range px to [0, 1]', () => {
    expect(parseSettingsFile({ pane: { width: 5000 } }).settings.pane.fraction).toBe(1);
    expect(parseSettingsFile({ pane: { width: -20 } }).settings.pane.fraction).toBe(0);
  });

  it('keeps an explicit fraction when both are present', () => {
    const { settings } = parseSettingsFile({ pane: { width: 500, fraction: 0.7 } });
    expect(settings.pane.fraction).toBe(0.7);
  });

  it('falls back to the 0.5 default when width is not a finite number', () => {
    expect(parseSettingsFile({ pane: { width: 'wide' } }).settings.pane.fraction).toBe(0.5);
    expect(parseSettingsFile({ pane: { open: false } }).settings.pane).toEqual({
      open: false,
      fraction: 0.5,
    });
    expect(SettingsSchema.parse({}).pane).toEqual({ open: true, fraction: 0.5 });
  });

  it('migrateSettingsRaw strips width even when fraction already exists', () => {
    expect(migrateSettingsRaw({ pane: { width: 500, fraction: 0.3 } })).toEqual({
      pane: { fraction: 0.3 },
    });
  });
});

describe('F2 window placements', () => {
  it('defaults to an empty record and merges as a top-level replace', () => {
    const base = SettingsSchema.parse({});
    expect(base.windowPlacements).toEqual({});
    const placement = { bounds: { x: 1, y: 2, width: 800, height: 600 }, maximized: false, savedAt: 10 };
    const merged = mergeSettings(base, { windowPlacements: { a: placement } });
    expect(merged.windowPlacements).toEqual({ a: placement });
    const replaced = mergeSettings(merged, { windowPlacements: { b: placement } });
    expect(replaced.windowPlacements).toEqual({ b: placement });
    expect(SettingsPatchSchema.safeParse({ windowPlacements: { a: { bounds: {} } } }).success).toBe(false);
  });

  it('drops an invalid windowPlacements field on repair but keeps the rest', () => {
    const { settings, dropped } = parseSettingsFile({ windowPlacements: 'nope', surface: 'local' });
    expect(dropped).toEqual(['windowPlacements']);
    expect(settings.windowPlacements).toEqual({});
    expect(settings.surface).toBe('local');
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

describe('prs settings (F1)', () => {
  it('defaults autoOpenTabs to true and toggles via a patch', () => {
    const base = SettingsSchema.parse({});
    expect(base.prs).toEqual({ autoOpenTabs: true });
    expect(SettingsPatchSchema.parse({})).not.toHaveProperty('prs');
    const off = mergeSettings(base, { prs: { autoOpenTabs: false } });
    expect(off.prs).toEqual({ autoOpenTabs: false });
    expect(off.notifications).toEqual(base.notifications);
    const on = mergeSettings(off, { prs: { autoOpenTabs: true } });
    expect(on.prs).toEqual({ autoOpenTabs: true });
    expect(mergeSettings(off, { notifications: { enabled: false } }).prs).toEqual({ autoOpenTabs: false });
    expect(SettingsPatchSchema.safeParse({ prs: { autoOpenTabs: 'yes' } }).success).toBe(false);
    // A pre-F1 settings file without `prs` parses to the default.
    expect(parseSettingsFile({ tenantUrl: 'https://x.example' }).settings.prs).toEqual({ autoOpenTabs: true });
  });
});

describe('terminal dock settings (F5)', () => {
  it('defaults layout/terminal and merges shallowly', () => {
    const base = SettingsSchema.parse({});
    expect(base.layout).toEqual({ terminalOpen: false, terminalHeight: 280 });
    expect(base.terminal).toEqual({ allSurfaces: false });

    const merged = mergeSettings(base, {
      layout: { terminalOpen: true },
      terminal: { allSurfaces: true },
    });
    expect(merged.layout).toEqual({ terminalOpen: true, terminalHeight: 280 });
    expect(merged.terminal).toEqual({ allSurfaces: true });
    const resized = mergeSettings(merged, { layout: { terminalHeight: 400 } });
    expect(resized.layout).toEqual({ terminalOpen: true, terminalHeight: 400 });
  });

  it('rejects a terminal height below the minimum', () => {
    expect(SettingsPatchSchema.safeParse({ layout: { terminalHeight: 60 } }).success).toBe(false);
    const { settings, dropped } = parseSettingsFile({ layout: { terminalHeight: 60 } });
    expect(dropped).toEqual(['layout']);
    expect(settings.layout.terminalHeight).toBe(280);
  });
});
