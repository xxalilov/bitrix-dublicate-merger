import axios from 'axios';
import { getPortal, savePortal, PortalTokens } from './store';
import { acquire } from './rateLimiter';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = 4;

// Bitrix24 OAuth token endpoint (shared across all portals).
const OAUTH_TOKEN_URL = 'https://oauth.bitrix.info/oauth/token/';

// CRM entity type ids used by the universal crm.item.* and crm.entity.* methods.
export const ENTITY = { lead: 1, deal: 2, contact: 3, company: 4 } as const;
export type EntityName = keyof typeof ENTITY;

function clientCreds() {
  const client_id = process.env.CLIENT_ID || '';
  const client_secret = process.env.CLIENT_SECRET || '';
  return { client_id, client_secret };
}

// Exchange an authorization code for tokens and remember the portal.
export async function exchangeCode(code: string, fallbackDomain?: string): Promise<PortalTokens> {
  const { data } = await axios.get(OAUTH_TOKEN_URL, {
    params: { grant_type: 'authorization_code', ...clientCreds(), code },
  });
  const portal: PortalTokens = {
    memberId: data.member_id,
    domain: data.domain || fallbackDomain || '',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  // Some install flows include the event-verification token here; keep it if so.
  if (data.application_token) portal.applicationToken = data.application_token;
  await savePortal(portal);
  return portal;
}

async function refresh(portal: PortalTokens): Promise<PortalTokens> {
  const { data } = await axios.get(OAUTH_TOKEN_URL, {
    params: { grant_type: 'refresh_token', ...clientCreds(), refresh_token: portal.refreshToken },
  });
  portal.accessToken = data.access_token;
  portal.refreshToken = data.refresh_token;
  portal.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  await savePortal(portal);
  return portal;
}

// Raw REST call → returns the full Bitrix24 envelope ({ result, total, next, ... }).
// Refreshes the token proactively (60s skew) and once more on an expired_token error.
async function callRaw(memberId: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  let portal = await getPortal(memberId);
  if (!portal) throw new Error('Portal not authorized — install the app first');
  if (Date.now() > portal.expiresAt - 60_000) portal = await refresh(portal);

  const url = `https://${portal.domain}/rest/${method}`;
  for (let attempt = 0; ; attempt++) {
    await acquire(memberId); // stay within Bitrix's ~2 req/s per-portal limit
    try {
      const { data } = await axios.post(url, { ...params, auth: portal.accessToken });
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      // Expired token → refresh and retry immediately (bounded).
      if (body && (body.error === 'expired_token' || body.error === 'invalid_token') && attempt < MAX_RETRIES) {
        portal = await refresh(portal);
        continue;
      }
      // Rate limit / transient server errors → backoff and retry.
      const retriable = status === 503 || status === 429 || (status && status >= 500)
        || body?.error === 'QUERY_LIMIT_EXCEEDED' || body?.error === 'OPERATION_TIME_LIMIT';
      if (retriable && attempt < MAX_RETRIES) {
        await sleep(Math.min(2 ** attempt * 500, 8000));
        continue;
      }
      throw new Error(body?.error_description || body?.error || err.message);
    }
  }
}

// Convenience: returns just `result`.
export async function call(memberId: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return (await callRaw(memberId, method, params)).result;
}

// crm.duplicate.findbycomm — ids of records sharing the given phones/emails.
export async function findByComm(
  memberId: string,
  type: 'PHONE' | 'EMAIL',
  values: string[],
  entityType?: 'LEAD' | 'CONTACT' | 'COMPANY',
): Promise<{ LEAD?: number[]; CONTACT?: number[]; COMPANY?: number[] }> {
  return call(memberId, 'crm.duplicate.findbycomm', { type, values, entity_type: entityType });
}

// crm.item.list with automatic pagination (50/page via the `next` cursor).
export interface ListOptions {
  filter?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  onProgress?: (count: number) => void;
}
export async function listAll(
  memberId: string,
  entityTypeId: number,
  select: string[],
  opts: ListOptions = {},
): Promise<any[]> {
  const items: any[] = [];
  let start = 0;
  const base: Record<string, unknown> = { entityTypeId, select };
  if (opts.filter) base.filter = opts.filter;
  if (opts.order) base.order = opts.order;
  // Hard cap to avoid runaway loops on huge bases; raise/stream later if needed.
  for (let guard = 0; guard < 2000; guard++) {
    const data = await callRaw(memberId, 'crm.item.list', { ...base, start });
    const batch = data?.result?.items || [];
    items.push(...batch);
    opts.onProgress?.(items.length);
    if (typeof data?.next === 'number') start = data.next;
    else break;
  }
  return items;
}

// crm.item.update — patch a single record (used for tag-mode).
export async function updateItem(
  memberId: string,
  entityTypeId: number,
  id: number,
  fields: Record<string, unknown>,
): Promise<any> {
  return call(memberId, 'crm.item.update', { entityTypeId, id, fields });
}

// crm.item.get — fetch one record (used by the on-create event handler).
export async function getItem(memberId: string, entityTypeId: number, id: number): Promise<any | null> {
  const result = await call(memberId, 'crm.item.get', { entityTypeId, id });
  return result?.item ?? null;
}

// CRM list-view menu entries that open the app's SPA. Bound on install so the
// app is reachable in context (requires the `placement` OAuth scope).
const PLACEMENTS = [
  { code: 'CRM_CONTACT_LIST_MENU', title: 'Поиск дублей' },
  { code: 'CRM_LEAD_LIST_MENU', title: 'Поиск дублей' },
  { code: 'CRM_COMPANY_LIST_MENU', title: 'Поиск дублей' },
];

export async function bindPlacements(memberId: string, handlerUrl: string): Promise<void> {
  for (const p of PLACEMENTS) {
    try {
      await call(memberId, 'placement.bind', {
        PLACEMENT: p.code,
        HANDLER: handlerUrl,
        TITLE: p.title,
        LANG_ALL: { ru: { TITLE: p.title }, en: { TITLE: 'Find duplicates' } },
      });
    } catch (err: any) {
      // Already bound or placement unavailable on this plan — non-fatal.
      console.warn(`placement.bind ${p.code}:`, err.message);
    }
  }
}

// CRM "record added" events → auto-merge-on-create handler. Bound on install so
// the app can dedup a new record against existing ones the moment it appears.
export const AUTO_MERGE_EVENTS = ['ONCRMCONTACTADD', 'ONCRMLEADADD', 'ONCRMCOMPANYADD'] as const;

export async function bindEvents(memberId: string, handlerUrl: string): Promise<void> {
  for (const event of AUTO_MERGE_EVENTS) {
    try {
      await call(memberId, 'event.bind', { event, handler: handlerUrl });
    } catch (err: any) {
      // Already bound or unsupported — non-fatal.
      console.warn(`event.bind ${event}:`, err.message);
    }
  }
}

// crm.entity.mergeBatch — real merge: data folded into entityIds[0], the rest deleted.
export async function mergeBatch(
  memberId: string,
  entityTypeId: number,
  entityIds: number[],
): Promise<{ STATUS: string; ENTITY_IDS: number[] }> {
  return call(memberId, 'crm.entity.mergeBatch', { params: { entityTypeId, entityIds } });
}
