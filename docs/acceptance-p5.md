# P5 acceptance — Extras (notifications, badge, PR quick-open, Ctrl+N)

Exit criterion (plan §5-P5): PAT encrypted at rest, absent from renderer/logs; toast fires within one poll interval.

| Field | Value |
|---|---|
| Build | `git rev-parse --short HEAD`: |
| API base | `https://api.devin.ai` (settings `apiBase`) |
| Token type | PAT or service-user token with `ViewOrgSessions` (NOT the CLI's Windsurf token — see Institutional Context row 2) |
| Date / tester | |

## What was built

| Piece | Where | Notes |
|---|---|---|
| Secret store | `src/main/secrets.ts` | Electron `safeStorage` **async** API (`isAsyncEncryptionAvailable` / `encryptStringAsync` / `decryptStringAsync`, present in electron 44.4.5 `electron.d.ts`). Sync API is used only if the async functions are absent (logged as `secrets-sync-fallback`). File `userData/secrets.json` = `{ version: 1, devinPat?: <base64 DPAPI blob> }`. Encryption unavailable ⇒ `setPat` rejects and the UI shows the error; nothing is written. |
| API client | `src/core/devinApi.ts` | Pure, injectable `fetch`. `GET /v3/self` → `org_id`; `GET /v3/organizations/{org_id}/sessions?first=100[&after=cursor]`. 401 → `auth`, 403 → `forbidden`, 429 → `rateLimited` with parsed `Retry-After` (seconds or HTTP-date), thrown fetch → `network`; error messages are scrubbed of the token. |
| Poller / notifier | `src/main/notifier.ts`, `src/core/notifyModel.ts` | Single-flight; 10 s when any session is `new/claimed/running(working)/resuming`, else 60 s; exponential backoff on failures (cap 5 min); 429 sets a `notBefore` from `Retry-After`. Diff per session → toast on transition into `waiting_for_user` / `waiting_for_approval` (and `blocked`), case-insensitive. First poll never toasts. Toast click → devinView `${tenantUrl}/sessions/<id>`, surface `cloud`, window focused. |
| Taskbar badge | `src/core/badgePng.ts` | Canvas-free PNG (node:zlib) rendered at runtime for 1–9 / `9+`; `BaseWindow.setOverlayIcon(image, description)`; cleared at 0. (Pre-generated `build/badges/` PNGs were not needed — runtime render avoids shipping binaries and packaging changes.) |
| PR quick-open | `ipc prs:list` / `prs:popup`, `src/shell/components/PrQuickOpen.tsx` | Rail "PR" button shows when the current session (from `state.currentSessionId`) has `pull_requests` in the last poll; native `Menu.popup`, each item → `handleLink(url)` → GitHub pane. |
| Ctrl+N | `src/main/shortcuts.ts` `openNewSession()` | Navigates devinView to `newSessionUrl(tenantUrl)` (`NEW_SESSION_PATH = '/'` in `src/core/sessions.ts`). |
| Settings UI | `src/shell/components/NotificationSettings.tsx` | Token row (password input, Save / Clear, status "Token stored (encrypted)" + last poll / auth error), "Notify me…" toggle (`settings.notifications.enabled`, default true), optional org-id override, "Test notification". |
| ShellState | `notifications: { enabled, hasToken, waitingCount, lastPollAt, authError, lastError, currentSessionPrCount }` | Never contains the token. |

## Evidence from automated tests

Run: `npm run typecheck && npm run test:unit && npm run build && npm run test:e2e`
Logs: `docs/evidence/p5-unit-tests.log`, `docs/evidence/p5-e2e-notify.log`.

| Exit requirement | Test | Assertion |
|---|---|---|
| PAT encrypted at rest | `tests/e2e/notify.spec.ts` "stores the PAT encrypted…" | `secrets.json` has `version: 1` and a base64 `devinPat`; neither the raw file nor the base64-decoded blob contains the token string. |
| PAT absent from renderer | same | `__devinworkspaces.state()` JSON and the shell DOM + `window.devinworkspaces` key list never contain the token. The preload has no "get token" method. |
| PAT absent from logs/settings | same + 401/429 test | `events.jsonl` and `settings.json` never contain the token (checked after set, poll, errors, clear). |
| Correct token sent | same | Fixture records `Authorization: Bearer test-token-123` on `/v3/self` and `/v3/organizations/org-fixture/sessions?first=100`. |
| Toast within one poll interval | same (`DEVIN_WORKSPACES_POLL_MS=500`) | `waitingCount` becomes 1 within 2 s of the fixture flipping `status_detail` to `waiting_for_user`; exactly one `notification-shown` event with `sessionId=sess-1`; repeated polls do not re-notify; `badge` event `count:1`, then `count:0` when the session resumes. |
| Toast click navigates | same | `clickNotification('sess-1')` → surface `cloud`, devinView URL `${tenant}/sessions/sess-1`, `currentSessionId === 'sess-1'`. |
| 401 handling | "surfaces 401 as authError…" | `authError: true`, `lastError: 'unauthorized'`, `poll-error kind=auth`; recovers to `false` when the API accepts again. |
| 429 backoff | same | With `Retry-After: 2`, the next request arrives ≥ 1.9 s after the 429; `poll-error kind=rateLimited retryAfterMs=2000`. |
| Clear stops polling | first test | After `clearPat()`, `secrets.json` is deleted and no API requests arrive for 3 poll intervals. |
| PR quick-open | "lists the current session PRs…" | `prs:list` matches the fixture's `pull_requests` for the current session (`acme/widgets#42 (open)`, `#43`), Rail button appears only then, empty for sessions without PRs. |
| Ctrl+N | same | `openNewSession()` → surface `cloud`, devinView at tenant root, `new-session` event. |
| Unit | `tests/unit/devinApi.test.ts`, `notifyModel.test.ts`, `settings.test.ts`, `sessions.test.ts` | Pagination (`first`/`after`, `end_cursor`), clamp to 200, 401/429/network/parse mapping, Retry-After parsing, status diff (first poll, transitions, waiting-kind switch, resume), poll interval, backoff, PNG header/IEND, PR titles, settings merge. |

OS toasts are suppressed under `DEVIN_WORKSPACES_TEST=1` (set `DEVIN_WORKSPACES_TEST_TOAST=1` to re-enable); the `notification-shown` log event is the evidence. Outside test mode `new Notification` is guarded by `Notification.isSupported()`.

## Manual real-tenant checklist (needs the user's PAT)

| Step | Expected | Result |
|---|---|---|
| Settings → paste PAT → Save | "Token stored (encrypted)"; within ~10 s "Last poll hh:mm:ss"; `secrets.json` has a base64 blob only | |
| Paste the CLI's Windsurf token instead | `/v3/self` may 401/403 → "Token rejected by the API" (row 2 of the institutional brief) | |
| Ask a running session a question that makes Devin wait | Windows toast within one poll interval (≤ 10 s active); taskbar overlay shows `1` | |
| Click the toast | App focused, Cloud surface, that session open | |
| Reply in the session | Overlay clears on the next poll | |
| Open a session with PRs | Rail "PR" button with count; click → native menu → PR opens in GitHub pane | |
| Ctrl+N from any view | Cloud surface at the tenant root (create surface) | |
| Clear token | Status "No token stored."; `secrets.json` gone; no more API traffic | |
| Grep `events.jsonl` for the token | No match | |

## API field assumptions (verified against `https://docs.devin.ai/v3-openapi.yaml`)

- List endpoint is `GET /v3/organizations/{org_id}/sessions`, **not** `/v3/sessions`; `org_id` resolved from `GET /v3/self` (`PatUserSelf.org_id` / `ServiceUserSelf.org_id`) or the `notifications.orgId` settings override.
- Query: `first` (default 100, max 200), `after` (cursor). Response: `{ items: SessionResponse[], end_cursor: string|null, has_next_page: boolean, total?: number }` (client also tolerates `sessions` / `next_cursor` aliases).
- `SessionResponse`: `session_id`, `title: string|null`, `status ∈ {new, claimed, running, exit, error, suspended, resuming}`, `status_detail ∈ {working, waiting_for_user, waiting_for_approval, finished, …}` (only on get/list), `updated_at: integer`, `url`, `pull_requests: [{ pr_url: string, pr_state: string|null }]`.
- Unverified: whether `/v3/self` returns a non-null `org_id` for every PAT (schema allows null) — hence the org override; and sort order (brief says newest first; the poller only reads the first page of 100).
