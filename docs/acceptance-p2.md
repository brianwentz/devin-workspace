# P2 acceptance — GitHub pane (R7–R9)

Exit criterion (plan §5-P2): router unit table + E2E routing matrix + tab behaviours + persistence + cleanup pass. Branch `p2-github-pane`.

| Field | Value |
|---|---|
| Build | `git rev-parse --short HEAD`: |
| Electron | 44.4.5 (Playwright 1.63.0, `_electron`) |
| Automated run | `npm run typecheck && npm run test:unit && npm run build && npm run test:e2e` |
| Display scale(s) tested (manual) | 100% / 150% / 200% |
| Date / tester | |

## How to read this
"Automated" rows name the exact test that proves the row; run the command above and the row passes when the suite is green. "Manual" rows are left for the user on the real tenant / real GitHub (SAML org) at three DPI scales.

Fixture hosts (tests/fixtures/http.ts): `devinUrl` = fake tenant, `githubUrl` = fake github.com (127.0.0.1), `githubAltUrl` = second GitHub-class origin standing in for `*.githubusercontent.com` (localhost), `idpUrl` = external IdP. Both GitHub-class origins are passed via `DEVIN_WORKSPACES_TEST_GITHUB_ORIGINS`.

## R7 — Every github.com link opens in the in-app hosted browser, never an external browser

### Unit (vitest, `tests/unit/linkRouter.test.ts`, 177 cases)
| Check | Evidence |
|---|---|
| Host classes: `github.com`, `*.github.com` (www, gist), `githubusercontent.com`, `*.githubusercontent.com` (raw, objects, user-images), http and https, uppercase host, trailing-dot host, fixture origins | `routeUrl (host class)` |
| Look-alike hosts (`evil-github.com`, `github.com.evil.com`, `githubusercontent.com.evil.com`, tenant suffix spoof, unknown fixture port) are external | `does not confuse %s with an allowed host` |
| Full decision table: every host class (github ×7 URLs, tenant, external ×2, mailto, javascript:, data:) × source (devin, github, local, shell) × disposition (new-window, navigate, background) = 156 rows | `route (host class x source x disposition)` |
| Rules spelled out: new-window → gh-tab from any source; background → `{gh-tab, background:true}`; devin navigate → gh-tab; github navigate → in-place (SSO never split); devin navigate to IdP → in-place; tenant popup → devin; other popup → external; mailto → external; javascript/data/invalid → deny | `spells out the key rules` |

### E2E routing matrix (`tests/e2e/routing-matrix.spec.ts`, 5 tests; plus `tests/e2e/routing.spec.ts`)
Each matrix test ends by asserting **zero `external`/`mailto` decisions for GitHub-class URLs** and **zero `BrowserWindow`s** (`finish()` → `githubExternalEvents`, `browserWindowCount`).

