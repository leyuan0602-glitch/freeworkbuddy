/**
 * legacyImport/importAdapter — 旧会话库 → 新库的显式导入(蓝图 §3.16)。
 *
 * 核心策略(**不假设文件直接兼容**,蓝图 §3.16 第 4 条):
 *  - 旧库以 **readonly** 打开;不写、不迁移、不改旧文件;
 *  - 不做 schema 级兼容假设:对 sessions / messages 各自 PRAGMA table_info
 *    取**实际存在的列**,新旧列名取交集;新库有而旧库没有的列由新库默认值兜底,
 *    旧库有而新库没有的列(历史遗留)直接丢弃;
 *  - 新库侧走**事务 + INSERT OR IGNORE**(同主键/唯一键跳过):导入幂等,
 *    重复执行不产生重复行,失败回滚不留半截数据(蓝图 §3.16 第 6 条);
 *  - 行数与体积预算:**先 COUNT 后取行**,超预算不加载、不写入;
 *  - 诊断只含计数与错误分类,**不含消息正文**(蓝图:诊断不含敏感正文)。
 *
 * 明确不导入(蓝图红线):token / 组织 session / model grant / hook binding /
 * push registration;BYOK 凭据在 safeStorage,本模块不触碰。
 */
import path from 'node:path';

import type Database from 'better-sqlite3';

import type { LegacyImportDbStats, LegacyImportTableStats } from '../../shared/legacyImport.js';

import { createBetterSqliteDatabase } from '../localDb/betterSqliteFactory';

export type { LegacyImportDbStats, LegacyImportTableStats } from '../../shared/legacyImport.js';

export const LEGACY_IMPORT_MAX_ROWS_PER_TABLE = 200_000;

/** 会话导入涉及的核心列(新库列集的子集;实际列由 PRAGMA 交集决定)。 */
export const SESSION_COLUMNS = [
  'id', 'title', 'working_dir', 'model', 'provider_id', 'agent_kind',
  'pinned_at', 'created_at', 'updated_at',
] as const;
export const MESSAGE_COLUMNS = [
  'id', 'client_id', 'session_id', 'role', 'content', 'created_at',
] as const;

/** 读取一张表的可用列 = 与 providedColumns 的交集(按 providedColumns 顺序)。 */
export function intersectColumns(
  provided: readonly string[],
  wanted: readonly string[],
): string[] {
  const set = new Set(provided);
  return wanted.filter((c) => set.has(c));
}

function tableColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(table).slice(1, -1)})`).all() as Array<{
    name: string;
  }>;
  return rows.map((r) => r.name);
}

function quotedList(columns: readonly string[]): string {
  return columns.map((c) => `"${c}"`).join(', ');
}

function emptyTableStats(): LegacyImportTableStats {
  return {
    rowsScanned: 0,
    rowsInserted: 0,
    rowsSkipped: 0,
    droppedLegacyColumns: [],
    errorKind: null,
    tableMissing: false,
  };
}

/**
 * 预检单张表:从 legacy db 只读选出交集列并执行行数预算检查,不写 target。
 * 两张表都通过后才会进入同一个整库事务。
 */
interface PreparedTableImport {
  stats: LegacyImportTableStats;
  insertable: string[];
  rows: Array<Record<string, unknown>>;
}

function prepareTableImport(
  legacyDb: Database.Database,
  targetDb: Database.Database,
  table: 'sessions' | 'messages',
  wantedColumns: readonly string[],
  maxRows: number,
): PreparedTableImport {
  const stats = emptyTableStats();
  const legacyColumns = tableColumns(legacyDb, table);
  if (legacyColumns.length === 0) {
    // 表不存在:不算失败(更旧的 schema),诊断标注。
    stats.tableMissing = true;
    return { stats, insertable: [], rows: [] };
  }
  const columns = intersectColumns(legacyColumns, wantedColumns);
  stats.droppedLegacyColumns = legacyColumns.filter((c) => !columns.includes(c));
  if (columns.length === 0) return { stats, insertable: [], rows: [] };

  // 预算检查先于取行:超预算不把大表读进内存,也不产生任何写入。
  const countRow = legacyDb.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
  stats.rowsScanned = countRow.n;
  if (countRow.n > maxRows) {
    stats.errorKind = 'budget-exceeded';
    return { stats, insertable: [], rows: [] };
  }

  const targetColumns = tableColumns(targetDb, table);
  const insertable = columns.filter((c) => targetColumns.includes(c));
  if (insertable.length === 0) return { stats, insertable, rows: [] };

  const rows = legacyDb
    .prepare(`SELECT ${quotedList(columns)} FROM "${table}" ORDER BY rowid ASC`)
    .all() as Array<Record<string, unknown>>;

  return { stats, insertable, rows };
}

function applyPreparedTableImport(
  targetDb: Database.Database,
  table: 'sessions' | 'messages',
  prepared: PreparedTableImport,
): void {
  if (prepared.insertable.length === 0) return;
  const placeholders = prepared.insertable.map(() => '?').join(', ');
  const insert = targetDb.prepare(
    `INSERT OR IGNORE INTO "${table}" (${quotedList(prepared.insertable)}) VALUES (${placeholders})`,
  );
  for (const row of prepared.rows) {
    const info = insert.run(...prepared.insertable.map((c) => row[c] ?? null));
    if (info.changes > 0) prepared.stats.rowsInserted += 1;
    else prepared.stats.rowsSkipped += 1;
  }
}

/**
 * 导入一份旧会话库。任何失败(打开/查询/事务)都以 ok:false + errorKind 返回,
 * **不抛异常**(调用方按库粒度聚合诊断;单库失败不影响其他库)。
 * 任一表带 errorKind(如 budget-exceeded)同样记为 ok:false。
 */
export function importLegacyDb(
  legacyDbPath: string,
  targetDb: Database.Database,
  options?: { maxRows?: number },
): LegacyImportDbStats {
  const result: LegacyImportDbStats = {
    filePath: legacyDbPath,
    sessions: emptyTableStats(),
    messages: emptyTableStats(),
    ok: false,
    errorKind: null,
  };
  let legacyDb: Database.Database | null = null;
  try {
    // 只读打开官方旧库(不落 journal、不写旧文件);native binding 与 localDb 同源工厂。
    legacyDb = createBetterSqliteDatabase(legacyDbPath, {
      readonly: true,
      fileMustExist: true,
    });
    const maxRows = options?.maxRows ?? LEGACY_IMPORT_MAX_ROWS_PER_TABLE;
    const sessions = prepareTableImport(legacyDb, targetDb, 'sessions', SESSION_COLUMNS, maxRows);
    const messages = prepareTableImport(legacyDb, targetDb, 'messages', MESSAGE_COLUMNS, maxRows);
    result.sessions = sessions.stats;
    result.messages = messages.stats;

    // Preflight both tables before the first write. Budget/schema diagnostics
    // therefore cannot leave the earlier table committed.
    result.errorKind = result.sessions.errorKind ?? result.messages.errorKind;
    if (result.errorKind) return result;

    targetDb.transaction(() => {
      applyPreparedTableImport(targetDb, 'sessions', sessions);
      applyPreparedTableImport(targetDb, 'messages', messages);
    })();
    result.ok = true;
    return result;
  } catch (err) {
    // These counters describe committed effects. The outer transaction has
    // rolled every inserted row back when execution reaches this branch.
    result.sessions.rowsInserted = 0;
    result.messages.rowsInserted = 0;
    const message = err instanceof Error ? err.message : String(err);
    result.errorKind = /no such table/i.test(message)
      ? 'no-such-table'
      : /SQLITE_CORRUPT|file is not a database/i.test(message)
        ? 'corrupt-db'
        : 'txn-failed';
    return result;
  } finally {
    try {
      legacyDb?.close();
    } catch {
      /* noop */
    }
  }
}

/** 供测试/调用方构造路径使用(与 discover 的文件命名约定一致)。 */
export function legacyDbFileName(userId: string): string {
  return `cindy-${userId}.db`;
}

export function resolveLegacyDbPath(dir: string, userId: string): string {
  return path.join(dir, legacyDbFileName(userId));
}
