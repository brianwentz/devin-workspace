import { z } from 'zod';
import { DEFAULT_PANE_FRACTION, DEFAULT_TERMINAL_HEIGHT, MIN_TERMINAL_HEIGHT } from '../core/layout';
import { isAllowedAppUrl } from '../core/sessions';

export const IpcChannels = {
  stateGet: 'state:get',
  stateUpdate: 'state:update',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsCommit: 'settings:commit',
  settingsFlush: 'settings:flush',
  settingsFlushDone: 'settings:flushDone',
  paneToggle: 'pane:toggle',
  tabActivate: 'tab:activate',
  tabClose: 'tab:close',
  tabReorder: 'tab:reorder',
  tabsCloseScope: 'tabs:closeScope',
  tabsListScopes: 'tabs:listScopes',
  tabsReloadMenu: 'tabs:reloadMenu',
  tabsTabMenu: 'tabs:tabMenu',
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
  credentialsUpdate: 'credentials:update',
  credentialsDelete: 'credentials:delete',
  credentialsReveal: 'credentials:reveal',
  // Autofill: hosted views ask for accounts/fills; the shell drives the picker.
  autofillQuery: 'autofill:query',
  autofillPicker: 'autofill:picker',
  autofillFill: 'autofill:fill',
  autofillPick: 'autofill:pick',
  autofillPickerClose: 'autofill:pickerClose',
  autofillSubmitted: 'autofill:submitted',
  autofillPromptResolve: 'autofill:promptResolve',
  // P5 extras
  secretsHasPat: 'secrets:hasPat',
  secretsSetPat: 'secrets:setPat',
  secretsClearPat: 'secrets:clearPat',
  prsList: 'prs:list',
  prsMarkRead: 'prs:markRead',
  prsMarkAllRead: 'prs:markAllRead',
  prsRemove: 'prs:remove',
  prsClear: 'prs:clear',
  prsOpen: 'prs:open',
  prsPanel: 'prs:panel',
  // P6 notification center
  notificationsList: 'notifications:list',
  notificationsMarkRead: 'notifications:markRead',
  notificationsMarkAllRead: 'notifications:markAllRead',
  notificationsRemove: 'notifications:remove',
  notificationsClear: 'notifications:clear',
  notificationsOpen: 'notifications:open',
  notificationsPanel: 'notifications:panel',
  notificationBanner: 'notifications:banner',
  // Service-user identity resolution
  notificationsIdentity: 'notifications:identity',
  notificationsIdentityReset: 'notifications:identityReset',
  // App version / auto-update status
  updateInstall: 'update:install',
  updateReleaseNotes: 'update:releaseNotes',
  localState: 'local:state',
  localUpdate: 'local:update',
  localWorkspaceAdd: 'local:workspace:add',
  localWorkspaceRemove: 'local:workspace:remove',
  localWorkspacePick: 'local:workspace:pick',
  localSessionNew: 'local:session:new',
  localSessionList: 'local:session:list',
  localSessionLoad: 'local:session:load',
  localSessionDelete: 'local:session:delete',
  localSessionDeleteAll: 'local:session:deleteAll',
  localPrompt: 'local:prompt',
  localCancel: 'local:cancel',
  localPermission: 'local:permission',
  localOpenLink: 'local:openLink',
  localActiveSession: 'local:activeSession',
  // P4b: embedded terminal per workspace
  terminalOpen: 'terminal:open',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalClose: 'terminal:close',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  // F5: tabbed shell-terminal dock
  terminalList: 'terminal:list',
  terminalTitle: 'terminal:title',
  terminalToggle: 'terminal:toggle',
  terminalActivate: 'terminal:activate',
  terminalCwdOptions: 'terminal:cwdOptions',
  terminalProfiles: 'terminal:profiles',
  // Terminal copy/paste via the main-process Electron clipboard.
  clipboardReadText: 'clipboard:readText',
  clipboardWriteText: 'clipboard:writeText',
} as const;