| Source | Disposition | Host class | Expected | Test |
|---|---|---|---|---|
| devin page | `_blank` anchor | github | foreground gh tab, devin URL unchanged | matrix `devin page…` (`#blank`); routing.spec |
| devin page | `window.open` | github | gh tab | routing.spec (`#windowOpen`) |
| devin page | ctrl-click (real input) | github | background gh tab, active unchanged, decision `github-tab-background` | matrix `devin page…` (`#ctrlTarget`) |
| devin page | middle-click (real input) | github | background gh tab | matrix `devin page…` (`#sameTab` middle) |
| devin page | top-level link nav | github | `will-navigate` cancelled → gh tab | routing.spec (`#sameTab`) |
| devin page | top-level link nav | githubusercontent-like | gh tab on second origin, devin unchanged | matrix `devin page…` (`#altSameTab`) |
| devin page | `_blank` | githubusercontent-like | gh tab | matrix (`#altBlank`) |
| devin page | iframe link (same frame) | github | subframe navigates in place (`allow-subframe`) | routing.spec (`#iframeNormal`) |
| devin page | iframe `_top` | github / githubusercontent-like | gh tab, devin unchanged | routing.spec (`#iframeTop`); matrix (`#iframeAltTop`) |
| devin page | iframe `_blank` | github | gh tab | matrix (`#iframeBlank`) |
| devin page | same-tab link to a redirecting GitHub URL | github → github | gh tab opened at `/redirect`, 302 followed inside the tab (`will-redirect allow`) | matrix (`#ghRedirect`, `#ghRedirectBlank`) |
| devin page | SSO hop tenant → IdP → tenant | tenant/external | stays in devinView, no tab, no external | matrix (`#devinSso`) |
| devin page | same-tab link | external | stays in devinView (IdP-style hop), never external-open | matrix (`#externalSameTab`) |
| devin page | `_blank` / `window.open` | tenant | devinView navigates, `currentSessionId` updates, no tab | matrix (`#tenantBlank`) |
| devin page | `_blank` | external | `external-open` decision (stubbed, `DEVIN_WORKSPACES_ALLOW_EXTERNAL=0`), no tab | routing.spec (`#external`) |
| devin page | `_blank` / same-tab | mailto | `mailto` decision, no tab, devin unchanged | routing.spec (`#mailto`); matrix (`#mailtoSameTab`) |
| devin page | `window.open` | javascript:, data: | `deny` | routing.spec |
| gh tab | `_blank` anchor | github | gh tab | routing.spec (`#popup`) |
| gh tab | ctrl-click (real input) | github | background tab, source tab stays active | matrix `gh tab…` (`#next` ctrl) |
| gh tab | `window.open` | github | gh tab | matrix (`#windowOpen`) |
| gh tab | `_blank` | githubusercontent-like | gh tab | matrix (`#altPopup`) |
| gh tab | same-tab link | github / githubusercontent-like | in place (`allow-in-view`), tab URL changes origin | matrix (`#altNext`) |
| gh tab | server redirect to other GitHub origin | github ↔ alt | in place | matrix (`#redirectAlt`) |
| gh tab | SAML-style chain github → IdP → github | github/external | single tab, ends on `/page/sso-complete` | matrix (`/sso`); routing.spec |
| gh tab | same-tab link | external | in place (never split) | matrix (`#externalNext`) |
| gh tab | iframe `_blank` / in-frame / `_top` | github / alt | tab / in place / tab navigates in place | matrix (`/page/with-frame` → `#frameBlank`, `#frameNormal`, `#topAlt`) |
| gh tab | `_blank` | tenant | devinView navigates, no tab | matrix (`#tenantPopup`) |
| gh tab | `_blank` | external | `external` decision, no tab | matrix (`#externalPopup`) |
| gh tab | link | mailto | `mailto` decision, tab unchanged | matrix (`#mailto`) |
| gh tab | download (both origins) | github / alt | `will-download` → app handler, file saved (`download-done completed`) | routing.spec (`#download`); matrix (`/page/download-alt`) |
| shell (`__devinworkspaces.routeLink`) | link | github / alt / tenant / external / mailto / javascript / data | gh tab / gh tab / devin / external / mailto / deny / deny | matrix `shell link source…` |
| any | — | — | tabs carry `originSessionId` = current `/sessions/<id>`; none when no session | matrix `shell link source…` |
| any | PR URLs | github | `owner/repo/pull/N` deduped across `/files`, `/commits`, `/checks`, query, hash (focus + navigate; background keeps focus); other PRs/repos/issues not deduped; exact URL focuses | matrix `dedupes owner/repo/pull/N…`; unit `tests/unit/tabModel.test.ts` |
| any | — | — | no `BrowserWindow` ever created | every matrix test; routing.spec |

### Manual (real tenant + GitHub SAML org)
| Check | Result | Evidence |
|---|---|---|
| PR card / worklog GitHub link from a real session → opens in pane | | `events.jsonl` `window-open`/`will-navigate decision=github-tab` |
| GitHub SAML sign-in completes inside one gh tab (P0 G2) | | |
| Real `raw.githubusercontent.com` / `gist.github.com` link → pane | | |
| Download from real GitHub → native save dialog (no `DEVIN_WORKSPACES_DOWNLOAD_DIR`) | | |

## R8 — Reuse browser hosting; host Chromium, don't build a browser
| Check | Evidence |
|---|---|
| Only `WebContentsView` per tab (`src/main/tabs.ts`), `persist:github` partition, no preload, sandbox + contextIsolation | code review: `TabManager.ensureView` |
| No address bar / bookmarks / history UI; strip = title, favicon, spinner, ×, drag handle; nav bar = back/forward/reload + width presets | code review: `src/shell/components/TabStrip.tsx`, `NavBar.tsx` |
| dnd-kit (`@dnd-kit/core 6.3.1`, `@dnd-kit/sortable 10.0.0`, `@dnd-kit/utilities 3.2.2`) for reorder only | package.json |

