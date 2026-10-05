import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import { closeApp, launchApp, pageFor, shellPage, state, waitForEventCount } from './helpers';

type Rect = { x: number; y: number; width: number; height: number };
interface G {
  __devinworkspaces: {
    getAnalyticsBounds(): Rect | null;
    getDevinBounds(): Rect | null;
    childViews(): Array<{ bounds: Rect; url: string | null }>;
    layoutRects(): { devin: Rect };
  };
}
const hooks = (app: import('playwright').ElectronApplication) => ({
  getAnalyticsBounds: () =>
    app.evaluate(() => (globalThis as unknown as G).__devinworkspaces.getAnalyticsBounds()),
  getDevinBounds: () =>
    app.evaluate(() => (globalThis as unknown as G).__devinworkspaces.getDevinBounds()),
  childViews: () =>
    app.evaluate(() => (globalThis as unknown as G).__devinworkspaces.childViews()),
  layoutRects: () =>
    app.evaluate(() => (globalThis as unknown as G).__devinworkspaces.layoutRects()),
});

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
});

test.afterAll(async () => {
  await fixtures.close();
});

test('analytics rail button swaps the main column to the tenant analytics view', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    const shell = await shellPage(app);
    const h = hooks(app);

    await shell.locator('#analyticsButton').click();
    await expect.poll(async () => (await state(app)).surface).toBe('analytics');
    await expect(shell.locator('#analyticsButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(shell.locator('#cloudButton')).toHaveAttribute('aria-pressed', 'false');

    // The analytics view fills the devin column; the devin view is parked at 0.
    await expect
      .poll(async () => (await h.getAnalyticsBounds())?.width ?? 0)
      .toBeGreaterThan(0);
    const analyticsBounds = await h.getAnalyticsBounds();
    const devinRect = (await h.layoutRects()).devin;
    expect(analyticsBounds?.width).toBe(devinRect.width);
    expect(analyticsBounds?.x).toBe(devinRect.x);
    expect((await h.getDevinBounds())?.width ?? -1).toBe(0);

    await expect
      .poll(async () =>
        (await h.childViews()).some((view) => view.url?.endsWith('/settings/my-analytics')),
      )
      .toBe(true);

    // First entry loads the page once — no refresh fires for the creation load.
    const firstPage = await pageFor(app, `${fixtures.devinUrl}/settings/my-analytics`);
    await expect(firstPage.locator('#analyticsLoadCount')).toHaveText('1');

    // Switching back restores the devin view and parks analytics (it stays loaded).
    await shell.locator('#cloudButton').click();
    await expect.poll(async () => (await state(app)).surface).toBe('cloud');
    await expect.poll(async () => (await h.getDevinBounds())?.width ?? 0).toBe(devinRect.width);
    expect((await h.getAnalyticsBounds())?.width ?? -1).toBe(0);
    await expect
      .poll(async () =>
        (await h.childViews()).some((view) => view.url?.endsWith('/settings/my-analytics')),
      )
      .toBe(false);

    // Re-entering the surface reloads the analytics view in place.
    await shell.locator('#analyticsButton').click();
    await expect.poll(async () => (await state(app)).surface).toBe('analytics');
    const page = await pageFor(app, `${fixtures.devinUrl}/settings/my-analytics`);
    await expect(page.locator('#analyticsLoadCount')).toHaveText('2');
    await waitForEventCount(logFile, 'analytics-refresh', 1);
    await shell.waitForTimeout(500);
    const refreshCount = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.includes('"analytics-refresh"')).length;
    expect(refreshCount).toBe(1);
  } finally {
    await closeApp(app);
    rmSync(profile, { recursive: true, force: true });
  }
});
