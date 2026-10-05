import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import { currentDevinUrl, launchApp, shellPage, state } from './helpers';
import type { CloudListResult } from '../../src/core/cloudAcp';
import { RAIL_WIDTH, SPLITTER_WIDTH, DEFAULT_SESSIONS_WIDTH } from '../../src/core/layout';

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
});

test.afterAll(async () => {
  await fixtures.close();
});

function hooks(app: ElectronApplication) {
  const evaluate = (fn: () => unknown) => app.evaluate(fn);
  return {
    cloudState: () =>
      evaluate(
        () =>
          (globalThis as any).__devinworkspaces.cloudState(),
      ) as Promise<{
        status: string;
        sessions: Array<{ id: string; url: string; folder: string | null }>;
        folders: string[];
      }>,
    cloudRefresh: () => evaluate(() => (globalThis as any).__devinworkspaces.cloudRefresh()),
    layoutRects: () =>
      evaluate(() => (globalThis as any).__devinworkspaces.layoutRects()) as Promise<{
        devin: { x: number; width: number };
        sessions: { x: number; width: number } | null;
        paneCollapsed: boolean;
      }>,
    setSessionsOpen: (value: boolean) =>
      app.evaluate(
        (_e, v: boolean) => (globalThis as any).__devinworkspaces.setSessionsOpen(v),
        value,
      ),
    setWindowSize: (width: number, height: number) =>
      app.evaluate(
        (_e, size: { w: number; h: number }) =>
          (globalThis as any).__devinworkspaces.setWindowSize(size.w, size.h),
        { w: width, h: height },
      ),
  };
}

