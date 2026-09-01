/**
 * legacyImport/discover — 旧官方发行版(Cindy)本地数据的只读发现(蓝图 §3.16)。
 *
 * 独立发行(FreeWorkBuddy)使用全新 userData 与凭据 namespace,与官方版互不共享;
 * 本模块提供「显式导入」的第一步:只读发现旧 userData 里的会话数据库文件。
 *
 * 安全约束(蓝图 §3.16 第 5 条的发现侧部分):
 *  - 只扫 appData 下**固定候选目录名**(Cindy / CindyGlobal / CindyDev),不做递归扫描;
 *  - 文件必须是 regular file,**拒绝 symlink**(不跟随越界链接);
 *  - 路径必须解析后仍位于候选目录内(防 `..` 逃逸);
 *  - 单文件体积上限(防误选巨大/损坏文件拖垮导入)。
 *  - 发现过程零写入、零删除(旧数据在导入成功前原样保留,蓝图 §3.16 第 6 条)。
 *
 * 不导入(蓝图红线):官方 access/refresh token、组织 session、model grant、
 * hook binding、push registration —— 这些由各自存储承载,本模块只发现**会话数据库**。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { CindyRegion } from '@cindy/maker-shared/brand-identity';

/** 官方发行版的 userData 目录名(brandIdentity.userDataDirNameByRegion 镜像,镜像测试锁定)。 */
export const LEGACY_USER_DATA_DIR_NAMES: Readonly<Record<CindyRegion, string>> = Object.freeze({
  cn: 'Cindy',
  global: 'CindyGlobal',
  dev: 'CindyDev',
});

/** 官方 db 文件名前缀(brandIdentity.dbFilePrefix 镜像)。 */
export const LEGACY_DB_FILE_PREFIX = 'cindy';

/** 旧库单文件体积上限(512MB):正常会话库远小于此,超出按损坏/误选拒收。 */
export const LEGACY_DB_MAX_BYTES = 512 * 1024 * 1024;

export interface DiscoveredLegacyDb {
  /** 所属官方 region 目录(cn/global/dev)。 */
  region: CindyRegion;
  /** 绝对路径(已验证为候选目录内 regular file)。 */
  filePath: string;
  /** 文件体积字节。 */
  sizeBytes: number;
  /** 从文件名解析的 userId(`<prefix>-<userId>.db`)。 */
  userId: string;
}

export interface LegacyDiscoveryResult {
  /** appData 根(调用方用于展示发现来源)。 */
  appDataDir: string;
  /** 已检查的候选目录(存在与否)。 */
  checkedDirs: Array<{ dir: string; exists: boolean }>;
  /** 发现的旧会话库(每目录最多一条最新 mtime)。 */
  databases: DiscoveredLegacyDb[];
  /** 发现阶段的非致命问题(拒绝原因),不含用户内容。 */
  warnings: string[];
}

function isRegularNonSymlinkFile(filePath: string): boolean {
  try {
    // lstat:符号链接即使是常规目标也拒收(蓝图:不跟随越界 symlink)。
    const st = fs.lstatSync(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

function isInsideDir(filePath: string, dir: string): boolean {
  const rel = path.relative(dir, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 从目录下的文件清单挑出最新一份合法旧会话库。
 * 内部函数注入 readDir/lstat 便于测试;export 的 discoverLegacyDatabases 走真实 fs。
 */
export function pickLatestLegacyDbFromNames(
  dir: string,
  fileNames: readonly string[],
  now: number,
): { db: DiscoveredLegacyDb | null; warnings: string[] } {
  const warnings: string[] = [];
  const candidates: Array<{ filePath: string; mtimeMs: number; sizeBytes: number; userId: string }> = [];
  for (const name of fileNames) {
    if (!name.startsWith(`${LEGACY_DB_FILE_PREFIX}-`) || !name.endsWith('.db')) continue;
    if (name.endsWith('-wal.db') || name.endsWith('-shm.db')) continue;
    const filePath = path.join(dir, name);
    // 路径边界:解析后必须仍在目录内(防文件名携带 ../ 的病态输入)。
    if (!isInsideDir(path.resolve(filePath), path.resolve(dir))) {
      warnings.push(`skip(path-escape): ${name}`);
      continue;
    }
    if (!isRegularNonSymlinkFile(filePath)) {
      warnings.push(`skip(not-regular-file): ${name}`);
      continue;
    }
    const st = fs.lstatSync(filePath);
    if (st.size > LEGACY_DB_MAX_BYTES) {
      warnings.push(`skip(too-large): ${name} (${st.size} bytes)`);
      continue;
    }
    const userId = name.slice(`${LEGACY_DB_FILE_PREFIX}-`.length, -'.db'.length);
    if (!userId) {
      warnings.push(`skip(empty-user-id): ${name}`);
      continue;
    }
    // mtime 在未来超过 1 天 = 时钟异常/伪造,拒收。
    if (st.mtimeMs > now + 24 * 60 * 60 * 1000) {
      warnings.push(`skip(future-mtime): ${name}`);
      continue;
    }
    candidates.push({ filePath, mtimeMs: st.mtimeMs, sizeBytes: st.size, userId });
  }
  if (candidates.length === 0) return { db: null, warnings };
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = candidates[0];
  for (const other of candidates.slice(1)) {
    warnings.push(`skip(older-than-latest): ${path.basename(other.filePath)}`);
  }
  return {
    db: {
      region: 'cn',
      filePath: latest.filePath,
      sizeBytes: latest.sizeBytes,
      userId: latest.userId,
    },
    warnings,
  };
}

/**
 * 发现旧官方发行版的会话数据库。零写入(蓝图 §3.16:导入成功前旧数据原样保留)。
 */
export function discoverLegacyDatabases(appDataDir: string, now = Date.now()): LegacyDiscoveryResult {
  const result: LegacyDiscoveryResult = {
    appDataDir,
    checkedDirs: [],
    databases: [],
    warnings: [],
  };
  const regions: CindyRegion[] = ['cn', 'global', 'dev'];
  for (const region of regions) {
    const dir = path.join(appDataDir, LEGACY_USER_DATA_DIR_NAMES[region]);
    const exists = fs.existsSync(dir);
    result.checkedDirs.push({ dir, exists });
    if (!exists) continue;
    let fileNames: string[];
    try {
      fileNames = fs.readdirSync(dir);
    } catch (err) {
      result.warnings.push(`readdir-failed: ${dir} (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const { db, warnings } = pickLatestLegacyDbFromNames(dir, fileNames, now);
    result.warnings.push(...warnings.map((w) => `[${region}] ${w}`));
    if (db) {
      result.databases.push({ ...db, region });
    }
  }
  return result;
}
