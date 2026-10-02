import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import type { FixtureServers } from '../fixtures/http';

export type PublicState = {
  paneOpen: boolean;
  paneFraction: number;
  paneCollapsed: boolean;
  surface: 'cloud' | 'local' | 'settings';
  currentSessionId: string | null;
  credentialMatch: {
    origin: string;
    accounts: Array<{ id: string; username: string }>;
  } | null;
  credentials: Array<{
    id: string;
    origin: string;
    username: string;
    createdAt: number;
    updatedAt: number;
    lastUsedAt: number | null;
  }>;
  autofill: {
    picker: {
      accounts: Array<{ id: string; username: string }>;
      anchor: { x: number; y: number; width: number; height: number };
    } | null;
    prompt: {
      kind: 'save' | 'update';
      origin: string;
      username: string;
      anchor: { x: number; y: number; width: number; height: number };
    } | null;
  };
  settings: Record<string, unknown> & {
    tabs: { keepAliveHours: number; maxLiveTabs: number };
    workspaces?: string[];
  };
  tabs: {
    activeId: string | null;
    scope: string;
    hiddenTabCount: number;
    tabs: Array<{
      id: string;
      url: string;
      title: string;
      favicon?: string;
      loading?: boolean;
      canGoBack?: boolean;
      canGoForward?: boolean;
      originSessionId?: string;
      discarded?: boolean;
    }>;
  };
  // F5 terminal dock
  terminalOpen: boolean;
  terminalHeight: number;
  terminals: Array<{
    id: string;
    kind: 'devin' | 'shell';
    cwd: string;
    title: string;
    exitCode: number | null;
  }>;
  activeTerminalId: string | null;
  // P5
  notifications: {
    collect: boolean;
    banner: boolean;
    hasToken: boolean;
    lastPollAt: string | null;
    authError: boolean;
    lastError: string | null;
    currentSessionPrCount: number;
    unreadCount: number;
    panelOpen: boolean;
  };
};

export async function launchApp(
  userData: string,
  logFile: string,
  downloadDir: string,
  fixtures: FixtureServers,
  extraEnv: Record<string, string> = {},
): Promise<ElectronApplication> {
  const app = await _electron.launch({
    args: [process.cwd()],
    timeout: 30_000,
    env: {
      ...process.env,
      ...extraEnv,
      DEVIN_WORKSPACES_TEST: '1',
      DEVIN_WORKSPACES_TENANT_URL: fixtures.devinUrl,
      DEVIN_WORKSPACES_TEST_GITHUB_ORIGINS: fixtures.githubOrigins,
      DEVIN_WORKSPACES_USER_DATA: userData,
      DEVIN_WORKSPACES_LOG: logFile,
      DEVIN_WORKSPACES_DOWNLOAD_DIR: downloadDir,
      DEVIN_WORKSPACES_ALLOW_EXTERNAL: '0',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      ...extraEnv,
    },
  });
  const dismissDialogs = (page: import('@playwright/test').Page) => {
    page.on('dialog', async (dialog) => {
      if (dialog.type() !== 'beforeunload') return;
      try {
        await dialog.dismiss();
      } catch (error) {
        if (!String(error).includes('No dialog is showing')) throw error;
      }
    });
  };
  app.context().pages().forEach(dismissDialogs);
  app.context().on('page', dismissDialogs);

  // Fail fast when the display clamps the window below the pane threshold —
  // otherwise every pane-dependent assertion just times out mysteriously.
  await expect
    .poll(async () => app.evaluate(() => Boolean((globalThis as any).__devinworkspaces)))
    .toBe(true);
  const width = await app.evaluate(
    ({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getContentBounds().width ?? 0,
  );
  if (width < 1400) {
    let detail = '';
    try {
      detail =
        readFileSync(logFile, 'utf8')
          .split('\n')
          .filter((line) => line.includes('window-size'))
          .pop() ?? '';
    } catch {
      // log may not exist yet
    }
    throw new Error(
      `runner display too small: window content width ${width}px (<1400) — ${detail}. ` +
        `see scripts/ci-display.ps1`,
    );
  }
  return app;
}

export async function state(app: ElectronApplication): Promise<PublicState> {
  return app.evaluate(
    () =>
      (globalThis as typeof globalThis & { __devinworkspaces: { state(): PublicState } })
        .__devinworkspaces.state(),
  );
}

export async function hasDevinView(
  app: ElectronApplication,
  fixtures: FixtureServers,
): Promise<boolean> {
  return app.evaluate(
    ({ webContents }, url: string) =>
      webContents.getAllWebContents().some((contents) => contents.getURL().startsWith(url)),
    fixtures.devinUrl,
  );
}

export async function currentDevinUrl(
  app: ElectronApplication,
  fixtures: FixtureServers,
): Promise<string | undefined> {
  return app.evaluate(
    ({ webContents }, url: string) =>
      webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(url))?.getURL(),
    fixtures.devinUrl,
  );
}

export async function hasFixtureFrame(
  app: ElectronApplication,
  fixtures: FixtureServers,
): Promise<boolean> {
  return app.evaluate(
    async ({ webContents }, url: string) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL().startsWith(url));
      const frame = contents?.mainFrame.frames.find((item) => item.url.endsWith('/frame'));
      return frame
        ? Boolean(
            await frame.executeJavaScript(
              `document.readyState === 'complete' && Boolean(document.getElementById('iframeTop'))`,
            ),
          )
        : false;
    },
    fixtures.devinUrl,
  );
}

