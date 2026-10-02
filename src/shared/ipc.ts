import { z } from 'zod';
import { DEFAULT_PANE_FRACTION } from '../core/layout';
import { isAllowedAppUrl } from '../core/sessions';

export const IpcChannels = {
  stateGet: 'state:get',
  stateUpdate: 'state:update',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  paneToggle: 'pane:toggle',
  tabActivate: 'tab:activate',
  tabClose: 'tab:close',
  tabReorder: 'tab:reorder',
  tabsCloseScope: 'tabs:closeScope',
  tabsListScopes: 'tabs:listScopes',
  tabsScopeMenu: 'tabs:scopeMenu',
  navAction: 'nav:action',
  surfaceSet: 'surface:set',
  linkOpen: 'link:open',
  layoutDragStart: 'layout:dragStart',
  layoutDragMove: 'layout:dragMove',
  layoutDragEnd: 'layout:dragEnd',
  layoutDragCancel: 'layout:dragCancel',
  layoutDragGuide: 'layout:dragGuide',
  layoutDragReset: 'layout:dragReset',
  credentialsList: 'credentials:list',
  credentialsSave: 'credentials:save',
  credentialsDelete: 'credentials:delete',
  credentialsFill: 'credentials:fill',
  credentialsMenu: 'credentials:menu',
  // P5 extras
  secretsHasPat: 'secrets:hasPat',
  secretsSetPat: 'secrets:setPat',
  secretsClearPat: 'secrets:clearPat',
  prsList: 'prs:list',
  prsPopup: 'prs:popup',
  notifyTest: 'notify:test',
  localState: 'local:state',
  localUpdate: 'local:update',
  localWorkspaceAdd: 'local:workspace:add',
  localWorkspaceRemove: 'local:workspace:remove',
  localWorkspacePick: 'local:workspace:pick',
  localSessionNew: 'local:session:new',
  localSessionList: 'local:session:list',
  localSessionLoad: 'local:session:load',
  localPrompt: 'local:prompt',
  localCancel: 'local:cancel',
  localPermission: 'local:permission',
  localOpenLink: 'local:openLink',
  // P4b: embedded terminal per workspace
  terminalOpen: 'terminal:open',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalClose: 'terminal:close',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
} as const;

export const SurfaceSchema = z.enum(['cloud', 'local', 'settings']);
export type Surface = z.infer<typeof SurfaceSchema>;

const RoutingFields = { allowExternal: z.boolean() };
// F2: the pane split is a fraction of (windowWidth - rail - splitter), 0..1.
const PaneFields = { open: z.boolean(), fraction: z.number().min(0).max(1) };
// F2: window bounds remembered per display configuration (key = display geometry).
const RectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});
export const PlacementSchema = z.object({
  bounds: RectSchema,
  maximized: z.boolean(),
  savedAt: z.number().finite(),
});
const WindowPlacementsSchema = z.record(z.string(), PlacementSchema);
// P5: orgId overrides the org resolved from GET /v3/self (empty = auto).
const NotificationsFields = { enabled: z.boolean(), orgId: z.string().max(128) };
const LocalFields = { devinPath: z.string().nullable() };
// P8: session-scoped tabs. keepAliveHours=0 discards hidden-scope tabs on switch;
// maxLiveTabs caps live webContents across all scopes (the visible active tab excluded).
const TabsFields = {
  keepAliveHours: z.number().min(0).max(168),
  maxLiveTabs: z.number().int().min(1).max(40),
};
// F3: tenant/api URLs must be https (http allowed for localhost only).
const AppUrl = z.url().refine(isAllowedAppUrl, 'must be https (http allowed for localhost only)');
const SettingsFields = {
  tenantUrl: AppUrl,
  apiBase: AppUrl,
  workspaces: z.array(z.string()),
  surface: SurfaceSchema,
  tabSnapshot: z.unknown(),
  windowPlacements: WindowPlacementsSchema,
};

