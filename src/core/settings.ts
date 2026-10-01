import {
  SettingsObject,
  SettingsPatchSchema,
  SettingsSchema,
  type Settings,
} from '../shared/ipc';

// Migrate pre-P8 payloads: `tabs` used to hold the tab snapshot (now
// `tabSnapshot`), and `discardIdleMinutes` became `tabs.keepAliveHours`
// (non-default values convert: ceil(minutes/60), clamped ≥1; the old default
// of 30 maps to the new default 24).
export function migrateSettingsRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...(raw as Record<string, unknown>) };
  const tabs = out.tabs;
  if (tabs && typeof tabs === 'object') {
    const snapshotCandidate = tabs as Record<string, unknown>;
    const looksLikeSnapshot =
      Array.isArray(snapshotCandidate.tabs) || typeof snapshotCandidate.version === 'number';
    if (looksLikeSnapshot) {
      if (out.tabSnapshot === undefined) out.tabSnapshot = tabs;
      delete out.tabs;
    } else {
      // settings.tabs object — already current shape (or invalid; repair drops it)
    }
  }
  const discardMinutes = out.discardIdleMinutes;
  if (discardMinutes !== undefined) {
    const tabsOut =
      out.tabs && typeof out.tabs === 'object'
        ? { ...(out.tabs as Record<string, unknown>) }
        : {};
    if (tabsOut.keepAliveHours === undefined) {
      const minutes = typeof discardMinutes === 'number' ? discardMinutes : NaN;
      tabsOut.keepAliveHours =
        Number.isFinite(minutes) && minutes !== 30
          ? Math.max(1, Math.min(168, Math.ceil(minutes / 60)))
          : 24;
    }
    out.tabs = tabsOut;
    delete out.discardIdleMinutes;
  }
  return out;
}

// Parse a raw settings.json payload. On whole-object failure, keep each
// individually valid field and report the dropped keys so the caller can log
// a repair event.
export function parseSettingsFile(raw: unknown): { settings: Settings; dropped: string[] } {
  const parsed = SettingsSchema.safeParse(migrateSettingsRaw(raw));
  if (parsed.success) return { settings: parsed.data, dropped: [] };
  const dropped: string[] = [];
  const kept: Record<string, unknown> = {};
  const migrated = migrateSettingsRaw(raw);
  if (migrated && typeof migrated === 'object') {
    for (const key of Object.keys(SettingsObject.shape)) {
      const field = SettingsObject.shape[key as keyof typeof SettingsObject.shape];
      const value = (migrated as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const result = field.safeParse(value);
      if (result.success) kept[key] = result.data;
      else dropped.push(key);
    }
  }
  return { settings: SettingsSchema.parse(kept), dropped };
}

// exactOptionalPropertyTypes: spreading a Partial can write explicit
// `undefined` over a required field — drop undefined entries first.
function mergeDefined<T extends object>(base: T, patch: { [K in keyof T]?: T[K] | undefined } | undefined): T {
  if (!patch) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

// Apply a SettingsPatchSchema-shaped partial to current settings. Absent keys
// are left untouched; routing/pane merge shallowly. Returns current unchanged
// when the patch is invalid.
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const parsed = SettingsPatchSchema.safeParse(patch);
  if (!parsed.success) return current;
  const { routing, pane, notifications, local, tabs, ...rest } = parsed.data;
  const topLevel = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );
  return {
    ...current,
    ...topLevel,
    routing: mergeDefined(current.routing, routing),
    pane: mergeDefined(current.pane, pane),
    tabs: mergeDefined(current.tabs, tabs),
    notifications: mergeDefined(current.notifications, notifications),
    local: mergeDefined(current.local, local),
  };
}
