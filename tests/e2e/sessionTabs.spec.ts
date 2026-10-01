// P8: GitHub tabs are session-scoped. Switching Cloud sessions swaps the visible
// strip; hidden tabs stay live inside keepAliveHours, then discard (state-safe)
// and restore on activation. maxLiveTabs caps live webContents across scopes.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import {
  evaluateInShell,
  evaluateInView,
  launchApp,
  readEvents,
  state,
  waitForEvent,
  waitForTabCount,
  waitForTabTitle,
  webContentsCount,
} from './helpers';

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
});

test.afterAll(async () => {
  await fixtures.close();
});

async function routeLink(app: ElectronApplication, url: string): Promise<void> {
  await app.evaluate((_e, target: string) => {
    (globalThis as typeof globalThis & { __devinworkspaces: { routeLink(url: string): void } })
      .__devinworkspaces.routeLink(target);
  }, url);
}

async function openSession(app: ElectronApplication, name: string): Promise<void> {
  await app.evaluate((_e, url: string) => {
    (globalThis as typeof globalThis & { __devinworkspaces: { loadDevinUrl(url: string): void } })
      .__devinworkspaces.loadDevinUrl(url);
  }, `${fixtures.devinUrl}/sessions/${name}`);
  await expect.poll(async () => (await state(app)).currentSessionId).toBe(name);
  await expect.poll(async () => (await state(app)).tabs.scope).toBe(name);
}

async function scopes(
  app: ElectronApplication,
): Promise<Array<{ scope: string; count: number; liveCount: number; lastSeen: number }>> {
  return app.evaluate(() => (globalThis as any).__devinworkspaces.listScopes());
}

async function quit(app: ElectronApplication, profile: string): Promise<void> {
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

test('tabs follow the visible session; hidden tabs stay live and keep scroll/form state', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-scopes-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);

    // Session A: two tabs.
    await openSession(app, 'A');
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-1`);
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-2`);
    await waitForTabCount(app, 2);
    await waitForTabTitle(app, 'session-a-2');
    const aState = await state(app);
    const aIds = aState.tabs.tabs.map((t) => t.id);
    expect(aState.tabs.scope).toBe('A');
    expect(aState.tabs.hiddenTabCount).toBe(0);
    expect(aState.tabs.activeId).toBe(aIds[1]);

    // Type into the active tab's page; the webContents id + input must survive a switch.
    const activeUrl = `${fixtures.githubUrl}/page/session-a-2`;
    const wcId = await app.evaluate(
      ({ webContents }, url: string) =>
        webContents.getAllWebContents().find((c) => c.getURL() === url)?.id ?? null,
      activeUrl,
    );
    expect(wcId).toBeTruthy();
    await evaluateInView(app, activeUrl, `document.getElementById('note').value='draft-comment'`);

    // Session B: one tab; A's two hide.
    await openSession(app, 'B');
    await expect.poll(async () => (await state(app)).tabs.hiddenTabCount).toBe(2);
    await routeLink(app, `${fixtures.githubUrl}/page/session-b-1`);
    await waitForTabCount(app, 1);
    const bState = await state(app);
    expect(bState.tabs.scope).toBe('B');
    expect(bState.tabs.hiddenTabCount).toBe(2);

    // listScopes reports both.
    const scopeList = await scopes(app);
    expect(scopeList.find((s) => s.scope === 'A')).toMatchObject({ count: 2, liveCount: 2 });
    expect(scopeList.find((s) => s.scope === 'B')).toMatchObject({ count: 1, liveCount: 1 });

    // Back to A: same ids, order, active — no reload (same webContents, no new load events).
    const loadsBefore = (await readEvents(logFile)).filter(
      (e) => e.event === 'did-start-loading' && (e.detail as any)?.id === aIds[1],
    ).length;
    await openSession(app, 'A');
    await waitForTabCount(app, 2);
    const back = await state(app);
    expect(back.tabs.tabs.map((t) => t.id)).toEqual(aIds);
    expect(back.tabs.activeId).toBe(aIds[1]);
    expect(back.tabs.hiddenTabCount).toBe(1);
    const wcAfter = await app.evaluate(
      ({ webContents }, url: string) =>
        webContents.getAllWebContents().find((c) => c.getURL() === url)?.id ?? null,
      activeUrl,
    );
    expect(wcAfter).toBe(wcId);
    const loadsAfter = (await readEvents(logFile)).filter(
      (e) => e.event === 'did-start-loading' && (e.detail as any)?.id === aIds[1],
    ).length;
    expect(loadsAfter).toBe(loadsBefore);
    expect(
      await evaluateInView(app, activeUrl, `document.getElementById('note').value`),
    ).toBe('draft-comment');

    // Fresh session C: empty strip shows the hint and the "other sessions" overflow.
    await openSession(app, 'C');
    await waitForTabCount(app, 0);
    await expect
      .poll(async () =>
        evaluateInShell(
          app,
          `document.querySelector('[data-testid="tabStripEmpty"]')?.textContent ?? null`,
        ),
      )
      .toBe('No GitHub tabs for this session — links from the worklog open here.');
    expect(
      await evaluateInShell(
        app,
        `document.getElementById('scopeOverflow')?.textContent ?? null`,
      ),
    ).toBe('⋯ 3 in other sessions');
  } finally {
    await quit(app, profile);
  }
});

