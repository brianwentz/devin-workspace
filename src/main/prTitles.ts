import { session } from 'electron';
import { routeUrl } from '../core/linkRouter';
import { parsePrTitle } from '../core/prTitle';
import { log } from './log';
import { routeContext } from './routing';

// Resolves GitHub PR titles (from the page <title>) for the PR quick-open menu.
// Fetches go through the persist:github partition so the user's GitHub cookies
// apply; only URLs that route as 'github' are ever fetched. Titles are never
// logged — only status/length.
const NULL_RETRY_MS = 10 * 60_000;
const OK_REFRESH_MS = 6 * 60 * 60_000;
const MAX_CONCURRENT = 3;
const FETCH_TIMEOUT_MS = 15_000;

interface CacheEntry {
  title: string | null;
  fetchedAt: number;
}

class PrTitleCache {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Set<string>();
  private queue: string[] = [];

  get(url: string): string | null {
    return this.cache.get(url)?.title ?? null;
  }

  ensure(urls: readonly string[]): void {
    const now = Date.now();
    for (const url of urls) {
      if (this.inFlight.has(url) || this.queue.includes(url)) continue;
      const cached = this.cache.get(url);
      if (cached) {
        const staleMs = cached.title === null ? NULL_RETRY_MS : OK_REFRESH_MS;
        if (now - cached.fetchedAt < staleMs) continue;
      }
      if (routeUrl(url, routeContext()) !== 'github') continue;
      this.queue.push(url);
    }
    this.pump();
  }

  private pump(): void {
    while (this.inFlight.size < MAX_CONCURRENT && this.queue.length > 0) {
      const url = this.queue.shift();
      if (!url || this.inFlight.has(url)) continue;
      this.inFlight.add(url);
      void this.fetchTitle(url).finally(() => {
        this.inFlight.delete(url);
        this.pump();
      });
    }
  }

  private async fetchTitle(url: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let status: number | null = null;
    let title: string | null = null;
    try {
      const response = await session.fromPartition('persist:github').fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        headers: { accept: 'text/html' },
        signal: controller.signal,
      });
      status = response.status;
      if (status >= 200 && status < 300) {
        title = parsePrTitle(await response.text());
      }
    } catch {
      status = null;
      title = null;
    } finally {
      clearTimeout(timer);
    }
    this.cache.set(url, { title, fetchedAt: Date.now() });
    log('shell', 'pr-title', {
      url,
      detail: { ok: status !== null && status >= 200 && status < 300, status, length: title?.length ?? 0 },
    });
  }
}

export const prTitles = new PrTitleCache();
