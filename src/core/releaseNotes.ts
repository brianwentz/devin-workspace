import { z } from 'zod';

export interface ReleaseNotes {
  version: string;
  name: string | null;
  publishedAt: string | null;
  body: string;
  htmlUrl: string;
}

export const RELEASE_BODY_MAX = 64 * 1024;

export function releasesPageUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}/releases`;
}

export function releaseTagUrl(
  apiBase: string,
  owner: string,
  repo: string,
  version: string,
): string {
  return `${apiBase}/repos/${owner}/${repo}/releases/tags/v${version}`;
}

const ReleaseResponseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  html_url: z.string(),
});

export function parseReleaseResponse(json: unknown, version: string): ReleaseNotes | null {
  const parsed = ReleaseResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const body = parsed.data.body ?? '';
  const truncated = body.length > RELEASE_BODY_MAX;
  return {
    version,
    name: parsed.data.name ?? null,
    publishedAt: parsed.data.published_at ?? null,
    body: truncated ? `${body.slice(0, RELEASE_BODY_MAX)}…` : body,
    htmlUrl: parsed.data.html_url,
  };
}

// electron-updater UpdateInfo shape → ReleaseNotes; null when there's no
// notes text at all.
export function releaseNotesFromUpdateInfo(
  info: {
    version: string;
    releaseName?: string | null;
    releaseDate?: string;
    releaseNotes?: string | { version: string; note: string | null }[] | null;
  },
  owner: string,
  repo: string,
): ReleaseNotes | null {
  const htmlUrl = `https://github.com/${owner}/${repo}/releases/tag/v${info.version}`;
  let body: string;
  if (typeof info.releaseNotes === 'string') {
    body = info.releaseNotes;
  } else if (Array.isArray(info.releaseNotes)) {
    body = info.releaseNotes
      .map((entry) => entry.note ?? '')
      .filter((note) => note.length > 0)
      .join('\n\n');
  } else {
    return null;
  }
  if (body.length === 0) return null;
  const truncated = body.length > RELEASE_BODY_MAX;
  return {
    version: info.version,
    name: info.releaseName ?? null,
    publishedAt: info.releaseDate ?? null,
    body: truncated ? `${body.slice(0, RELEASE_BODY_MAX)}…` : body,
    htmlUrl,
  };
}
