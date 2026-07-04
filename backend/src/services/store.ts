import { Portal } from '../db';

// OAuth tokens for one installed portal. Persisted in the `portals` table.
export interface PortalTokens {
  memberId: string;
  domain: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  applicationToken?: string | null;
}

// Persist just the application_token (learned from the first event callback).
export async function saveApplicationToken(memberId: string, token: string): Promise<void> {
  await Portal.update({ applicationToken: token }, { where: { memberId } });
}

export async function savePortal(p: PortalTokens): Promise<void> {
  await Portal.upsert(p as any);
}

export async function getPortal(memberId: string): Promise<PortalTokens | undefined> {
  const row = await Portal.findByPk(memberId);
  return row ? (row.toJSON() as PortalTokens) : undefined;
}
