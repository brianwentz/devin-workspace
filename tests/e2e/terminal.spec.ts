import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import { launchApp, shellPage } from './helpers';

type Hooks = {
  terminalOpen(workspace: string): { ok: true; id: string } | { ok: false; error: string };
  terminalInput(id: string, data: string): boolean;
  terminalResize(id: string, cols: number, rows: number): boolean;
  terminalClose(id: string): boolean;
  terminalRead(id: string): string;
  terminalPid(id: string): number | null;
  localAddWorkspace(path: string): string | null;
  setSurface(value: 'cloud' | 'local' | 'settings'): void;
};

type G = typeof globalThis & { __devinworkspaces: Hooks };

const TERMINAL_CMD = 'node out/fixtures/fakePty.cjs';

let fixtures: FixtureServers;

test.beforeAll(async () => {
  fixtures = await startFixtureServers();
  expect(existsSync(join('out', 'fixtures', 'fakePty.cjs'))).toBe(true);
});

test.afterAll(async () => {
  await fixtures.close();
});

// process.kill(pid, 0) lies on Windows when the pid was recycled — check the
// image name too (pty children here are node.exe).
function pidAlive(pid: number): boolean {
  try {
    const out = spawnSync('tasklist', ['/fi', `pid eq ${pid}`, '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
    }).stdout;
    const match = /^"([^"]+)"/.exec(out.trim());
    return match ? match[1]!.toLowerCase() === 'node.exe' : false;
  } catch {
    return false;
  }
}

test('terminal: opens a pty, echoes input, resizes, closes, and leaves no orphans on quit', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-term-'));
  const logFile = join(profile, 'events.jsonl');
  writeFileSync(logFile, '', 'utf8');
  const workspace = mkdtempSync(join(tmpdir(), 'devin-workspaces-ws-'));
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
    DEVIN_WORKSPACES_TEST_TERMINAL_CMD: TERMINAL_CMD,
  });
  let closed = false;
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as G).__devinworkspaces)))
      .toBe(true);

    // A path outside the configured workspaces must be rejected.
    const denied = await app.evaluate(
      (_e, path) => (globalThis as G).__devinworkspaces.terminalOpen(path as string),
      tmpdir(),
    );
    expect(denied.ok).toBe(false);
    const added = await app.evaluate(
      (_e, path) => (globalThis as G).__devinworkspaces.localAddWorkspace(path),
      workspace,
    );
    expect(added).toBeTruthy();
    const opened = await app.evaluate(
      (_e, ws) => (globalThis as G).__devinworkspaces.terminalOpen(ws as string),
      added,
    );
    expect(opened.ok).toBe(true);
    const id = opened.ok ? opened.id : '';
    expect(id).toBeTruthy();

    // Fake pty announces readiness.
    await expect
      .poll(async () =>
        app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string), id),
      )
      .toContain('ready');

    // Input echoes back through the pty.
    await app.evaluate(
      (_e, args) => (globalThis as G).__devinworkspaces.terminalInput(args.id, args.data),
      { id, data: 'ping\r' },
    );
    await expect
      .poll(async () =>
        app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string), id),
      )
      .toContain('echo:ping');

    expect(
      await app.evaluate(
        (_e, args) => (globalThis as G).__devinworkspaces.terminalResize(args.id, args.c, args.r),
        { id, c: 80, r: 24 },
      ),
    ).toBe(true);

    const pid = await app.evaluate(
      (_e, tid) => (globalThis as G).__devinworkspaces.terminalPid(tid as string),
      id,
    );
    expect(pid).toBeTruthy();

    // Shell DOM: Terminal tab shows an xterm surface.
    await app.evaluate(() => (globalThis as G).__devinworkspaces.setSurface('local'));
    const page = await shellPage(app);await page.waitForSelector('#view-terminal', { timeout: 10000 });
    await page.click('#view-terminal');await page.waitForSelector('.xterm', { timeout: 10000 });

    // Close kills the child process.
    await app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalClose(tid as string), id);
    await expect.poll(async () => pidAlive(pid!)).toBe(false);

    // A second terminal left open is disposed on quit — no orphan conhost/node.
    const opened2 = await app.evaluate(
      (_e, ws) => (globalThis as G).__devinworkspaces.terminalOpen(ws as string),
      added,
    );
    expect(opened2.ok).toBe(true);
    const pid2 = opened2.ok
      ? await app.evaluate(
          (_e, tid) => (globalThis as G).__devinworkspaces.terminalPid(tid as string),
          opened2.id,
        )
      : null;
    expect(pid2).toBeTruthy();

    // app.evaluate(quit) can hang forever (the app exits before the IPC reply
    // is delivered) — fire it un-awaited and wait on the child 'exit' event.
    const exitStatus = new Promise<'exited' | 'timeout'>((resolve) => {
      app.process().once('exit', () => resolve('exited'));
      setTimeout(() => resolve('timeout'), 30_000);
    });
    void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    expect(await exitStatus).toBe('exited');
    closed = true;
    await expect.poll(async () => pidAlive(pid2!)).toBe(false);
    await Promise.race([
      app.close().then(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  } finally {
    if (!closed) {
      spawnSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' });
      await Promise.race([
        app.close().then(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
    // ConPTY children can hold the temp dirs briefly after quit — retry.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(profile, { recursive: true, force: true });
        rmSync(workspace, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
});