test('cloud session sidebar: data, sections, interactions, geometry', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  const fixturePath = join(profile, 'cloudSessions.json');
  const raw = JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/cloudSessions.json'), 'utf8'),
  ) as CloudListResult;
  for (const session of raw.sessions) {
    session.url = `${fixtures.devinUrl}/sessions/${session.id}`;
  }
  writeFileSync(fixturePath, JSON.stringify(raw));

  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
    DEVIN_WORKSPACES_TEST_CLOUD_SESSIONS: fixturePath,
    DEVIN_WORKSPACES_TEST_SESSIONS_OPEN: '1',
  });
  const h = hooks(app);
  try {
    // --- data layer: status ready, fixture loaded -------------------------
    await expect.poll(async () => (await h.cloudState()).status).toBe('ready');
    expect((await h.cloudState()).sessions).toHaveLength(8);
    expect((await h.cloudState()).folders).toEqual([
      'Alpha',
      'Beta',
      'participated',
      'pinned',
    ]);

    const page = await shellPage(app);
    await expect(page.locator('#sessionsPanel')).toBeVisible();

    // --- (1) section order: pinned, folders minus 'pinned', extras, recent --
    const names = await page
      .locator('[data-section-name]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-section-name')));
    expect(names).toEqual(['pinned', 'Alpha', 'Beta', 'participated', 'recent']);

    // --- (2) children nest under the parent; orphan is a root -------------
    const alphaRows = page.locator('[data-session-id]');
    const rowIds = await alphaRows.evaluateAll((els) =>
      els.map((el) => `${el.getAttribute('data-session-id')}:${el.getAttribute('data-depth')}`),
    );
    // Pinned section first (pinned root), then Alpha: bbbb root + its two
    // children (depth 1) directly after it, then the orphan at depth 0.
    const rootIdx = rowIds.indexOf('bbbb0000000000000000000000000002:0');
    expect(rootIdx).toBeGreaterThan(0);
    expect(rowIds[rootIdx + 1]).toBe('cccc0000000000000000000000000003:1');
    expect(rowIds[rootIdx + 2]).toBe('dddd0000000000000000000000000004:1');
    expect(rowIds).toContain('eeee0000000000000000000000000005:0');

    // Rows use the shared 12px token (same as the web sidebar's text-xs).
    await expect
      .poll(() =>
        page
          .locator('[data-session-id]')
          .first()
          .evaluate((el) => getComputedStyle(el).fontSize),
      )
      .toBe('12px');

    // --- screenshot evidence (all sections expanded, full fixture) --------
    const evidenceDir = resolve(process.cwd(), 'docs', 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, 'sessions-sidebar.png') });

    // --- (3) collapse persists via settings -------------------------------
    await page.locator('[data-section-name="Alpha"]').click();
    await expect
      .poll(
        async () =>
          ((await state(app)).settings as unknown as { sessions: { collapsedFolders: string[] } })
            .sessions.collapsedFolders,
      )
      .toContain('Alpha');
    await expect(
      page.locator('[data-session-id="bbbb0000000000000000000000000002"]'),
    ).toHaveCount(0);
    // survives a surface round-trip
    await app.evaluate(() => (globalThis as any).__devinworkspaces.setSurface('settings'));
    await expect(page.locator('#sessionsPanel')).toHaveCount(0);
    await app.evaluate(() => (globalThis as any).__devinworkspaces.setSurface('cloud'));
    await expect(page.locator('#sessionsPanel')).toBeVisible();
    await expect(
      page.locator('[data-session-id="bbbb0000000000000000000000000002"]'),
    ).toHaveCount(0);
    // expand again for the following assertions
    await page.locator('[data-section-name="Alpha"]').click();
    await expect(
      page.locator('[data-session-id="bbbb0000000000000000000000000002"]'),
    ).toBeVisible();

    // --- (4) row click navigates the devin view + marks current -----------
    const target = raw.sessions.find((s) => s.folder === null)!;
    await page.locator(`[data-session-id="${target.id}"]`).click();
    await expect.poll(() => currentDevinUrl(app, fixtures)).toBe(target.url);
    await expect.poll(async () => (await state(app)).currentSessionId).toBe(target.id);
    await expect(
      page.locator(`[data-session-id="${target.id}"]`),
    ).toHaveAttribute('data-current', 'true');

    // --- (5) sessions column toggle hides the column and shifts devin.x ---
    await h.setSessionsOpen(false);
    await expect.poll(async () => (await h.layoutRects()).sessions).toBeNull();
    expect((await h.layoutRects()).devin.x).toBe(RAIL_WIDTH);
    await h.setSessionsOpen(true);
    await expect
      .poll(async () => (await h.layoutRects()).devin.x)
      .toBe(RAIL_WIDTH + DEFAULT_SESSIONS_WIDTH + SPLITTER_WIDTH);

    // --- (6) search filters to a flat matching list -----------------------
    await page.locator('#sessionSearch').fill('Recent one');
    await expect
      .poll(async () => page.locator('[data-session-id]').count())
      .toBe(1);
    await expect(
      page.locator('[data-session-id="22220000000000000000000000000000"]'),
    ).toBeVisible();
    await page.locator('#sessionSearch').fill('');
    await expect
      .poll(async () => page.locator('[data-session-id]').count())
      .toBeGreaterThan(5);

    // --- (7) narrow window collapses the column (and the pane) ------------
    // The pane-open min width (1000) blocks shrinking to 900 — close the pane
    // first so the window can actually get that narrow.
    await app.evaluate(() => (globalThis as any).__devinworkspaces.setPaneOpen(false));
    await h.setWindowSize(900, 800);
    await expect.poll(async () => (await state(app)).sessionsCollapsed).toBe(true);
    await expect(page.locator('#sessionsPanel')).toHaveCount(0);
    await h.setWindowSize(1400, 900);
    await app.evaluate(() => (globalThis as any).__devinworkspaces.setPaneOpen(true));
    await expect.poll(async () => (await state(app)).sessionsCollapsed).toBe(false);
    await expect(page.locator('#sessionsPanel')).toBeVisible();

    // --- fixture mutation → refresh --------------------------------------
    raw.sessions = raw.sessions.slice(0, 5);
    raw.folders = ['Alpha', 'pinned'];
    writeFileSync(fixturePath, JSON.stringify(raw));
    await h.cloudRefresh();
    await expect.poll(async () => (await h.cloudState()).sessions.length).toBe(5);
    expect((await h.cloudState()).folders).toEqual(['Alpha', 'pinned']);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});
