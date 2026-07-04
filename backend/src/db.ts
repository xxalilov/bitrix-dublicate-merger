import { Sequelize, DataTypes, Model } from 'sequelize';

// Postgres. Set DATABASE_URL (postgres://user:pass@host:5432/db); defaults to a
// local instance for development.
const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/bitrix24_dedup';
export const sequelize = new Sequelize(url, { dialect: 'postgres', logging: false });

// ── Portal: one row per installed Bitrix24 account (keyed by member_id) ──
export class Portal extends Model {
  declare memberId: string;
  declare domain: string;
  declare accessToken: string;
  declare refreshToken: string;
  declare expiresAt: number;
  declare applicationToken: string | null; // verifies incoming event callbacks
}
Portal.init({
  memberId: { type: DataTypes.STRING, primaryKey: true },
  domain: { type: DataTypes.STRING, allowNull: false },
  accessToken: { type: DataTypes.TEXT, allowNull: false },
  refreshToken: { type: DataTypes.TEXT, allowNull: false },
  expiresAt: { type: DataTypes.BIGINT, allowNull: false },
  applicationToken: { type: DataTypes.STRING, allowNull: true },
}, { sequelize, tableName: 'portals' });

// ── Settings: one row per (portal, entity). Contact / company / lead each get
// their own config, mirroring the amoCRM widget's per-entity settings. ──
export class Settings extends Model {
  declare memberId: string;
  declare entity: string;           // 'contact' | 'company' | 'lead' | 'deal'
  // Matching
  declare matchField: string;       // 'phone' | 'email' | 'name'
  declare normalizePhone: boolean;  // strip non-digits before comparing phones
  declare phoneLastNDigits: number; // compare only the last N digits (0 = whole)
  // Merge behaviour
  declare survivor: string;         // 'oldest' | 'newest' — which record is kept
  declare tagMode: boolean;         // tag duplicates instead of merging+deleting
  declare tagName: string;          // tag/category name used in tag mode
  // Automation
  declare autoMergeOnCreate: boolean; // auto-merge a new record's duplicates on add
  // Lead-only grouping
  declare groupBy: string;          // 'byContact' | 'byCompany' | 'byName'
  declare categoryFilter: string;   // CSV of allowed categoryId (funnel) ids, '' = all
  declare stageFilter: string;      // CSV of allowed stageId ids, '' = all
}
Settings.init({
  memberId: { type: DataTypes.STRING, primaryKey: true },
  entity: { type: DataTypes.STRING, primaryKey: true, defaultValue: 'contact' },
  matchField: { type: DataTypes.STRING, allowNull: false, defaultValue: 'phone' },
  normalizePhone: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  phoneLastNDigits: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  survivor: { type: DataTypes.STRING, allowNull: false, defaultValue: 'oldest' },
  tagMode: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  tagName: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  autoMergeOnCreate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  groupBy: { type: DataTypes.STRING, allowNull: false, defaultValue: 'byContact' },
  categoryFilter: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  stageFilter: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
}, { sequelize, tableName: 'entity_settings' });

// ── MergeHistory: one row per merge operation ──
export class MergeHistory extends Model {
  declare id: number;
  declare memberId: string;
  declare entity: string;       // 'contact' | 'lead' | 'company' | 'deal'
  declare mainId: number;
  declare mainName: string;
  declare deletedIds: number[];
  declare readonly createdAt: Date;
}
MergeHistory.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  memberId: { type: DataTypes.STRING, allowNull: false },
  entity: { type: DataTypes.STRING, allowNull: false },
  mainId: { type: DataTypes.BIGINT, allowNull: false },
  mainName: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  deletedIds: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
}, { sequelize, tableName: 'merge_history' });

// ── ScanStat: last scan per (portal, entity) ──
export class ScanStat extends Model {
  declare memberId: string;
  declare entity: string;
  declare scanned: number;
  declare groupsFound: number;
  declare scannedAt: Date;
}
ScanStat.init({
  memberId: { type: DataTypes.STRING, allowNull: false },
  entity: { type: DataTypes.STRING, allowNull: false },
  scanned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  groupsFound: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  scannedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: 'scan_stats', indexes: [{ unique: true, fields: ['memberId', 'entity'] }] });

export async function initDb(): Promise<void> {
  await sequelize.authenticate();
  await sequelize.sync();
  console.log('DB ready');
}
