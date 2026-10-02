import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import { evaluateInShell, launchApp, shellPage, state, waitForEventCount } from './helpers';

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
});

test.afterAll(async () => {
  await fixtures.close();
});

test('tracks current session id from devin view navigation', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);
    await app.evaluate((_electron, url: string) => {
      (globalThis as typeof globalThis & {
        __devinworkspaces: { loadDevinUrl(url: string): void };
      }).__devinworkspaces.loadDevinUrl(url);
    }, `${fixtures.devinUrl}/sessions/abc123`);
    await expect.poll(async () => (await state(app)).currentSessionId).toBe('abc123');
    await app.evaluate((_electron, url: string) => {
      (globalThis as typeof globalThis & {
        __devinworkspaces: { loadDevinUrl(url: string): void };
      }).__devinworkspaces.loadDevinUrl(url);
    }, `${fixtures.devinUrl}/`);
    await expect.poll(async () => (await state(app)).currentSessionId).toBe(null);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});

test('auto-collapses the pane below the minimum devin width', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);
    const tabId = await app.evaluate((_electron, url: string) => {
      return (
        globalThis as typeof globalThis & { __devinworkspaces: { open(url: string): string } }
      ).__devinworkspaces.open(url);
    }, `${fixtures.githubUrl}/page/collapse`);
    expect((await state(app)).paneCollapsed).toBe(false);

    await app.evaluate((_electron) => {
      (globalThis as typeof globalThis & {
        __devinworkspaces: { setWindowSize(w: number, h: number): void };
      }).__devinworkspaces.setWindowSize(1000, 800);
    });
    await expect.poll(async () => (await state(app)).paneCollapsed).toBe(true);
    expect((await state(app)).paneOpen).toBe(true);
    const collapsedBounds = await app.evaluate((_electron, id: string) => {
      return (
        globalThis as typeof globalThis & {
          __devinworkspaces: { getTabBounds(id: string): { width: number } | null };
        }
      ).__devinworkspaces.getTabBounds(id);
    }, tabId);
    expect(collapsedBounds?.width).toBe(0);

    await app.evaluate((_electron) => {
      (globalThis as typeof globalThis & {
        __devinworkspaces: { setWindowSize(w: number, h: number): void };
      }).__devinworkspaces.setWindowSize(1400, 900);
    });
    await expect.poll(async () => (await state(app)).paneCollapsed).toBe(false);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});

test('renders a custom title bar with the tab strip inside', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    const shell = await shellPage(app);
    await expect(shell.locator('#titleBar')).toBeVisible();
    await expect(shell.locator('#navBar')).toHaveCount(0);
    const devinBounds = await app.evaluate(() =>
      (globalThis as typeof globalThis & {
        __devinworkspaces: { getDevinBounds(): { y: number; height: number } | null };
      }).__devinworkspaces.getDevinBounds(),
    );
    expect(devinBounds?.y).toBe(36);

    const tabId = await app.evaluate((_electron, url: string) => {
      return (
        globalThis as typeof globalThis & { __devinworkspaces: { open(url: string): string } }
      ).__devinworkspaces.open(url);
    }, `${fixtures.githubUrl}/page/titlebar`);
    await expect.poll(async () => (await state(app)).tabs.activeId).toBe(tabId);
    const tabBounds = await app.evaluate((_electron, id: string) => {
      return (
        globalThis as typeof globalThis & {
          __devinworkspaces: {
            getTabBounds(id: string): { y: number; height: number } | null;
            getDevinBounds(): { y: number; height: number } | null;
          };
        }
      ).__devinworkspaces.getTabBounds(id);
    }, tabId);
    expect(tabBounds?.y).toBe(36);
    expect(tabBounds?.height).toBe(devinBounds?.height);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});

test('persists settings across relaunch', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  let app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);
    // 0.9 of the 1338 px available at 1400 px would be 1204 px — more than the
    // MIN_DEVIN_WIDTH guard allows (698 px). The layout clamps what it renders, but
    // the stored preference must stay exactly what was set, across a restart.
    await evaluateInShell(
      app,
      `window.devinworkspaces.setSettings({ pane: { fraction: 0.9 } })`,
    );
    await expect.poll(async () => (await state(app)).paneFraction).toBe(0.9);
    expect((await state(app)).paneCollapsed).toBe(false);
    expect(existsSync(join(profile, 'settings.json'))).toBe(true);

    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitForEventCount(logFile, 'window-close-complete', 1);
    await app.close();
    const persisted = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'));
    expect(persisted.pane.fraction).toBe(0.9);
    expect(persisted.pane.width).toBeUndefined();

    app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);
    expect((await state(app)).paneFraction).toBe(0.9);
    // Still unclamped after the first syncFromState of the new run.
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitForEventCount(logFile, 'window-close-complete', 2);
    await app.close();
    const afterRestart = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'));
    expect(afterRestart.pane.fraction).toBe(0.9);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});

test('migrates legacy spike-state.json into settings.json', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  writeFileSync(
    join(profile, 'spike-state.json'),
    JSON.stringify({ paneOpen: true, paneWidth: 500, surface: 'cloud', tabs: { tabs: [], activeId: null } }),
  );
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);
    const current = await state(app);
    // Legacy paneWidth 500 px → fraction 500 / (1400 - 56 - 6).
    expect(current.paneFraction).toBeCloseTo(0.374, 2);
    expect(existsSync(join(profile, 'settings.json'))).toBe(true);
    expect(existsSync(join(profile, 'spike-state.json'))).toBe(false);
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});
