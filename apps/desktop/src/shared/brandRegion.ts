/**
 * brandRegion — 本构建的区域身份(cn/global)与区域派生 appId 的运行时单点。
 *
 * 区域在**构建期**经 VITE_CINDY_AUTH_REGION 烘焙(main 走 vite.main.config.ts
 * 的 define,renderer 走标准 Vite env;生产由 desktopClientBuildEnv 注入,dev /
 * 未注入一律默认 global)。运行时不可切换——cn 与 global 是两个可并存的系统身份
 * (com.xd.cindycn / com.xd.cindy,与 mobile 同一套命名)。
 *
 * 发行身份(工作流 B,2026-09):独立发行(self-host 等)在构建期经
 * VITE_CINDY_DISTRIBUTION_ID / VITE_CINDY_DISTRIBUTION_IDENTITY 烘焙
 * (vite.main.config 与 forge.config 同一 resolveDistributionProfile 入口);
 * CURRENT_BRAND_IDENTITY 是 main / renderer 取**本构建系统身份**的唯一入口——
 * 官方构建等于 BRAND_IDENTITY(行为不变),独立发行等于注入的派生 identity。
 *
 * ⚠️ AUMID 三位一体:本文件的 CURRENT_APP_ID 必须与 NSIS appId(forge.config
 * 从同一 BUILD_IDENTITY 取值)、快捷方式 AUMID 逐字符一致,否则
 * Windows toast 通知被静默丢弃。
 */

import {
  BRAND_IDENTITY,
  resolveCindyRegion,
  type BrandIdentity,
  type CindyRegion,
} from '@cindy/maker-shared/brand-identity';

/** 本构建的区域(构建期烘焙;dev 默认 global)。 */
export const CURRENT_CINDY_REGION: CindyRegion = resolveCindyRegion(
  import.meta.env?.VITE_CINDY_AUTH_REGION,
);

/**
 * 本构建的 distributionId(恒注入;官方为 cindy-cn / cindy-global / cindy-dev,
 * 独立发行如 freeworkbuddy-selfhost)。渲染进程未注入 define 时回落官方 global id,
 * 与官方构建行为一致。
 */
export const CURRENT_DISTRIBUTION_ID: string =
  import.meta.env?.VITE_CINDY_DISTRIBUTION_ID || 'cindy-global';

/**
 * 解析注入的独立发行 identity(由 vite.main.config 从 resolveDistributionProfile
 * + resolveBrandIdentityFromProfile 序列化)。结构非法即抛错——身份字段错半个
 * 字符就是 AUMID / userData 漂移,宁可构建期炸。
 */
function parseInjectedIdentity(raw: string): BrandIdentity {
  const parsed = JSON.parse(raw) as BrandIdentity;
  if (
    typeof parsed?.primaryScheme !== 'string'
    || typeof parsed?.appIdByRegion?.global !== 'string'
    || typeof parsed?.userDataDirNameByRegion?.global !== 'string'
    || typeof parsed?.updaterName !== 'string'
  ) {
    throw new Error('VITE_CINDY_DISTRIBUTION_IDENTITY: 注入的发行身份结构非法');
  }
  return parsed;
}

/**
 * 本构建的系统身份。官方构建 = BRAND_IDENTITY(原引用,行为与历史一致);
 * 独立发行 = vite.main.config 注入的派生 identity(冻结语义由来源保证)。
 */
export const CURRENT_BRAND_IDENTITY: BrandIdentity = (() => {
  const injected = import.meta.env?.VITE_CINDY_DISTRIBUTION_IDENTITY;
  return injected ? parseInjectedIdentity(injected) : BRAND_IDENTITY;
})();

/** 本构建的系统身份 id(Windows AUMID / macOS bundle id)。 */
export const CURRENT_APP_ID: string = CURRENT_BRAND_IDENTITY.appIdByRegion[CURRENT_CINDY_REGION];
