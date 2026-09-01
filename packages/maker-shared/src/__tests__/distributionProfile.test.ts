import { describe, expect, it } from 'vitest';

import {
  BRAND_IDENTITY,
  DEFAULT_CINDY_REGION,
} from '../brandIdentity.js';
import {
  assertDistributionProfile,
  DISTRIBUTION_CAPABILITY_KEYS,
  OFFICIAL_DISTRIBUTION_IDS,
  OFFICIAL_DISTRIBUTION_PROFILES,
  officialProfileForRegion,
  resolveBrandIdentityFromProfile,
  validateDistributionProfile,
  type DistributionProfile,
} from '../distributionProfile.js';

describe('official profiles(官方三身份回归)', () => {
  it('distributionId 与官方集合一致', () => {
    expect(OFFICIAL_DISTRIBUTION_IDS).toEqual(['cindy-cn', 'cindy-global', 'cindy-dev']);
    for (const region of ['cn', 'global', 'dev'] as const) {
      expect(OFFICIAL_DISTRIBUTION_PROFILES[region].distributionId).toBe(`cindy-${region}`);
      expect(OFFICIAL_DISTRIBUTION_PROFILES[region].region).toBe(region);
    }
  });

  it('身份字段逐项派生自 BRAND_IDENTITY(单一事实源,不复制字面量)', () => {
    for (const region of ['cn', 'global', 'dev'] as const) {
      const profile = OFFICIAL_DISTRIBUTION_PROFILES[region];
      const appId = BRAND_IDENTITY.appIdByRegion[region];
      expect(profile.brand.desktopAppId).toBe(appId);
      // Mobile 与 Desktop 同一套 appId 命名(app.config.js 同值)。
      expect(profile.brand.iosBundleId).toBe(appId);
      expect(profile.brand.androidPackage).toBe(appId);
      expect(profile.brand.executableName).toBe(BRAND_IDENTITY.executableNameByRegion[region]);
      expect(profile.brand.userDataName).toBe(BRAND_IDENTITY.userDataDirNameByRegion[region]);
      // scheme 全集 = 主 scheme + legacy,顺序与 allDeepLinkSchemes 一致。
      expect(profile.brand.urlSchemes).toEqual([
        region === 'dev' ? 'cindydev' : BRAND_IDENTITY.primaryScheme,
        ...BRAND_IDENTITY.legacySchemes,
      ]);
      expect(profile.brand.productName).toBe(BRAND_IDENTITY.displayName);
    }
  });

  it('官方身份快照:cn / global / dev 关键字面量锁定', () => {
    // 这些值若变化即官方发行身份变化,必须同步 mobile app.config.js、
    // forge.config.ts、CI/发布脚本与 endpointManifestCache,不允许静默漂移。
    expect(OFFICIAL_DISTRIBUTION_PROFILES.cn.brand).toMatchObject({
      desktopAppId: 'com.xd.cindycn',
      executableName: 'Cindy',
      userDataName: 'Cindy',
      secureStorageNamespace: 'cindy',
      privacyUrl: 'https://protocol.xd.cn/cindy/privacy-1.0.html',
      termsUrl: 'https://protocol.xd.cn/cindy/agreement.html',
      websiteUrl: 'https://cindy.com.cn',
    });
    expect(OFFICIAL_DISTRIBUTION_PROFILES.global.brand).toMatchObject({
      desktopAppId: 'com.xd.cindy',
      executableName: 'Cindy',
      userDataName: 'CindyGlobal',
      secureStorageNamespace: 'cindy',
      privacyUrl: 'https://protocol.xd.com/cindy/privacy.html',
      termsUrl: 'https://protocol.xd.com/cindy/agreement-1.0.html',
      websiteUrl: 'https://cindy.app',
    });
    expect(OFFICIAL_DISTRIBUTION_PROFILES.dev.brand).toMatchObject({
      desktopAppId: 'com.xd.cindydev',
      executableName: 'CindyDev',
      userDataName: 'CindyDev',
      secureStorageNamespace: 'cindydev',
    });
  });

  it('信任根与双 realm 行为:官方保留现有语义', () => {
    for (const region of ['cn', 'global', 'dev'] as const) {
      const profile = OFFICIAL_DISTRIBUTION_PROFILES[region];
      // 与 endpointManifestCache.ts REGION_ENDPOINT_DOMAIN 同源(两个域都进信任根,
      // 与现有双 realm 缓存一致);由 brand-identity-sync 测试锁定镜像。
      expect(profile.endpointManifest.mode).toBe('remote');
      expect(profile.endpointManifest.trustedEndpointDomains).toEqual([
        'cindy.com.cn',
        'cindy.app',
      ]);
      expect(profile.authRealm).toBe('global');
      expect(profile.crossRealmOrgLoginEnabled).toBe(true);
      expect(profile.telemetryPolicy).toBe('official');
      expect(profile.updateMode).toBe('official');
    }
  });

  it('官方 capability 默认全开,键集与蓝图 taxonomy 一致', () => {
    expect(DISTRIBUTION_CAPABILITY_KEYS).toHaveLength(16);
    for (const region of ['cn', 'global', 'dev'] as const) {
      const defaults = OFFICIAL_DISTRIBUTION_PROFILES[region].capabilityDefaults;
      for (const key of DISTRIBUTION_CAPABILITY_KEYS) {
        expect(defaults[key]).toBe(true);
      }
    }
  });

  it('官方三 profile 通过完整校验', () => {
    for (const region of ['cn', 'global', 'dev'] as const) {
      expect(validateDistributionProfile(OFFICIAL_DISTRIBUTION_PROFILES[region])).toEqual([]);
      expect(() => assertDistributionProfile(OFFICIAL_DISTRIBUTION_PROFILES[region])).not.toThrow();
    }
  });

  it('officialProfileForRegion 与预构建表一致', () => {
    for (const region of ['cn', 'global', 'dev'] as const) {
      expect(officialProfileForRegion(region)).toEqual(OFFICIAL_DISTRIBUTION_PROFILES[region]);
    }
  });

  it('默认区域仍为 global(现有构建语义不变)', () => {
    expect(DEFAULT_CINDY_REGION).toBe('global');
  });
});