test('keepAliveHours=0 discards hidden-scope tabs on switch and restores on return', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-scopes0-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
    DEVIN_WORKSPACES_TEST_KEEPALIVE_MS: '0',
  });
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    await openSession(app, 'A');
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-1`);
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-2`);
    await waitForTabCount(app, 2);
    await waitForTabTitle(app, 'session-a-2');

    await openSession(app, 'B');
    // Both A tabs discard; B's scope is empty.
    await expect.poll(async () => (await state(app)).tabs.tabs.length).toBe(0);
    await expect.poll(async () => {
      const list = await scopes(app);
      return list.find((s) => s.scope === 'A')?.liveCount ?? -1;
    }).toBe(0);
    expect(
      (await readEvents(logFile)).filter((e) => e.event === 'tab-discard').length,
    ).toBeGreaterThanOrEqual(2);

    // Returning restores the scope's active tab (tab-restore) and the other on click.
    await openSession(app, 'A');
    await waitForEvent(logFile, 'tab-restore');
    await waitForTabCount(app, 2);
    const s = await state(app);
    const restoredId = s.tabs.activeId!;
    expect(s.tabs.tabs.find((t) => t.id === restoredId)?.discarded).toBeUndefined();
    const other = s.tabs.tabs.find((t) => t.id !== restoredId)!;
    expect(other.discarded).toBe(true);
    await app.evaluate((_e, id: string) => (globalThis as any).__devinworkspaces.activate(id), other.id);
    await expect.poll(async () => (await state(app)).tabs.tabs.find((t) => t.id === other.id)?.discarded).toBeUndefined();
  } finally {
    await quit(app, profile);
  }
});

