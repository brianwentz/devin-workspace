# Devin Workspaces — Round 3 Review

## Validation Mode
**Verdict: CONSENSUS**

1. **[resolved — R7]** GitHub and its subdomains, including `githubusercontent.com`, route in-app; external opening is removed for GitHub. Downloads stay app-owned and are covered in the routing matrix.
2. **[resolved — splitter]** Re-adding the existing `shellView` to its parent makes it topmost; `WebContentsView` inherits `View`, whose background color accepts alpha. G4 tests drag/release/cancel over both hosted views at three DPI scales. Keep the shell page itself transparent outside controls during the raised overlay. [Electron View](https://www.electronjs.org/docs/latest/api/view); [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view).
3. **[resolved — memory]** No eviction is enabled by default; P2 measures 5/10/20 tabs before state-safe discard. `webContents.close({ waitForBeforeUnload: true })` exists; if `beforeunload` prevents closure, the contents remain open and `will-prevent-unload` fires. [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents#contentscloseopts).
4. **[resolved — auth/ACP/routing]** UA spoofing and cookie copying are gone; supported embedded IdP auth is a P0 gate with stop-and-redecide if unavailable. ACP v1 paths are explicit and fixture-asserted. `will-redirect` exists; the plan keeps redirect/SSO chains in their originating view and includes them in the routing matrix. [Electron webContents navigation events](https://www.electronjs.org/docs/latest/api/web-contents#event-will-redirect).
5. **[verified — downloads]** `session` emits `will-download`; absent `setSavePath`, Electron’s usual default routine prompts for a save location, and `setSaveDialogOptions` can configure it. `DownloadItem` also exposes progress events. This supports the proposed app-owned save dialog/progress flow. [Electron session](https://www.electronjs.org/docs/latest/api/session#event-will-download); [DownloadItem](https://www.electronjs.org/docs/latest/api/download-item).

**READY:** No remaining design blocker found. P0 auth/splitter/routing gates and P2 memory evidence remain go/no-go implementation checks, not claims that the app already works.

## Challenge Mode
**Verdict: CONSENSUS**

1. **[resolved — browser scope]** The plan removes address bar, copy-URL, and external-open controls; it keeps required tab controls and justified back/forward/reload. GitHub downloads remain browser-session initiated and app-owned.
2. **[resolved — splitter alternative]** The z-order mechanism is supported by Electron’s `View` API and has a focused G4 test. If the overlay drag fails, fixed-width presets plus keyboard resize preserve the layout requirement without relying on an unproven pointer-release path.
3. **[resolved — state/auth risks]** Replacing fixed N=8 eviction with measurement-first, cancelable discard addresses silent draft loss. The auth plan does not evade IdP policy; if approved embedded sign-in fails, stop and re-decide rather than weakening security.
4. **[resolved — portability]** P7 evaluates Local as remote control of desktop Local and leaves mobile pending; a Cloud-only mobile shell is explicitly not treated as satisfying R6.
5. **[minor verification note]** `View.setBackgroundColor` supports alpha, but the shell renderer’s own CSS must also leave uncovered regions transparent while raised; retain this in G4’s visual check. The fallback above is simpler if that composition proves brittle. [Electron View](https://www.electronjs.org/docs/latest/api/view).