// ---------------------------------------------------------------------------
// 独立发行(self-host 等)profile
// ---------------------------------------------------------------------------

/** 蓝图 §3.7 形态 A(Local-first Desktop)的最小合法 profile 样例。 */
function selfHostProfile(overrides?: Partial<DistributionProfile>): DistributionProfile {
  return {
    distributionId: 'freeworkbuddy-selfhost',
    authRealm: 'global',
    crossRealmOrgLoginEnabled: false,
    brand: {
      productName: 'FreeWorkBuddy',
      companyName: 'FreeWorkBuddy Contributors',
      desktopAppId: 'me.freeworkbuddy.desktop',
      iosBundleId: 'me.freeworkbuddy.ios',
      androidPackage: 'me.freeworkbuddy.android',
      executableName: 'FreeWorkBuddy',
      urlSchemes: ['freeworkbuddy'],
      userDataName: 'FreeWorkBuddy',
      secureStorageNamespace: 'freeworkbuddy',
      privacyUrl: 'https://freeworkbuddy.me/privacy',
      termsUrl: 'https://freeworkbuddy.me/terms',
    },
    endpointManifest: {
      mode: 'embedded',
      trustedEndpointDomains: ['freeworkbuddy.me'],
    },
    capabilityDefaults: Object.fromEntries(
      DISTRIBUTION_CAPABILITY_KEYS.map((k) => [k, false]),
    ) as DistributionProfile['capabilityDefaults'],
    telemetryPolicy: 'disabled',
    updateMode: 'disabled',
    ...overrides,
  } as DistributionProfile;
}

