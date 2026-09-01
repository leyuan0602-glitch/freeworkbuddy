/**
 * regionUserData — 按构建区域选择 Electron userData 目录。
 *
 * 背景:cn / global 是两个可同机并存的系统身份(appId / exe / 安装目录已按
 * 区域派生),但 Electron 默认 userData 目录由 package.json productName('Cindy')
 * 派生,两个区域的包会共用同一目录——数据库 / 登录态 / 单实例锁全部串台。
 * 因此 global 构建与 dev 启动都在 main 入口最早期(initLogger、crashReporter、
 * 单实例锁、一切 userData 读取之前)把 userData 切到当前区域目录。正式目录保持
 * 历史兼容：cn=`Cindy`、global=`CindyGlobal`；内部 dev 身份使用 `CindyDev`。
 *
 * 语义边界:
 *  - cn 构建的区域目录名 = productName 默认派生目录 → 返回 null,零改动,
 *    保持 Electron 原生行为(线上 cn 包与历史行为完全一致)。
 *  - 非 packaged 启动同样按区域选正式 profile；`--isolated` 再由 devCliFlags
 *    基于这个区域目录派生 `<区域目录>-dev2[-<名字>]`。
 *  - 命令行显式传了 Chromium 原生 `--user-data-dir` 时返回 null，尊重调用方。
 *    `XDT_USER_DATA_DIR` 是 devCliFlags 的最终覆写；这里仍先建立区域默认
 *    profile，确保隔离 epoch comparison 以 CindyGlobal / Cindy / CindyDev 为基线。
 *  - 只决定**目录名**,拼绝对路径(appData 基址)留给调用方——本模块保持
 *    零 Electron 依赖,可直接单测。
 */

import {
  BRAND_IDENTITY,
  type BrandIdentity,
  type CindyRegion,
} from '@cindy/maker-shared/brand-identity';

/** argv 里是否显式指定了 Chromium 原生 --user-data-dir(= 与空格两种形态)。 */
function hasExplicitUserDataDir(argv: readonly string[]): boolean {
  return argv.some((a) => a === '--user-data-dir' || a.startsWith('--user-data-dir='));
}

/**
 * 解析本构建是否需要覆写 userData 目录。
 * 返回目录名(调用方拼到 appData 下)或 null(保持 Electron 默认)。
 *
 * identity(工作流 B):本构建的发行身份(main 从 brandRegion.CURRENT_BRAND_IDENTITY
 * 传入;缺省官方 BRAND_IDENTITY)。官方路径沿用历史同名优化(cn 目录 = productName
 * 派生 → 不覆写);独立发行与官方身份不同,无条件覆写到 profile 的 userDataName,
 * 保证与官方发行版数据分库(蓝图 §3.3 验收:互不共享 userData)。
 */
export function resolveRegionUserDataDirName(input: {
  isPackaged: boolean;
  region: CindyRegion;
  argv: readonly string[];
  envUserDataDir?: string;
  identity?: BrandIdentity;
}): string | null {
  if (hasExplicitUserDataDir(input.argv)) return null;
  const identity = input.identity ?? BRAND_IDENTITY;
  const dirName = identity.userDataDirNameByRegion[input.region];
  // 独立发行:身份与官方不同,无条件覆写,不依赖 productName 派生同名判断
  // (packaged 包的默认派生目录随打包身份走,显式 setPath 让隔离行为
  // 不依赖打包器细节)。
  if (identity !== BRAND_IDENTITY) return dirName;
  // 与 productName 默认派生目录同名(cn)→ 不覆写,走 Electron 原生路径。
  if (dirName === BRAND_IDENTITY.userDataDirName) return null;
  return dirName;
}
