import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from 'playwright';
import { startFixtureServers, type FixtureServers } from '../fixtures/http';
import { evaluateInShell, launchApp, readEvents, shellPage, state, waitForEvent } from './helpers';

type Hooks = {
  terminalOpen(
    options: { kind: 'devin'; workspace: string; sessionId: string } | { kind: 'shell'; cwd?: string },
  ): { ok: true; id: string } | { ok: false; error: string };
  terminalInput(id: string, data: string): boolean;
  terminalResize(id: string, cols: number, rows: number): boolean;
  terminalClose(id: string): boolean;
  terminalRead(id: string): string;
  terminalPid(id: string): number | null;
  terminalList(): Array<{ id: string; kind: string; cwd: string; title: string; exitCode: number | null }>;
  localAddWorkspace(path: string): string | null;
  localNewSession(workspace: string): Promise<string>;
  localState(): { agents: Record<string, { status: string }> };
  setSurface(value: 'cloud' | 'local' | 'settings'): void;
  setTerminalOpen(value: boolean): void;
  setTerminalHeight(value: number): void;
  getDevinBounds(): { y: number; height: number } | null;
  childViews(): Array<{ bounds: { x: number; y: number; width: number; height: number }; url: string | null }>;
  layoutRects(): { terminal: { x: number; y: number; width: number; height: number } };
  setPaneOpen(value: boolean): void;
  clipboardWrite(text: string): void;
  clipboardRead(): string;
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
    DEVIN_WORKSPACES_LOCAL_AGENT_CMD: 'node out/fixtures/fakeAcpAgent.cjs',
  });
  let closed = false;
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as G).__devinworkspaces)))
      .toBe(true);

    // A path outside the configured workspaces must be rejected.
    const denied = await app.evaluate(
      (_e, path) => (globalThis as G).__devinworkspaces.terminalOpen({ kind: 'devin', workspace: path as string, sessionId: 'deny-session' }),
      tmpdir(),
    );
    expect(denied.ok).toBe(false);
    const added = await app.evaluate(
      (_e, path) => (globalThis as G).__devinworkspaces.localAddWorkspace(path),
      workspace,
    );
    expect(added).toBeTruthy();
    const opened = await app.evaluate(
      (_e, ws) => (globalThis as G).__devinworkspaces.terminalOpen({ kind: 'devin', workspace: ws as string, sessionId: 'sess-term' }),
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

    // Shell DOM: Terminal tab shows an xterm surface (per-session pty — the
    // hook-opened one belongs to 'sess-term', the session gets its own).
    await expect
      .poll(async () => (await app.evaluate(() => (globalThis as G).__devinworkspaces.localState())).agents[added!]?.status)
      .toBe('ready');
    const uiSessionId = await app.evaluate(
      (_e, w) => (globalThis as G).__devinworkspaces.localNewSession(w as string),
      added,
    );
    await app.evaluate(() => (globalThis as G).__devinworkspaces.setSurface('local'));
    const page = await shellPage(app);
    await page.waitForSelector(`.session-item[data-session-id="${uiSessionId}"]`, { timeout: 10000 });
    await page.click(`.session-item[data-session-id="${uiSessionId}"]`);
    await page.waitForSelector('#view-terminal:not([disabled])', { timeout: 10000 });
    await page.click('#view-terminal');
    await page.waitForSelector('.xterm', { timeout: 10000 });

    // Close kills the child process.
    await app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalClose(tid as string), id);
    await expect.poll(async () => pidAlive(pid!)).toBe(false);

    // A second terminal left open is disposed on quit — no orphan conhost/node.
    const opened2 = await app.evaluate(
      (_e, ws) => (globalThis as G).__devinworkspaces.terminalOpen({ kind: 'devin', workspace: ws as string, sessionId: 'sess-term' }),
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

test('terminal dock: rail toggle, shell tabs, surface gating, persisted height', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-dock-'));
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
    const page = await shellPage(app);
    await page.waitForSelector('#terminalToggle', { timeout: 10_000 });

    // Closed by default; devin view fills the height.
    const before = await app.evaluate(() => (globalThis as G).__devinworkspaces.getDevinBounds());
    expect(before?.height).toBeGreaterThan(600);
    await expect(page.locator('#terminalDock')).toBeHidden();

    // Rail toggle opens the dock; devin height shrinks by height + splitter.
    await page.click('#terminalToggle');
    await expect.poll(async () => (await state(app)).terminalOpen).toBe(true);
    await expect(page.locator('#terminalDock')).toBeVisible();
    const after = await app.evaluate(() => (globalThis as G).__devinworkspaces.getDevinBounds());
    expect(after?.height).toBe(before!.height - 280 - 6);

    // Native layering: no WebContentsView may cover the dock rect — a stray
    // native view over the strip swallows real clicks before they reach the
    // shell DOM (CDP input bypasses native hit-testing, so DOM assertions miss it).
    const [rects, views] = await app.evaluate(() => [
      (globalThis as G).__devinworkspaces.layoutRects(),
      (globalThis as G).__devinworkspaces.childViews(),
    ]);
    const term = rects.terminal;
    const overlaps = (b: { x: number; y: number; width: number; height: number }) =>
      b.x < term.x + term.width && b.x + b.width > term.x && b.y < term.y + term.height && b.y + b.height > term.y;
    for (const view of views) {
      const isShell = view.url?.startsWith('app://shell');
      if (!isShell) expect(overlaps(view.bounds), `view over dock: ${view.url}`).toBe(false);
    }

    // + opens a shell immediately in the default cwd (workspaces empty → homedir).
    await page.click('#terminalNew');
    await expect.poll(async () => (await state(app)).terminals.length).toBe(1);
    await waitForEvent(logFile, 'terminal-open');
    const openEvents = (await readEvents(logFile)).filter(
      (e) => e.event === 'terminal-open' && (e.detail as { kind?: string }).kind === 'shell',
    );
    expect(openEvents.length).toBe(1);
    const firstId = (await state(app)).terminals[0]!.id;

    // Focus lands in the new terminal (xterm helper textarea), not the button —
    // typed input goes to the pty and Space/Enter cannot re-trigger +.
    await expect
      .poll(async () =>
        page.evaluate(
          (id) =>
            document.activeElement?.closest(`[data-terminal-id="${id}"]`) !== null &&
            document.activeElement?.classList.contains('xterm-helper-textarea'),
          firstId,
        ),
      )
      .toBe(true);
    await page.keyboard.type('ping\r');
    await expect
      .poll(async () =>
        app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string), firstId),
      )
      .toContain('ping');
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    expect((await state(app)).terminals.length).toBe(1);
    // Tab label is the cwd basename (short), not the raw OSC title.
    const firstCwd = (await state(app)).terminals[0]!.cwd;
    await expect(page.locator(`[data-terminal-tab="${firstId}"] .tabTitle`)).toHaveText(
      firstCwd.split(/[\\/]/).filter(Boolean).at(-1)!,
    );

    // The chevron opens the cwd menu — it must be a real, unclipped overlay:
    // rect inside the dock and the first item hit-tests to itself.
    const profiles = (await evaluateInShell(app, `window.devinworkspaces.terminalProfiles()`)) as unknown[];
    expect(Array.isArray(profiles)).toBe(true);
    await page.click('#terminalNewCwd');
    await page.waitForSelector('#terminalNewMenu button');
    await expect(page.locator('#terminalNewMenu >> text=Open in…')).toHaveCount(1);
    const options = await page.locator('#terminalNewMenu button').allTextContents();
    expect(options.length).toBeGreaterThan(0);
    const menuBox = await page.locator('#terminalNewMenu').boundingBox();
    const dockBox = await page.locator('#terminalDock').boundingBox();
    expect(menuBox).toBeTruthy();
    expect(dockBox).toBeTruthy();
    expect(menuBox!.y).toBeGreaterThanOrEqual(dockBox!.y);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(dockBox!.y + dockBox!.height + 1);
    const firstItem = page.locator('#terminalNewMenu button').first();
    const hitId = await firstItem.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === el || el.contains(hit) ? (el.closest('#terminalNewMenu')?.id ?? 'menu') : (hit?.id ?? hit?.tagName ?? 'none');
    });
    expect(hitId).toBe('terminalNewMenu');
    await firstItem.click();
    await expect.poll(async () => (await state(app)).terminals.length).toBe(2);
    const tabs = (await state(app)).terminals;
    expect(tabs.every((t) => t.kind === 'shell')).toBe(true);
    await expect(page.locator('#terminalDock .terminal-tab')).toHaveCount(2);

    // Input round-trips through the active pty.
    const activeId = (await state(app)).activeTerminalId;
    expect(activeId).toBe(tabs[1]!.id);
    await expect
      .poll(async () =>
        app.evaluate(
          (_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string),
          activeId,
        ),
      )
      .toContain('ready');
    await app.evaluate(
      (_e, tid) => (globalThis as G).__devinworkspaces.terminalInput(tid as string, 'hi\r'),
      activeId,
    );
    await expect
      .poll(async () =>
        app.evaluate(
          (_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string),
          activeId,
        ),
      )
      .toContain('echo:hi');

    // Clicking a tab switches; × closes it and kills the pty.
    await page.click(`[data-terminal-tab="${tabs[0]!.id}"]`);
    await expect.poll(async () => (await state(app)).activeTerminalId).toBe(tabs[0]!.id);
    const pid = await app.evaluate(
      (_e, tid) => (globalThis as G).__devinworkspaces.terminalPid(tid as string),
      tabs[0]!.id,
    );
    expect(pid).toBeTruthy();
    await page.click(`[data-terminal-tab="${tabs[0]!.id}"] .closeMark`);
    await expect.poll(async () => (await state(app)).terminals.length).toBe(1);
    await expect.poll(async () => pidAlive(pid!)).toBe(false);

    // Non-Cloud surface hides the dock and restores the devin bounds…
    await app.evaluate(() => (globalThis as G).__devinworkspaces.setSurface('local'));
    await expect(page.locator('#terminalDock')).toBeHidden();
    await expect
      .poll(async () => (await app.evaluate(() => (globalThis as G).__devinworkspaces.getDevinBounds()))?.height)
      .toBe(0); // devin view detached on local surface
    // …until terminal.allSurfaces is on (same channel the UI uses).
    await page.evaluate(() =>
      (
        window as unknown as {
          devinworkspaces: { setSettings(p: unknown): Promise<unknown> };
        }
      ).devinworkspaces.setSettings({ terminal: { allSurfaces: true } }),
    );
    await expect(page.locator('#terminalDock')).toBeVisible();

    // Resize + persist across restart.
    await app.evaluate(() => (globalThis as G).__devinworkspaces.setTerminalHeight(400));
    await expect.poll(async () => (await state(app)).terminalHeight).toBe(400);
    await app.evaluate(() => (globalThis as G).__devinworkspaces.setSurface('cloud'));
    await expect.poll(async () => (await state(app)).surface).toBe('cloud');

    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await app.close();

    const app2 = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
      DEVIN_WORKSPACES_TEST_TERMINAL_CMD: TERMINAL_CMD,
    });
    try {
      await expect
        .poll(async () => app2.evaluate(() => Boolean((globalThis as G).__devinworkspaces)))
        .toBe(true);
      const s = await state(app2);
      expect(s.terminalOpen).toBe(true);
      expect(s.terminalHeight).toBe(400);
    } finally {
      await app2.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
      await app2.close().catch(() => undefined);
    }
    closed = true;
  } finally {
    if (!closed) {
      spawnSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' });
      await Promise.race([
        app.close().then(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
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

test('terminal clipboard: Ctrl+Shift+V pastes, right-click pastes, context menu suppressed', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-termclip-'));
  const logFile = join(profile, 'events.jsonl');
  writeFileSync(logFile, '', 'utf8');
  const app = await launchApp(profile, logFile, join(profile, 'downloads'), fixtures, {
    DEVIN_WORKSPACES_TEST_TERMINAL_CMD: TERMINAL_CMD,
  });
  let closed = false;
  try {
    await expect
      .poll(async () => app.evaluate(() => Boolean((globalThis as G).__devinworkspaces)))
      .toBe(true);
    const page = await shellPage(app);
    await page.waitForSelector('#terminalToggle', { timeout: 10_000 });
    await page.click('#terminalToggle');
    await page.waitForSelector('#terminalNew', { timeout: 10_000 });
    await page.click('#terminalNew');
    let id = '';
    await expect
      .poll(async () => {
        id = (await state(app)).terminals[0]?.id ?? '';
        return id;
      })
      .not.toBe('');
    await page.waitForSelector(`[data-terminal-id="${id}"] .xterm`, { timeout: 10_000 });
    await expect
      .poll(async () =>
        app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string), id),
      )
      .toContain('ready');
    await page.locator(`[data-terminal-id="${id}"]`).click();

    // Ctrl+Shift+V pastes clipboard text into the pty.
    await app.evaluate((_e, text) => (globalThis as G).__devinworkspaces.clipboardWrite(text as string), 'clip-v-paste');
    await page.keyboard.press('Control+Shift+v');
    await expect
      .poll(async () =>
        app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string), id),
      )
      .toContain('clip-v-paste');

    // Right-click with no xterm selection pastes (Windows Terminal convention).
    await app.evaluate((_e, text) => (globalThis as G).__devinworkspaces.clipboardWrite(text as string), 'right-click-paste');
    await page.locator(`[data-terminal-id="${id}"]`).click({ button: 'right' });
    await expect
      .poll(async () =>
        app.evaluate((_e, tid) => (globalThis as G).__devinworkspaces.terminalRead(tid as string), id),
      )
      .toContain('right-click-paste');

    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await app.close();
    closed = true;
  } finally {
    if (!closed) {
      spawnSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' });
      await Promise.race([
        app.close().then(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
});

test('terminal: quit disposes several live devin ptys and the process exits', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'devin-workspaces-e2e-termquit-'));
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
    const added = await app.evaluate(
      (_e, path) => (globalThis as G).__devinworkspaces.localAddWorkspace(path),
      workspace,
    );
    expect(added).toBeTruthy();
    // Three live per-session devin ptys at quit.
    for (let i = 0; i < 3; i += 1) {
      const opened = await app.evaluate(
        (_e, args) =>
          (globalThis as G).__devinworkspaces.terminalOpen({
            kind: 'devin',
            workspace: args.ws as string,
            sessionId: args.sid as string,
          }),
        { ws: added, sid: `quit-sess-${i}` },
      );
      expect(opened.ok).toBe(true);
    }
    expect(
      (await app.evaluate(() => (globalThis as G).__devinworkspaces.terminalList())).length,
    ).toBe(3);

    // quit + wait on the process 'exit' — the evaluate reply can be lost when
    // the app exits first, so it is fired un-awaited.
    const exitStatus = new Promise<'exited' | 'timeout'>((resolve) => {
      app.process().once('exit', () => resolve('exited'));
      setTimeout(() => resolve('timeout'), 30_000);
    });
    void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    expect(await exitStatus).toBe('exited');
    await waitForEvent(logFile, 'window-close-complete');
    closed = true;
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