export async function fixtureFrameUrl(
  app: ElectronApplication,
  fixtures: FixtureServers,
): Promise<string | undefined> {
  return app.evaluate(
    ({ webContents }, url: string) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL().startsWith(url));
      return contents?.mainFrame.frames.find((frame) => frame.url !== contents.getURL())?.url;
    },
    fixtures.devinUrl,
  );
}

export async function evaluateInView(
  app: ElectronApplication,
  urlPrefix: string,
  script: string,
): Promise<unknown> {
  return app.evaluate(
    async ({ webContents }, args: { urlPrefix: string; script: string }) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().startsWith(args.urlPrefix));
      if (!contents) throw new Error(`No webContents for ${args.urlPrefix}`);
      return contents.executeJavaScript(args.script);
    },
    { urlPrefix, script },
  );
}

export async function evaluateInShell(
  app: ElectronApplication,
  script: string,
): Promise<unknown> {
  return app.evaluate(async ({ webContents }, source: string) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL().startsWith('app://shell/'));
    if (!contents) throw new Error('Shell WebContents not found');
    return contents.executeJavaScript(source);
  }, script);
}

export async function runInFrame(
  app: ElectronApplication,
  fixtures: FixtureServers,
  script: string,
): Promise<unknown> {
  return app.evaluate(
    async ({ webContents }, args: { devinUrl: string; script: string }) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().startsWith(args.devinUrl));
      const frame = contents?.mainFrame.frames.find((candidate) => candidate.url.endsWith('/frame'));
      if (!frame) throw new Error('Fixture iframe did not load');
      return frame.executeJavaScript(args.script);
    },
    { devinUrl: fixtures.devinUrl, script },
  );
}

export async function waitForTabCount(app: ElectronApplication, count: number): Promise<void> {
  await expect.poll(async () => (await state(app)).tabs.tabs.length).toBe(count);
}

export async function waitForTabTitle(app: ElectronApplication, title: string): Promise<void> {
  await expect
    .poll(async () => (await state(app)).tabs.tabs.some((tab) => tab.title.includes(title)))
    .toBe(true);
}

