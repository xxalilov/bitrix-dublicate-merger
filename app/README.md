# Bitrix24 app registration

Bitrix24 cloud apps aren't a zip (unlike amoCRM). You register the app in the
Bitrix24 developer console (a local app on your portal, or a Marketplace app),
point it at the deployed backend + SPA, and the rest is handled over REST.

## 1. Create the app

**Developer resources → Other → Local application** (or a Marketplace app):

| Field | Value |
|-------|-------|
| Application type | Server (with OAuth) |
| Handler path (app UI) | `https://<frontend>` — the SPA |
| Initial install path | `https://<backend>/auth/install?DOMAIN=<portal>` |
| Assign permissions (scope) | **`crm`, `placement`** |
| Use only API (no UI) | No |

Set the OAuth redirect to `https://<backend>/auth/callback`.

Copy the generated **client_id** and **client_secret** into the backend `.env`
(`CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `APP_HANDLER_URL=<frontend>`).

## 2. Install flow

1. Admin opens the app → Bitrix24 hits `/auth/install` → redirect to the portal's
   `/oauth/authorize/`.
2. Portal redirects back to `/auth/callback?code=…` → backend exchanges the code
   (`oauth.bitrix.info/oauth/token/`), stores the portal tokens.
3. Backend calls `placement.bind` for the CRM list menus
   (`CRM_CONTACT_LIST_MENU`, `CRM_LEAD_LIST_MENU`, `CRM_COMPANY_LIST_MENU`) so a
   **«Поиск дублей»** item opens the SPA in context.
4. Backend calls `event.bind` for `ONCRMCONTACTADD`, `ONCRMLEADADD`,
   `ONCRMCOMPANYADD`, pointing at `https://<backend>/events/handler`. When
   **auto-merge-on-create** is enabled for an entity, a newly added record is
   deduped against existing ones (`crm.duplicate.findbycomm`) and merged
   immediately (`crm.entity.mergeBatch`). Event authenticity is checked via the
   portal's `application_token` (trust-on-first-use).

## 3. How the SPA authorizes

Inside the placement iframe the SPA loads the Bitrix24 JS SDK
(`//api.bitrix24.com/api/v1/`), calls `BX24.init()` + `BX24.getAuth()` to read
`member_id`, and sends it to the backend as `X-Member-Id`. The backend looks up
the stored OAuth tokens for that portal and calls the CRM REST methods.

## 4. Required REST scope

- `crm` — `crm.duplicate.findbycomm`, `crm.item.list`, `crm.item.get`,
  `crm.item.update`, `crm.entity.mergeBatch`, `event.bind`
- `placement` — `placement.bind`

`.env` also takes `EVENT_HANDLER_URL` (where Bitrix POSTs add-events; defaults to
the `REDIRECT_URI` origin + `/events/handler`).

## Deploy checklist

- [ ] Backend deployed (HTTPS), Postgres reachable, `.env` filled
- [ ] SPA built (`VITE_API_BASE_URL=<backend>`) and served over HTTPS
- [ ] App registered with handler = SPA, scope `crm,placement`
- [ ] Install once → verify «Поиск дублей» appears in CRM contact list menu
