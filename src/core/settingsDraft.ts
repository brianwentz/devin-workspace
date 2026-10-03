import { isAllowedAppUrl } from './sessions';
import type { Settings, SettingsPatch } from '../shared/ipc';

export interface SettingsDraft {
  tenantUrl: string;
  apiBase: string;
  workspaces: string[];
  allowExternal: boolean;
  keepAliveHours: string;
  maxLiveTabs: string;
  terminalAllSurfaces: boolean;
  terminalShell: string;
  userId: string;
  orgId: string;
}

export type DraftField = keyof SettingsDraft;

export type SettingsTabId = 'general' | 'passwords' | 'notifications' | 'updates';

export const DRAFT_TAB: Record<DraftField, SettingsTabId> = {
  tenantUrl: 'general',
  apiBase: 'general',
  workspaces: 'general',
  allowExternal: 'general',
  keepAliveHours: 'general',
  maxLiveTabs: 'general',
  terminalAllSurfaces: 'general',
  terminalShell: 'general',
  userId: 'notifications',
  orgId: 'notifications',
};

const FIELD_ORDER = Object.keys(DRAFT_TAB) as DraftField[];

export type DraftErrors = Partial<Record<DraftField, string>>;

export function draftFromSettings(settings: Settings): SettingsDraft {
  return {
    tenantUrl: settings.tenantUrl,
    apiBase: settings.apiBase,
    workspaces: [...settings.workspaces],
    allowExternal: settings.routing.allowExternal,
    keepAliveHours: String(settings.tabs.keepAliveHours),
    maxLiveTabs: String(settings.tabs.maxLiveTabs),
    terminalAllSurfaces: settings.terminal.allSurfaces,
    terminalShell: settings.terminal.shell,
    userId: settings.notifications.userId,
    orgId: settings.notifications.orgId,
  };
}

export function isDraftDirty(draft: SettingsDraft, settings: Settings): boolean {
  const base = draftFromSettings(settings);
  return (
    draft.tenantUrl.trim() !== base.tenantUrl ||
    draft.apiBase.trim() !== base.apiBase ||
    draft.workspaces.length !== base.workspaces.length ||
    draft.workspaces.some((workspace, index) => workspace !== base.workspaces[index]) ||
    draft.allowExternal !== base.allowExternal ||
    Number(draft.keepAliveHours) !== Number(base.keepAliveHours) ||
    Number(draft.maxLiveTabs) !== Number(base.maxLiveTabs) ||
    draft.terminalAllSurfaces !== base.terminalAllSurfaces ||
    draft.terminalShell.trim() !== base.terminalShell ||
    draft.userId.trim() !== base.userId ||
    draft.orgId.trim() !== base.orgId
  );
}

export function validateDraft(
  draft: SettingsDraft,
): { ok: true; patch: SettingsPatch } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const tenantUrl = draft.tenantUrl.trim();
  const apiBase = draft.apiBase.trim();
  if (!isAllowedAppUrl(tenantUrl)) {
    errors.tenantUrl = 'Tenant URL must be an https URL (http allowed for localhost only)';
  }
  if (!isAllowedAppUrl(apiBase)) {
    errors.apiBase = 'API base must be an https URL (http allowed for localhost only)';
  }
  const keepAlive = Number(draft.keepAliveHours);
  if (!Number.isFinite(keepAlive) || keepAlive < 0 || keepAlive > 168) {
    errors.keepAliveHours = 'Keep-alive must be between 0 and 168 hours';
  }
  const maxLive = Number(draft.maxLiveTabs);
  if (!Number.isInteger(maxLive) || maxLive < 1 || maxLive > 40) {
    errors.maxLiveTabs = 'Max live tabs must be a whole number between 1 and 40';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    patch: {
      tenantUrl,
      apiBase,
      workspaces: draft.workspaces,
      routing: { allowExternal: draft.allowExternal },
      tabs: { keepAliveHours: keepAlive, maxLiveTabs: maxLive },
      terminal: { allSurfaces: draft.terminalAllSurfaces, shell: draft.terminalShell.trim() },
      notifications: { userId: draft.userId.trim(), orgId: draft.orgId.trim() },
    },
  };
}

const PATH_TO_FIELD: Record<string, DraftField> = {
  tenantUrl: 'tenantUrl',
  apiBase: 'apiBase',
  workspaces: 'workspaces',
  'routing.allowExternal': 'allowExternal',
  'tabs.keepAliveHours': 'keepAliveHours',
  'tabs.maxLiveTabs': 'maxLiveTabs',
  'terminal.allSurfaces': 'terminalAllSurfaces',
  'terminal.shell': 'terminalShell',
  'notifications.userId': 'userId',
  'notifications.orgId': 'orgId',
};

export function fieldErrorsFromIssues(
  issues: { path: readonly PropertyKey[]; message: string }[],
): { errors: DraftErrors; other: string[] } {
  const errors: DraftErrors = {};
  const other: string[] = [];
  for (const issue of issues) {
    const field = PATH_TO_FIELD[issue.path.join('.')];
    if (field) {
      errors[field] ??= issue.message;
    } else {
      other.push(issue.message);
    }
  }
  return { errors, other };
}

export function firstErrorField(errors: DraftErrors): DraftField | null {
  return FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}