export async function openTab(app: ElectronApplication, url: string): Promise<string> {
  const id = await app.evaluate((_electron, targetUrl: string) => {
    return (
      globalThis as typeof globalThis & { __devinworkspaces: { open(url: string): string } }
    ).__devinworkspaces.open(targetUrl);
  }, url);
  if (typeof id !== 'string') throw new Error(`Could not open fixture tab at ${url}`);
  return id;
}

export async function readEvents(logFile: string): Promise<Array<Record<string, unknown>>> {
  const text = readFileSync(logFile, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export async function waitForEvent(
  logFile: string,
  event: string,
  decision?: string,
): Promise<void> {
  await expect
    .poll(async () =>
      (await readEvents(logFile)).some(
        (entry) => entry.event === event && (decision === undefined || entry.decision === decision),
      ),
    )
    .toBe(true);
}

export async function waitForEventCount(
  logFile: string,
  event: string,
  count: number,
): Promise<void> {
  await expect
    .poll(async () => (await readEvents(logFile)).filter((entry) => entry.event === event).length)
    .toBeGreaterThanOrEqual(count);
}

export async function waitForDecision(
  logFile: string,
  decision: string,
  urlIncludes: string,
): Promise<Record<string, unknown>> {
  let found: Record<string, unknown> | undefined;
  await expect
    .poll(async () => {
      found = (await readEvents(logFile)).find(
        (entry) =>
          entry.decision === decision &&
          typeof entry.url === 'string' &&
          entry.url.includes(urlIncludes),
      );
      return Boolean(found);
    })
    .toBe(true);
  return found!;
}

// Events that would have handed a URL to the system browser (`external` / `mailto`
// decisions), filtered to the GitHub-class fixture origins. Must always be empty (R7).
export async function githubExternalEvents(
  logFile: string,
  fixtures: FixtureServers,
): Promise<Array<Record<string, unknown>>> {
  const origins = fixtures.githubOrigins.split(',');
  return (await readEvents(logFile)).filter(
    (entry) =>
      (entry.decision === 'external' || entry.decision === 'mailto' || entry.event === 'external-open') &&
      typeof entry.url === 'string' &&
      origins.some((origin) => (entry.url as string).startsWith(origin)),
  );
}

export async function browserWindowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

export async function webContentsCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
}

// Playwright Page for a hosted view (shell / devin / gh tab). Every WebContentsView is a
// CDP page target, so real pointer/keyboard input can be driven through it.
export async function pageFor(app: ElectronApplication, urlPrefix: string): Promise<Page> {
  let page: Page | undefined;
  await expect
    .poll(() => {
      page = app.context().pages().find((candidate) => candidate.url().startsWith(urlPrefix));
      return Boolean(page);
    })
    .toBe(true);
  return page!;
}

export function shellPage(app: ElectronApplication): Promise<Page> {
  return pageFor(app, 'app://shell/');
}

export async function tabPage(app: ElectronApplication, tabUrl: string): Promise<Page> {
  return pageFor(app, tabUrl);
}

// Real mouse click (optionally with Ctrl / middle button) on an element inside a hosted
// view. Uses raw input instead of `locator.click()` because Playwright's actionability
// checks wait for "scheduled navigations" that the main process intentionally cancels
// (will-navigate preventDefault), which would hang the test.
// Element geometry is read through Electron's executeJavaScript (not Playwright locators)
// for the same reason: after a cancelled navigation the Playwright frame stays "navigating".
export async function clickLink(
  app: ElectronApplication,
  page: Page,
  selector: string,
  options: { ctrl?: boolean; middle?: boolean } = {},
): Promise<void> {
  const urlPrefix = page.url();
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect
    .poll(async () => {
      try {
        box = (await evaluateInView(
          app,
          urlPrefix,
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            // First line box: inline links may wrap, leaving the bounding-box centre empty.
            const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          })()`,
        )) as typeof box;
      } catch {
        box = null;
      }
      return Boolean(box && box.width > 0 && box.height > 0);
    })
    .toBe(true);
  if (!box) throw new Error(`No bounding box for ${selector}`);
  const rect = box as { x: number; y: number; width: number; height: number };
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  if (options.ctrl) await page.keyboard.down('Control');
  await page.mouse.move(x, y);
  await page.mouse.down({ button: options.middle ? 'middle' : 'left' });
  await page.mouse.up({ button: options.middle ? 'middle' : 'left' });
  if (options.ctrl) await page.keyboard.up('Control');
}

// Real pointer drag of one tab onto another in the shell strip (dnd-kit PointerSensor:
// 5px activation distance, then horizontal moves, then release over the target).
// Requires both tabs fully inside the strip — no autoscroll heuristics; use
// keyboardReorderTab when the strip overflows.
export async function dragTab(page: Page, fromId: string, toId: string): Promise<void> {
  const from = page.locator(`[data-tab-id="${fromId}"]`);
  const to = page.locator(`[data-tab-id="${toId}"]`);
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();
  const stripBox = await page.locator('#tabStrip').boundingBox();
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox || !stripBox) throw new Error('Tab elements not visible for drag');
  const inside = (b: { x: number; width: number }) =>
    b.x >= stripBox.x - 1 && b.x + b.width <= stripBox.x + stripBox.width + 1;
  if (!inside(fromBox) || !inside(toBox)) {
    throw new Error(
      `dragTab requires both tabs fully visible; strip overflows — widen the pane or use keyboardReorderTab (from ${JSON.stringify(fromBox)} to ${JSON.stringify(toBox)}, strip ${JSON.stringify(stripBox)})`,
    );
  }
  const orderBefore = await page.locator('#tabStrip [data-tab-id]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-tab-id')),
  );
  const startX = fromBox.x + fromBox.width / 2;
  const y = fromBox.y + fromBox.height / 2;
  const dir = Math.sign(toBox.x - fromBox.x) || 1;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  // 4 moves of 4px (> 5px activation distance) in the target direction.
  for (let i = 1; i <= 4; i += 1) {
    await page.mouse.move(startX + dir * i * 4, y);
    await page.waitForTimeout(30);
  }
  await page.mouse.move(toBox.x + toBox.width / 2 + (dir * toBox.width) / 4, y, { steps: 8 });
  await page.mouse.up();
  // Wait for the strip order to actually change rather than a fixed delay —
  // the reorder applies after dnd-kit's drop animation.
  try {
    await page.waitForFunction(
      (prev) => {
        const ids = [...document.querySelectorAll('#tabStrip [data-tab-id]')].map((el) =>
          el.getAttribute('data-tab-id'),
        );
        return ids.join(',') !== (prev as string[]).join(',');
      },
      orderBefore,
      { timeout: 5000 },
    );
  } catch {
    throw new Error(`Tab order did not change after drop: ${orderBefore.join(',')}`);
  }
}

// Deterministic reorder via the dnd-kit KeyboardSensor on the tab's drag handle:
// focus handle → Space (pick up) → ArrowLeft/Right → Space (drop).
export async function keyboardReorderTab(
  page: Page,
  tabId: string,
  direction: 'left' | 'right',
): Promise<void> {
  const orderBefore = await page.locator('#tabStrip [data-tab-id]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-tab-id')),
  );
  const handle = page.locator(`[data-tab-id="${tabId}"] .dragHandle`);
  await handle.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  await page.keyboard.press(direction === 'left' ? 'ArrowLeft' : 'ArrowRight');
  await page.waitForTimeout(120);
  await page.keyboard.press('Space');
  await page.waitForFunction(
    (prev) => {
      const ids = [...document.querySelectorAll('#tabStrip [data-tab-id]')].map((el) =>
        el.getAttribute('data-tab-id'),
      );
      return ids.join(',') !== (prev as string[]).join(',');
    },
    orderBefore,
    { timeout: 5000 },
  );
}
