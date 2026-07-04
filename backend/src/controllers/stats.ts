import { Request, Response, NextFunction } from 'express';
import { MergeHistory, ScanStat } from '../db';
import { memberId } from './member';

const ENTITIES = ['contact', 'lead', 'company', 'deal'] as const;

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);

    const scans = await ScanStat.findAll({ where: { memberId: mid } });
    const scanByEntity: Record<string, any> = {};
    for (const s of scans) {
      const r = s.toJSON() as any;
      scanByEntity[r.entity] = { scanned: r.scanned, groupsFound: r.groupsFound, scannedAt: r.scannedAt };
    }

    const merges = await MergeHistory.findAll({ where: { memberId: mid }, attributes: ['entity', 'deletedIds', 'createdAt'] });
    const agg: Record<string, { operations: number; mergedRecords: number }> = {};
    let lastMergeAt: Date | null = null;
    for (const m of merges) {
      const r = m.toJSON() as any;
      const a = agg[r.entity] || (agg[r.entity] = { operations: 0, mergedRecords: 0 });
      a.operations += 1;
      a.mergedRecords += Array.isArray(r.deletedIds) ? r.deletedIds.length : 0;
      if (!lastMergeAt || new Date(r.createdAt) > lastMergeAt) lastMergeAt = new Date(r.createdAt);
    }

    const data: Record<string, any> = { lastMergeAt };
    for (const e of ENTITIES) {
      data[e] = {
        scanned: scanByEntity[e]?.scanned ?? 0,
        groupsFound: scanByEntity[e]?.groupsFound ?? 0,
        scannedAt: scanByEntity[e]?.scannedAt ?? null,
        mergedOperations: agg[e]?.operations ?? 0,
        mergedRecords: agg[e]?.mergedRecords ?? 0,
      };
    }
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};