export const SurfaceSchema = z.enum(['cloud', 'local', 'settings', 'analytics']);
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
// P6: notification center settings. `collect` gates derive+store, `banner` the
// title-bar toast; `kinds` per-kind toggles (finished off by default).
const NotificationKindFields = {
  waiting: z.boolean(),
  approval: z.boolean(),
  blocked: z.boolean(),
  finished: z.boolean(),
  prOpened: z.boolean(),
  prCompleted: z.boolean(),
  update: z.boolean(),
};
const NotificationsFields = {
  orgId: z.string().max(128),
  // Manual user-id override for service-user tokens ('' = detect automatically).
  userId: z.string().max(128),
  collect: z.boolean(),
  banner: z.boolean(),
  kinds: z.object({
    waiting: NotificationKindFields.waiting.default(true),
    approval: NotificationKindFields.approval.default(true),
    blocked: NotificationKindFields.blocked.default(true),
    finished: NotificationKindFields.finished.default(false),
    prOpened: NotificationKindFields.prOpened.default(true),
    prCompleted: NotificationKindFields.prCompleted.default(true),
    update: NotificationKindFields.update.default(true),
  }),
};
// F1: open a background tab (in the session's scope) when the poller sees a new PR.
const PrsFields = { autoOpenTabs: z.boolean() };
const LocalFields = { devinPath: z.string().nullable() };
// P8: session-scoped tabs. keepAliveHours=0 discards hidden-scope tabs on switch;
// maxLiveTabs caps live webContents across all scopes (the visible active tab excluded).
const TabsFields = {
  keepAliveHours: z.number().min(0).max(168),
  maxLiveTabs: z.number().int().min(1).max(40),
};
// F5: docked terminal layout state (persisted via syncFromState) and the
// opt-in to show it on non-Cloud surfaces.
const LayoutFields = {
  terminalOpen: z.boolean(),
  terminalHeight: z.number().min(MIN_TERMINAL_HEIGHT),
};
const TerminalFields = {
  allSurfaces: z.boolean(),
  // Optional command line override for dock shells ('' = Windows Terminal
  // default profile, else PowerShell).
  shell: z.string().max(1024),
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
      orgId: NotificationsFields.orgId.default(''),
      userId: NotificationsFields.userId.default(''),
      collect: NotificationsFields.collect.default(true),
      banner: NotificationsFields.banner.default(true),
      kinds: NotificationsFields.kinds.default({
        waiting: true, approval: true, blocked: true, finished: false,
        prOpened: true, prCompleted: true, update: true,
      }),
    })
    .default({
      orgId: '', userId: '', collect: true, banner: true,
      kinds: { waiting: true, approval: true, blocked: true, finished: false, prOpened: true, prCompleted: true, update: true },
    }),
  prs: z
    .object({ autoOpenTabs: PrsFields.autoOpenTabs.default(true) })
    .default({ autoOpenTabs: true }),
  layout: z
    .object({
      terminalOpen: LayoutFields.terminalOpen.default(false),
      terminalHeight: LayoutFields.terminalHeight.default(DEFAULT_TERMINAL_HEIGHT),
    })
    .default({ terminalOpen: false, terminalHeight: DEFAULT_TERMINAL_HEIGHT }),
  terminal: z
    .object({
      allSurfaces: TerminalFields.allSurfaces.default(false),
      shell: TerminalFields.shell.default(''),
    })
    .default({ allSurfaces: false, shell: '' }),
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
  notifications: z
    .object({ ...NotificationsFields, kinds: z.object(NotificationKindFields).partial() })
    .partial()
    .optional(),
  prs: z.object(PrsFields).partial().optional(),
  local: z.object(LocalFields).partial().optional(),
  layout: z.object(LayoutFields).partial().optional(),
  terminal: z.object(TerminalFields).partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

// settings:commit — field keys are DraftField names from core/settingsDraft.
export const SettingsCommitResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), settings: SettingsSchema }),
  z.object({
    ok: z.literal(false),
    errors: z.record(z.string(), z.string()),
    message: z.string().nullable(),
  }),
]);
export type SettingsCommitResult = z.infer<typeof SettingsCommitResultSchema>;
export const SettingsFlushDoneArg = z.object({ pending: z.boolean(), ok: z.boolean() });

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

