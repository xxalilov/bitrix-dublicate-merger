import { Request, Response, NextFunction } from 'express';
import { ENTITY, EntityName, listAll, mergeBatch, updateItem, findByComm } from '../services/bitrix';
import { MergeHistory, ScanStat } from '../db';
import { createJob, getJob, runJob, updateJob } from '../jobStore';
import { loadSettings, EntitySettings } from './settings';
import { memberId } from './member';

// ── Field extraction ────────────────────────────────────────────────────────

// Multifield (phone/email) values from a crm.item — array of { value, valueType }.
export function commValues(item: any, field: 'phone' | 'email'): string[] {
  const arr = item?.[field];
  if (!Array.isArray(arr)) return [];
  return arr.map((e: any) => String(e?.value ?? '')).filter(Boolean);
}

function displayName(item: any, entity: EntityName): string {
  if (entity === 'contact') {
    const full = `${item.name || ''} ${item.lastName || ''}`.trim();
    return full || item.title || `Контакт #${item.id}`;
  }
  return item.title || `#${item.id}`;
}

// A record's own name/title, used for name-based matching.
function nameKey(item: any, entity: EntityName): string {
  const raw = entity === 'contact' ? `${item.name || ''} ${item.lastName || ''}` : (item.title || '');
  return raw.trim().toLowerCase();
}

const normPhone = (v: string) => v.replace(/\D/g, '');

function phoneKey(v: string, s: EntitySettings): string {
  let d = s.normalizePhone !== false ? normPhone(v) : v.trim();
  if (s.phoneLastNDigits > 0 && d.length > s.phoneLastNDigits) d = d.slice(-s.phoneLastNDigits);
  return d;
}

// Group keys for one item. Contacts/companies can yield several (multi-value
// phone/email); leads yield exactly one (grouped by contact/company/name).
function keysFor(item: any, entity: EntityName, s: EntitySettings): { key: string; sample: string }[] {
  if (entity === 'lead') {
    if (s.groupBy === 'byContact') {
      const id = item.contactId || (Array.isArray(item.contactIds) ? item.contactIds[0] : 0);
      return id ? [{ key: `c:${id}`, sample: `contactId ${id}` }] : [];
    }
    if (s.groupBy === 'byCompany') {
      return item.companyId ? [{ key: `co:${item.companyId}`, sample: `companyId ${item.companyId}` }] : [];
    }
    const n = nameKey(item, entity);
    return n ? [{ key: `n:${n}`, sample: item.title || '' }] : [];
  }
  // contact / company / deal
  if (s.matchField === 'name') {
    const n = nameKey(item, entity);
    return n ? [{ key: `n:${n}`, sample: displayName(item, entity) }] : [];
  }
  const field: 'phone' | 'email' = s.matchField === 'email' ? 'email' : 'phone';
  return commValues(item, field)
    .map((v) => ({ key: field === 'phone' ? `p:${phoneKey(v, s)}` : `e:${v.trim().toLowerCase()}`, sample: v }))
    .filter((k) => k.key.length > 2);
}

// CSV → set of trimmed non-empty tokens (for category/stage filters).
const csvSet = (v: string) => new Set(String(v || '').split(',').map((x) => x.trim()).filter(Boolean));

export function passesLeadFilter(item: any, s: EntitySettings): boolean {
  const cats = csvSet(s.categoryFilter);
  const stages = csvSet(s.stageFilter);
  if (cats.size && !cats.has(String(item.categoryId))) return false;
  if (stages.size && !stages.has(String(item.stageId))) return false;
  return true;
}

// Order a bucket so the survivor (kept record) is first: oldest = smallest id.
function orderBySurvivor(items: any[], survivor: string): any[] {
  const byIdAsc = [...items].sort((a, b) => a.id - b.id);
  return survivor === 'newest' ? byIdAsc.reverse() : byIdAsc;
}

// Same rule for a bare id list — survivor (kept record) first.
export function orderIdsBySurvivor(ids: number[], survivor: string): number[] {
  const asc = [...new Set(ids)].sort((a, b) => a - b);
  return survivor === 'newest' ? asc.reverse() : asc;
}

