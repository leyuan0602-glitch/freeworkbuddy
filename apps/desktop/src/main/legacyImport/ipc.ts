/**
 * legacyImport/ipc — 显式数据导入的 main IPC(蓝图 §3.16)。
 *
 * 两个 channel:
 *  - legacy-import:discover —— 只读发现旧官方发行版数据(可反复调,零副作用);
 *  - legacy-import:execute  —— 按用户选择的库执行导入(事务幂等,失败保留旧数据)。
 *
 * gate:仅本地模式/未登录均可显式导入自己的旧数据(不涉及云端);执行前要求
 * 当前 db 已 ensureReady(导入目标始终是**新发行版自己的库**)。
 */
import { app, ipcMain } from 'electron';

import { getCurrentDbPath, getRawDb } from '../localDb/index.js';
import { createLogger } from '../logger.js';
import {
  discoverLegacyDatabases,
  type DiscoveredLegacyDb,
  type LegacyDiscoveryResult,
} from './discover';
import { importLegacyDb, type LegacyDbImportStats } from './importAdapter';

const log = createLogger('legacy-import');

const DISCOVER_CHANNEL = 'legacy-import:discover';
const EXECUTE_CHANNEL = 'legacy-import:execute';

let registered = false;

export interface LegacyImportExecuteInput {
  /** 用户勾选要导入的旧库(必须来自 discover 的结果,重新校验)。 */
  filePaths: readonly string[];
}

export interface LegacyImportExecuteResult {
  results: Array<LegacyDbImportStats & { rejected?: string }>;
}

/** 重新校验 execute 的输入路径:必须落在候选目录内且是合法旧库文件名。 */
function isAcceptableLegacyPath(
  filePath: string,
  discovery: LegacyDiscoveryResult,
): boolean {
  const known = discovery.databases.some((d: DiscoveredLegacyDb) => d.filePath === filePath);
  if (known) return true;
  // discover 之后文件可能被外部改动:仍要求路径形态合法(候选目录 + cindy-*.db)。
  for (const checked of discovery.checkedDirs) {
    if (!filePath.startsWith(checked.dir + path.sep)) continue;
    const base = path.basename(filePath);
    if (base.startsWith('cindy-') && base.endsWith('.db')) return true;
  }
  return false;
}

export function registerLegacyImportIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(DISCOVER_CHANNEL, (): LegacyDiscoveryResult => {
    return discoverLegacyDatabases(app.getPath('appData'));
  });

  ipcMain.handle(EXECUTE_CHANNEL, (_event, input: unknown): LegacyImportExecuteResult => {
    const filePaths =
      Array.isArray((input as LegacyImportExecuteInput | null)?.filePaths)
        ? (input as LegacyImportExecuteInput).filePaths
        : [];
    if (filePaths.length === 0) {
      return { results: [] };
    }
    const discovery = discoverLegacyDatabases(app.getPath('appData'));
    const targetPath = getCurrentDbPath();
    if (!targetPath) {
      throw new Error('legacy-import: target local db is not initialized');
    }
    const targetDb = getRawDb();
    const results: LegacyImportExecuteResult['results'] = [];
    for (const filePath of filePaths) {
      if (typeof filePath !== 'string' || !isAcceptableLegacyPath(filePath, discovery)) {
        results.push({
          filePath: String(filePath),
          sessions: { rowsScanned: 0, rowsInserted: 0, rowsSkipped: 0, droppedLegacyColumns: [], errorKind: null, tableMissing: false },
          messages: { rowsScanned: 0, rowsInserted: 0, rowsSkipped: 0, droppedLegacyColumns: [], errorKind: null, tableMissing: false },
          ok: false,
          errorKind: null,
          rejected: 'path-not-from-discovery',
        });
        continue;
      }
      const stats = importLegacyDb(filePath, targetDb);
      log.info(
        'legacy import done (ok=%s sessions=%d messages=%d)',
        stats.ok,
        stats.sessions.rowsInserted,
        stats.messages.rowsInserted,
      );
      results.push(stats);
    }
    return { results };
  });
}