test('maxLiveTabs caps live webContents LRU and skips a beforeunload-protected tab', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-cap-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    await evaluateInShell(app, `window.devinworkspaces.setSettings({ tabs: { maxLiveTabs: 2 } })`);
    await expect.poll(async () => (await state(app)).settings.tabs.maxLiveTabs).toBe(2);

    // Oldest tab is protected (unsaved-draft); it must survive the cap.
    await openSession(app, 'A');
    await routeLink(app, `${fixtures.githubUrl}/beforeunload`);
    await waitForTabTitle(app, 'Before unload');
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-1`);
    await waitForTabTitle(app, 'session-a-1');

    await openSession(app, 'B');
    await routeLink(app, `${fixtures.githubUrl}/page/session-b-1`);
    await waitForTabTitle(app, 'session-b-1');
    await routeLink(app, `${fixtures.githubUrl}/page/session-b-2`);
    await waitForTabTitle(app, 'session-b-2');

    // Live = active (session-b-2) + cap(2): protected guarded tab + most-recent non-active.
    await expect.poll(async () => {
      const list = await scopes(app);
      return list.reduce((sum, s) => sum + s.liveCount, 0);
    }).toBe(3);
    const list = await scopes(app);
    const a = list.find((s) => s.scope === 'A')!;
    expect(a.liveCount).toBe(1); // the protected tab; session-a-1 discarded
    expect(
      (await readEvents(logFile)).some((e) => e.event === 'tab-discard-cancelled'),
    ).toBe(true);
  } finally {
    await quit(app, profile);
  }
});

test('closeScope keeps a beforeunload-protected tab live and visible', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-closescope-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    await openSession(app, 'A');
    await routeLink(app, `${fixtures.githubUrl}/beforeunload`);
    await waitForTabTitle(app, 'Before unload');
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-1`);
    await waitForTabTitle(app, 'session-a-1');
    await waitForTabCount(app, 2);
    const guardedId = (await state(app)).tabs.tabs.find((t) =>
      t.url.endsWith('/beforeunload'),
    )!.id;
    // User answers "Stay" on the beforeunload prompt.
    await app.evaluate(
      () => (globalThis as any).__devinworkspaces.setBeforeUnloadDecision('stay'),
    );

    // Close the whole scope — the guarded tab refuses, the other closes.
    await evaluateInShell(app, `window.devinworkspaces.closeScope('A')`);
    await expect.poll(async () => (await state(app)).tabs.tabs.map((t) => t.id)).toEqual([guardedId]);
    const aScope = (await scopes(app)).find((s) => s.scope === 'A');
    expect(aScope).toMatchObject({ count: 1, liveCount: 1 });
    // No orphan: the surviving entry still owns a live webContents.
    expect(
      await app.evaluate((_e, id: string) =>
        Boolean((globalThis as any).__devinworkspaces.getTabWebContents(id)), guardedId),
    ).toBe(true);
    await waitForEvent(logFile, 'tabs-scope-closed');
  } finally {
    await quit(app, profile);
  }
});

test('restart persists scopes/active; a v1 snapshot + discardIdleMinutes migrates', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-persist-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  let ids: string[] = [];
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    await openSession(app, 'A');
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-1`);
    await routeLink(app, `${fixtures.githubUrl}/page/session-a-2`);
    await waitForTabCount(app, 2);
    ids = (await state(app)).tabs.tabs.map((t) => t.id);
    await app.evaluate((_e, id: string) => (globalThis as any).__devinworkspaces.activate(id), ids[0]!);
    await openSession(app, 'B');
    await routeLink(app, `${fixtures.githubUrl}/page/session-b-1`);
    await waitForTabCount(app, 1);
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await app.close().catch(() => undefined);
  } catch {
    await quit(app, profile);
    throw new Error('first run failed');
  }

  const saved = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'));
  expect(saved.tabSnapshot.version).toBe(2);
  expect(saved.tabSnapshot.activeByScope.A).toBe(ids[0]);

  // Relaunch: both scopes restore; nothing live until its session is opened.
  const app2 = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect.poll(async () => app2.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    expect((await state(app2)).tabs.hiddenTabCount).toBe(3);
    await openSession(app2, 'A');
    const s = await state(app2);
    expect(s.tabs.tabs.map((t) => t.id)).toEqual(ids);
    expect(s.tabs.activeId).toBe(ids[0]);
  } finally {
    await quit(app2, profile);
  }
});

test('v1 tab snapshot migrates into scopes', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-v1-'));
  const logFile = join(profile, 'events.jsonl');
  writeFileSync(
    join(profile, 'settings.json'),
    JSON.stringify({
      tenantUrl: fixtures.devinUrl,
      discardIdleMinutes: 90,
      tabs: {
        tabs: [
          { id: 'old-1', url: `${fixtures.githubUrl}/page/legacy-1`, title: 'legacy-1', originSessionId: 'A' },
          { id: 'old-2', url: `${fixtures.githubUrl}/page/legacy-2`, title: 'legacy-2', originSessionId: 'A' },
        ],
        activeId: 'old-1',
      },
    }),
  );
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    // discardIdleMinutes 90 -> keepAliveHours 2; v1 snapshot moved to tabSnapshot.
    expect((await state(app)).settings.tabs.keepAliveHours).toBe(2);
    expect((await state(app)).tabs.hiddenTabCount).toBe(2);
    await openSession(app, 'A');
    const s = await state(app);
    expect(s.tabs.tabs.map((t) => t.id)).toEqual(['old-1', 'old-2']);
    expect(s.tabs.activeId).toBe('old-1');
  } finally {
    await quit(app, profile);
  }
});
