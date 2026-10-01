import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import { evaluateInShell, launchApp, readEvents, state, waitForEventCount } from './helpers';

// Mirrors LocalStateSchema in src/shared/ipc.ts (subset used by the assertions).
type LocalState = {
  cliPath: string | null;
  installGuidance: string;
  agents: Record<
    string,
    {
      status: string;
      protocolVersion?: number;
      capabilities?: { loadSession: boolean; sessionList: boolean };
      restarts: number;
      error?: string;
    }
  >;
  sessions: Record<
    string,
    {
      id: string;
      workspace: string;
      title: string;
      running: boolean;
      loaded: boolean;
      historySource: 'agent' | 'local-index';
      lastStopReason?: string;
      error?: string;
      messages: Array<{ role: 'user' | 'agent'; blocks: Array<{ type: string; text?: string; id?: string }> }>;
      toolCalls: Record<string, { id: string; title: string; status: string; kind?: string }>;
      plan?: Array<{ content: string; status: string }>;
      pendingPermission?: { requestId: string; options: Array<{ optionId: string }> };
    }
  >;
};

type Hooks = {
  localState(): LocalState;
  localAddWorkspace(path: string): string | null;
  localRemoveWorkspace(path: string): void;
  localNewSession(workspace: string): Promise<string>;
  localPrompt(sessionId: string, text: string): Promise<string>;
  localCancel(sessionId: string): Promise<void>;
  localListSessions(
    workspace: string,
  ): Promise<Array<{ id: string; title: string; historySource: string }>>;
  localLoadSession(workspace: string, sessionId: string): Promise<void>;
  localAgentPid(workspace: string): number | null;
  setSurface(value: 'cloud' | 'local' | 'settings'): void;
};

const FAKE_AGENT_CMD = 'node out/fixtures/fakeAcpAgent.cjs';

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
  expect(existsSync(join('out', 'fixtures', 'fakeAcpAgent.cjs'))).toBe(true);
});

test.afterAll(async () => {
  await fixtures.close();
});

type G = typeof globalThis & { __devinworkspaces: Hooks };

async function localState(app: ElectronApplication): Promise<LocalState> {
  return app.evaluate(() => (globalThis as G).__devinworkspaces.localState());
}

async function setSurfaceLocal(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => (globalThis as G).__devinworkspaces.setSurface('local'));
}

async function addWorkspace(app: ElectronApplication, path: string): Promise<string> {
  const added = await app.evaluate(
    (_electron, value: string) => (globalThis as G).__devinworkspaces.localAddWorkspace(value),
    path,
  );
  if (!added) throw new Error('localAddWorkspace returned null');
  return added;
}

async function agentPid(app: ElectronApplication, workspace: string): Promise<number> {
  const pid = await app.evaluate(
    (_electron, value: string) => (globalThis as G).__devinworkspaces.localAgentPid(value),
    workspace,
  );
  return pid ?? 0;
}

async function newSession(app: ElectronApplication, workspace: string): Promise<string> {
  return app.evaluate(
    (_electron, value: string) => (globalThis as G).__devinworkspaces.localNewSession(value),
    workspace,
  );
}

// Awaits the full turn and returns the stopReason.
async function promptAndWait(app: ElectronApplication, sessionId: string, text: string): Promise<string> {
  return app.evaluate(
    (_electron, args: { id: string; text: string }) =>
      (globalThis as G).__devinworkspaces.localPrompt(args.id, args.text),
    { id: sessionId, text },
  );
}

// Fire-and-forget so the test can interact (permission card, Cancel) mid-turn.
async function promptNoWait(app: ElectronApplication, sessionId: string, text: string): Promise<void> {
  await app.evaluate(
    (_electron, args: { id: string; text: string }) => {
      (globalThis as G).__devinworkspaces.localPrompt(args.id, args.text).catch(() => undefined);
    },
    { id: sessionId, text },
  );
}

async function listSessions(app: ElectronApplication, workspace: string) {
  return app.evaluate(
    (_electron, value: string) => (globalThis as G).__devinworkspaces.localListSessions(value),
    workspace,
  );
}

