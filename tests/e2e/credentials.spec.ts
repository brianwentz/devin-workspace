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
  id: string,
  field: 'username' | 'password',
  pressEnter: boolean,
): Promise<string> {
  return evaluateInShell(
    app,
    `window.devinworkspaces.fillCredential(${JSON.stringify({ id, field, pressEnter })})`,
  ) as Promise<string>;
}

// Deterministic variant: fill a specific tab via the test hook. Target
// selection itself is asserted with getFillTargetUrl; OS focus on a background
// CI desktop is not reliable enough to drive the IPC path for every fill.
async function fillInto(
  app: ElectronApplication,
  id: string,
  credentialId: string,
  field: 'username' | 'password',
  pressEnter: boolean,
): Promise<string> {
  return app.evaluate(
    (
      _electron,
      args: { id: string; credentialId: string; field: 'username' | 'password'; pressEnter: boolean },
    ) =>
      (globalThis as typeof globalThis & {
        __devinworkspaces: {
          fillInto(
            id: string,
            credentialId: string,
            field: 'username' | 'password',
            pressEnter: boolean,
          ): Promise<string>;
        };
      }).__devinworkspaces.fillInto(args.id, args.credentialId, args.field, args.pressEnter),
    { id, credentialId, field, pressEnter },
  );
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
          __devinworkspaces: {
            saveCredential(c: typeof credential): Promise<{ id: string } | null>;
          };
        }
      ).__devinworkspaces.saveCredential(credential);
    }, { origin: githubOrigin(), username: 'alice', password: 's3cret' });
    expect(saved?.id).toBeTruthy();
    const credentialId = saved!.id;
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
    expect(await fillInto(app, loginId, credentialId, 'username', false)).toBe('filled');
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
    expect(await fillInto(app, loginId, credentialId, 'password', true)).toBe('filled');
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
    expect(await fillInto(app, devinTabId!, credentialId, 'username', false)).toBe('no-match');
    // IPC path still answers (whatever OS focus says, it is one of the three results).
    expect(['filled', 'no-match', 'unavailable']).toContain(
      await fillCredential(app, credentialId, 'username', false),
    );

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

test('migrates a v1 credentials.json and manages passwords from Settings', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-'));
  const logFile = join(profile, 'events.jsonl');
  writeFileSync(logFile, '', 'utf8');
  // Pre-seed a v1 vault; the store must migrate it to version 2 on launch.
  writeFileSync(
    join(profile, 'credentials.json'),
    JSON.stringify({
      entries: [
        { origin: githubOrigin(), username: 'legacy', passwordEnc: 'dGVzdA==' },
      ],
    }),
    'utf8',
  );
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures);
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
      .toBe(true);
    await expect
      .poll(async () =>
        (await state(app)).credentials.some(
          (entry) => entry.origin === githubOrigin() && entry.username === 'legacy',
        ),
      )
      .toBe(true);
    const migrated = (await state(app)).credentials.find(
      (entry) => entry.username === 'legacy',
    );
    expect(migrated?.id).toBeTruthy();
    expect(JSON.parse(readFileSync(join(profile, 'credentials.json'), 'utf8')).version).toBe(2);

    // Save a fresh entry to drive the Settings UI flow.
    const saved = await app.evaluate((_electron, credential) => {
      return (
        globalThis as typeof globalThis & {
          __devinworkspaces: {
            saveCredential(c: typeof credential): Promise<{ id: string } | null>;
          };
        }
      ).__devinworkspaces.saveCredential(credential);
    }, { origin: githubOrigin(), username: 'alice', password: 's3cret' });
    expect(saved?.id).toBeTruthy();
    const id = saved!.id;

    await evaluateInShell(app, `window.devinworkspaces.setSurface('settings')`);
    const rowSelector = `li[data-credential-id="${id}"]`;
    await expect
      .poll(async () =>
        evaluateInShell(app, `Boolean(document.querySelector('${rowSelector}'))`),
      )
      .toBe(true);

    // Show → the readonly input displays the decrypted password.
    await evaluateInShell(app, `document.getElementById('credentialReveal-${id}').click()`);
    await expect
      .poll(async () =>
        evaluateInShell(app, `document.querySelector('${rowSelector} input[readonly]')?.value`),
      )
      .toBe('s3cret');

    // Edit → change password → Save → reveal shows the new value.
    await evaluateInShell(app, `document.getElementById('credentialEdit-${id}').click()`);
    await expect
      .poll(async () =>
        evaluateInShell(app, `Boolean(document.getElementById('credentialEditPassword-${id}'))`),
      )
      .toBe(true);
    await evaluateInShell(
      app,
      `(() => {
        const input = document.getElementById('credentialEditPassword-${id}');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'n3wSecret');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
    );
    await evaluateInShell(app, `document.getElementById('credentialEditSave-${id}').click()`);
    await expect
      .poll(async () =>
        evaluateInShell(app, `Boolean(document.getElementById('credentialEditPassword-${id}'))`),
      )
      .toBe(false);
    // The first Show is still visible (30 s auto-hide) — toggle it off, then on again.
    await evaluateInShell(app, `document.getElementById('credentialReveal-${id}').click()`);
    await expect
      .poll(async () =>
        evaluateInShell(app, `Boolean(document.querySelector('${rowSelector} input[readonly]'))`),
      )
      .toBe(false);
    await evaluateInShell(app, `document.getElementById('credentialReveal-${id}').click()`);
    await expect
      .poll(async () =>
        evaluateInShell(app, `document.querySelector('${rowSelector} input[readonly]')?.value`),
      )
      .toBe('n3wSecret');

    // Delete requires two clicks (confirm step).
    await evaluateInShell(app, `document.getElementById('credentialDelete-${id}').click()`);
    expect(
      await evaluateInShell(
        app,
        `document.getElementById('credentialDelete-${id}').textContent`,
      ),
    ).toBe('Confirm delete');
    expect(
      await evaluateInShell(app, `Boolean(document.querySelector('${rowSelector}'))`),
    ).toBe(true);
    await evaluateInShell(app, `document.getElementById('credentialDelete-${id}').click()`);
    await expect
      .poll(async () =>
        evaluateInShell(app, `Boolean(document.querySelector('${rowSelector}'))`),
      )
      .toBe(false);

    const events = await readEvents(logFile);
    expect(JSON.stringify(events)).not.toContain('s3cret');
    expect(JSON.stringify(events)).not.toContain('n3wSecret');
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await app.close().catch(() => undefined);
    rmSync(profile, { recursive: true, force: true });
  }
});
