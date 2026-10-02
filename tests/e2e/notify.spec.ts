import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import {
  evaluateInShell,
  launchApp,
  openTab,
  readEvents,
  state,
  waitForEvent,
  waitForTabCount,
  webContentsCount,
} from './helpers';

const PAT = 'test-token-123';
const POLL_MS = 500;

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
});

test.afterAll(async () => {
  await fixtures.close();
});

type PrLink = { sessionId: string; title: string; url: string };

function hooks(app: ElectronApplication) {
  return {
    setPat: (pat: string) =>
      app.evaluate((_e, value: string) => (globalThis as any).__devinworkspaces.setPat(value) as Promise<boolean>, pat),
    clearPat: () => app.evaluate(() => (globalThis as any).__devinworkspaces.clearPat() as Promise<void>),
    hasPat: () => app.evaluate(() => (globalThis as any).__devinworkspaces.hasPat() as boolean),
    pollNow: () => app.evaluate(() => (globalThis as any).__devinworkspaces.pollNow() as Promise<void>),
    listPrs: () =>
      app.evaluate(() => (globalThis as any).__devinworkspaces.listPrs() as PrLink[]),
    clickNotification: (id: string) =>
      app.evaluate((_e, value: string) => (globalThis as any).__devinworkspaces.clickNotification(value), id),
    newSession: () => app.evaluate(() => (globalThis as any).__devinworkspaces.newSession()),
    testNotification: () => app.evaluate(() => (globalThis as any).__devinworkspaces.testNotification()),
    loadDevinUrl: (url: string) =>
      app.evaluate((_e, value: string) => (globalThis as any).__devinworkspaces.loadDevinUrl(value), url),
    closeTab: (id: string) =>
      app.evaluate((_e, value: string) => (globalThis as any).__devinworkspaces.close(value) as Promise<boolean>, id),
    listScopes: () =>
      app.evaluate(
        () =>
          (globalThis as any).__devinworkspaces.listScopes() as Array<{
            scope: string;
            count: number;
            liveCount: number;
          }>,
      ),
    tabInfo: (id: string) =>
      app.evaluate(
        (_e, value: string) =>
          (globalThis as any).__devinworkspaces.tabInfo(value) as {
            url: string;
            originSessionId: string | null;
            discarded: boolean;
            loading: boolean;
            hasView: boolean;
          } | null,
        id,
      ),
    devinUrl: () =>
      app.evaluate(({ webContents }, prefix: string) =>
        webContents.getAllWebContents().find((c) => c.getURL().startsWith(prefix))?.getURL(), fixtures.devinUrl),
  };
}

async function launch(profile: string, logFile: string) {
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
    DEVIN_WORKSPACES_API_BASE: fixtures.apiUrl,
    DEVIN_WORKSPACES_POLL_MS: String(POLL_MS),
  });
  await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
  return app;
}

async function quit(app: ElectronApplication, profile: string) {
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
}

test.beforeEach(() => {
  fixtures.api.setMode({ kind: 'ok' });
  fixtures.api.setSessions([]);
  fixtures.api.clearRequests();
});

