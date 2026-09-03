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
import fs from 'node:fs';
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
import { discoverLegacyDatabases, LEGACY_DB_MAX_BYTES } from './discover';
import { importLegacyDb } from './importAdapter';

const log = createLogger('legacy-import');

/** 单次 execute 最多导入的库数(合法输入最多 = 3 个候选目录,留余量)。 */
const MAX_FILES_PER_EXECUTE = 8;
/** 单条路径字符串长度上限(防病态超长输入)。 */
const MAX_PATH_LENGTH = 4096;

let registered = false;

interface LegacyPathGrant {
  canonicalPath: string;
  canonicalDir: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

/** A discovery grant belongs to the webContents that received it. */
const grantsByOwner = new WeakMap<object, ReadonlyMap<string, LegacyPathGrant>>();

function grantOwner(event: IpcMainInvokeEvent): object {
  const sender = event.sender as unknown;
  return typeof sender === 'object' && sender !== null ? sender : event;
}

function readSecureLegacyPath(
  filePath: string,
  discovery: LegacyImportDiscoveryResult,
): LegacyPathGrant | null {
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath !== filePath) return null;
  if (!/^cindy-.+\.db$/.test(path.basename(filePath))) return null;

  const checkedDir = discovery.checkedDirs.find(
    ({ dir, exists }) => exists && path.resolve(dir) === path.dirname(resolvedPath),
  );
  if (!checkedDir) return null;

  try {
    const dirStat = fs.lstatSync(checkedDir.dir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return null;

    const fileStat = fs.lstatSync(resolvedPath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > LEGACY_DB_MAX_BYTES) {
      return null;
    }

    const canonicalDir = fs.realpathSync.native(checkedDir.dir);
    const canonicalPath = fs.realpathSync.native(resolvedPath);
    if (path.dirname(canonicalPath) !== canonicalDir) return null;

    return {
      canonicalPath,
      canonicalDir,
      dev: fileStat.dev,
      ino: fileStat.ino,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      ctimeMs: fileStat.ctimeMs,
    };
  } catch {
    return null;
  }
}

function sameGrant(actual: LegacyPathGrant, granted: LegacyPathGrant): boolean {
  return actual.canonicalPath === granted.canonicalPath
    && actual.canonicalDir === granted.canonicalDir
    && actual.dev === granted.dev
    && actual.ino === granted.ino
    && actual.size === granted.size
    && actual.mtimeMs === granted.mtimeMs
    && actual.ctimeMs === granted.ctimeMs;
}

function createDiscoveryGrant(
  discovery: LegacyImportDiscoveryResult,
): ReadonlyMap<string, LegacyPathGrant> {
  const grant = new Map<string, LegacyPathGrant>();
  for (const database of discovery.databases) {
    const fingerprint = readSecureLegacyPath(database.filePath, discovery);
    if (fingerprint && fingerprint.size === database.sizeBytes) {
      grant.set(database.filePath, fingerprint);
    }
  }
  return grant;
}

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
  const discovered = discovery.databases.find((d) => d.filePath === filePath);
  if (!discovered) return false;
  const actual = readSecureLegacyPath(filePath, discovery);
  return actual !== null && actual.size === discovered.sizeBytes;
}

export function registerLegacyImportIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(LEGACY_IMPORT_DISCOVER_CHANNEL, (event): LegacyImportDiscoveryResult => {
    assertTrustedAppRendererEvent(event as IpcMainInvokeEvent);
    const discovery = discoverLegacyDatabases(app.getPath('appData'));
    grantsByOwner.set(grantOwner(event as IpcMainInvokeEvent), createDiscoveryGrant(discovery));
    return discovery;
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
      const targetPath = getCurrentDbPath();
      if (!targetPath) {
        throw new Error('legacy-import: target local db is not initialized');
      }
      const targetDb = getRawDb();
      const ownerGrant = grantsByOwner.get(grantOwner(event as IpcMainInvokeEvent));
      const currentDiscovery = discoverLegacyDatabases(app.getPath('appData'));
      const results: LegacyImportExecuteResult['results'] = [];
      for (const filePath of usable) {
        const granted = ownerGrant?.get(filePath);
        const actual = readSecureLegacyPath(filePath, currentDiscovery);
        if (!granted || !actual || !sameGrant(actual, granted)) {
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
