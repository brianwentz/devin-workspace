# P2 memory measurement (O6)

Generated 2026-10-01T14:54:58.878Z on win32 x64. Fixture page: /heavy/<n> (~2 MB DOM: 6000-row table).
Metric: sum of `workingSetSize` over `app.getAppMetrics()` (all Electron processes), sampled 4 s after every tab reports `did-stop-loading`.

| Tabs | Working set (MB) | Private (MB) | Processes | By process type |
|---|---|---|---|---|
| 0 | 474 | 238 | 5 | Browser: 1 (114 MB), GPU: 1 (135 MB), Utility: 1 (49 MB), Tab: 2 (175 MB) |
| 5 | 2285 | 1718 | 10 | Browser: 1 (121 MB), GPU: 1 (159 MB), Utility: 1 (51 MB), Tab: 7 (1954 MB) |
| 10 | 4159 | 3251 | 15 | Browser: 1 (127 MB), GPU: 1 (159 MB), Utility: 1 (51 MB), Tab: 12 (3823 MB) |
| 20 | 8046 | 6449 | 25 | Browser: 1 (138 MB), GPU: 1 (158 MB), Utility: 1 (52 MB), Tab: 22 (7698 MB) |

- Approx. marginal cost per heavy tab: 379 MB.
- Budget (plan §4.1 / O6): 20 tabs ≤ 2048 MB total working set.
- Result: **EXCEEDS budget** → State-safe discard enabled (TabManager.discardIdle: inactive tabs idle >= settings.discardIdleMinutes, default 30, are closed with webContents.close({waitForBeforeUnload:true}); beforeunload cancels; chrome kept; reload on activation).

Re-run with `npm run measure:tabs`.
