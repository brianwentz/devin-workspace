# Devin Workspaces

A Windows desktop client for [Devin](https://devin.ai) that keeps your Devin sessions, the GitHub pages they produce, and a local terminal in one window.

The Cloud surface is the real Devin web app (your tenant) hosted in a Chromium view, so sessions, folders, worklogs and approvals behave exactly as they do in the browser. Around it the app adds what the web app can't do on its own:

- **GitHub pane** — every GitHub link a session produces (PR cards, worklog links, `_blank` popups, iframes) opens in a tabbed pane docked to the right instead of a separate browser. Tabs are scoped to the session you're viewing, persist across restarts, and can be reordered, closed and resized.
- **PR auto-open** — when a session creates a pull request, a tab for it appears in that session's pane automatically.
- **Notifications** — Windows toast + taskbar badge when a session is waiting for your input or approval.
- **Terminal dock** — a tabbed shell (PowerShell by default) under the Devin view, with per-workspace working directories.
- **Devin Local** — run the `devin` CLI against local workspace folders from the same window (requires the Devin CLI).
- **Credential fill** — saved logins for SSO/IdP origins, encrypted with Windows DPAPI, fillable from the rail.
- **Layout memory** — the pane split, terminal height, and window size/position (per display configuration) are remembered without any settings to manage.

## Install

Download `DevinWorkspaces-Setup-<version>.exe` from the [GitHub Releases](../../releases) page and run it. It is a per-user install (no admin rights) and updates itself from subsequent releases.

The installer is currently unsigned, so Windows SmartScreen will warn on first run — choose *More info → Run anyway*.

Requirements: Windows 10/11 x64. The Devin CLI is only needed for the Local surface and the terminal's `devin` tab.

## First run

1. The window opens on the **Cloud** surface (☁ in the left rail) pointing at the default tenant. If you use a different Devin tenant, open **Settings** (⚙) and change *Tenant URL*, then sign in as you normally would — SSO flows run inside the hosted view, nothing is intercepted.
2. Click any GitHub link in a session; it opens in the pane on the right. Toggle the pane with the **GH** rail button or `Ctrl+Shift+G`, drag the splitter to resize.
3. Toggle the terminal dock with the **>_** rail button or `` Ctrl+` ``; use **+** in the dock to open a shell in a workspace folder or your home directory.

## Notifications and PR auto-open

Both features poll the Devin API, so they need an API token:

1. In the Devin web app go to **Settings → API Keys** and create a personal access token (a service-user token also works). The app only calls `GET /v3/self` and `GET /v3/organizations/{org}/sessions`.
2. In Devin Workspaces open **Settings → Notifications**, paste the token into the token field and click **Save**. The token is encrypted with Windows DPAPI and stored in `%APPDATA%\devin-workspaces\secrets.json`; it is never written to `settings.json`, the log, or shown in the UI again.
3. Leave *Organization ID* blank — it is resolved from `/v3/self`. Only fill it in if the status line reports that no organization could be determined for your token.
4. *API base* stays `https://api.devin.ai` unless your enterprise tenant uses a different API host.

Two checkboxes control what the poller does; both are on by default and polling runs while either is enabled:

- **Notify me when a session is waiting for me** — toast and badge on `waiting_for_user` / `waiting_for_approval` / `blocked`. *Test notification* sends a sample toast.
- **Open a tab when a session creates a PR** — a background tab for the PR opens in that session's pane within one poll interval (10 s while a session is active, 60 s when idle). It loads when you click it. PRs that already existed when the token was saved are not opened, and closing an auto-opened tab does not bring it back.

## Devin Local

1. Install the Devin CLI and make sure `devin` is on your `PATH`. If it isn't, the Local surface shows install guidance; you can also point at a specific binary with `"local": { "devinPath": "C:\\path\\to\\devin.exe" }` in `settings.json`.
2. Switch to the **Local** surface (⌘ in the rail), click **+ Add** and pick a workspace folder.
3. Start a session; prompts, tool calls, plans and permission requests appear in the chat panel. The **Terminal** tab in the same panel runs the interactive `devin` CLI in that workspace. Type `/handoff` in a local session to move it to Devin Cloud.

## Settings reference

| Setting | Where | Notes |
|---|---|---|
| Tenant URL / API base | Settings | Must be `https` |
| Workspaces | Settings → Workspaces | Folders for Devin Local and terminal working directories |
| Open non-GitHub links in system browser | Settings | GitHub links always stay in the pane |
| Keep hidden tabs live for (hours) / Max live tabs | Settings | Memory controls for GitHub tabs of sessions you're not viewing |
| Show terminal dock on Local and Settings too | Settings | Dock is Cloud-only by default |
| Notifications / PR auto-open / token / org id | Settings → Notifications | See above |
| Credentials | Settings → Credentials | Origin + username + password, DPAPI-encrypted; fill via the 🔑 rail button |

Pane width, terminal height, window placement and the open tab list are saved automatically.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Shift+G` | Toggle GitHub pane |
| `Ctrl+Shift+[` / `]` | Shrink / grow the pane |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous GitHub tab |
| `Ctrl+W` | Close the active GitHub tab |
| `Alt+←` / `Alt+→`, `Ctrl+R` / `F5` | Back / forward / reload in the focused view |
| `Ctrl+N` | New Devin session |
| `` Ctrl+` `` | Toggle terminal dock |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom the focused view |

## Where things live

`%APPDATA%\devin-workspaces\` — `settings.json` (plain settings and layout), `secrets.json` (API token, encrypted), `credentials.json` (saved logins, encrypted), `events.jsonl` (the event log), and the two browser profiles (`persist:devin`, `persist:github`). Uninstalling removes the app; delete this folder to remove all data.

The event log records URLs, ids and sizes only — never page content, terminal output, or secrets. It is the first place to look if notifications or PR tabs don't appear (`poll`, `poll-error`, `pr-auto-open` events).

## Development

```
npm ci
npm run typecheck      # tsc
npm run test:unit      # vitest (pure core logic)
npm run test:e2e       # build + Playwright against local fixture servers
npm start              # build + run
npm run dist:win       # NSIS installer -> dist/
npm run smoke:install  # install, smoke-test, upgrade, uninstall the built installer
```

Node ≥ 22.12 is required. See `AGENTS.md` for architecture notes, environment variables and project conventions.
