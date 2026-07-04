import { Request, Response } from 'express';
import { ENTITY, EntityName, getItem, findByComm, listAll } from '../services/bitrix';
import { getPortal, saveApplicationToken } from '../services/store';
import { loadSettings, EntitySettings } from './settings';
import { mergeGroup, commValues, orderIdsBySurvivor, passesLeadFilter } from './dedup';

// Bitrix "record added" events → our entity names.
const EVENT_ENTITY: Record<string, EntityName> = {
  ONCRMCONTACTADD: 'contact',
  ONCRMLEADADD: 'lead',
  ONCRMCOMPANYADD: 'company',
};

// Find existing records that duplicate the freshly-created `item`.
// Contacts/companies use crm.duplicate.findbycomm (phone/email) or a name filter;
// leads group by their linked contact / company / title.
async function findDuplicateIds(
  mid: string,
  entity: EntityName,
  item: any,
  s: EntitySettings,
): Promise<number[]> {
  if (entity === 'lead') {
    const filter: Record<string, unknown> = {};
    if (s.groupBy === 'byContact') {
      const cid = item.contactId || (Array.isArray(item.contactIds) ? item.contactIds[0] : 0);
      if (!cid) return [];
      filter.contactId = cid;
    } else if (s.groupBy === 'byCompany') {
      if (!item.companyId) return [];
      filter.companyId = item.companyId;
    } else {
      if (!item.title) return [];
      filter['=title'] = item.title;
    }
    const rows = await listAll(mid, ENTITY.lead, ['id', 'categoryId', 'stageId'], { filter });
    return rows.filter((r) => passesLeadFilter(r, s)).map((r) => Number(r.id));
  }

  // contact / company
  if (s.matchField === 'name') {
    const filter: Record<string, unknown> =
      entity === 'contact'
        ? { '=name': item.name || '', '=lastName': item.lastName || '' }
        : { '=title': item.title || '' };
    if (entity === 'contact' && !(item.name || item.lastName)) return [];
    if (entity === 'company' && !item.title) return [];
    const rows = await listAll(mid, ENTITY[entity], ['id'], { filter });
    return rows.map((r) => Number(r.id));
  }

  const type = s.matchField === 'email' ? 'EMAIL' : 'PHONE';
  const values = commValues(item, type === 'EMAIL' ? 'email' : 'phone').slice(0, 20);
  if (!values.length) return [];
  const res = await findByComm(mid, type, values, entity.toUpperCase() as 'CONTACT' | 'COMPANY' | 'LEAD');
  const bucket = (res as Record<string, number[]>)[entity.toUpperCase()] || [];
  return bucket.map(Number);
}

// POST /events/handler — Bitrix posts a form-encoded event payload here.
// Verifies the portal + application_token, then auto-merges the new record's
// duplicates when autoMergeOnCreate is enabled for that entity.
export const handleEvent = async (req: Request, res: Response) => {
  // Always ACK fast; Bitrix retries on non-2xx and we never want to loop.
  res.json({ ok: true });

  try {
    const body: any = req.body || {};
    const event = String(body.event || '').toUpperCase();
    const entity = EVENT_ENTITY[event];
    if (!entity) return;

    const auth = body.auth || {};
    const mid = String(auth.member_id || '');
    const appToken = String(auth.application_token || '');
    const newId = Number(body?.data?.FIELDS?.ID || 0);
    if (!mid || !newId) return;

    // Verify the portal and its application_token (trust-on-first-use).
    const portal = await getPortal(mid);
    if (!portal) return;
    if (portal.applicationToken) {
      if (!appToken || appToken !== portal.applicationToken) {
        console.warn('event: application_token mismatch for', mid);
        return;
      }
    } else if (appToken) {
      await saveApplicationToken(mid, appToken);
    }

    const s = await loadSettings(mid, entity);
    if (!s.autoMergeOnCreate) return;

    const item = await getItem(mid, ENTITY[entity], newId);
    if (!item) return;

    const dupIds = await findDuplicateIds(mid, entity, item, s);
    const ids = orderIdsBySurvivor([newId, ...dupIds], s.survivor);
    if (ids.length < 2) return; // nothing to merge

    const mainName = item.title || `${item.name || ''} ${item.lastName || ''}`.trim();
    await mergeGroup(mid, entity, ids, mainName, s);
    console.log(`auto-merge ${entity}: merged ${ids.length} records → #${ids[0]} on portal ${mid}`);
  } catch (err: any) {
    console.warn('event handler error:', err.message);
  }
};