async function loadSession(app: ElectronApplication, workspace: string, sessionId: string): Promise<string | null> {
  return app.evaluate(
    async (_electron, args: { path: string; id: string }) => {
      try {
        await (globalThis as G).__devinworkspaces.localLoadSession(args.path, args.id);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { path: workspace, id: sessionId },
  );
}

async function waitForHooks(app: ElectronApplication): Promise<void> {
  await expect
    .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
    .toBe(true);
}

async function shellCount(app: ElectronApplication, selector: string): Promise<number> {
  return (await evaluateInShell(app, `document.querySelectorAll(${JSON.stringify(selector)}).length`)) as number;
}

async function shellClick(app: ElectronApplication, selector: string): Promise<boolean> {
  return (await evaluateInShell(
    app,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  )) as boolean;
}

// Drive the React-controlled composer the way a user would: set the value via the
// native setter so React sees the input event, then press Enter.
async function typeAndSend(app: ElectronApplication, text: string): Promise<void> {
  const ok = await evaluateInShell(
    app,
    `(() => {
      const el = document.getElementById('composer');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`,
  );
  expect(ok).toBe(true);
}

function agentText(session: LocalState['sessions'][string]): string {
  return session.messages
    .filter((message) => message.role === 'agent')
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('Local: fake agent with session/list + session/load — prompt, permission, cancel, link, history, crash restart', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-local-'));
  const workspace = mkdtempSync(join(tmpdir(), 'devin-workspaces-ws-'));
  const logFile = join(profile, 'events.jsonl');
  const linkUrl = `${fixtures.githubUrl}/page/pr-1`;
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
    DEVIN_WORKSPACES_LOCAL_AGENT_CMD: FAKE_AGENT_CMD,
    FAKE_ACP_LIST: '1',
    FAKE_ACP_LOAD: '1',
    FAKE_ACP_LINK_URL: linkUrl,
  });
  let agentPids: number[] = [];
  try {
    await waitForHooks(app);
    await setSurfaceLocal(app);
    await expect.poll(() => shellCount(app, '#localPanel')).toBe(1);
    expect((await localState(app)).cliPath).toBe('node');

    // Add a workspace → agent starts → ready with ACP v1 capabilities visible.
    const ws = await addWorkspace(app, workspace);
    expect(ws).toBeTruthy();
    await expect.poll(async () => (await localState(app)).agents[ws]?.status).toBe('ready');
    let local = await localState(app);
    expect(local.agents[ws]?.protocolVersion).toBe(1);
    expect(local.agents[ws]?.capabilities).toEqual({ loadSession: true, sessionList: true });
    expect(((await state(app)).settings as { workspaces: string[] }).workspaces).toContain(ws);
    await expect.poll(() => shellCount(app, '#agentBadge[data-status="ready"]')).toBe(1);
    await expect.poll(() => shellCount(app, `.ws-item[data-status="ready"]`)).toBe(1);
    const firstPid = await agentPid(app, ws);
    expect(firstPid).toBeGreaterThan(0);
    agentPids = [firstPid];

    // New session through the shell button.
    expect(await shellClick(app, '#sessionNew')).toBe(true);
    await expect.poll(async () => Object.keys((await localState(app)).sessions).length).toBe(1);
    local = await localState(app);
    const sessionId = Object.keys(local.sessions)[0]!;
    await expect.poll(() => shellCount(app, `.session-item[data-session-id="${sessionId}"]`)).toBe(1);

    // Prompt "hello" via the composer: chunks concatenate, tool-call card + plan render.
    await typeAndSend(app, 'hello');
    await expect.poll(async () => (await localState(app)).sessions[sessionId]?.lastStopReason).toBe('end_turn');
    local = await localState(app);
    let session = local.sessions[sessionId]!;
    expect(session.running).toBe(false);
    expect(session.title).toBe('hello');
    expect(session.messages[0]).toEqual({ role: 'user', blocks: [{ type: 'text', text: 'hello' }] });
    expect(agentText(session)).toBe(`Hello from the fake agent. See [the pull request](${linkUrl}).`);
    const agentBlocks = session.messages[1]!.blocks;
    expect(agentBlocks[0]).toEqual({ type: 'thought', text: 'The user said something. I should reply politely.' });
    expect(agentBlocks.some((block) => block.type === 'tool_call')).toBe(true);
    expect(Object.values(session.toolCalls).some((call) => call.title === 'Read README.md' && call.status === 'completed')).toBe(true);
    expect(session.plan?.map((entry) => entry.status)).toEqual(['completed', 'in_progress', 'pending']);
    await expect.poll(() => shellCount(app, '#messageList .tool-call[data-status="completed"]')).toBe(1);
    expect(await shellCount(app, '#messageList .plan .plan-entry')).toBe(3);
    expect(await shellCount(app, '#messageList .thought')).toBe(1);
    expect(await shellCount(app, '#messageList .thought-body')).toBe(0); // collapsed by default
    expect(await shellClick(app, '#messageList .thought-toggle')).toBe(true);
    await expect.poll(() => shellCount(app, '#messageList .thought-body')).toBe(1);
    expect(await shellCount(app, '.session-item .history-label')).toBe(0);

    // GitHub link in the agent message → routed to the GitHub pane.
    expect(await shellCount(app, '#messageList .md a')).toBe(1);
    expect(await shellClick(app, '#messageList .md a')).toBe(true);
    await expect.poll(async () => (await state(app)).tabs.tabs.map((tab) => tab.url)).toContain(linkUrl);
    const linkEvents = (await readEvents(logFile)).filter((entry) => entry.event === 'link-open');
    expect(linkEvents.some((entry) => entry.view === 'local' && entry.decision === 'github-tab')).toBe(true);

    // Permission flow: card appears, choosing "Allow" lets the turn finish.
    await promptNoWait(app, sessionId, 'I need permission');
    await expect
      .poll(async () =>
        (await localState(app)).sessions[sessionId]?.pendingPermission?.options.map((o) => o.optionId),
      )
      .toEqual(['allow', 'reject']);
    await expect.poll(() => shellCount(app, '#messageList .permission-card')).toBe(1);
    expect(await shellCount(app, '.permission-option:not([disabled])')).toBe(2);
    expect(await shellClick(app, '.permission-option[data-option-id="allow"]')).toBe(true);
    await expect.poll(async () => (await localState(app)).sessions[sessionId]?.lastStopReason).toBe('end_turn');
    local = await localState(app);
    session = local.sessions[sessionId]!;
    expect(session.pendingPermission).toBeUndefined();
    expect(session.toolCalls['perm-1']?.status).toBe('completed');
    expect(agentText(session)).toContain('Permission granted, tests passed.');
    expect(await shellCount(app, '#messageList .permission-card')).toBe(0);
    const permissionEvents = (await readEvents(logFile)).filter((entry) => entry.event === 'permission-resolved');
    expect(permissionEvents).toHaveLength(1);

    // Cancel: "slow" streams for 5 s; Cancel in the composer → stopReason cancelled.
    await typeAndSend(app, 'please be slow');
    await expect.poll(async () => (await localState(app)).sessions[sessionId]?.running).toBe(true);
    await expect.poll(() => shellCount(app, '#cancelButton')).toBe(1);
    expect(await shellClick(app, '#cancelButton')).toBe(true);
    await expect.poll(async () => (await localState(app)).sessions[sessionId]?.lastStopReason).toBe('cancelled');
    await expect.poll(() => shellCount(app, '#stopReason[data-stop-reason="cancelled"]')).toBe(1);
    expect(await shellCount(app, '#sendButton')).toBe(1);

    // History from the agent: session/list + session/load replay.
    const listed = await listSessions(app, ws);
    expect(listed.map((entry) => entry.id)).toContain(sessionId);
    expect(listed.every((entry) => entry.historySource === 'agent')).toBe(true);
    expect(
      (await readEvents(logFile)).some(
        (entry) => entry.event === 'session-list' && (entry.detail as any)?.source === 'agent',
      ),
    ).toBe(true);
    local = await localState(app);
    session = local.sessions[sessionId]!;
    expect(session.messages.filter((message) => message.role === 'user')).toHaveLength(3);
    expect(await loadSession(app, ws, sessionId)).toBeNull();
    local = await localState(app);
    session = local.sessions[sessionId]!;
    expect(session.loaded).toBe(true);
    expect(
      session.messages.filter((message) => message.role === 'user').map((m) => m.blocks[0]?.text),
    ).toEqual(['hello', 'I need permission', 'please be slow']);
    expect(agentText(session)).toContain('Hello from the fake agent.');
    expect((await readEvents(logFile)).some((entry) => entry.event === 'session-load')).toBe(true);

    // Crash: kill the agent process externally → crashed → next prompt restarts it.
    expect(processAlive(firstPid)).toBe(true);
    process.kill(firstPid);
    await expect.poll(async () => (await localState(app)).agents[ws]?.status).toBe('crashed');
    local = await localState(app);
    expect(local.agents[ws]?.restarts).toBe(1);
    await expect.poll(() => shellCount(app, '#agentBadge[data-status="crashed"]')).toBe(1);
    expect(await promptAndWait(app, sessionId, 'hello again')).toBe('end_turn');
    local = await localState(app);
    expect(local.agents[ws]?.status).toBe('ready');
    const secondPid = await agentPid(app, ws);
    expect(secondPid).toBeGreaterThan(0);
    expect(secondPid).not.toBe(firstPid);
    agentPids.push(secondPid);
    session = local.sessions[sessionId]!;
    expect(session.messages.at(-2)?.blocks[0]?.text).toBe('hello again');
    expect(
      (await readEvents(logFile)).some(
        (entry) => entry.event === 'session-rebound' && (entry.detail as any)?.via === 'load',
      ),
    ).toBe(true);

    // Markdown rendering must not trip the shell CSP (no inline styles/scripts).
    const consoleEvents = (await readEvents(logFile)).filter((entry) => entry.event === 'console-message');
    // (the pre-existing "frame-ancestors is ignored when delivered via <meta>" notice is not a violation)
    expect(
      consoleEvents.filter((entry) => /Refused to/i.test(String((entry.detail as any)?.message))),
    ).toEqual([]);
    // Prompt text is never logged — only lengths/ids.
    expect(
      (await readEvents(logFile)).some((entry) => JSON.stringify(entry.detail ?? {}).includes('please be slow')),
    ).toBe(false);

    // Shutdown stops the agent child.
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitForEventCount(logFile, 'window-close-complete', 1);
    await app.close();
    await expect.poll(() => agentPids.some(processAlive)).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    for (const pid of agentPids) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
    rmSync(profile, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('Local: fake agent without list/load — local-index history, load error, crash rebinds to a fresh remote session, index persists', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-local-'));
  const workspace = mkdtempSync(join(tmpdir(), 'devin-workspaces-ws-'));
  const logFile = join(profile, 'events.jsonl');
  const env = { DEVIN_WORKSPACES_LOCAL_AGENT_CMD: FAKE_AGENT_CMD };
  let app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, env);
  const agentPids: number[] = [];
  try {
    await waitForHooks(app);
    await setSurfaceLocal(app);
    const ws = await addWorkspace(app, workspace);
    await expect.poll(async () => (await localState(app)).agents[ws]?.status).toBe('ready');
    expect((await localState(app)).agents[ws]?.capabilities).toEqual({ loadSession: false, sessionList: false });
    agentPids.push(await agentPid(app, ws));

    const sessionId = await newSession(app, ws);
    expect(sessionId).toBeTruthy();
    expect((await localState(app)).sessions[sessionId]?.historySource).toBe('local-index');
    expect(await promptAndWait(app, sessionId, 'hello')).toBe('end_turn');

    // Session list falls back to the app-local index and the UI labels it.
    const listed = await listSessions(app, ws);
    expect(listed).toEqual([
      { id: sessionId, workspace: ws, title: 'hello', createdAt: expect.any(String), historySource: 'local-index' },
    ]);
    expect(
      (await readEvents(logFile)).some(
        (entry) => entry.event === 'session-list' && (entry.detail as any)?.source === 'local-index',
      ),
    ).toBe(true);
    await expect
      .poll(() => shellCount(app, `.session-item[data-session-id="${sessionId}"] .history-label`))
      .toBe(1);
    expect(
      (await evaluateInShell(app, `document.querySelector('.session-item .history-label').textContent`)) as string,
    ).toBe('history not supported by agent');

    // session/load is refused when the agent lacks loadSession.
    expect(await loadSession(app, ws, sessionId)).toBe('history not supported by agent');
    const localSessionsFile = join(profile, 'local-sessions.json');
    expect(existsSync(localSessionsFile)).toBe(true);
    expect(JSON.parse(readFileSync(localSessionsFile, 'utf8')).sessions[0]).toMatchObject({
      id: sessionId,
      workspace: ws,
      title: 'hello',
    });

    // Crash without loadSession: UI history is kept, a fresh remote session is bound.
    process.kill(agentPids[0]!);
    await expect.poll(async () => (await localState(app)).agents[ws]?.status).toBe('crashed');
    const messagesBefore = (await localState(app)).sessions[sessionId]!.messages.length;
    expect(await promptAndWait(app, sessionId, 'after crash')).toBe('end_turn');
    const after = (await localState(app)).sessions[sessionId]!;
    expect(after.messages.length).toBe(messagesBefore + 2);
    expect((await localState(app)).agents[ws]?.status).toBe('ready');
    expect(
      (await readEvents(logFile)).some(
        (entry) => entry.event === 'session-rebound' && (entry.detail as any)?.via === 'new',
      ),
    ).toBe(true);
    agentPids.push(await agentPid(app, ws));

    // Relaunch: workspace persisted in settings, index still lists the session.
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitForEventCount(logFile, 'window-close-complete', 1);
    await app.close();
    await expect.poll(() => agentPids.some(processAlive)).toBe(false);
    app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, env);
    await waitForHooks(app);
    expect(Object.keys((await localState(app)).agents)).toEqual([ws]);
    const relisted = await listSessions(app, ws);
    expect(relisted.map((entry) => [entry.id, entry.title, entry.historySource])).toEqual([
      [sessionId, 'hello', 'local-index'],
    ]);
    agentPids.push(await agentPid(app, ws));
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitForEventCount(logFile, 'window-close-complete', 2);
    await app.close();
    await expect.poll(() => agentPids.some(processAlive)).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    for (const pid of agentPids) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
    rmSync(profile, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