describe('self-host / 独立发行 profile 校验', () => {
  it('合法的 Local-first profile 通过校验', () => {
    expect(validateDistributionProfile(selfHostProfile())).toEqual([]);
  });

  it('身份隔离:不得复用官方 app id / scheme / userData / 凭据 namespace', () => {
    const cases: Array<[Partial<DistributionProfile>, string]> = [
      [{ brand: { ...selfHostProfile().brand, desktopAppId: 'com.xd.cindy' } }, 'desktopAppId'],
      [{ brand: { ...selfHostProfile().brand, iosBundleId: 'com.xd.cindycn' } }, 'iosBundleId'],
      [{ brand: { ...selfHostProfile().brand, androidPackage: 'com.xd.cindydev' } }, 'androidPackage'],
      [{ brand: { ...selfHostProfile().brand, urlSchemes: ['cindy'] } }, 'urlSchemes'],
      [{ brand: { ...selfHostProfile().brand, userDataName: 'CindyGlobal' } }, 'userDataName'],
      [{ brand: { ...selfHostProfile().brand, secureStorageNamespace: 'cindy' } }, 'secureStorageNamespace'],
    ];
    for (const [override, field] of cases) {
      const errors = validateDistributionProfile(selfHostProfile(override));
      expect(errors.some((e) => e.includes(field))).toBe(true, `${field} 冲突未被拦截: ${errors.join('; ')}`);
    }
  });

  it('独立发行必须关闭跨 realm 且不得使用 official 策略值', () => {
    expect(
      validateDistributionProfile(selfHostProfile({ crossRealmOrgLoginEnabled: true })).some((e) =>
        e.includes('crossRealmOrgLoginEnabled'),
      ),
    ).toBe(true);
    expect(
      validateDistributionProfile(selfHostProfile({ telemetryPolicy: 'official' })).some((e) =>
        e.includes('official'),
      ),
    ).toBe(true);
    expect(
      validateDistributionProfile(selfHostProfile({ updateMode: 'official' })).some((e) =>
        e.includes('updateMode'),
      ),
    ).toBe(true);
  });

  it('独立发行不得声明官方 region', () => {
    expect(
      validateDistributionProfile(selfHostProfile({ region: 'global' })).some((e) =>
        e.includes('region'),
      ),
    ).toBe(true);
  });

  it('法律 / 安全必填项缺失即失败(不回退官方值)', () => {
    const missingPrivacy = selfHostProfile({
      brand: { ...selfHostProfile().brand, privacyUrl: '' },
    });
    expect(validateDistributionProfile(missingPrivacy).some((e) => e.includes('privacyUrl'))).toBe(true);
    const httpTerms = selfHostProfile({
      brand: { ...selfHostProfile().brand, termsUrl: 'http://freeworkbuddy.me/terms' },
    });
    expect(validateDistributionProfile(httpTerms).some((e) => e.includes('termsUrl'))).toBe(true);
  });

  it('embedded manifest 禁止 bootstrapUrl;remote 的独立发行必须有自举源', () => {
    const embeddedWithUrl = selfHostProfile({
      endpointManifest: { mode: 'embedded', bootstrapUrl: 'https://freeworkbuddy.me/endpoint.json', trustedEndpointDomains: ['freeworkbuddy.me'] },
    });
    expect(validateDistributionProfile(embeddedWithUrl).some((e) => e.includes('bootstrapUrl'))).toBe(true);
    const remoteWithoutUrl = selfHostProfile({
      endpointManifest: { mode: 'remote', trustedEndpointDomains: ['freeworkbuddy.me'] },
    });
    expect(validateDistributionProfile(remoteWithoutUrl).some((e) => e.includes('bootstrapUrl'))).toBe(true);
    const remoteOk = selfHostProfile({
      endpointManifest: { mode: 'remote', bootstrapUrl: 'https://freeworkbuddy.me/endpoint.json', trustedEndpointDomains: ['freeworkbuddy.me'] },
    });
    expect(validateDistributionProfile(remoteOk)).toEqual([]);
  });

  it('信任根缺失或非法即失败(fail-closed 需要)', () => {
    const empty = selfHostProfile({
      endpointManifest: { mode: 'embedded', trustedEndpointDomains: [] },
    });
    expect(validateDistributionProfile(empty).some((e) => e.includes('trustedEndpointDomains'))).toBe(true);
  });

  it('capabilityDefaults:未知键与缺键都被拒绝', () => {
    const unknownKey = selfHostProfile({
      capabilityDefaults: { ...selfHostProfile().capabilityDefaults, canUseTelepathy: true },
    } as Partial<DistributionProfile>);
    expect(validateDistributionProfile(unknownKey).some((e) => e.includes('canUseTelepathy'))).toBe(true);
    const missingKey = selfHostProfile({
      capabilityDefaults: Object.fromEntries(
        Object.entries(selfHostProfile().capabilityDefaults).filter(([k]) => k !== 'canUseAccount'),
      ),
    } as Partial<DistributionProfile>);
    expect(validateDistributionProfile(missingKey).some((e) => e.includes('canUseAccount'))).toBe(true);
  });

  it('assertDistributionProfile 把校验失败变成构建期硬错误', () => {
    expect(() => assertDistributionProfile(selfHostProfile())).not.toThrow();
    expect(() => assertDistributionProfile(selfHostProfile({ distributionId: 'Bad_Id' }))).toThrow(/distributionId/);
  });
});