test('stores the PAT encrypted, polls with it, toasts on waiting_for_user and badges', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-notify-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launch(profile, logFile);
  const h = hooks(app);
  try {
    // No token yet: no API traffic, state reflects it.
    expect((await state(app)).notifications.hasToken).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 2));
    expect(fixtures.api.requests().length).toBe(0);

    fixtures.api.setSessions([
      { session_id: 'sess-1', title: 'Fix login bug', status: 'running', status_detail: 'working', updated_at: 10 },
      { session_id: 'sess-2', title: 'Old one', status: 'exit', status_detail: 'finished', updated_at: 5 },
    ]);
    expect(await h.setPat(PAT)).toBe(true);
    expect((await state(app)).notifications.hasToken).toBe(true);

    // The fixture saw the bearer token on /v3/self and the org sessions list.
    await expect
      .poll(() => fixtures.api.requests().some((r) => r.path.startsWith('/v3/organizations/org-fixture/sessions')))
      .toBe(true);
    const requests = fixtures.api.requests();
    expect(requests.every((r) => r.authorization === `Bearer ${PAT}`)).toBe(true);
    expect(requests[0]?.path).toBe('/v3/self');
    expect(requests.find((r) => r.path.includes('/sessions'))?.path).toContain('first=100');
    await expect.poll(async () => (await state(app)).notifications.lastPollAt).not.toBeNull();
    expect((await state(app)).notifications.waitingCount).toBe(0);

    // Status flips to waiting_for_user -> count + notification-shown within 2s.
    fixtures.api.setSessions([
      { session_id: 'sess-1', title: 'Fix login bug', status: 'running', status_detail: 'waiting_for_user', updated_at: 11 },
      { session_id: 'sess-2', title: 'Old one', status: 'exit', status_detail: 'finished', updated_at: 5 },
    ]);
    const flippedAt = Date.now();
    await expect
      .poll(async () => (await state(app)).notifications.waitingCount, { timeout: 2000, intervals: [50, 100] })
      .toBe(1);
    const detectedAfterMs = Date.now() - flippedAt;
    expect(detectedAfterMs).toBeLessThan(2000);
    await waitForEvent(logFile, 'notification-shown');
    const shown = (await readEvents(logFile)).filter((e) => e.event === 'notification-shown');
    expect(shown).toHaveLength(1);
    expect((shown[0]?.detail as any).sessionId).toBe('sess-1');
    expect((shown[0]?.detail as any).status).toBe('waiting_for_user');
    const badges = (await readEvents(logFile)).filter((e) => e.event === 'badge');
    expect((badges.at(-1)?.detail as any).count).toBe(1);

    // Same waiting state on later polls does not re-notify.
    await h.pollNow();
    await h.pollNow();
    expect((await readEvents(logFile)).filter((e) => e.event === 'notification-shown')).toHaveLength(1);

    // Clicking the toast navigates devinView to the tenant session and shows Cloud.
    await evaluateInShell(app, `window.devinworkspaces.setSurface('settings')`);
    await expect.poll(async () => (await state(app)).surface).toBe('settings');
    await h.clickNotification('sess-1');
    await expect.poll(async () => (await state(app)).surface).toBe('cloud');
    await expect.poll(() => h.devinUrl()).toBe(`${fixtures.devinUrl}/sessions/sess-1`);
    await expect.poll(async () => (await state(app)).currentSessionId).toBe('sess-1');

    // Session resumes working -> badge cleared.
    fixtures.api.setSessions([
      { session_id: 'sess-1', title: 'Fix login bug', status: 'running', status_detail: 'working', updated_at: 12 },
    ]);
    await expect.poll(async () => (await state(app)).notifications.waitingCount).toBe(0);
    const badgesAfter = (await readEvents(logFile)).filter((e) => e.event === 'badge');
    expect((badgesAfter.at(-1)?.detail as any).count).toBe(0);

    // Secrets at rest: encrypted blob only, no plaintext anywhere on disk or in the log.
    const secretsFile = join(profile, 'secrets.json');
    expect(existsSync(secretsFile)).toBe(true);
    const secrets = JSON.parse(readFileSync(secretsFile, 'utf8')) as { version: number; devinPat?: string };
    expect(secrets.version).toBe(1);
    expect(typeof secrets.devinPat).toBe('string');
    expect(secrets.devinPat).not.toContain(PAT);
    expect(Buffer.from(secrets.devinPat ?? '', 'base64').toString('utf8')).not.toContain(PAT);
    expect(readFileSync(secretsFile, 'utf8')).not.toContain(PAT);
    expect(readFileSync(logFile, 'utf8')).not.toContain(PAT);
    expect(readFileSync(join(profile, 'settings.json'), 'utf8')).not.toContain(PAT);
    // ...and the renderer-visible state never carries it.
    expect(JSON.stringify(await state(app))).not.toContain(PAT);
    const shellDump = (await evaluateInShell(
      app,
      `JSON.stringify(Object.keys(window.devinworkspaces)) + document.documentElement.outerHTML`,
    )) as string;
    expect(shellDump).not.toContain(PAT);

    // Clear removes the file and stops polling.
    await h.clearPat();
    expect(await h.hasPat()).toBe(false);
    expect(existsSync(secretsFile)).toBe(false);
    fixtures.api.clearRequests();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 3));
    expect(fixtures.api.requests().length).toBe(0);
  } finally {
    await quit(app, profile);
  }
});