export const IdentitySourceSchema = z.enum(['self', 'cli', 'inferred', 'manual']);
export type IdentitySource = z.infer<typeof IdentitySourceSchema>;

// P5: poller/notifier status exposed to the shell. Never contains the PAT.
export const NotificationsStateSchema = z.object({
  collect: z.boolean(),
  banner: z.boolean(),
  hasToken: z.boolean(),
  lastPollAt: z.string().nullable(),
  authError: z.boolean(),
  lastError: z.string().nullable(),
  noUserIdentity: z.boolean(),
  identity: z.object({ source: IdentitySourceSchema.nullable(), resolved: z.boolean() }),
  openPrCount: z.number().int(),
  unreadPrCount: z.number().int(),
  prsPanelOpen: z.boolean(),
  unreadCount: z.number().int(),
  panelOpen: z.boolean(),
});
// notifications:identity — the user id itself never leaves main; the shell
// only gets the source and a masked tail (user-…705c6).
export const IdentityInfoSchema = z.object({
  source: IdentitySourceSchema.nullable(),
  maskedUserId: z.string().nullable(),
  cliOrgMismatch: z.boolean(),
});
export type IdentityInfo = z.infer<typeof IdentityInfoSchema>;
export const NotificationIdArg = z.object({ id: z.string() });
export const NotificationPanelArg = z.object({ open: z.boolean() });

export type NotificationsState = z.infer<typeof NotificationsStateSchema>;

export const UpdateStateSchema = z.object({
  version: z.string(),
  available: z.string().nullable(),
  downloaded: z.string().nullable(),
  releasesUrl: z.string(),
});
export type UpdateState = z.infer<typeof UpdateStateSchema>;

// update:releaseNotes — lazy GitHub release-notes lookup for the Updates tab.
export const ReleaseNotesSchema = z.object({
  version: z.string(),
  name: z.string().nullable(),
  publishedAt: z.string().nullable(),
  body: z.string(),
  htmlUrl: z.string(),
});
export type ReleaseNotes = z.infer<typeof ReleaseNotesSchema>;
export const ReleaseNotesReplySchema = z.object({
  current: ReleaseNotesSchema.nullable(),
  available: ReleaseNotesSchema.nullable(),
});
export type ReleaseNotesReply = z.infer<typeof ReleaseNotesReplySchema>;

export const TerminalSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(['devin', 'shell']),
  // The local session a devin-kind pty belongs to (null for shell-kind).
  sessionId: z.string().nullable().default(null),
  cwd: z.string(),
  title: z.string(),
  exitCode: z.number().int().nullable(),
  // Windows Terminal profile name when one launched this pty.
  profile: z.string().nullable().default(null),
});
export type TerminalSummary = z.infer<typeof TerminalSummarySchema>;

export const CredentialEntrySchema = z.object({
  id: z.string().min(1),
  origin: z.string(),
  username: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  lastUsedAt: z.number().finite().nullable(),
});
export type ShellCredentialEntry = z.infer<typeof CredentialEntrySchema>;

export const AutofillQuerySchema = z.object({
  hasPassword: z.boolean(),
  hint: z.string().max(256).nullable(),
});
export const AutofillPickerSchema = z.object({
  rect: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  }),
  field: z.enum(['username', 'password']),
});
export const AutofillPickSchema = z.object({ id: z.string().min(1) });
export const AutofillFillSchema = z.object({
  id: z.string().min(1),
  username: z.string(),
  password: z.string(),
});
export const AutofillSubmittedSchema = z.object({
  username: z.string().max(256).nullable(),
  password: z.string().min(1).max(1024),
});
export const AutofillPromptResolveSchema = z.object({
  action: z.enum(['save', 'dismiss']),
});

