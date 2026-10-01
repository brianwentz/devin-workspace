import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import {
  evaluateInShell,
  evaluateInView,
  launchApp,
  openTab,
  readEvents,
  state,
  waitForTabTitle,
} from './helpers';

let fixtures: FixtureServers;
const githubOrigin = () => new URL(fixtures.githubUrl).origin;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
});

test.afterAll(async () => {
  await fixtures.close();
});

async function fillCredential(
  app: ElectronApplication,
  field: 'username' | 'password',
  pressEnter: boolean,
): Promise<string> {
  return evaluateInShell(
    app,
    `window.devinworkspaces.fillCredential(${JSON.stringify({ field, pressEnter })})`,
  ) as Promise<string>;
}

test('credential vault saves, fills, denies non-saved origins, and keeps secrets out of logs', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  writeFileSync(logFile, '', 'utf8');
  let app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  let closed = false;
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);

    const saved = await app.evaluate((_electron, credential) => {
      return (
        globalThis as typeof globalThis & {
          __devinworkspaces: { saveCredential(c: typeof credential): Promise<boolean> };
        }
      ).__devinworkspaces.saveCredential(credential);
    }, { origin: githubOrigin(), username: 'alice', password: 's3cret' });
    expect(saved).toBe(true);
    await expect
      .poll(async () =>
        (await state(app)).credentials.some(
          (entry) => entry.origin === githubOrigin() && entry.username === 'alice',
        ),
      )
      .toBe(true);

    const loginId = await openTab(app, `${fixtures.githubUrl}/login`);
    await waitForTabTitle(app, 'Fixture login');
    await app.evaluate((_electron, id: string) => {
      (globalThis as typeof globalThis & { __devinworkspaces: { focus(id: string): void } })
        .__devinworkspaces.focus(id);
    }, loginId);
    await expect.poll(async () => (await state(app)).credentialMatch?.origin).toBe(githubOrigin());

    await evaluateInView(app, `${fixtures.githubUrl}/login`, `document.getElementById('user').focus()`);
    // The fill target follows OS focus; confirm it settled on the login tab
    // before filling (a late 'focus' event elsewhere would flip it mid-test).
    await expect
      .poll(async () =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & {
              __devinworkspaces: { getFillTargetUrl(): string | null };
            }).__devinworkspaces.getFillTargetUrl(),
        ),
      )
      .toBe(`${fixtures.githubUrl}/login`);
    expect(await fillCredential(app, 'username', false)).toBe('filled');
    await expect
      .poll(async () =>
        evaluateInView(app, `${fixtures.githubUrl}/login`, `document.getElementById('user').value`),
      )
      .toBe('alice');

    await evaluateInView(app, `${fixtures.githubUrl}/login`, `document.getElementById('pass').focus()`);
    await app.evaluate((_electron, id: string) => {
      (globalThis as typeof globalThis & { __devinworkspaces: { focus(id: string): void } })
        .__devinworkspaces.focus(id);
    }, loginId);
    await expect
      .poll(async () =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & {
              __devinworkspaces: { getFillTargetUrl(): string | null };
            }).__devinworkspaces.getFillTargetUrl(),
        ),
      )
      .toBe(`${fixtures.githubUrl}/login`);
    expect(await fillCredential(app, 'password', true)).toBe('filled');
    await expect
      .poll(async () => evaluateInView(app, `${fixtures.githubUrl}/login`, `document.title`))
      .toBe('submitted:alice:s3cret');

    // A tab on a non-saved origin is denied.
    await openTab(app, `${fixtures.devinUrl}/other`);
    await waitForTabTitle(app, 'Fixture Devin session');
    const devinTabId = (await state(app)).tabs.activeId;
    expect(devinTabId).toBeTruthy();
    await app.evaluate((_electron, id: string) => {
      (globalThis as typeof globalThis & { __devinworkspaces: { focus(id: string): void } })
        .__devinworkspaces.focus(id);
    }, devinTabId!);
    await expect.poll(async () => (await state(app)).credentialMatch).toBe(null);
    expect(await fillCredential(app, 'username', false)).toBe('no-match');

    // Secrets must not reach the log or the vault file.
    const events = await readEvents(logFile);
    expect(JSON.stringify(events)).not.toContain('s3cret');
    const vault = readFileSync(join(profile, 'credentials.json'), 'utf8');
    expect(vault).not.toContain('s3cret');

    // Cookie persistence across relaunch (fixture github root sets fixture_persist).
    await openTab(app, `${fixtures.githubUrl}/`);
    await waitForTabTitle(app, 'home');
    await expect
      .poll(async () =>
        app.evaluate(async ({ session }) => {
          const cookies = await session
            .fromPartition('persist:github')
            .cookies.get({ name: 'fixture_persist' });
          return cookies.length;
        }),
      )
      .toBe(1);

    // Cookie audit hook returns both partitions, metadata only.
    const audit = await app.evaluate(() =>
      (globalThis as typeof globalThis & {
        __devinworkspaces: {
          auditCookies(): Promise<Array<{ partition: string; cookies: Array<Record<string, unknown>> }>>;
        };
      }).__devinworkspaces.auditCookies(),
    );
    expect(audit.map((entry) => entry.partition).sort()).toEqual([
      'persist:devin',
      'persist:github',
    ]);
    for (const entry of audit) {
      for (const cookie of entry.cookies) {
        expect(cookie.value).toBeUndefined();
      }
    }

    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await app.close();
    closed = true;

    // Relaunch: cookie survives.
    app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
    closed = false;
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);
    const persisted = await app.evaluate(async ({ session }) =>
      session.fromPartition('persist:github').cookies.get({ name: 'fixture_persist' }),
    );
    expect(persisted).toHaveLength(1);
    expect(existsSync(join(profile, 'credentials.json'))).toBe(true);
  } finally {
    if (!closed) {
      await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
      await app.close().catch(() => undefined);
    }
    rmSync(profile, { recursive: true, force: true });
  }
});
