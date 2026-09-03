/**
 * legacyImport 跨进程协议(蓝图 §3.16)。
 *
 * shared 只放协议类型与 channel 名常量;发现/导入逻辑在 main/legacyImport,
 * renderer 只通过 preload 的固定方法消费。红线:不导入 token / 组织 session /
 * model grant / hook binding / push registration;诊断不含消息正文。
 */

export const LEGACY_IMPORT_DISCOVER_CHANNEL = 'legacy-import:discover';
export const LEGACY_IMPORT_EXECUTE_CHANNEL = 'legacy-import:execute';

import type { CindyRegion } from '@cindy/maker-shared/brand-identity';

/** 官方发行版 userData 目录名(discover 侧使用;协议里只透传字符串)。 */
export const LEGACY_USER_DATA_DIR_NAMES: Readonly<Record<CindyRegion, string>> = Object.freeze({
  cn: 'Cindy',
  global: 'CindyGlobal',
  dev: 'CindyDev',
});

export interface LegacyImportDiscoveredDb {
  /** 所属官方 region 目录(cn/global/dev)。 */
  region: CindyRegion;
  /** 绝对路径(已验证为候选目录内 regular file)。 */
  filePath: string;
  /** 文件体积字节。 */
  sizeBytes: number;
  /** 从文件名解析的 userId(`<prefix>-<userId>.db`)。 */
  userId: string;
}

export interface LegacyImportDiscoveryResult {
  /** appData 根(调用方用于展示发现来源)。 */
  appDataDir: string;
  /** 已检查的候选目录(存在与否)。 */
  checkedDirs: Array<{ dir: string; exists: boolean }>;
  /** 发现的旧会话库(每目录最多一条最新 mtime)。 */
  databases: LegacyImportDiscoveredDb[];
  /** 发现阶段的非致命问题(拒绝原因),不含用户内容。 */
  warnings: string[];
}

export interface LegacyImportTableStats {
  rowsScanned: number;
  rowsInserted: number;
  rowsSkipped: number;
  /** 旧库存在但新库完全没有的列(丢弃清单,进诊断)。 */
  droppedLegacyColumns: string[];
  /** 'budget-exceeded' 等;null = 正常。 */
  errorKind: string | null;
  /** 旧库无该表(更旧 schema),无行可导。 */
  tableMissing: boolean;
}

export interface LegacyImportDbStats {
  filePath: string;
  sessions: LegacyImportTableStats;
  messages: LegacyImportTableStats;
  ok: boolean;
  /** 失败分类(no-such-table / open-failed / corrupt-db / budget-exceeded / txn-failed)。 */
  errorKind: string | null;
  /** execute 侧输入被拒时的原因(path-not-from-discovery);discover 侧不出现。 */
  rejected?: string;
}

export interface LegacyImportExecuteInput {
  /** 用户勾选要导入的旧库(必须来自 discover 的结果,main 侧重新校验)。 */
  filePaths: readonly string[];
}

export interface LegacyImportExecuteResult {
  results: LegacyImportDbStats[];
}