test('surfaces 401 as authError and honours 429 Retry-After', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-notify-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launch(profile, logFile);
  const h = hooks(app);
  try {
    fixtures.api.setSessions([{ session_id: 'sess-1', status: 'running', status_detail: 'working', updated_at: 1 }]);
    await h.setPat(PAT);
    await expect.poll(async () => (await state(app)).notifications.lastPollAt).not.toBeNull();
    expect((await state(app)).notifications.authError).toBe(false);

    // 401 -> authError true; recovery when the API accepts the token again.
    fixtures.api.setMode({ kind: 'status', status: 401 });
    await expect.poll(async () => (await state(app)).notifications.authError).toBe(true);
    expect((await state(app)).notifications.lastError).toBe('unauthorized');
    const authEvents = (await readEvents(logFile)).filter(
      (e) => e.event === 'poll-error' && (e.detail as any).kind === 'auth',
    );
    expect(authEvents.length).toBeGreaterThan(0);
    fixtures.api.setMode({ kind: 'ok' });
    await h.pollNow();
    await expect.poll(async () => (await state(app)).notifications.authError).toBe(false);

    // 429 with Retry-After: 2 -> the next request is not before 2s later.
    fixtures.api.clearRequests();
    fixtures.api.setMode({ kind: 'status', status: 429, retryAfter: '2', once: true });
    await expect.poll(() => fixtures.api.requests().length).toBeGreaterThanOrEqual(1);
    const limitedAt = fixtures.api.requests()[0]!.ts;
    await expect.poll(() => fixtures.api.requests().length, { timeout: 6000 }).toBeGreaterThanOrEqual(2);
    const nextAt = fixtures.api.requests()[1]!.ts;
    expect(nextAt - limitedAt).toBeGreaterThanOrEqual(1900);
    const rateEvents = (await readEvents(logFile)).filter(
      (e) => e.event === 'poll-error' && (e.detail as any).kind === 'rateLimited',
    );
    expect((rateEvents[0]?.detail as any).retryAfterMs).toBe(2000);
    expect(readFileSync(logFile, 'utf8')).not.toContain(PAT);
  } finally {
    await quit(app, profile);
  }
});

test('lists the current session PRs for quick-open and Ctrl+N goes to the new-session surface', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-notify-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launch(profile, logFile);
  const h = hooks(app);
  try {
    const prs = [
      { pr_url: `${fixtures.githubUrl}/acme/widgets/pull/42`, pr_state: 'open' },
      { pr_url: `${fixtures.githubUrl}/acme/widgets/pull/43`, pr_state: null },
    ];
    fixtures.api.setSessions([
      { session_id: 'sess-pr', title: 'PR session', status: 'running', status_detail: 'working', updated_at: 3, pull_requests: prs },
      { session_id: 'sess-none', title: 'No PRs', status: 'running', status_detail: 'working', updated_at: 2 },
    ]);
    await h.setPat(PAT);
    await expect.poll(async () => (await state(app)).notifications.lastPollAt).not.toBeNull();

    // No current session -> nothing to open; Rail button hidden.
    expect(await h.listPrs()).toEqual([]);
    expect(await evaluateInShell(app, `Boolean(document.getElementById('prQuickOpen'))`)).toBe(false);

    await h.loadDevinUrl(`${fixtures.devinUrl}/sessions/sess-pr`);
    await expect.poll(async () => (await state(app)).currentSessionId).toBe('sess-pr');
    await expect.poll(async () => (await state(app)).notifications.currentSessionPrCount).toBe(2);
    expect(await h.listPrs()).toEqual([
      { sessionId: 'sess-pr', title: 'acme/widgets#42 (open)', url: prs[0]!.pr_url },
      { sessionId: 'sess-pr', title: 'acme/widgets#43', url: prs[1]!.pr_url },
    ]);
    await expect
      .poll(async () => evaluateInShell(app, `Boolean(document.getElementById('prQuickOpen'))`))
      .toBe(true);
    // The IPC path returns the same list the menu is built from.
    const viaIpc = (await evaluateInShell(app, `window.devinworkspaces.listPrs()`)) as unknown[];
    expect(viaIpc).toHaveLength(2);

    await h.loadDevinUrl(`${fixtures.devinUrl}/sessions/sess-none`);
    await expect.poll(async () => (await state(app)).currentSessionId).toBe('sess-none');
    await expect.poll(async () => (await state(app)).notifications.currentSessionPrCount).toBe(0);
    expect(await h.listPrs()).toEqual([]);

    // Ctrl+N: back to the tenant's create surface (root) on the Cloud surface.
    await evaluateInShell(app, `window.devinworkspaces.setSurface('settings')`);
    await expect.poll(async () => (await state(app)).surface).toBe('settings');
    await h.newSession();
    await expect.poll(async () => (await state(app)).surface).toBe('cloud');
    await expect.poll(() => h.devinUrl()).toBe(`${fixtures.devinUrl}/`);
    await waitForEvent(logFile, 'new-session');

    // Test notification logs a shown event (toast suppressed under test mode).
    await h.testNotification();
    const shown = (await readEvents(logFile)).filter(
      (e) => e.event === 'notification-shown' && (e.detail as any).status === 'test',
    );
    expect(shown).toHaveLength(1);
    expect((shown[0]?.detail as any).toast).toBe(false);
  } finally {
    await quit(app, profile);
  }
});

