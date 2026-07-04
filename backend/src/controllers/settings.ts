import { Request, Response, NextFunction } from 'express';
import { Settings } from '../db';
import { memberId } from './member';

// Entities that carry their own settings block in the UI.
export const SETTINGS_ENTITIES = ['contact', 'company', 'lead'] as const;
export type SettingsEntity = (typeof SETTINGS_ENTITIES)[number];

// Writable fields (memberId/entity are server-controlled).
const FIELDS = [
  'matchField', 'normalizePhone', 'phoneLastNDigits',
  'survivor', 'tagMode', 'tagName',
  'autoMergeOnCreate',
  'groupBy', 'categoryFilter', 'stageFilter',
] as const;

export interface EntitySettings {
  memberId: string;
  entity: string;
  matchField: 'phone' | 'email' | 'name';
  normalizePhone: boolean;
  phoneLastNDigits: number;
  survivor: 'oldest' | 'newest';
  tagMode: boolean;
  tagName: string;
  autoMergeOnCreate: boolean;
  groupBy: 'byContact' | 'byCompany' | 'byName';
  categoryFilter: string;
  stageFilter: string;
}

// Per-entity defaults — company matches by name, everyone else by phone.
export function defaultsFor(mid: string, entity: string): EntitySettings {
  return {
    memberId: mid,
    entity,
    matchField: entity === 'company' ? 'name' : 'phone',
    normalizePhone: true,
    phoneLastNDigits: 0,
    survivor: 'oldest',
    tagMode: false,
    tagName: '',
    autoMergeOnCreate: false,
    groupBy: 'byContact',
    categoryFilter: '',
    stageFilter: '',
  };
}

// Load one entity's settings, falling back to defaults when no row exists.
export async function loadSettings(mid: string, entity = 'contact'): Promise<EntitySettings> {
  const row = await Settings.findOne({ where: { memberId: mid, entity } });
  return row ? (row.toJSON() as EntitySettings) : defaultsFor(mid, entity);
}

// GET /api/settings → { contact, company, lead } (defaults filled in).
export const getSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const rows = await Settings.findAll({ where: { memberId: mid } });
    const byEntity = new Map(rows.map((r) => [r.get('entity') as string, r.toJSON() as EntitySettings]));
    const data: Record<string, EntitySettings> = {};
    for (const e of SETTINGS_ENTITIES) data[e] = byEntity.get(e) || defaultsFor(mid, e);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings { entity, ...fields } → upsert one entity's settings.
export const updateSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const entity = String(req.body.entity || 'contact');
    if (!SETTINGS_ENTITIES.includes(entity as SettingsEntity)) throw new Error('invalid entity');

    const patch: Record<string, unknown> = { memberId: mid, entity };
    for (const f of FIELDS) if (req.body[f] !== undefined) patch[f] = req.body[f];
    await Settings.upsert(patch as any);
    res.json({ success: true, data: await loadSettings(mid, entity) });
  } catch (err) {
    next(err);
  }
};
