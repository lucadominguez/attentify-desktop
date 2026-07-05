---
title: Attentify — Cloud & Auth
tags: [attentify, backend, auth, billing, cloudflare]
updated: 2026-07-03
---

# Attentify — Cloud, Auth & Billing

> [!summary] Stack
> **Cloudflare Worker** + **D1** (SQLite at the edge) + **R2** (installer downloads) + **Stripe** (subscriptions).
> One Worker at `api.attentify.ai` (dev alias `attentify-cloud.ludomi2502.workers.dev`) fronts everything.
> Source: `Browser-Daemon/backend/` — router in `src/index.js`, data layer in `src/store.js`.

Companion to [[Attentify AI System]].

---

## Two credentials, one user

A user is authenticated by **either** of two Bearer tokens — both resolve to the same account:

| Credential | Prefix | Who holds it | How it's issued |
|---|---|---|---|
| **License key** | `pd_live_…` | the **desktop app** / extension | Stripe checkout or admin grant |
| **Session token** | `ses_…` | the **website** (localStorage) | email + password sign-in |

`authUser()` in `index.js` checks the prefix and looks up the right table. **This is why the same protected endpoints work from the app and the website.**

```
Authorization: Bearer <token>
        │
        ├─ starts with "ses_"  → sessions table → user
        └─ otherwise           → users.license_key → user
```

---

## Auth endpoints (added for website sign-in)

| Method + path | Purpose |
|---|---|
| `POST /v1/auth/signup` | email+password → creates free user, returns `{token, user}` |
| `POST /v1/auth/login` | email+password → returns `{token, user}` |
| `GET  /v1/auth/session` | validate current session token → `{user}` (website restores login) |
| `POST /v1/auth/logout` | invalidate this session token |
| `POST /v1/auth/set-password` | authed (license **or** session) → set/replace password |

### Password security
- **PBKDF2-SHA256, 100 000 iterations**, 16-byte random salt (Web Crypto, no deps) — `util.js` → `hashPassword` / `verifyPassword`.
- Salt + hash stored as hex in `users.password_hash` / `users.password_salt`.
- Login runs a verify **even when the user doesn't exist** to keep timing uniform (no user-enumeration via response time).

### Sessions
- Token = `ses_` + 48 hex chars. TTL **30 days** (`SESSION_TTL_MS`).
- Stored in the `sessions` table; expiry checked on every lookup.
- Logout deletes the row; `deleteSessionsForUser()` exists for "sign out everywhere".

> [!info] Why not JWT?
> D1 lookups are edge-fast and give us **instant revocation** (delete the row). Stateless JWTs can't be revoked without a blocklist, which defeats the point.

---

## Billing (Stripe) — unchanged, still works

```
website "Upgrade" ─► POST /v1/billing/checkout ─► Stripe Checkout
                                                      │ pays
                                                      ▼
                          Stripe webhook: checkout.session.completed
                                                      │
                                                      ▼
                        createUser(tier:'cloud')  OR  updateUser(tier:'cloud')
                                                      │ issues pd_live_… key
success.html polls /v1/billing/session ◄──────────────┘
   → shows key + "set a website password" → logs into dashboard
```

- `customer.subscription.updated/deleted` webhooks flip `tier`/`status` (active ↔ canceled/past_due).
- Webhook idempotency via `processed_events` table (`seenEvent`/`markEvent`).
- Manage/cancel → `POST /v1/billing/portal` → Stripe billing portal.

---

## Tiers (`util.js` → `TIERS`)

| Capability | Free | Cloud ($5/mo) |
|---|---|---|
| AI calls / month | 60 | 60 000 |
| Managed auto-block rules | ✗ | ✓ |
| Analytics sync + web dashboard | ✗ | ✓ |

Quota rolls monthly (`quotaState` — resets when `now - ai_period_start > 30d`).

---

## The website dashboard data pipeline

This is the "same dashboard on the website" feature:

```
Desktop app (Cloud user)
   │  cloudSync.ts buffers block/distraction events
   ▼
POST /v1/analytics   (Bearer pd_live_…)   ← every 3 min
   │  stored in D1 `events` table
   ▼
GET /v1/analytics/summary?days=30  (Bearer ses_…)  ← website dashboard.html
   │  totals by type · top domains · by-day counts
   ▼
Rendered as focal stat + stat pills + activity bars
```

> [!warning] No app running = empty web dashboard
> The website can only show what the desktop app has synced. A brand-new Cloud user with the app not yet installed will see the "keep tracking / upgrade" empty state — by design.

---

## Website pages

| File | Role |
|---|---|
| `auth.html` | sign in / sign up (toggles mode); stores `ses_…` in localStorage → dashboard |
| `dashboard.html` | signed-in view: plan, AI usage meter, synced focus insights, billing CTA |
| `success.html` | post-Stripe: shows license key + "set a web password" → dashboard |
| `account.html` | legacy license-key lookup (still works); links to `auth.html` |
| `index.html` nav | "Sign in" button → becomes "Dashboard" when a session exists |

---

## Deploying changes

```bash
cd Browser-Daemon/backend
node --test                                   # run the worker test suite (must pass)
# apply the auth migration to the live DB ONCE:
wrangler d1 execute pd-cloud --remote --file=./migrations/002_auth.sql
wrangler deploy
```

Secrets (never in `wrangler.toml`): `OPENROUTER_KEY`, `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_TOKEN` — set with `wrangler secret put <NAME>`.

> [!tip] Tests
> `backend/test/worker.test.mjs` covers auth (signup/login/logout/set-password/session), billing webhooks, quota, and admin. Add a test for any new route — the router is exported specifically so it runs against an in-memory `FakeStore` with no network.