function buildGroups(items: any[], entity: EntityName, s: EntitySettings) {
  const groups = new Map<string, { sample: string; members: any[] }>();
  for (const item of items) {
    if (entity === 'lead' && !passesLeadFilter(item, s)) continue;
    for (const { key, sample } of keysFor(item, entity, s)) {
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { sample, members: [] });
      const g = groups.get(key)!;
      if (!g.members.some((b) => b.id === Number(item.id))) {
        g.members.push({ id: Number(item.id), name: displayName(item, entity), match: sample });
      }
    }
  }
  return [...groups.entries()]
    .filter(([, g]) => g.members.length > 1)
    .map(([key, g]) => {
      const ordered = orderBySurvivor(g.members, s.survivor);
      return { key, field: s.matchField, value: g.sample, items: ordered };
    });
}

// Fields to pull per entity (leads need their links + funnel/stage).
function selectFor(entity: EntityName): string[] {
  const base = ['id', 'title', 'name', 'lastName', 'phone', 'email'];
  if (entity === 'lead' || entity === 'deal') {
    return [...base, 'contactId', 'companyId', 'contactIds', 'categoryId', 'stageId'];
  }
  return base;
}

// ── Scan ────────────────────────────────────────────────────────────────────

// POST /api/scan { entity, field? } → starts a background scan job, returns { jobId }.
export const startScan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const entity = (req.body.entity || 'contact') as EntityName;
    if (!(entity in ENTITY)) throw new Error('invalid entity');
    const settings = await loadSettings(mid, entity);
    // Optional per-scan override of the match field (Find tab selector).
    if (req.body.field && ['phone', 'email', 'name'].includes(req.body.field)) {
      settings.matchField = req.body.field;
    }

    const job = createJob(mid, 'scan');
    runJob(job.id, async () => {
      const items = await listAll(mid, ENTITY[entity], selectFor(entity),
        { onProgress: (n) => updateJob(job.id, { scanned: n }) });
      const groups = buildGroups(items, entity, settings);
      updateJob(job.id, { groups, groupsFound: groups.length, scanned: items.length });

      const existing = await ScanStat.findOne({ where: { memberId: mid, entity } });
      const values = { scanned: items.length, groupsFound: groups.length, scannedAt: new Date() };
      if (existing) await existing.update(values);
      else await ScanStat.create({ memberId: mid, entity, ...values });
    });
    res.status(202).json({ jobId: job.id, entity, field: settings.matchField });
  } catch (err) {
    next(err);
  }
};

// POST /api/search { entity, field?, value } → find records matching one value
// (no full scan). Uses crm.duplicate.findbycomm for phone/email, a name filter
// otherwise. Returns a single group ({ items }) or { group: null }.
export const search = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const entity = (req.body.entity || 'contact') as EntityName;
    if (!(entity in ENTITY)) throw new Error('invalid entity');
    const value = String(req.body.value || '').trim();
    if (!value) throw new Error('value required');

    const s = await loadSettings(mid, entity);
    const field = ['phone', 'email', 'name'].includes(req.body.field) ? req.body.field : s.matchField;

    let ids: number[] = [];
    if (field === 'phone' || field === 'email') {
      const type = field === 'email' ? 'EMAIL' : 'PHONE';
      const r = await findByComm(mid, type, [value], entity.toUpperCase() as 'CONTACT' | 'COMPANY' | 'LEAD');
      ids = ((r as Record<string, number[]>)[entity.toUpperCase()] || []).map(Number);
    } else {
      const filter = entity === 'contact' ? { '%name': value } : { '%title': value };
      const rows = await listAll(mid, ENTITY[entity], selectFor(entity), { filter });
      ids = rows.map((row) => Number(row.id));
    }
    if (!ids.length) return res.json({ success: true, group: null });

    const rows = await listAll(mid, ENTITY[entity], selectFor(entity), { filter: { id: ids } });
    const items = orderBySurvivor(
      rows.map((row) => ({ id: Number(row.id), name: displayName(row, entity), match: value })),
      s.survivor,
    );
    res.json({ success: true, group: { key: `search:${value}`, field, value, items } });
  } catch (err) {
    next(err);
  }
};

