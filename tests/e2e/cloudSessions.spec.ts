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

type MenuItem = {
  id: string;
  label: string;
  type: string;
  enabled: boolean;
  checked?: boolean;
  submenu?: MenuItem[];
};

function findMenuItem(items: MenuItem[], label: string): MenuItem | null {
  for (const item of items) {
    if (item.label === label) return item;
    const hit = item.submenu ? findMenuItem(item.submenu, label) : null;
    if (hit) return hit;
  }
  return null;
}

test('cloud session sidebar: mutations, menus, PR badges', async () => {
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
  const evaluate = (fn: () => unknown) => app.evaluate(fn);
  const mutations = () =>
    evaluate(() => (globalThis as any).__devinworkspaces.cloudMutations()) as Promise<
      { op: string; payload: { method: string; path: string; body?: unknown } }[]
    >;
  const menuItems = () =>
    evaluate(() => (globalThis as any).__devinworkspaces.cloudMenuItems()) as Promise<
      MenuItem[]
    >;
  const menuClick = (id: string) =>
    app.evaluate((_e, itemId) => (globalThis as any).__devinworkspaces.cloudMenuClick(itemId), id);
  const clipboardRead = () =>
    evaluate(() => (globalThis as any).__devinworkspaces.clipboardRead()) as Promise<string>;

  try {
    await expect.poll(async () => (await h.cloudState()).status).toBe('ready');
    const page = await shellPage(app);
    await expect(page.locator('#sessionsPanel')).toBeVisible();

    // --- PR badge attrs ---------------------------------------------------
    await expect(
      page.locator('[data-session-id="aaaa0000000000000000000000000001"]'),
    ).toHaveAttribute('data-pr-open', '1');
    await expect(
      page.locator('[data-session-id="eeee0000000000000000000000000005"]'),
    ).toHaveAttribute('data-pr-merged', '1');

    // --- create folder via the + inline editor ----------------------------
    await page.locator('#sessionFolderNew').click();
    await page.locator('#sessionFolderEdit').fill('ZZ E2E');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-section-name="ZZ E2E"]')).toBeVisible();
    expect(
      (await mutations()).some(
        (m) =>
          m.op === 'folder-create' &&
          (m.payload.body as { folder: string }).folder === 'ZZ E2E',
      ),
    ).toBe(true);

    // --- right-click → Copy link ------------------------------------------
    const recentRow = page.locator('[data-session-id="22220000000000000000000000000000"]');
    await recentRow.click({ button: 'right' });
    const copy = findMenuItem(await menuItems(), 'Copy link');
    expect(copy).toBeTruthy();
    await menuClick(copy!.id);
    const expectedLink = `${fixtures.devinUrl}/sessions/22220000000000000000000000000000`;
    expect(
      (await mutations()).some(
        (m) =>
          m.op === 'copy-link' &&
          (m.payload as unknown as { link: string }).link === expectedLink,
      ),
    ).toBe(true);
    await expect.poll(clipboardRead).toBe(expectedLink);

    // --- archive removes the row; Show archived restores it dimmed --------
    await recentRow.click({ button: 'right' });
    const archive = findMenuItem(await menuItems(), 'Archive');
    await menuClick(archive!.id);
    await expect(recentRow).toHaveCount(0);
    await page.locator('#sessionsMenu').click();
    const showArchived = findMenuItem(await menuItems(), 'Show archived sessions');
    await menuClick(showArchived!.id);
    await expect(recentRow).toHaveAttribute('data-archived', 'true');

    // --- DnD: session onto a folder header moves it -----------------------
    const mover = page.locator('[data-session-id="33330000000000000000000000000000"]');
    await mover.dragTo(page.locator('[data-section-name="Alpha"]'));
    await expect
      .poll(async () =>
        (await mutations()).some(
          (m) =>
            m.op === 'session-move' &&
            m.payload.method === 'POST' &&
            (m.payload.body as { folder: string }).folder === 'Alpha' &&
            (m.payload.body as { devin_id: string }).devin_id ===
              'devin-33330000000000000000000000000000',
        ),
      )
      .toBe(true);

    // --- DnD: back onto Recent removes it ---------------------------------
    await mover.dragTo(page.locator('[data-section-name="recent"]'));
    await expect
      .poll(async () =>
        (await mutations()).some(
          (m) =>
            m.op === 'session-move' &&
            m.payload.method === 'DELETE' &&
            m.payload.path === 'sessions/folder/devin-33330000000000000000000000000000',
        ),
      )
      .toBe(true);

    // --- DnD: folder header onto another header reorders ------------------
    await page
      .locator('[data-section-name="Beta"]')
      .dragTo(page.locator('[data-section-name="Alpha"]'));
    await expect
      .poll(async () => {
        const reorder = (await mutations()).find((m) => m.op === 'folder-reorder');
        return (reorder?.payload.body as { folder_names: string[] } | undefined)
          ?.folder_names;
      })
      .toEqual(['Beta', 'Alpha', 'ZZ E2E']);
    // The section order reflects it in the DOM too.
    await expect
      .poll(async () =>
        page
          .locator('[data-section-name]')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-section-name'))),
      )
      .toEqual(['pinned', 'Beta', 'Alpha', 'ZZ E2E', 'participated', 'recent']);

    // --- move a foldered session out via the menu -------------------------
    // 'participated' is a system folder but a valid move target in the web.
    const foldered = page.locator('[data-session-id="bbbb0000000000000000000000000002"]');
    await foldered.click({ button: 'right' });
    const menu = await menuItems();
    const participated = findMenuItem(menu, 'participated');
    expect(participated).toBeTruthy();
    await menuClick(participated!.id);
    await expect
      .poll(async () =>
        (await mutations()).some(
          (m) =>
            m.op === 'session-move' &&
            (m.payload.body as { folder?: string } | undefined)?.folder ===
              'participated',
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        page
          .locator(
            'xpath=//*[@data-section-name="participated"]/ancestor::div[1]//*[@data-session-id="bbbb0000000000000000000000000002"]',
          )
          .count(),
      )
      .toBe(1);
    // move it back to Alpha so later steps see the fixture order
    await foldered.dragTo(page.locator('[data-section-name="Alpha"]'));

    // --- DnD onto participated header is a move target --------------------
    const betaRow = page.locator('[data-session-id="eeee0000000000000000000000000005"]');
    await betaRow.dragTo(page.locator('[data-section-name="participated"]'));
    await expect
      .poll(async () =>
        (await mutations()).filter(
          (m) =>
            m.op === 'session-move' &&
            (m.payload.body as { folder?: string } | undefined)?.folder ===
              'participated',
        ).length,
      )
      .toBe(2);

    // --- folder headers cannot be dropped/reordered onto participated -----
    await page
      .locator('[data-section-name="Alpha"]')
      .dragTo(page.locator('[data-section-name="participated"]'));
    await expect(
      page.locator('[data-section-name="participated"]'),
    ).toHaveAttribute('data-drop-before', 'false');

    // --- folder context menu: Rename… resolves to the inline-edit action --
    await page.locator('[data-section-name="Beta"]').click({ button: 'right' });
    const rename = findMenuItem(await menuItems(), 'Rename…');
    expect(rename).toBeTruthy();
    const renameResult = (await app.evaluate(
      (_e, id) => (globalThis as any).__devinworkspaces.cloudMenuClick(id),
      rename!.id,
    )) as { action: string | null };
    expect(renameResult.action).toBe('rename');
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});