## R9 — Pane docked right; titles; close; reorder; resize/collapse; persist

### Automated
| Check | Test |
|---|---|
| Titles and favicons update from `page-title-updated` / `page-favicon-updated` | routing.spec (title `blank`, favicon `data:image/svg+xml`); tabstrip.spec (`toHaveText`) |
| Close via × (right neighbour becomes active, else left), middle-click close, `Delete` key close | routing.spec; tabstrip.spec `pointer and keyboard reorder…`; unit `closeTab` |
| Reorder by real pointer drag (dnd-kit PointerSensor, 5 px activation) both directions; tiny move is a click | tabstrip.spec; routing.spec (adjacent drag in an overflowing strip) |
| Reorder by keyboard (handle: Space, ←/→, Space; Escape cancels) | tabstrip.spec |
| Enter/Space on a tab activates it | tabstrip.spec |
| Overflow: strip scrolls, scrollbar hidden (tabs fill 36 px), active tab scrolled into view on activation, wheel scrolls horizontally, middle-click works on an overflowing (scrollable) strip | tabstrip.spec `overflowing strip…` |
| Background opens (ctrl/middle-click) do not steal focus | matrix; unit `openTab` |
| Pane open/width/collapse persist; auto-collapse below min devin width | shell.spec; routing.spec (`paneWidth 500` after restart) |
| Tabs (order, active id, URLs, `originSessionId`) restored after restart; restored tabs created lazily on activation | matrix `restart restores tabs…`; routing.spec |
| Window close leaves no orphan webContents (`window-close-complete webContentsCountAfter = 0`) | matrix `restart restores…`; routing.spec |
| beforeunload on tab close: Stay keeps the tab, Close destroys it | routing.spec (`/beforeunload`) |
| **O6 discard**: idle inactive tabs discarded after threshold (test: 1.5 s via `DEVIN_WORKSPACES_TEST_DISCARD_MS`), title/favicon/url/order kept, dimmed in strip, reload on activation, active tab never discarded, `beforeunload` page cancels discard silently (no prompt), threshold setting `discardIdleMinutes` (0 = off) applied live and persisted, schema rejects out-of-range | discard.spec (2 tests) |

### Manual (3 DPI scales: 100 / 150 / 200 %)
| Check | 100% | 150% | 200% | Evidence |
|---|---|---|---|---|
| Pane sits right of the conversation; strip 36 px, nav bar 32 px, no overlap with hosted views | | | | screenshot |
| Drag-reorder with the mouse feels right (tab follows pointer, drops where released) | | | | |
| Splitter drag + Escape cancel still work with tabs open (P0 G4 regression) | | | | |
| Hidden scrollbar: wheel over the strip scrolls tabs; active tab always visible | | | | |
| Discarded tab appears dimmed and reloads on click after 30 min idle (or set the setting to 1 min) | | | | |

## O6 — Memory measurement and decision
See `docs/evidence/p2-memory.md` / `p2-memory.json` (`npm run measure:tabs`). 20 tabs of the ~2 MB `/heavy` fixture page = **~8.0 GB** total working set (baseline 474 MB; 5 tabs 2.3 GB; 10 tabs 4.2 GB; ~380–400 MB per renderer) on Windows x64, far above the 2 GB budget → **state-safe discard implemented** (TabManager `discard()` / `discardIdle()`, default idle 30 min, `webContents.close({ waitForBeforeUnload: true })`, `will-prevent-unload` cancels silently, tab chrome preserved, reload on activation). The measurement is of fully loaded tabs; discard reduces steady-state use for tabs left idle but does not change the cost of 20 freshly opened tabs.

## Test summary (automated run 2026-10-01, Windows x64, log `docs/evidence/p2-verify.log`)
| Suite | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run test:unit` (linkRouter 177, tabModel 27, layout 7, sessions 7, settings 8) | 226 passed |
| `npm run test:e2e` (routing 1, routing-matrix 5, tabstrip 2, discard 2, shell 4) | 14 passed (53 s) |
| `tasklist \| findstr electron` after the run | 0 processes |