test('auto-opens a lazy background tab in the session scope when a session gains a PR (F1)', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-notify-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launch(profile, logFile);
  const h = hooks(app);
  const events = async (name: string) => (await readEvents(logFile)).filter((e) => e.event === name);
  // pollNow() is a no-op while a scheduled poll is in flight, so wait until one
  // more successful `poll` event has been logged (whichever poll produced it).
  const pollOnce = async () => {
    const before = (await events('poll')).length;
    await h.pollNow();
    await expect.poll(async () => (await events('poll')).length).toBeGreaterThan(before);
  };
  const existingPr = `${fixtures.githubUrl}/acme/widgets/pull/1`;
  const newPr = `${fixtures.githubUrl}/acme/widgets/pull/2`;
  const laterPr = `${fixtures.githubUrl}/acme/widgets/pull/3`;
  const session = (prs: string[]) => ({
    session_id: 'sess-pr',
    title: 'PR session',
    status: 'running',
    status_detail: 'working',
    updated_at: 3,
    pull_requests: prs.map((pr_url) => ({ pr_url, pr_state: 'open' })),
  });
  try {
    // A GLOBAL-scope tab the user already has: the visible strip must not change.
    const globalTab = await openTab(app, `${fixtures.githubUrl}/page/global`);
    await waitForTabCount(app, 1);
    expect((await state(app)).tabs.activeId).toBe(globalTab);
    const webContentsBefore = await webContentsCount(app);

    // (1) First poll with a session that already has a PR: baseline, nothing opens.
    fixtures.api.setSessions([session([existingPr])]);
    await h.setPat(PAT);
    await expect.poll(async () => (await state(app)).notifications.lastPollAt).not.toBeNull();
    await pollOnce();
    expect(await events('pr-auto-open')).toHaveLength(0);
    expect((await events('tab-open')).filter((e) => (e.detail as any).lazy)).toHaveLength(0);
    let current = await state(app);
    expect(current.tabs.tabs.map((tab) => tab.id)).toEqual([globalTab]);
    expect(current.tabs.hiddenTabCount).toBe(0);

    // (2) The session gains a PR -> one lazy tab in its scope; visible strip untouched.
    fixtures.api.setSessions([session([existingPr, newPr])]);
    await pollOnce();
    await waitForEvent(logFile, 'pr-auto-open');
    const autoOpened = await events('pr-auto-open');
    expect(autoOpened).toHaveLength(1);
    expect(autoOpened[0]?.url).toBe(newPr);
    expect((autoOpened[0]?.detail as any).sessionId).toBe('sess-pr');
    const lazyOpens = (await events('tab-open')).filter((e) => (e.detail as any).lazy === true);
    expect(lazyOpens).toHaveLength(1);
    expect(lazyOpens[0]?.url).toBe(newPr);
    expect((lazyOpens[0]?.detail as any).originSessionId).toBe('sess-pr');
    expect((lazyOpens[0]?.detail as any).background).toBe(true);
    const prTabId = (lazyOpens[0]?.detail as any).id as string;
    current = await state(app);
    expect(current.tabs.activeId).toBe(globalTab);
    expect(current.tabs.tabs.map((tab) => tab.id)).toEqual([globalTab]);
    expect(current.tabs.hiddenTabCount).toBe(1);
    // Lazy placeholder: discarded, scoped to the session, and no webContents was created.
    expect(await h.tabInfo(prTabId)).toEqual({
      url: newPr,
      originSessionId: 'sess-pr',
      discarded: true,
      loading: false,
      hasView: false,
    });
    expect(await webContentsCount(app)).toBe(webContentsBefore);
    expect(await h.listScopes()).toContainEqual(
      expect.objectContaining({ scope: 'sess-pr', count: 1, liveCount: 0 }),
    );

    // Viewing the session shows the tab in its strip (activation loads it).
    await h.loadDevinUrl(`${fixtures.devinUrl}/sessions/sess-pr`);
    await expect.poll(async () => (await state(app)).currentSessionId).toBe('sess-pr');
    await expect.poll(async () => (await state(app)).tabs.scope).toBe('sess-pr');
    await expect.poll(async () => (await state(app)).tabs.tabs.map((tab) => tab.id)).toEqual([prTabId]);
    current = await state(app);
    expect(current.tabs.tabs[0]?.url).toBe(newPr);
    expect(current.tabs.tabs[0]?.originSessionId).toBe('sess-pr');
    expect(current.tabs.activeId).toBe(prTabId);
    await expect.poll(async () => (await h.tabInfo(prTabId))?.hasView).toBe(true);

    // Same PR list on the next poll -> no duplicate, no re-open.
    await pollOnce();
    expect(await events('pr-auto-open')).toHaveLength(1);
    expect((await state(app)).tabs.tabs).toHaveLength(1);

    // (3) User closes it; later polls (same PR still listed) do not reopen it.
    expect(await h.closeTab(prTabId)).toBe(true);
    await waitForTabCount(app, 0);
    await pollOnce();
    await pollOnce();
    expect(await events('pr-auto-open')).toHaveLength(1);
    expect((await state(app)).tabs.tabs).toHaveLength(0);
    expect(await h.tabInfo(prTabId)).toBeNull();

    // (4) Toggle off via the settings IPC (restarts the poller -> fresh baseline),
    // then a new PR appears: nothing opens.
    const restartsBefore = (await events('notifier-start')).length;
    await evaluateInShell(app, `window.devinworkspaces.setSettings({ prs: { autoOpenTabs: false } })`);
    await expect.poll(async () => (await state(app)).settings.prs).toEqual({ autoOpenTabs: false });
    await expect.poll(async () => (await events('notifier-start')).length).toBeGreaterThan(restartsBefore);
    await pollOnce();
    fixtures.api.setSessions([session([existingPr, newPr, laterPr])]);
    await pollOnce();
    await pollOnce();
    expect(await events('pr-auto-open')).toHaveLength(1);
    expect((await state(app)).tabs.tabs).toHaveLength(0);
    expect((await state(app)).tabs.hiddenTabCount).toBe(1); // only the GLOBAL tab
    expect(await h.listScopes()).not.toContainEqual(expect.objectContaining({ scope: 'sess-pr' }));

    // Toggle back on: the restart baseline includes laterPr, so still nothing opens
    // until a genuinely new PR arrives.
    await evaluateInShell(app, `window.devinworkspaces.setSettings({ prs: { autoOpenTabs: true } })`);
    await expect.poll(async () => (await state(app)).settings.prs).toEqual({ autoOpenTabs: true });
    await pollOnce();
    await pollOnce();
    expect(await events('pr-auto-open')).toHaveLength(1);
    const fourthPr = `${fixtures.githubUrl}/acme/widgets/pull/4`;
    fixtures.api.setSessions([session([existingPr, newPr, laterPr, fourthPr])]);
    await pollOnce();
    await expect.poll(async () => (await events('pr-auto-open')).length).toBe(2);
    expect((await events('pr-auto-open'))[1]?.url).toBe(fourthPr);
    // The visible scope is sess-pr and had no tabs, so this one is the scope's
    // active tab: it must render (view created, not discarded) rather than show
    // an active-but-empty pane.
    const fourthOpen = (await events('tab-open')).find((e) => e.url === fourthPr);
    expect((fourthOpen?.detail as any).lazy).toBe(true);
    const fourthId = (fourthOpen?.detail as any).id as string;
    await expect.poll(async () => (await state(app)).tabs.tabs.map((tab) => tab.url)).toEqual([fourthPr]);
    current = await state(app);
    expect(current.tabs.activeId).toBe(fourthId);
    expect(current.tabs.tabs[0]?.discarded ?? false).toBe(false);
    expect(current.tabs.hiddenTabCount).toBe(1); // the GLOBAL tab
    await expect.poll(async () => (await h.tabInfo(fourthId))?.hasView).toBe(true);
    expect((await h.tabInfo(fourthId))?.discarded).toBe(false);
    expect(await webContentsCount(app)).toBe(webContentsBefore + 1);
    expect(readFileSync(logFile, 'utf8')).not.toContain(PAT);
  } finally {
    await quit(app, profile);
  }
});