export const SettingsObject = z.object({
  tenantUrl: SettingsFields.tenantUrl.default('https://cloudbeds.devinenterprise.com'),
  apiBase: SettingsFields.apiBase.default('https://api.devin.ai'),
  workspaces: SettingsFields.workspaces.default([]),
  routing: z
    .object({ allowExternal: RoutingFields.allowExternal.default(true) })
    .default({ allowExternal: true }),
  pane: z
    .object({
      open: PaneFields.open.default(true),
      fraction: PaneFields.fraction.default(DEFAULT_PANE_FRACTION),
    })
    .default({ open: true, fraction: DEFAULT_PANE_FRACTION }),
  local: z
    .object({ devinPath: LocalFields.devinPath.default(null) })
    .default({ devinPath: null }),
  surface: SettingsFields.surface.default('cloud'),
  // Tab strip snapshot (v2 shape from core/tabModel.serializeTabs).
  tabSnapshot: SettingsFields.tabSnapshot.optional(),
  windowPlacements: SettingsFields.windowPlacements.default({}),
  tabs: z
    .object({
      keepAliveHours: TabsFields.keepAliveHours.default(24),
      maxLiveTabs: TabsFields.maxLiveTabs.default(8),
    })
    .default({ keepAliveHours: 24, maxLiveTabs: 8 }),
  notifications: z
    .object({
      enabled: NotificationsFields.enabled.default(true),
      orgId: NotificationsFields.orgId.default(''),
    })
    .default({ enabled: true, orgId: '' }),
});

// Every field has a default or is optional, so parse({}) yields valid Settings.
export const SettingsSchema = SettingsObject;
export type Settings = z.infer<typeof SettingsSchema>;

// Patch schema built from default-free fields: absent keys stay absent.
export const SettingsPatchSchema = z.object({
  ...z.object(SettingsFields).partial().shape,
  routing: z.object(RoutingFields).partial().optional(),
  pane: z.object(PaneFields).partial().optional(),
  tabs: z.object(TabsFields).partial().optional(),
  notifications: z.object(NotificationsFields).partial().optional(),
  local: z.object(LocalFields).partial().optional(),
});

const TabSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  favicon: z.string().optional(),
  loading: z.boolean().optional(),
  canGoBack: z.boolean().optional(),
  canGoForward: z.boolean().optional(),
  originSessionId: z.string().optional(),
  discarded: z.boolean().optional(),
});

// P5: poller/notifier status exposed to the shell. Never contains the PAT.
export const NotificationsStateSchema = z.object({
  enabled: z.boolean(),
  hasToken: z.boolean(),
  waitingCount: z.number().int(),
  lastPollAt: z.string().nullable(),
  authError: z.boolean(),
  lastError: z.string().nullable(),
  currentSessionPrCount: z.number().int(),
});
export type NotificationsState = z.infer<typeof NotificationsStateSchema>;

export const ShellStateSchema = z.object({
  paneOpen: z.boolean(),
  paneFraction: z.number(),
  paneCollapsed: z.boolean(),
  surface: SurfaceSchema,
  currentSessionId: z.string().nullable(),
  settings: SettingsSchema,
  tabs: z.object({
    tabs: z.array(TabSchema), // visible scope only
    activeId: z.string().nullable(),
    scope: z.string(),
    hiddenTabCount: z.number().int(),
  }),
  credentialMatch: z
    .object({ origin: z.string(), username: z.string() })
    .nullable(),
  credentials: z.array(z.object({ origin: z.string(), username: z.string() })),
  notifications: NotificationsStateSchema,
});
export type ShellState = z.infer<typeof ShellStateSchema>;

export const CredentialSaveSchema = z.object({
  origin: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
export const CredentialDeleteSchema = z.object({ origin: z.string().min(1) });
export const CredentialFillSchema = z.object({
  field: z.enum(['username', 'password']),
  pressEnter: z.boolean().default(false),
});

export const TabsCloseScopeArg = z.object({ scope: z.string() });
export const TabsScopeMenuArg = z.object({ x: z.number(), y: z.number() });
export interface ScopeSummary {
  scope: string;
  count: number;
  liveCount: number;
  lastSeen: number;
}

// P4b terminal channels.
export const TerminalOpenArg = z.object({ workspace: z.string().min(1) });
export const TerminalInputArg = z.object({ id: z.string().min(1), data: z.string().max(65536) });
export const TerminalResizeArg = z.object({
  id: z.string().min(1),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(200),
});
export const TerminalCloseArg = z.object({ id: z.string().min(1) });

export const SessionPrSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  url: z.string(),
});
export type SessionPr = z.infer<typeof SessionPrSchema>;