export const ShellStateSchema = z.object({
  paneOpen: z.boolean(),
  paneFraction: z.number(),
  paneCollapsed: z.boolean(),
  surface: SurfaceSchema,
  currentSessionId: z.string().nullable(),
  localSessionId: z.string().nullable(),
  settings: SettingsSchema,
  tabs: z.object({
    tabs: z.array(TabSchema), // visible scope only
    activeId: z.string().nullable(),
    scope: z.string(),
    hiddenTabCount: z.number().int(),
  }),
  credentials: z.array(CredentialEntrySchema),
  autofill: z.object({
    picker: z
      .object({
        accounts: z.array(z.object({ id: z.string(), username: z.string() })),
        anchor: RectSchema,
      })
      .nullable(),
    prompt: z
      .object({
        kind: z.enum(['save', 'update']),
        origin: z.string(),
        username: z.string(),
        anchor: RectSchema,
      })
      .nullable(),
  }),
  notifications: NotificationsStateSchema,
  update: UpdateStateSchema,
  // F5 terminal dock
  terminalOpen: z.boolean(),
  terminalHeight: z.number(),
  terminals: z.array(TerminalSummarySchema),
  activeTerminalId: z.string().nullable(),
});
export type ShellState = z.infer<typeof ShellStateSchema>;

export const CredentialSaveSchema = z.object({
  origin: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
export const CredentialUpdateSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
});
export const CredentialDeleteSchema = z.object({ id: z.string().min(1) });
export const CredentialRevealSchema = z.object({ id: z.string().min(1) });

export const TabsCloseScopeArg = z.object({ scope: z.string() });
export const TabsReloadMenuArg = z.object({ x: z.number(), y: z.number() });
export const TabsTabMenuArg = z.object({ id: z.string(), x: z.number(), y: z.number() });
export interface ScopeSummary {
  scope: string;
  count: number;
  liveCount: number;
  lastSeen: number;
}

// P4b terminal channels.
export const TerminalOpenArg = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('devin'),
    workspace: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('shell'),
    cwd: z.string().min(1).max(4096).optional(),
    profile: z.string().max(128).optional(),
  }),
]);
export type TerminalOpenArgType = z.infer<typeof TerminalOpenArg>;
export const TerminalTitleArg = z.object({ id: z.string().min(1), title: z.string().max(256) });
export const TerminalActivateArg = z.object({ id: z.string().min(1) });
export const TerminalInputArg = z.object({ id: z.string().min(1), data: z.string().max(65536) });
export const TerminalResizeArg = z.object({
  id: z.string().min(1),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(200),
});
export const TerminalCloseArg = z.object({ id: z.string().min(1) });
export const ClipboardWriteArg = z.object({ text: z.string().max(65536) });

export const SessionPrSchema = z.object({
  sessionId: z.string(),
  sessionTitle: z.string(),
  ref: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  state: z.string().nullable(),
  readAt: z.number().nullable(),
});
export type SessionPr = z.infer<typeof SessionPrSchema>;

export const PrUrlArg = z.object({ url: z.string().url() });
export const PrOpenArg = z.object({ sessionId: z.string().min(1), url: z.string().url() });
export const PrPanelArg = z.object({ open: z.boolean() });

// Arg schemas for ipcMain.on channels (safeParse; invalid payloads ignored).
export const TabIdArg = z.string();
export const TabReorderArgs = z.tuple([z.string(), z.number().int()]);
export const NavActionArg = z.enum(['back', 'forward', 'reload']);
export const SurfaceArg = SurfaceSchema;
export const LinkOpenArg = z.string().max(8192);
export const DragPosArg = z.number().finite();
export const DragStartArg = z.object({
  axis: z.enum(['x', 'y']),
  pos: z.number().finite(),
});
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
  capabilities: z
    .object({ loadSession: z.boolean(), sessionList: z.boolean(), sessionDelete: z.boolean() })
    .optional(),
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
export const LocalSessionDeleteArg = z.object({ sessionId: SessionId });
export const LocalSessionDeleteAllArg = z.object({ workspace: WorkspacePath });
export const LocalPromptArg = z.object({ sessionId: SessionId, text: z.string().min(1).max(200_000) });
export const LocalCancelArg = z.object({ sessionId: SessionId });
export const LocalPermissionArg = z.object({
  sessionId: SessionId,
  requestId: z.string().min(1).max(128),
  optionId: z.string().min(1).max(256),
});
export const LocalOpenLinkArg = z.object({ url: LinkOpenArg });
export const LocalActiveSessionArg = z.object({ sessionId: SessionId.nullable() });

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
