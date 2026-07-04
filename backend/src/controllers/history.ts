import { Request, Response, NextFunction } from 'express';
import { MergeHistory } from '../db';
import { memberId } from './member';

export const listHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mid = memberId(req);
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 50));
    const { rows, count } = await MergeHistory.findAndCountAll({
      where: { memberId: mid },
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });
    res.json({ success: true, data: rows, total: count, page, limit });
  } catch (err) {
    next(err);
  }
};
