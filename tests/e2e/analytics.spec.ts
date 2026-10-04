import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import { closeApp, launchApp, shellPage, state } from './helpers';

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
        (await h.childViews()).some((view) => view.url?.endsWith('/analytics')),
      )
      .toBe(true);

    // Switching back restores the devin view and parks analytics (it stays loaded).
    await shell.locator('#cloudButton').click();
    await expect.poll(async () => (await state(app)).surface).toBe('cloud');
    await expect.poll(async () => (await h.getDevinBounds())?.width ?? 0).toBe(devinRect.width);
    expect((await h.getAnalyticsBounds())?.width ?? -1).toBe(0);
    await expect
      .poll(async () =>
        (await h.childViews()).some((view) => view.url?.endsWith('/analytics')),
      )
      .toBe(false);
  } finally {
    await closeApp(app);
    rmSync(profile, { recursive: true, force: true });
  }
});
