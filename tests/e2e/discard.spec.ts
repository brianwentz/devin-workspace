// O6 state-safe discard: inactive tabs idle past the threshold lose their webContents but
// keep id/title/favicon/order and reload on activation; a page that prevents unload is kept
// (silently — no dialog); the active tab is never discarded; the threshold is a setting
// (DEVIN_WORKSPACES_TEST_KEEPALIVE_MS overrides settings.tabs.keepAliveHours in test mode so this suite can use 1.5 s).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

const DISCARD_MS = 1500;

async function tab(app: ElectronApplication, id: string) {
  return (await state(app)).tabs.tabs.find((candidate) => candidate.id === id);
}

async function quit(app: ElectronApplication, profile: string): Promise<void> {
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
  await app.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

test('discards idle inactive tabs, keeps chrome state, reloads on activation, honours beforeunload', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-discard-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
    DEVIN_WORKSPACES_TEST_KEEPALIVE_MS: String(DISCARD_MS),
  });
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    expect(await app.evaluate(() => (globalThis as any).__devinworkspaces.getKeepAliveMs())).toBe(DISCARD_MS);

    const a = await openTab(app, `${fixtures.githubUrl}/page/discard-a`);
    await waitForTabTitle(app, 'discard-a');
    const b = await openTab(app, `${fixtures.githubUrl}/page/discard-b`);
    await waitForTabTitle(app, 'discard-b');
    expect((await state(app)).tabs.activeId).toBe(b);
    expect(await webContentsCount(app)).toBe(4);
    const aBefore = (await tab(app, a))!;
    expect(aBefore.favicon).toBeTruthy();

    // A idles past the threshold -> discarded by the sweep; B (active) is untouched.
    await expect.poll(async () => (await tab(app, a))?.discarded, { timeout: 20_000 }).toBe(true);
    await waitForEvent(logFile, 'tab-discard');
    await expect.poll(() => webContentsCount(app)).toBe(3);
    const aAfter = (await tab(app, a))!;
    expect(aAfter.title).toBe(aBefore.title);
    expect(aAfter.favicon).toBe(aBefore.favicon);
    expect(aAfter.url).toBe(aBefore.url);
    expect(aAfter.loading).toBe(false);
    expect((await state(app)).tabs.tabs.map((t) => t.id)).toEqual([a, b]);
    expect((await state(app)).tabs.activeId).toBe(b);
    // Shell shows it dimmed but still in place.
    expect(await evaluateInShell(app, `document.querySelector('[data-tab-id="${a}"]').classList.contains('discarded')`)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, DISCARD_MS * 2));
    expect((await tab(app, b))?.discarded).toBeUndefined();
    expect(await webContentsCount(app)).toBe(3);

    // Activation recreates the view and reloads the page.
    await app.evaluate((_e, id: string) => (globalThis as any).__devinworkspaces.activate(id), a);
    await waitForEvent(logFile, 'tab-restore');
    await expect.poll(async () => (await tab(app, a))?.discarded).toBeUndefined();
    await expect.poll(() => webContentsCount(app)).toBe(4);
    await expect.poll(async () => (await tab(app, a))?.loading).toBe(false);
    expect((await tab(app, a))?.title).toBe('GitHub fixture: discard-a');
    expect(await evaluateInShell(app, `document.querySelector('[data-tab-id="${a}"]').classList.contains('discarded')`)).toBe(false);

    // Now B idles and gets discarded in turn; closing a discarded tab is a plain model close.
    await expect.poll(async () => (await tab(app, b))?.discarded, { timeout: 20_000 }).toBe(true);
    expect(await app.evaluate((_e, id: string) => (globalThis as any).__devinworkspaces.close(id), b)).toBe(true);
    await expect.poll(async () => (await state(app)).tabs.tabs.map((t) => t.id)).toEqual([a]);

    // A page that prevents unload cancels its discard silently (no dialog, no prompt event).
    const guarded = await openTab(app, `${fixtures.githubUrl}/beforeunload`);
    await waitForTabTitle(app, 'Before unload');
    const d = await openTab(app, `${fixtures.githubUrl}/page/discard-d`);
    await waitForTabTitle(app, 'discard-d');
    expect((await state(app)).tabs.activeId).toBe(d);
    await waitForEvent(logFile, 'tab-discard-cancelled');
    await new Promise((resolve) => setTimeout(resolve, DISCARD_MS));
    expect((await tab(app, guarded))?.discarded).toBeUndefined();
    expect(
      await app.evaluate((_e, id: string) => Boolean((globalThis as any).__devinworkspaces.getTabWebContents(id)), guarded),
    ).toBe(true);
    const events = await readEvents(logFile);
    expect(events.some((entry) => entry.event === 'beforeunload-prompt')).toBe(false);
    expect(
      events.some(
        (entry) => entry.event === 'will-prevent-unload' && (entry.detail as any)?.discard === true,
      ),
    ).toBe(true);
    // Discarded A was meanwhile kept as a tab with its title.
    expect((await tab(app, a))?.title).toBe('GitHub fixture: discard-a');

    // Disabling via the hook stops the sweep: a fresh idle tab stays alive.
    await app.evaluate(() => (globalThis as any).__devinworkspaces.setKeepAliveMs(0));
    const e = await openTab(app, `${fixtures.githubUrl}/page/discard-e`);
    await waitForTabTitle(app, 'discard-e');
    await app.evaluate((_e, id: string) => (globalThis as any).__devinworkspaces.activate(id), d);
    await new Promise((resolve) => setTimeout(resolve, DISCARD_MS * 2));
    expect((await tab(app, e))?.discarded).toBeUndefined();
    expect(await app.evaluate(() => (globalThis as any).__devinworkspaces.discardIdle())).toEqual([]);
  } finally {
    await quit(app, profile);
  }
});

test('keep-alive threshold is a persisted setting (hours) applied live', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-discard-'));
  const logFile = join(profile, 'events.jsonl');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect.poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces))).toBe(true);
    expect((await state(app)).settings.tabs.keepAliveHours).toBe(24);
    expect(await app.evaluate(() => (globalThis as any).__devinworkspaces.getKeepAliveMs())).toBe(24 * 3_600_000);

    await evaluateInShell(app, `window.devinworkspaces.setSettings({ tabs: { keepAliveHours: 0 } })`);
    await expect.poll(async () => (await state(app)).settings.tabs.keepAliveHours).toBe(0);
    expect(await app.evaluate(() => (globalThis as any).__devinworkspaces.getKeepAliveMs())).toBe(0);

    await evaluateInShell(app, `window.devinworkspaces.setSettings({ tabs: { keepAliveHours: 48 } })`);
    await expect.poll(async () => (await state(app)).settings.tabs.keepAliveHours).toBe(48);
    expect(await app.evaluate(() => (globalThis as any).__devinworkspaces.getKeepAliveMs())).toBe(48 * 3_600_000);
    await waitForEvent(logFile, 'keepalive-threshold');
    expect(
      JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).tabs.keepAliveHours,
    ).toBe(48);

    // Out-of-range patches are rejected by the schema and leave the value untouched.
    await evaluateInShell(app, `window.devinworkspaces.setSettings({ tabs: { keepAliveHours: -5 } })`);
    await evaluateInShell(app, `window.devinworkspaces.setSettings({ tabs: { keepAliveHours: 200 } })`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await state(app)).settings.tabs.keepAliveHours).toBe(48);
  } finally {
    await quit(app, profile);
  }
});