// Arg schemas for ipcMain.on channels (safeParse; invalid payloads ignored).
export const TabIdArg = z.string();
export const TabReorderArgs = z.tuple([z.string(), z.number().int()]);
export const NavActionArg = z.enum(['back', 'forward', 'reload']);
export const SurfaceArg = SurfaceSchema;
export const LinkOpenArg = z.string().max(8192);
export const DragXArg = z.number().finite();
export const DragCancelReasonArg = z.enum(['escape', 'pointer-cancel']);
// P5: secrets:setPat payload. The value itself is never logged or echoed back.
export const SetPatArg = z.object({ pat: z.string().min(10).max(4096) });

// ---- Devin Local (ACP) ----

const LocalBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thought'), text: z.string() }),
  z.object({ type: z.literal('tool_call'), id: z.string() }),
]);

const LocalMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  blocks: z.array(LocalBlockSchema),
  messageId: z.string().optional(),
});

const LocalToolCallSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  content: z.array(z.unknown()).optional(),
  locations: z.array(z.object({ path: z.string(), line: z.number().nullable().optional() })).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});

const LocalPlanEntrySchema = z.object({
  content: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'in_progress', 'completed']),
});

const LocalPermissionSchema = z.object({
  requestId: z.string(),
  toolCallId: z.string(),
  title: z.string(),
  options: z.array(z.object({ optionId: z.string(), name: z.string(), kind: z.string() })),
});

export const LocalStopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
  'error',
]);

const LocalSessionSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  title: z.string(),
  createdAt: z.string(),
  messages: z.array(LocalMessageSchema),
  plan: z.array(LocalPlanEntrySchema).optional(),
  toolCalls: z.record(z.string(), LocalToolCallSchema),
  pendingPermission: LocalPermissionSchema.optional(),
  running: z.boolean(),
  lastStopReason: LocalStopReasonSchema.optional(),
  error: z.string().optional(),
  historySource: z.enum(['agent', 'local-index']),
  loaded: z.boolean(),
});

const LocalAgentSchema = z.object({
  workspace: z.string(),
  status: z.enum(['missing-cli', 'starting', 'ready', 'crashed', 'stopped']),
  protocolVersion: z.number().optional(),
  capabilities: z.object({ loadSession: z.boolean(), sessionList: z.boolean() }).optional(),
  agentName: z.string().optional(),
  error: z.string().optional(),
  restarts: z.number(),
  retryInMs: z.number().optional(),
});

export const LocalStateSchema = z.object({
  cliPath: z.string().nullable(),
  installGuidance: z.string(),
  agents: z.record(z.string(), LocalAgentSchema),
  sessions: z.record(z.string(), LocalSessionSchema),
});
export type LocalStatePublic = z.infer<typeof LocalStateSchema>;

const WorkspacePath = z.string().min(1).max(4096);
const SessionId = z.string().min(1).max(512);

export const LocalWorkspaceArg = z.object({ path: WorkspacePath });
export const LocalSessionNewArg = z.object({ workspace: WorkspacePath });
export const LocalSessionListArg = z.object({ workspace: WorkspacePath });
export const LocalSessionLoadArg = z.object({ workspace: WorkspacePath, sessionId: SessionId });
export const LocalPromptArg = z.object({ sessionId: SessionId, text: z.string().min(1).max(200_000) });
export const LocalCancelArg = z.object({ sessionId: SessionId });
export const LocalPermissionArg = z.object({
  sessionId: SessionId,
  requestId: z.string().min(1).max(128),
  optionId: z.string().min(1).max(256),
});
export const LocalOpenLinkArg = z.object({ url: LinkOpenArg });

export const LocalSessionSummarySchema = z.object({
  id: z.string(),
  workspace: z.string(),
  title: z.string(),
  createdAt: z.string(),
  historySource: z.enum(['agent', 'local-index']),
});
export type LocalSessionSummary = z.infer<typeof LocalSessionSummarySchema>;

// invoke results share one envelope so the renderer can show errors inline.
export type LocalResult<T> = { ok: true; value: T } | { ok: false; error: string };
