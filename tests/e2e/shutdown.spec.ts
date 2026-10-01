// F8: quitting with an unsaved GitHub draft probes tabs for beforeunload; a
// veto shows one consolidated prompt (env-driven under test mode). Cancel keeps
// the app and the tab; Quit proceeds to the normal teardown.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import {
  launchApp,
  openTab,
  readEvents,
  state,
  waitForEvent,
  waitForTabTitle,
} from './helpers';

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
});
test.afterAll(async () => {
  await fixtures.close();
});

test('window close with an unsaved tab vetoes quit once, then exits on confirm', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-quit-'));
  const logFile = join(profile, 'events.jsonl');
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
    await expect.poll(async () => app!.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);

    const guardedId = await openTab(app, `${fixtures.githubUrl}/beforeunload`);
    await waitForTabTitle(app, 'Before unload');

    // Cancel path: user answers "stay" — app keeps running, tab survives.
    await app.evaluate(
      () => (globalThis as any).__devinworkspaces.setBeforeUnloadDecision('stay'),
    );
    await app.evaluate(() => (globalThis as any).__devinworkspaces.closeWindow());
    await waitForEvent(logFile, 'shutdown-vetoed');
    expect(
      (await readEvents(logFile)).some((e) => e.event === 'shutdown-probe'),
    ).toBe(true);
    // Still alive and the tab is intact.
    const s = await state(app);
    expect(s.tabs.tabs.some((t) => t.id === guardedId)).toBe(true);
    expect(await app.evaluate(() => 1 + 1)).toBe(2);
    // Scope invariant: the visible scope is unchanged and every visible tab
    // belongs to it (the probe must not resurrect a hidden-scope tab).
    expect(s.tabs.scope).toBe('');
    for (const tab of s.tabs.tabs) {
      expect(tab.originSessionId ?? '').toBe(s.tabs.scope);
    }

    // Quit path: same close now tears down cleanly.
    await app.evaluate(
      () => (globalThis as any).__devinworkspaces.setBeforeUnloadDecision('leave'),
    );
    const exitStatus = new Promise<'exited' | 'timeout'>((resolve) => {
      app!.process().once('exit', () => resolve('exited'));
      setTimeout(() => resolve('timeout'), 30_000);
    });
    await app.evaluate(() => (globalThis as any).__devinworkspaces.closeWindow());
    expect(await exitStatus).toBe('exited');
    await waitForEvent(logFile, 'window-close-complete');
    app = undefined;
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
      await app.close().catch(() => undefined);
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
