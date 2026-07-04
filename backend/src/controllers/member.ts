import { Request } from 'express';

// The portal is identified by member_id, sent by the SPA from the Bitrix24
// placement auth context (BX24.getAuth().member_id).
export function memberId(req: Request): string {
  const h = req.headers['x-member-id'];
  const v = (typeof h === 'string' && h) || req.query.member_id || (req.body && req.body.memberId);
  if (!v) throw new Error('member_id required');
  return String(v);
}
