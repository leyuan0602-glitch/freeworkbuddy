/**
 * distribution-profile.cjs —— Mobile 构建期发行身份选取(app.config.js 的 CJS 投影)。
 *
 * FreeWorkBuddy self-hosting 工作流 B(蓝图 §3.3)PR 5:Mobile identity。
 * 与 desktop forge.config 同一 env 约定(CINDY_DISTRIBUTION_PROFILE),
 * 同一选取语义(缺省官方、未知 id 拒绝、官方与 region 矛盾即抛错)。
 *
 * ⚠️ 镜像边界:app.config.js 在 Expo config 求值链(CJS require)里,无法直接
 * import @cindy/maker-shared 的 TS 单点;本文件按仓库既有「CJS 镜像字面量 +
 * 镜像测试锁定」模式(scriptsf/__tests__/brand-identity-sync.test.mjs)与
 * packages/maker-shared/src/distributionProfile.ts 保持逐字段一致——单点翻转
 * 漏改这里,镜像测试立刻红灯。
 *
 * 官方路径(env 未设):返回 official,app.config 走既有 REGION_CONFIG 行为,
 * resolved ExpoConfig 逐字节不变(runtime fingerprint 不变,不触发冷更)。
 * 独立发行(freeworkbuddy-selfhost):身份来自本文件镜像;该变体是全新 app
 * 身份,无存量 OTA 用户,冷更影响仅限此变体(蓝图 §3.3 验收)。
 */

'use strict';

/** 官方 distributionId(与 maker-shared OFFICIAL_DISTRIBUTION_IDS 镜像)。 */
const OFFICIAL_DISTRIBUTION_IDS = Object.freeze(['cindy-cn', 'cindy-global', 'cindy-dev']);

/**
 * FreeWorkBuddy 独立发行的 Mobile 构建投影。
 * 镜像 maker-shared SELFHOST_FREEWORKBUDDY_PROFILE.brand 的 Mobile 字段
 * (iosBundleId / androidPackage / urlSchemes[0]);由 brand-identity-sync 锁定。
 */
const SELFHOST_FREEWORKBUDDY_MOBILE = Object.freeze({
  distributionId: 'freeworkbuddy-selfhost',
  productName: 'FreeWorkBuddy',
  scheme: 'freeworkbuddy',
  iosBundleIdentifier: 'me.freeworkbuddy.ios',
  androidPackage: 'me.freeworkbuddy.android',
  endpointManifestBaseUrl: 'https://freeworkbuddy.me',
});

const SELFHOST_DISTRIBUTIONS = Object.freeze({
  'freeworkbuddy-selfhost': SELFHOST_FREEWORKBUDDY_MOBILE,
});

/**
 * 解析 Mobile 构建期发行身份。
 * @param {{ CINDY_DISTRIBUTION_PROFILE?: string | undefined, EXPO_PUBLIC_CINDY_AUTH_REGION?: string | undefined }} env
 * @returns {{ kind: 'official', distributionId: null } | { kind: 'selfhost', distributionId: string, identity: typeof SELFHOST_FREEWORKBUDDY_MOBILE }}
 *   official 时 distributionId 为 null(调用方继续按 region 走 REGION_CONFIG);
 *   selfhost 时携带镜像身份。未知 id / 官方 id 与 region 矛盾 → 抛错,不回退。
 */
function resolveMobileDistribution(env = process.env) {
  const raw = (env.CINDY_DISTRIBUTION_PROFILE || '').trim();
  if (!raw) return { kind: 'official', distributionId: null };
  if ((OFFICIAL_DISTRIBUTION_IDS).includes(raw)) {
    // 官方 id 由 desktop 侧 forge/vite 处理;Mobile 官方构建继续用
    // EXPO_PUBLIC_CINDY_AUTH_REGION 选区域。两处同时给出时必须一致,防身份撕裂。
    const region = raw.slice('cindy-'.length);
    const regionInput = (env.EXPO_PUBLIC_CINDY_AUTH_REGION || '').trim();
    if (regionInput && regionInput !== region) {
      throw new Error(
        `Distribution profile mismatch: CINDY_DISTRIBUTION_PROFILE=${raw} but EXPO_PUBLIC_CINDY_AUTH_REGION=${regionInput}`,
      );
    }
    return { kind: 'official', distributionId: null };
  }
  const identity = SELFHOST_DISTRIBUTIONS[raw];
  if (!identity) {
    throw new Error(
      `Unknown distribution profile: ${JSON.stringify(raw)}; expected one of `
        + `${[...OFFICIAL_DISTRIBUTION_IDS, ...Object.keys(SELFHOST_DISTRIBUTIONS)].join(', ')}`,
    );
  }
  return { kind: 'selfhost', distributionId: raw, identity };
}

module.exports = {
  OFFICIAL_DISTRIBUTION_IDS,
  SELFHOST_FREEWORKBUDDY_MOBILE,
  SELFHOST_DISTRIBUTIONS,
  resolveMobileDistribution,
};
