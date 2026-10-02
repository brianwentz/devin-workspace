# Devin Workspaces

A desktop client for [Devin](https://devin.ai) — Windows and macOS (Apple Silicon) — that keeps your Devin sessions, the GitHub pages they produce, and a local terminal in one window.

The Cloud surface is the real Devin web app (your tenant) hosted in a Chromium view, so sessions, folders, worklogs and approvals behave exactly as they do in the browser. Around it the app adds what the web app can't do on its own:

- **GitHub pane** — every GitHub link a session produces (PR cards, worklog links, `_blank` popups, iframes) opens in a tabbed pane docked to the right instead of a separate browser. Tabs are scoped to the session you're viewing, persist across restarts, and can be reordered, closed and resized.
- **PR auto-open** — when a session creates a pull request, a tab for it appears in that session's pane automatically.
- **Notifications** — an in-app notification center (plus a taskbar badge on Windows) when a session is waiting for your input or approval.
- **Terminal dock** — a tabbed shell (your Windows Terminal default profile or PowerShell on Windows, your login shell on macOS) under the Devin view, with per-workspace working directories.
- **Devin Local** — run the `devin` CLI against local workspace folders from the same window (requires the Devin CLI).
- **Credential fill** — saved logins for SSO/IdP origins, encrypted with the OS credential store (DPAPI on Windows, Keychain on macOS), fillable from the rail.
- **Layout memory** — the pane split, terminal height, and window size/position (per display configuration) are remembered without any settings to manage.

## Install

Builds for both platforms are on the [GitHub Releases](../../releases) page. The Devin CLI is only needed for the Local surface and the terminal's `devin` tab.

### Windows (10/11 x64)

Download `DevinWorkspaces-Setup-<version>.exe` and run it. It is a per-user install (no admin rights) and updates itself from subsequent releases.

The installer is currently unsigned, so Windows SmartScreen will warn on first run — choose *More info → Run anyway*.

### macOS (Apple Silicon)

Download `DevinWorkspaces-<version>-arm64.dmg`, open it and drag **Devin Workspaces** into *Applications*.

The Mac build is ad-hoc signed and not notarized, so the first launch is a little odd — macOS refuses to open it until you allow it explicitly:

1. Double-click **Devin Workspaces** in *Applications*. macOS shows *"Devin Workspaces" Not Opened — Apple could not verify "Devin Workspaces" is free of malware…* Click **Done** (not *Move to Trash*).
2. Open **System Settings → Privacy & Security** and scroll down to the **Security** section. A line reads *"Devin Workspaces" was blocked to protect your Mac* — click **Open Anyway** next to it and authenticate with your password or Touch ID.
3. Double-click the app again and click **Open Anyway** in the final confirmation dialog.

This is only needed once; subsequent launches open normally. If you'd rather skip the dialogs, clear the quarantine flag from a terminal instead:

```
xattr -d com.apple.quarantine "/Applications/Devin Workspaces.app"
```

If you see *"Devin Workspaces" is damaged and can't be opened* rather than the dialog above, you have a build from before v0.1.4 — download the current release.

Because the build is not notarized, the Mac app does not auto-update: check the Releases page for new versions and install them over the existing app the same way (the first-launch steps above are needed again after each update).

## First run

1. The window opens on the **Cloud** surface (☁ in the left rail) pointing at the default tenant. If you use a different Devin tenant, open **Settings** (⚙) and change *Tenant URL*, then sign in as you normally would — SSO flows run inside the hosted view, nothing is intercepted.
2. Click any GitHub link in a session; it opens in the pane on the right. Toggle the pane with the **GH** rail button or `Ctrl+Shift+G`, drag the splitter to resize.
3. Toggle the terminal dock with the **>_** rail button or `` Ctrl+` ``; use **+** in the dock to open a shell in a workspace folder or your home directory. On Windows the shell is your Windows Terminal default profile when available (WSL distros included); the **▾** menu lists other launchable profiles. On macOS it is your login shell (`$SHELL`, normally `zsh`).

## Notifications and PR auto-open

Both features poll the Devin API, so they need an API token:

1. In the Devin web app go to **Settings → API Keys** and create a personal access token (a service-user token also works). The app only calls `GET /v3/self` and `GET /v3/organizations/{org}/sessions`.
2. In Devin Workspaces open **Settings → Notifications**, paste the token into the token field and click **Save**. The token is encrypted with the OS credential store (DPAPI on Windows, Keychain on macOS) and stored in `secrets.json` in the app's data folder (see [Where things live](#where-things-live)); it is never written to `settings.json`, the log, or shown in the UI again.
3. Leave *Organization ID* blank — it is resolved from `/v3/self`. Only fill it in if the status line reports that no organization could be determined for your token.
4. *API base* stays `https://api.devin.ai` unless your enterprise tenant uses a different API host.

Once a token is set the poller runs continuously (10 s while a session is active, 60 s when idle). Three things hang off it:

- **Notification center** — the bell in the rail. New events (a session waiting for your reply, needing approval or blocked; a PR opened or merged/closed; a downloaded app update) land in the panel with unread highlighting, a taskbar overlay count (Windows) and an optional title-bar banner. Clicking an entry opens its session (or the PR tab, or installs the update). *Collect notifications*, *Show banner* and the per-kind toggles live in Settings → Notifications; "Session finished" is off by default. History persists across restarts (last 50).
- **Open a tab when a session creates a PR** — a background tab for the PR opens in that session's pane within one poll interval. PRs that already existed when the token was saved are not opened, and closing an auto-opened tab does not bring it back.
- **PR quick-open** — the `PR` rail button lists open pull requests across your sessions with their GitHub titles; clicking one switches to that session and opens the PR in its pane.

The poller only lists sessions created by the token's user (`GET /v3/self` → `user_ids` filter). A service-user token has no user identity, so it shows no sessions, notifications or pull requests — use a personal API token.

## Devin Local

1. Install the Devin CLI and make sure `devin` is on your `PATH`. If it isn't, the Local surface shows install guidance; you can also point at a specific binary with `"local": { "devinPath": "C:\\path\\to\\devin.exe" }` (or `"/path/to/devin"` on macOS) in `settings.json`.
2. Switch to the **Local** surface (⌘ in the rail), click **+ Add** and pick a workspace folder.
3. Start a session; prompts, tool calls, plans and permission requests appear in the chat panel. The **Terminal** tab in the same panel runs the interactive `devin` CLI in that workspace. Type `/handoff` in a local session to move it to Devin Cloud.

## Settings reference

| Setting | Where | Notes |
|---|---|---|
| Tenant URL / API base | Settings | Must be `https` |
| Workspaces | Settings → Workspaces | Folders for Devin Local and terminal working directories |
| Tabs | Settings → Keep-alive / Max live tabs | The session you're viewing keeps its tabs loaded; hidden sessions' tabs are discarded after the keep-alive window and the live cap only ever applies to them |
| Open non-GitHub links in system browser | Settings | GitHub links always stay in the pane |
| Keep hidden tabs live for (hours) / Max live tabs | Settings | Memory controls for GitHub tabs of sessions you're not viewing |
| Show terminal dock on Local and Settings too | Settings | Dock is Cloud-only by default |
| Shell command | Settings | Blank = Windows Terminal default profile (else PowerShell) on Windows, `$SHELL` on macOS; e.g. `wsl.exe -d Ubuntu` or `/bin/zsh -l` |
| Notifications / PR auto-open / token / org id | Settings → Notifications | See above |
| Passwords | Settings → Passwords | Origin + username + password, encrypted with DPAPI (Windows) / Keychain (macOS); autofill fills a single match on load, offers an account picker when several match, and asks to save/update after a sign-in; rows support show/copy/edit/delete |

Pane width, terminal height, window placement and the open tab list are saved automatically.

## Keyboard shortcuts

On macOS, `Cmd` works everywhere `Ctrl` is listed (`Ctrl` works too).

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

`%APPDATA%\devin-workspaces\` on Windows, `~/Library/Application Support/devin-workspaces/` on macOS — `settings.json` (plain settings and layout), `secrets.json` (API token, encrypted), `credentials.json` (saved logins, encrypted), `notifications.json` (notification history), `events.jsonl` (the event log), and the two browser profiles (`persist:devin`, `persist:github`). Uninstalling removes the app; delete this folder to remove all data.

The event log records URLs, ids and sizes only — never page content, terminal output, or secrets. It is the first place to look if notifications or PR tabs don't appear (`poll`, `poll-error`, `notification-added`, `notification-open`, `pr-auto-open` events).

## Development

```
npm ci
npm run typecheck      # tsc
npm run test:unit      # vitest (pure core logic)
npm run test:e2e       # build + Playwright against local fixture servers
npm start              # build + run
npm run dist:win       # NSIS installer -> dist/
npm run dist:mac       # arm64 dmg + zip (ad-hoc signed) -> dist/, macOS only
npm run smoke:install  # install, smoke-test, upgrade, uninstall the built installer
```

Node ≥ 22.12 is required. See `AGENTS.md` for architecture notes, environment variables and project conventions.
