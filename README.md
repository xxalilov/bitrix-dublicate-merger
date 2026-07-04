# Bitrix24 Duplicate Finder & Merger

A standalone Bitrix24 marketplace app that finds and merges duplicate
**contacts / leads / companies / deals** entirely over the Bitrix24 REST API.

## How it works

Bitrix24 exposes duplicate handling natively, so the whole flow is plain REST —
the merge is one backend call:

| Task | Bitrix24 REST method |
|------|----------------------|
| Find duplicates for one value | `crm.duplicate.findbycomm` |
| Scan all records (paginated, filtered) | `crm.item.list` |
| Read / tag one record | `crm.item.get` / `crm.item.update` |
| **Merge (real merge + delete)** | **`crm.entity.mergeBatch`** |
| Auto-merge on create | `event.bind` (`ONCRM*ADD`) → findbycomm → mergeBatch |

`crm.entity.mergeBatch` merges N records of one type into the first, copies data
across, and **deletes** the rest — server-side, OAuth only. All REST calls run
through a per-portal token-bucket limiter (~2 req/s) with 503/expired-token retry.

Entity type ids: **1 = lead, 2 = deal, 3 = contact, 4 = company, 7 = quote, 31 = invoice**.

## Architecture

- **backend/** — Express 5 + TypeScript 6. Bitrix24 OAuth + REST client (rate
  limited), duplicate scan / merge / search, per-entity settings, history, stats,
  background jobs, and the `event.bind` auto-merge handler.
- **client/** — React 19 + Vite 8 SPA: find/search/merge, per-entity settings,
  history, stats.
- **app/** — Bitrix24 app registration guide + `placement`/`event` bindings.

## OAuth (Bitrix24)

1. Install/authorize → Bitrix24 redirects with a `code` (and `domain`, `member_id`).
2. Exchange at `https://oauth.bitrix.info/oauth/token/`
   (`grant_type=authorization_code`, `client_id`, `client_secret`, `code`).
3. Get `access_token` (~1h), `refresh_token`, `domain`, `member_id`.
4. Call REST at `https://<DOMAIN>/rest/<method>` with the token; refresh on
   `expired_token`. Tokens are keyed by portal (`member_id`).

Required scope: **`crm`**.

## Status

- [x] Bitrix24 REST client (OAuth token mgmt, `call`, findbycomm, item.list/get/update, mergeBatch)
- [x] Per-portal rate limiter (~2 req/s token bucket) + 503 / expired-token retry
- [x] Persistent token store (Postgres / Sequelize)
- [x] Duplicate scan (background job) + merge / merge-all / single-value search
- [x] Matching options: phone / email / name, phone normalization, last-N digits
- [x] Lead grouping: by contact / company / name + category (funnel) & stage filters
- [x] Tag-mode (mark duplicates instead of merging) + survivor rule (oldest/newest)
- [x] **Per-entity settings** (contact / company / lead each configured separately)
- [x] **Auto-merge on create** via Bitrix24 events (`ONCRMCONTACTADD`/`LEADADD`/`COMPANYADD` → `event.bind` handler, `application_token` verified)
- [x] Merge history (paginated) + statistics
- [x] React SPA — find/search/merge, per-entity settings, history, stats (BX24 auth)
- [x] OAuth install/callback + `placement.bind` (CRM list menus) + `event.bind`
- [x] App registration guide (`app/README.md`)
- [ ] Deploy (Docker/host) + register the app on a real portal

## Layout

```
backend/   Express + TS: Bitrix24 REST, scan/merge, settings, history, stats
client/    Vite + React SPA: find / settings / history / stats
app/       Bitrix24 app registration guide (handler, scope, placements)
```

## Run

```bash
cd backend
npm install
cp .env.example .env   # fill CLIENT_ID / CLIENT_SECRET / REDIRECT_URI
npm run dev
```