// GET /api/jobs/:id → poll scan/merge progress.
export const getJobStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const job = getJob(String(req.params.id));
    if (!job || job.memberId !== mid) throw Object.assign(new Error('Job not found'), { status: 404 });
    res.json({
      kind: job.kind, status: job.status, error: job.error ?? undefined,
      scanned: job.scanned, groupsFound: job.groupsFound,
      groups: job.kind === 'scan' && job.status === 'done' ? job.groups : undefined,
      total: job.total, processed: job.processed, failed: job.failed,
    });
  } catch (err) {
    next(err);
  }
};

// ── Merge ───────────────────────────────────────────────────────────────────

async function recordMerge(mid: string, entity: EntityName, mainId: number, mainName: string, deleted: number[]) {
  try {
    await MergeHistory.create({ memberId: mid, entity, mainId, mainName: mainName || '', deletedIds: deleted });
  } catch (err: any) {
    console.warn('history record failed:', err.message);
  }
}

// Merge one group: either a real mergeBatch (survivor kept, rest deleted) or,
// in tag-mode, tag the duplicates and leave every record in place.
export async function mergeGroup(
  mid: string,
  entity: EntityName,
  ids: number[],
  mainName: string,
  s: EntitySettings,
): Promise<{ ok: boolean; deleted: number[]; tagged?: boolean }> {
  if (s.tagMode) {
    const tag = s.tagName || 'duplicate';
    const dups = ids.slice(1);
    for (const id of dups) {
      try {
        // crm.item stores tags/categories under UF fields; a comment-safe fallback
        // is the built-in "title" prefix. We append the tag to a dedicated UF list
        // via the entity's TAGS-like field when present, else skip gracefully.
        await updateItem(mid, ENTITY[entity], id, { ufCrmDuplicateTag: tag });
      } catch (err: any) {
        console.warn(`tag ${entity}#${id} failed:`, err.message);
      }
    }
    await recordMerge(mid, entity, ids[0], mainName, dups);
    return { ok: true, deleted: [], tagged: true };
  }
  const result = await mergeBatch(mid, ENTITY[entity], ids);
  const deleted = result.ENTITY_IDS || [];
  if (result.STATUS === 'SUCCESS') {
    await recordMerge(mid, entity, ids[0], mainName, deleted);
    return { ok: true, deleted };
  }
  return { ok: false, deleted };
}

// POST /api/merge { entity, ids: number[], mainName? } — ids[0] kept, rest merged+deleted.
export const merge = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const entity = (req.body.entity || 'contact') as EntityName;
    const ids: number[] = (req.body.ids || []).map(Number).filter(Boolean);
    if (!(entity in ENTITY)) throw new Error('invalid entity');
    if (ids.length < 2) throw new Error('need at least two ids');

    const s = await loadSettings(mid, entity);
    const r = await mergeGroup(mid, entity, ids, req.body.mainName, s);
    res.json({ success: r.ok, tagged: r.tagged || false, deleted: r.deleted });
  } catch (err) {
    next(err);
  }
};

// POST /api/merge-all { entity, groups: [{ ids: number[], mainName? }] } → background job.
export const startMergeAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const entity = (req.body.entity || 'contact') as EntityName;
    if (!(entity in ENTITY)) throw new Error('invalid entity');
    const groups: { ids: number[]; mainName?: string }[] = (req.body.groups || [])
      .map((g: any) => ({ ids: (g.ids || []).map(Number).filter(Boolean), mainName: g.mainName }))
      .filter((g: any) => g.ids.length >= 2);
    if (!groups.length) throw new Error('no mergeable groups');

    const s = await loadSettings(mid, entity);
    const job = createJob(mid, 'merge');
    updateJob(job.id, { total: groups.length });
    runJob(job.id, async () => {
      let processed = 0;
      let failed = 0;
      for (const g of groups) {
        try {
          const r = await mergeGroup(mid, entity, g.ids, g.mainName || '', s);
          if (!r.ok) failed += 1;
        } catch {
          failed += 1;
        }
        processed += 1;
        updateJob(job.id, { processed, failed });
      }
    });
    res.status(202).json({ jobId: job.id, total: groups.length });
  } catch (err) {
    next(err);
  }
};
