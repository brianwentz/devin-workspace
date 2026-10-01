# Acceptance — P1.5 Sign-in persistence & credentials

Run on the real tenant (`cloudbeds.devinenterprise.com`), second client = normal browser, same user.

## Cookie lifetime table (§3.1)

Read with: `jq 'select(.event=="cookie-audit")' events.jsonl` (events.jsonl lives in `DEVIN_WORKSPACES_USER_DATA` / userData dir). The `cookie-audit` event fires 10 s after window creation, every 60 min, and once at shutdown; `__devinworkspaces.auditCookies()` returns the same shape live.

| Partition | Cookie | Session? | Expires | Observed t0 | Observed t+24h |
|---|---|---|---|---|---|
| persist:devin | (fill) | | | | |
| persist:github | user_session / __Host-user_session_same_site / logged_in | | | | |
| (Okta via persist:devin) | sid / DT | | | | |

## G7 — Passkeys (Windows Hello)

| Site | Enroll passkey | Sign in with passkey | Chrome-created passkey offered? | Provider |
|---|---|---|---|---|
| Okta (tenant) | | | | |
| github.com | | | | |

## Next-day relaunch

| Row | Result |
|---|---|
| Close app → reopen ≥12 h later → no Devin/GitHub sign-in prompt | |

## Credential vault (§3.3)

| Row | Result |
|---|---|
| Fill username into real Okta username step | |
| Fill password (+Enter) into Okta password step | |
| Fill into GitHub login form | |
| `select-string 's3cret' events.jsonl` → no hits; credentials.json has no plaintext | |
| Fill denied (logged `credential-fill-denied`) on any non-saved origin | |

Notes: DPAPI protects against other OS users, not other processes of the same user (same as Chrome). Fill targets only the focused hosted view on an exact saved https origin.
