/**
 * legacyImport/ipc — 显式数据导入的 main IPC(蓝图 §3.16)。
 *
 * 两个 channel:
 *  - legacy-import:discover —— 只读发现旧官方发行版数据(可反复调,零副作用);
 *  - legacy-import:execute  —— 按用户选择的库执行导入(事务幂等,失败保留旧数据)。
 *
 * 安全边界(Electron 进程边界规则 §5):
 *  - 两个 handler 都过 assertTrustedAppRendererEvent(Cindy 自有顶层 frame);
 *  - execute 的 payload 在结构之外还校验条目数与字符串长度上限;
 *    路径授权不来自 Renderer 自报——必须在 discover 结果或候选目录形态内重新校验。
 *
 * gate:仅本地模式/未登录均可显式导入自己的旧数据(不涉及云端);执行前要求
 * 当前 db 已 ensureReady(导入目标始终是**新发行版自己的库**)。
 */
import path from 'node:path';

import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';

import { assertTrustedAppRendererEvent } from '../security/trustedAppRenderer.js';
import { getCurrentDbPath, getRawDb } from '../localDb/index.js';
import { createLogger } from '../logger.js';
import {
  LEGACY_IMPORT_DISCOVER_CHANNEL,
  LEGACY_IMPORT_EXECUTE_CHANNEL,
  type LegacyImportDiscoveryResult,
  type LegacyImportExecuteInput,
  type LegacyImportExecuteResult,
} from '../../shared/legacyImport.js';
import { discoverLegacyDatabases } from './discover';
import { importLegacyDb } from './importAdapter';

const log = createLogger('legacy-import');

/** 单次 execute 最多导入的库数(合法输入最多 = 3 个候选目录,留余量)。 */
const MAX_FILES_PER_EXECUTE = 8;
/** 单条路径字符串长度上限(防病态超长输入)。 */
const MAX_PATH_LENGTH = 4096;

let registered = false;

function emptyStats(filePath: string): LegacyImportExecuteResult['results'][number] {
  return {
    filePath,
    sessions: {
      rowsScanned: 0,
      rowsInserted: 0,
      rowsSkipped: 0,
      droppedLegacyColumns: [],
      errorKind: null,
      tableMissing: false,
    },
    messages: {
      rowsScanned: 0,
      rowsInserted: 0,
      rowsSkipped: 0,
      droppedLegacyColumns: [],
      errorKind: null,
      tableMissing: false,
    },
    ok: false,
    errorKind: null,
    rejected: 'path-not-from-discovery',
  };
}

/** 重新校验 execute 的输入路径:必须落在候选目录内且是合法旧库文件名。 */
export function isAcceptableLegacyPath(
  filePath: string,
  discovery: LegacyImportDiscoveryResult,
): boolean {
  const known = discovery.databases.some((d) => d.filePath === filePath);
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

  ipcMain.handle(LEGACY_IMPORT_DISCOVER_CHANNEL, (event): LegacyImportDiscoveryResult => {
    assertTrustedAppRendererEvent(event as IpcMainInvokeEvent);
    return discoverLegacyDatabases(app.getPath('appData'));
  });

  ipcMain.handle(
    LEGACY_IMPORT_EXECUTE_CHANNEL,
    (event, input: unknown): LegacyImportExecuteResult => {
      assertTrustedAppRendererEvent(event as IpcMainInvokeEvent);
      const rawList = (input as LegacyImportExecuteInput | null)?.filePaths;
      const filePaths = Array.isArray(rawList) ? rawList.filter((p): p is string => typeof p === 'string') : [];
      if (filePaths.length === 0 || filePaths.length > MAX_FILES_PER_EXECUTE) {
        return { results: [] };
      }
      const usable = filePaths.filter((p) => p.length > 0 && p.length <= MAX_PATH_LENGTH);
      if (usable.length === 0) {
        return { results: [] };
      }
      const discovery = discoverLegacyDatabases(app.getPath('appData'));
      const targetPath = getCurrentDbPath();
      if (!targetPath) {
        throw new Error('legacy-import: target local db is not initialized');
      }
      const targetDb = getRawDb();
      const results: LegacyImportExecuteResult['results'] = [];
      for (const filePath of usable) {
        if (!isAcceptableLegacyPath(filePath, discovery)) {
          results.push(emptyStats(filePath));
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
    },
  );
}