describe('resolveBrandIdentityFromProfile', () => {
  it('官方 profile 原样返回 BRAND_IDENTITY(区域差异保留)', () => {
    for (const region of ['cn', 'global', 'dev'] as const) {
      expect(resolveBrandIdentityFromProfile(OFFICIAL_DISTRIBUTION_PROFILES[region])).toBe(BRAND_IDENTITY);
    }
  });

  it('独立发行派生:by-region 三键同值、legacy 恒为空、派生名随 distributionId', () => {
    const identity = resolveBrandIdentityFromProfile(selfHostProfile());
    expect(identity.displayName).toBe('FreeWorkBuddy');
    expect(identity.executableName).toBe('FreeWorkBuddy');
    expect(identity.executableNameByRegion).toEqual({
      cn: 'FreeWorkBuddy',
      global: 'FreeWorkBuddy',
      dev: 'FreeWorkBuddy',
    });
    expect(identity.appIdByRegion).toEqual({
      cn: 'me.freeworkbuddy.desktop',
      global: 'me.freeworkbuddy.desktop',
      dev: 'me.freeworkbuddy.desktop',
    });
    expect(identity.primaryScheme).toBe('freeworkbuddy');
    expect(identity.legacySchemes).toEqual([]);
    expect(identity.userDataDirNameByRegion).toEqual({
      cn: 'FreeWorkBuddy',
      global: 'FreeWorkBuddy',
      dev: 'FreeWorkBuddy',
    });
    expect(identity.legacyUserDataDirNames).toEqual([]);
    expect(identity.legacyDialogueUserDataDirNamesByRegion.cn).toEqual([]);
    expect(identity.cdnPrefix).toBe('freeworkbuddy-selfhost');
    expect(identity.updaterName).toBe('freeworkbuddy-selfhost-updater');
    expect(identity.dbFilePrefix).toBe('freeworkbuddy-selfhost');
    expect(identity.legacyDbFilePrefixes).toEqual([]);
  });

  it('派生结果可被现有 brand*() 消费面以任意 region 参数使用', async () => {
    const { brandAppId, brandExecutableName, brandUserDataDirName } = await import('../brandIdentity.js');
    const identity = resolveBrandIdentityFromProfile(selfHostProfile());
    for (const region of ['cn', 'global', 'dev'] as const) {
      expect(brandAppId(region, identity)).toBe('me.freeworkbuddy.desktop');
      expect(brandExecutableName(region, identity)).toBe('FreeWorkBuddy');
      expect(brandUserDataDirName(region, identity)).toBe('FreeWorkBuddy');
    }
  });
});
