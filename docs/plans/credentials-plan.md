# Sign-in persistence & credentials — plan (cb:plan-review)

**Rounds Completed: 2 of 2** · Parent: `devin-desk-plan.md` (adds phase **P1.5**)

## Final Plan Summary
Make sign-in to Devin (Okta) and GitHub a non-event: (1) keep sessions alive as long as the servers allow and prove cookies survive restarts; (2) prefer **passkeys via Windows Hello** (WebAuthn works in Electron on Windows and shares the Windows passkey store with Chrome/Google Password Manager); (3) ship a small **app-owned credential vault** (DPAPI via `safeStorage`) with one-click fill into the focused login field for the cases where a password is still required. Google Password Manager's *passwords* cannot be used from a non-Chrome app; this is stated as a constraint, not worked around.

## Key Design Decisions
| Decision | Choice | Why | Rejected |
|---|---|---|---|
| Google Password Manager | Not integrable for passwords; **passkeys** shared via Windows Hello / Win11 passkey providers | GPM has no external API; Electron has no autofill layer (electron#54142) | Chrome extension loading (Electron: "non-goal", popup/content-script APIs missing); cookie copying from Chrome (forbidden in §4.2) |
| Primary path | WebAuthn passkeys (Okta FIDO2 factor, GitHub passkeys) | Works in Electron on Windows via Windows Hello (electron#24573); one Hello prompt, no typing | Hardware keys only |
| Fallback path | App vault: per-origin `{username,password}` encrypted with `safeStorage` (DPAPI, async API) in userData | Same protection class as Chrome's own password store on Windows (DPAPI) | Plaintext JSON; OS Credential Manager via native module (extra native dep for no gain over DPAPI) |
| Fill mechanism | `webContents.insertText()` into the **focused** field on an exact-origin allowlist, triggered by explicit click in the shell | Zero script injection into IdP/GitHub pages (keeps §4.2 "no code in remote views"); naturally handles Okta's multi-step username→password forms | `executeJavaScript` form-filling (script in third-party auth pages; brittle selectors) |
| Save flow | Manual entry in Settings → Credentials (origin, username, password) | No form observation in remote views needed | Chrome-style "offer to save" (requires injection on every page) |
| Session longevity | Measure Devin/Okta/GitHub cookie lifetimes; always tick "Keep me signed in"/"Remember me"; document the `prompt=login` finding | You can't fix what you haven't measured | Cookie TTL tampering |

## Complexity Accepted
- A credential store the app must protect (DPAPI-bound to the Windows user; readable by other apps in the same user session — same as Chrome).
- A two-click fill UX (click the field, click Fill) instead of inline autofill.

## Simplifications Made
- No browser-extension host, no form-detection heuristics, no TOTP generator, no cross-device sync of the vault.

## 1. Requirements
| ID | Requirement (user) |
|---|---|
| C1 | Credentials for Devin and GitHub are remembered; sign-in is not cumbersome |
| C2 | Cookies/sessions persist so the user doesn't log in each launch |
| C3 | Use Google Password Manager where possible; an app-specific manager is acceptable if required |

## 2. Decisive findings
- **F1** Electron ships Chromium's content layer, not Chrome's password manager: no autofill, no credential store, no extension-store support (docs: "non-goal"). ⇒ C3's first clause is infeasible for passwords; the app-specific option is required.
- **F2** WebAuthn/passkeys work on Windows in Electron through the Windows WebAuthn API (Windows Hello), which is the same store Chrome uses on Windows and which Windows 11 opens to third-party providers (incl. password managers). ⇒ passkeys are the shared-credential path.
- **F3** Our own event log (2026-10-01) shows the tenant's Okta authorize URL includes `prompt=login`: Devin forces a fresh Okta authentication on every redirect. Okta's "remember me" therefore does not prevent credential entry; only (a) Devin's own session staying valid or (b) passkey/Hello at Okta avoids typing.
- **F4** Partitions are already persistent and cookie encryption is fused on; P0 G3-real showed a GitHub tab surviving restart. What's unmeasured: the Devin session lifetime and GitHub's SAML re-auth cadence.

## 3. Phase P1.5 — Sign-in persistence & credentials
Inserted after P1 (daily-use blocker) and before P2.

### 3.1 Session persistence (C2)
- **Measure**: for each partition, dump cookie names/expiry (`session.cookies.get`) right after sign-in and after 24 h; record Devin app cookie(s), Okta `sid`/`DT`, GitHub `user_session`/`__Host-user_session_same_site`/`logged_in`. Note which are session-only vs persistent. Evidence in `docs/acceptance-p1.5.md`.
- **Keep-alive**: nothing to build if lifetimes are days; if Devin's cookie is short and refreshes on use, add a low-frequency background `devinView` liveness touch only if measurement shows it extends the session (otherwise skip).
- **Restart proof**: E2E (fixture) — set a persistent cookie in `persist:devin` and `persist:github`, quit, relaunch, assert cookie present. Real-tenant: close app → reopen next day → no sign-in prompt (acceptance row).
- **Verify fuse**: `EnableCookieEncryption` on in the packaged exe (already asserted in P1 dist) — cookies file is encrypted at rest.

### 3.2 Passkeys (C1, C3)
- **Gate G7 (spike, 1 session)**: in devinView navigate to Okta → security settings → enroll a FIDO2/passkey factor; sign out; sign in with it (Windows Hello prompt appears inside the app). Repeat on github.com (Settings → Passkeys). Record pass/fail per site and whether a passkey created in Chrome on this PC is offered in the app (Windows Hello store sharing). If a third-party passkey provider (Google Password Manager for Windows, 1Password) is installed, record whether it's offered.
- **App work**: none expected beyond permission handling — confirm `setPermissionRequestHandler` isn't asked for anything WebAuthn needs (it isn't in Chromium; verify in G7). If Okta's policy forbids passkey enrollment, record it and rely on 3.3.
- **Settings copy**: a short "Sign-in tips" block in Settings explaining passkeys + Hello.

### 3.3 Credential vault + fill (C1, C3 fallback)
- `core/credentials.ts` (pure): `CredentialEntry {origin, username, label?}`; `matchOrigin(url, entries)` — exact `https` origin match only; `okta` host and `github.com` seeded as suggested origins.
- `main/credentials.ts`: store at `userData/credentials.json` as `{origin, username, passwordEnc}` where `passwordEnc = await safeStorage.encryptStringAsync(pw)` (base64); refuse to store if `isAsyncEncryptionAvailable()` is false (show error, never plaintext). Decrypt only at fill time; never log, never send to shell.
- IPC (zod): `credentials:list → {origin,username}[]`, `credentials:save {origin,username,password}`, `credentials:delete {origin}`, `credentials:fill {target:'devin'|'tab', field:'username'|'password'}`. Fill handler: resolves the target `webContents`, checks `new URL(contents.getURL()).origin` is in the vault **and** `https:`, then `contents.insertText(value)`; optional `sendInputEvent` Enter via a separate "Fill + Enter" action. Logs `credential-fill {origin, field}` only.
- Shell: when the active Cloud view or active GitHub tab is on a saved origin, the rail shows a key button; clicking it opens a native `Menu.popup` (views paint over DOM) with "Fill username", "Fill password", "Fill password + Enter". Settings → Credentials: list, add (origin dropdown + custom, username, password), delete.
- Threat notes (documented in §4.2 addendum): DPAPI protects against other users, not other processes of the same user (same as Chrome). Fill goes only to the focused element of a top-level page on an exact saved origin; a phishing page on another origin never matches. The vault never leaves the machine.

### 3.4 Tests
- Unit: `matchOrigin` (exact origin, http rejected, subdomain rejected, port-sensitive), credential JSON round-trip with a stubbed encryptor.
- E2E (fixture): fake IdP page with username/password inputs on the fixture "github" origin; save creds via `__devinworkspaces.saveCredential`; focus the username field (`executeJavaScript` in test only), trigger `credentials:fill`, assert the field's value; assert no fill happens when the view is on a non-saved origin; assert events.jsonl never contains the password string; cookie-persistence-across-relaunch test (3.1).
- Manual: `docs/acceptance-p1.5.md` — G7 results, cookie lifetime table, next-day relaunch without sign-in, fill into real Okta and GitHub forms.

### 3.5 Exit criteria
- Cookie lifetime table filled; relaunch after ≥ 12 h shows no sign-in prompt for Devin and GitHub, or the reason is documented (server-enforced).
- G7 recorded; at least one of Okta/GitHub signs in via Hello in-app, or infeasibility documented with the IdP policy as evidence.
- Vault: save/fill/delete work on real Okta + GitHub login forms; password absent from logs, settings.json and renderer state (grep + review).

## 4. Validation lens (Round 1 → resolved in Round 2)
1. **[blocker→resolved] "Use Google Password Manager" is not achievable for passwords.** Resolved by F1/F2: plan states the constraint explicitly and delivers the two feasible equivalents (shared passkeys via Windows Hello; app vault). User's own brief allows an app-specific manager.
2. **[major→resolved] "Cookies stored" is already true; the real cause of re-login is unmeasured.** Resolved by 3.1 measurement + F3 (`prompt=login`). Acceptance requires a next-day relaunch test rather than assuming.
3. **[major→resolved] Passkey support in Electron is anecdotal.** Resolved by gate G7 with recorded evidence before relying on it; vault is the independent fallback.
4. **[minor] Vault security claims must be scoped.** Resolved: threat notes compare to Chrome's DPAPI store; no claim of protection against same-user malware.

## 5. Challenge lens (Round 1 → resolved in Round 2)
1. **[major→changed] `executeJavaScript` form-filling was proposed first.** Challenge: injects code into IdP pages, violates §4.2 spirit, brittle to Okta DOM changes. Changed to `insertText` into the focused field (no script, multi-step friendly) at the cost of one extra click.
2. **[major→accepted] Why not load the 1Password/Bitwarden extension?** Electron docs: arbitrary store extensions are a non-goal; browser-action popups and most `chrome.*` APIs are missing. Rejected with evidence.
3. **[minor→accepted] Is a vault over-engineering if passkeys work?** Okta/GitHub policies may block passkeys, and the Devin `prompt=login` means a password prompt is possible at every expiry. The vault is ~300 lines and is the only guaranteed path; kept, but G7 runs first so the vault's UX priority can be lowered if passkeys cover both.
4. **[minor→accepted] Manual save only — no "offer to save".** Keeps remote views script-free; credential set is two entries. Revisit only if users report friction.

## 6. Open items
- O7 Devin app session lifetime and whether Cognition can drop `prompt=login` for the tenant (ask Cognition support; would let Okta's own session carry sign-in).
- O8 Okta org policy on FIDO2/passkey enrollment for this tenant.
- O9 Whether Google Password Manager's Windows passkey provider is installed/available on the user's PC (determines how "shared" passkeys are in practice).

## Evidence Requirements
- `docs/acceptance-p1.5.md`: cookie table (two time points), G7 per-site results with screenshots of the Hello prompt inside the app, next-day relaunch result, vault fill screenshots, log grep showing no secrets.
- Unit + E2E green incl. relaunch cookie persistence and fill tests.

## Recommendation
**READY** for P1.5. Order: 3.1 measurement (start the 24 h clock immediately) → G7 passkey spike → 3.3 vault → acceptance. P2 follows.
