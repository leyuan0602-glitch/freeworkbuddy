/**
 * distributionProfile — 发行身份(发行包是谁)的构建期事实源。
 *
 * FreeWorkBuddy self-hosting 改造工作流 B(蓝图 §3.3)第一阶段的 schema 层:
 * 回答「这份安装包是谁」,与「部署提供哪些服务」(endpoint manifest,
 * clientEndpoints.ts)和「部署允许用户使用哪些服务」(管理员策略)严格分层。
 *
 * ⚠️ 语义边界:
 *  - **构建期单点,不是运行时开关**。profile 在打包期选定并烘焙,运行时不可切换。
 *  - 与 `CindyRegion` **正交**:cn / global / dev 是官方发行的区域维度;
 *    self-host 等独立发行用独立 `distributionId`,不把 `selfhost` 塞进
 *    CindyRegion(蓝图 §2.1 非目标)。Self-host v1 内部 authRealm 仍用
 *    `global` 兼容现有 auth contract,UI 不显示 Global edition。
 *  - 官方三身份(cindy-cn / cindy-global / cindy-dev)全部**派生自
 *    brandIdentity.ts 的 BRAND_IDENTITY**,不复制字面量——官方身份的单一
 *    事实源不变。Desktop 与 Mobile 使用同一个 distributionId。
 *  - 本模块是纯逻辑层(仓规则):不做 IO、不做构建注入;profile 的选取
 *    (env → profile 实例)由打包脚本在后续 PR 接入。
 *  - legacy identifier 只增不减(brandIdentity.ts 的 legacy 数组是唯一载体;
 *    非官方 profile 派生的 identity legacy 数组恒为空——新发行没有历史)。
 *
 * 消费方(后续 PR 逐个接入,本阶段只有测试):
 *  - apps/desktop/forge.config.ts(appId / exe / scheme / updater 产物名)
 *  - Desktop Vite / release scripts(manifest mode、trust root、telemetry、update policy)
 *  - apps/mobile/app.config.js(bundle / package / scheme / push identity)
 */

import {
  BRAND_IDENTITY,
  resolveCindyRegion,
  type BrandIdentity,
  type CindyRegion,
} from './brandIdentity.js';

/**
 * 官方发行身份的 distributionId 集合。
 * 命名与 appIdByRegion 对齐(cindy-<region>);非此集合的 id 一律视为
 * 独立发行(self-host 等),触发更严格的身份隔离校验。
 */
export type OfficialDistributionId = 'cindy-cn' | 'cindy-global' | 'cindy-dev';

export const OFFICIAL_DISTRIBUTION_IDS: readonly OfficialDistributionId[] = Object.freeze([
  'cindy-cn',
  'cindy-global',
  'cindy-dev',
]);

/** 品牌与系统身份块。全部为构建期静态值,不含机密(签名私钥走外部 secret)。 */
export interface DistributionBrand {
  /** 展示名(与 branding.ts 的 BRAND_NAME 同层语义,随 profile 走)。 */
  readonly productName: string;
  /** 发行主体(法律实体名,进 About / 安装器 / 商店资料)。 */
  readonly companyName: string;
  /** Desktop 系统身份:AUMID = NSIS appId = macOS bundle id(三位一体,见 brandIdentity)。 */
  readonly desktopAppId: string;
  /** Mobile iOS bundle id(与 desktopAppId 同一套命名约定,允许平台差异)。 */
  readonly iosBundleId: string;
  /** Mobile Android applicationId。 */
  readonly androidPackage: string;
  /**
   * 可执行文件基名(exe / mac .app 包名 / 安装目录)。首字母大写是产品决策,
   * 与 brandIdentity.executableName 同规则。
   */
  readonly executableName: string;
  /** 深链 scheme 全集,首位恒为主 scheme(与 allDeepLinkSchemes 顺序一致)。 */
  readonly urlSchemes: readonly string[];
  /** Electron userData 目录名(= productName 语义,数据分库边界)。 */
  readonly userDataName: string;
  /**
   * 凭据存储 namespace:Desktop safeStorage 条目名基(`app.name` 派生)与
   * Mobile SecureStore key 前缀的公共锚。官方值为 scheme 同源的 'cindy';
   * 独立发行必须提供不同值,否则与官方发行版互读凭证(蓝图 §3.3 验收)。
   */
  readonly secureStorageNamespace: string;
  /** 官网;空表示无外链(必需法律内容必须随包提供,见 privacyUrl/termsUrl)。 */
  readonly websiteUrl?: string;
  /** 支持入口;空表示无(官方 profile 走应用内 feedback)。 */
  readonly supportUrl?: string;
  /** 隐私政策 URL(法律必填,https)。 */
  readonly privacyUrl: string;
  /** 服务条款 URL(法律必填,https)。 */
  readonly termsUrl: string;
}

/**
 * endpoint manifest 的自举来源(蓝图 §3.5 工作流 D)。
 * embedded:Local-first 包,manifest 烘焙进产物,不做网络自举;
 * remote:联网部署,从构建期固定的 bootstrapUrl 拉取。
 * trustedEndpointDomains 是**离线缓存的可信域**(信任根),不得放进远端
 * manifest 本身,否则攻击者可同时改 endpoint 与信任根(endpointManifestCache.ts)。
 */
export interface DistributionEndpointManifestSource {
  readonly mode: 'embedded' | 'remote';
  /** mode='remote' 时必填(https);'embedded' 时必须缺省。 */
  readonly bootstrapUrl?: string;
  readonly trustedEndpointDomains: readonly string[];
}

/**
 * 遥测策略。
 *  - 'official':官方发行版的 TapDB 埋点与构建注入的 log upload(仅官方 id 允许);
 *  - 'self-hosted':部署方自己的采集端(Phase 3 才有消费面);
 *  - 'disabled':整体关闭,不初始化任何采集。
 */
export type DistributionTelemetryPolicy = 'official' | 'self-hosted' | 'disabled';

/**
 * 更新模式。
 *  - 'official':cindy-updater CDN 链路(仅官方 id 允许);
 *  - 'self-hosted':自建更新服务(manifest / artifact,Phase 3);
 *  - 'manual':只提示人工升级,不自动下载;
 *  - 'disabled':完全关闭 updater,不因关闭更新阻断启动(蓝图 §2.5)。
 */
export type DistributionUpdateMode = 'official' | 'self-hosted' | 'manual' | 'disabled';

/**
 * 中央 capability 的默认开关表(能力名与蓝图 §3.6 的 taxonomy 对齐;
 * appCapabilities.ts 扩展为完整 capability 模型时消费)。
 * 键必须来自 DISTRIBUTION_CAPABILITY_KEYS;校验器拒绝未知键,防止拼写漂移。
 */
export type DistributionCapabilityKey =
  | 'canUseAccount'
  | 'canUseDeviceLink'
  | 'canUseManagedModels'
  | 'canUseManagedVoice'
  | 'canUseOAuthBroker'
  | 'canUseHostedTelegramHook'
  | 'canUseHostedXHook'
  | 'canUseHostedSlackHook'
  | 'canUploadPublicAssets'
  | 'canUseFeedback'
  | 'canUseSkillHubCloud'
  | 'canUsePluginMarket'
  | 'canPublishPlugins'
  | 'canSendHeartbeat'
  | 'canCheckDesktopUpdates'
  | 'canOpenWebsite'
  | 'canSendTelemetry';

export const DISTRIBUTION_CAPABILITY_KEYS: readonly DistributionCapabilityKey[] = Object.freeze([
  'canUseAccount',
  'canUseDeviceLink',
  'canUseManagedModels',
  'canUseManagedVoice',
  'canUseOAuthBroker',
  'canUseHostedTelegramHook',
  'canUseHostedXHook',
  'canUseHostedSlackHook',
  'canUploadPublicAssets',
  'canUseFeedback',
  'canUseSkillHubCloud',
  'canUsePluginMarket',
  'canPublishPlugins',
  'canSendHeartbeat',
  'canCheckDesktopUpdates',
  'canOpenWebsite',
  'canSendTelemetry',
]);

/**
 * 发行 profile 完整形状(蓝图 §2.4 的落地版)。
 * 官方三身份由 officialProfileForRegion 派生;独立发行由构建脚本提供并经
 * assertDistributionProfile 校验。
 */
export interface DistributionProfile {
  /** 发行 id(kebab-case);Desktop / Mobile 共用。 */
  readonly distributionId: string;
  /**
   * 官方 profile 对应的构建期 region(消费现有 CindyRegion 分支);
   * 独立发行缺省——内部 authRealm 固定 'global'(蓝图 §2.4 兼容决策)。
   */
  readonly region?: CindyRegion;
  /** 内部 auth realm。Self-host v1 固定 'global';放开任意 realm 需单独设计 token/manifest 版本。 */
  readonly authRealm: 'global';
  /** 跨 realm 组织登录。官方 cn/global 开启(现有双 realm 行为);独立发行必须 false。 */
  readonly crossRealmOrgLoginEnabled: boolean;
  readonly brand: DistributionBrand;
  readonly endpointManifest: DistributionEndpointManifestSource;
  readonly capabilityDefaults: Readonly<Record<DistributionCapabilityKey, boolean>>;
  readonly telemetryPolicy: DistributionTelemetryPolicy;
  readonly updateMode: DistributionUpdateMode;
}

// ---------------------------------------------------------------------------
// 官方 profile 派生
// ---------------------------------------------------------------------------

/**
 * 官方法律链接的区域分流(与 apps/desktop/src/shared/legalLinks.ts 同一口径)。
 * 该文件是 Desktop 消费单点;此处为 profile 层镜像,由
 * scripts/__tests__/brand-identity-sync.test.mjs 锁定两处字面量一致。
 * dev 归 cn 系(与 legalLinks.ts 的 CURRENT_CINDY_REGION 分支同口径)。
 */
const OFFICIAL_LEGAL_LINKS_BY_REGION: Readonly<
  Record<CindyRegion, { readonly termsUrl: string; readonly privacyUrl: string }>
> = Object.freeze({
  cn: Object.freeze({
    termsUrl: 'https://protocol.xd.cn/cindy/agreement.html',
    privacyUrl: 'https://protocol.xd.cn/cindy/privacy-1.0.html',
  }),
  global: Object.freeze({
    termsUrl: 'https://protocol.xd.com/cindy/agreement-1.0.html',
    privacyUrl: 'https://protocol.xd.com/cindy/privacy.html',
  }),
  // dev 归 cn 系(与 legalLinks.ts 非 global 分支同口径)。
  dev: Object.freeze({
    termsUrl: 'https://protocol.xd.cn/cindy/agreement.html',
    privacyUrl: 'https://protocol.xd.cn/cindy/privacy-1.0.html',
  }),
});

/**
 * 官方 endpoint manifest 信任根(镜像 apps/desktop/src/main/endpointManifestCache.ts
 * 的 REGION_ENDPOINT_DOMAIN:cn → cindy.com.cn,global → cindy.app)。
 * 由 brand-identity-sync 测试锁定两处一致;改官方信任根必须两处同改。
 * 两区域名同时进两份官方 profile 的信任根,与现有双 realm 缓存语义一致。
 */
const OFFICIAL_TRUSTED_ENDPOINT_DOMAINS: readonly string[] = Object.freeze([
  'cindy.com.cn',
  'cindy.app',
]);

/**
 * 官方 Mobile SecureStore / Desktop safeStorage 的凭据 namespace
 * (镜像 apps/mobile/src/auth/mobileAccountVault.ts 的 key 前缀 'cindy';
 * dev 身份独立为 'cindydev',与 scheme 同源)。
 */
function officialSecureStorageNamespace(region: CindyRegion): string {
  return region === 'dev' ? 'cindydev' : 'cindy';
}

/**
 * 官方 profile 的 capability 默认值:业务能力全开(现有官方行为);
 * telemetry 跟随 telemetryPolicy(official → 开)。
 */
function officialCapabilityDefaults(): Readonly<Record<DistributionCapabilityKey, boolean>> {
  // official telemetryPolicy → canSendTelemetry 为 true;其余能力全开。
  return Object.freeze(
    Object.fromEntries(
      DISTRIBUTION_CAPABILITY_KEYS.map((k) => [k, true]),
    ) as Record<DistributionCapabilityKey, boolean>,
  );
}

/**
 * 按官方区域派生 profile。全部身份字段引用 BRAND_IDENTITY,不复制字面量;
 * 官方区域构建行为与既有常量逐字段一致(回归测试锁定)。
 */
export function officialProfileForRegion(region: CindyRegion): DistributionProfile {
  const legal = OFFICIAL_LEGAL_LINKS_BY_REGION[region];
  const appId = BRAND_IDENTITY.appIdByRegion[region];
  return Object.freeze({
    distributionId: (`cindy-${region}` as OfficialDistributionId),
    region,
    authRealm: 'global',
    // 官方 cn/global 保留现有跨 realm 组织登录行为;dev 归 cn 系同待遇。
    crossRealmOrgLoginEnabled: true,
    brand: Object.freeze({
      productName: BRAND_IDENTITY.displayName,
      companyName: 'Cindy',
      desktopAppId: appId,
      // Mobile 与 Desktop 同一套 appId 命名(app.config.js / brandIdentity 注释)。
      iosBundleId: appId,
      androidPackage: appId,
      executableName: BRAND_IDENTITY.executableNameByRegion[region],
      urlSchemes: Object.freeze([
        region === 'dev' ? 'cindydev' : BRAND_IDENTITY.primaryScheme,
        ...BRAND_IDENTITY.legacySchemes,
      ]),
      userDataName: BRAND_IDENTITY.userDataDirNameByRegion[region],
      secureStorageNamespace: officialSecureStorageNamespace(region),
      websiteUrl: `https://${region === 'global' ? 'cindy.app' : 'cindy.com.cn'}`,
      supportUrl: undefined,
      privacyUrl: legal.privacyUrl,
      termsUrl: legal.termsUrl,
    }),
    endpointManifest: Object.freeze({
      mode: 'remote',
      trustedEndpointDomains: OFFICIAL_TRUSTED_ENDPOINT_DOMAINS,
    }),
    capabilityDefaults: officialCapabilityDefaults(),
    telemetryPolicy: 'official',
    updateMode: 'official',
  });
}

/** 官方三身份的 profile(按 region 索引;构建脚本经 resolveDistributionProfile 消费)。 */
export const OFFICIAL_DISTRIBUTION_PROFILES: Readonly<Record<CindyRegion, DistributionProfile>> =
  Object.freeze({
    cn: officialProfileForRegion('cn'),
    global: officialProfileForRegion('global'),
    dev: officialProfileForRegion('dev'),
  });

// ---------------------------------------------------------------------------
// 独立发行(self-host 等)的派生与校验
// ---------------------------------------------------------------------------

/**
 * 从独立发行 profile 解析出 BrandIdentity 形状,供现有 forge / 运行时消费面
 * (brandAppId 等以 region 为参的入口)零改动消费。
 *
 * 兼容策略:BrandIdentity 的 by-region Record 是官方区域维度;独立发行没有
 * 区域概念,三键**同值填充**,消费方传任意 region 都得到同一身份。legacy 数组
 * 恒为空(新发行没有历史;官方 profile 直接走 BRAND_IDENTITY 原样,不走本函数)。
 * updaterName / cdnPrefix / dbFilePrefix 的派生值在品牌接入 PR(蓝图 PR 4)按需复核。
 */
export function resolveBrandIdentityFromProfile(profile: DistributionProfile): BrandIdentity {
  if (profile.region) return BRAND_IDENTITY; // 官方 profile:原样返回,区域差异保留
  const id = profile.distributionId;
  const schemes = profile.brand.urlSchemes;
  return {
    displayName: profile.brand.productName,
    executableName: profile.brand.executableName,
    executableNameByRegion: Object.freeze({
      cn: profile.brand.executableName,
      global: profile.brand.executableName,
      dev: profile.brand.executableName,
    }),
    appIdByRegion: Object.freeze({
      cn: profile.brand.desktopAppId,
      global: profile.brand.desktopAppId,
      dev: profile.brand.desktopAppId,
    }),
    primaryScheme: schemes[0] ?? '',
    legacySchemes: Object.freeze(schemes.slice(1)),
    userDataDirName: profile.brand.userDataName,
    userDataDirNameByRegion: Object.freeze({
      cn: profile.brand.userDataName,
      global: profile.brand.userDataName,
      dev: profile.brand.userDataName,
    }),
    legacyUserDataDirNames: Object.freeze([]),
    legacyUserDataDirNamesByRegion: Object.freeze({
      cn: Object.freeze([]),
      global: Object.freeze([]),
      dev: Object.freeze([]),
    }),
    legacyDialogueUserDataDirNamesByRegion: Object.freeze({
      cn: Object.freeze([]),
      global: Object.freeze([]),
      dev: Object.freeze([]),
    }),
    cdnPrefix: id,
    updaterName: `${id}-updater`,
    dbFilePrefix: id,
    legacyDbFilePrefixes: Object.freeze([]),
  };
}

/** HTTPS URL 形状校验(法律链接 / bootstrapUrl)。 */
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host.length > 0;
  } catch {
    return false;
  }
}

function isDomainLike(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9.-]+$/.test(value) && value.includes('.');
}

const REVERSE_DNS_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/**
 * 校验 profile,返回全部问题(空数组 = 通过)。纯函数,不抛错;
 * 构建链路用 assertDistributionProfile 变成硬失败(蓝图 §3.3:缺身份、
 * 安全或法律必填项时构建失败,不回退官方值)。
 */
export function validateDistributionProfile(profile: DistributionProfile): string[] {
  const errors: string[] = [];
  const at = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!/^[a-z][a-z0-9-]*$/.test(profile.distributionId)) {
    at('distributionId', `必须是 kebab-case,实际 ${JSON.stringify(profile.distributionId)}`);
  }
  if (profile.authRealm !== 'global') {
    at('authRealm', 'self-host v1 只支持内部 realm "global"(蓝图 §2.4)');
  }
  if (typeof profile.crossRealmOrgLoginEnabled !== 'boolean') {
    at('crossRealmOrgLoginEnabled', '必须是 boolean');
  }
  const isOfficial = (OFFICIAL_DISTRIBUTION_IDS as readonly string[]).includes(profile.distributionId);
  if (isOfficial && !profile.region) {
    at('region', `官方 distributionId ${profile.distributionId} 必须携带 region`);
  }
  if (!isOfficial && profile.region) {
    at('region', '独立发行不得声明官方 region(与 CindyRegion 正交)');
  }

  // —— brand ——
  const brand = profile.brand;
  const brandAt = (field: string, msg: string) => at(`brand.${field}`, msg);
  for (const field of [
    'productName',
    'companyName',
    'desktopAppId',
    'iosBundleId',
    'androidPackage',
    'executableName',
    'userDataName',
    'secureStorageNamespace',
    'privacyUrl',
    'termsUrl',
  ] as const) {
    const v = brand[field];
    if (typeof v !== 'string' || v.trim().length === 0) brandAt(field, '必填且不能为空白');
  }
  if (brand.websiteUrl !== undefined && !isHttpsUrl(brand.websiteUrl)) {
    brandAt('websiteUrl', '缺省或 https URL');
  }
  if (brand.supportUrl !== undefined && !isHttpsUrl(brand.supportUrl)) {
    brandAt('supportUrl', '缺省或 https URL');
  }
  if (!isHttpsUrl(brand.privacyUrl)) brandAt('privacyUrl', '必须是 https URL(法律必填)');
  if (!isHttpsUrl(brand.termsUrl)) brandAt('termsUrl', '必须是 https URL(法律必填)');
  if (!REVERSE_DNS_RE.test(brand.desktopAppId ?? '')) {
    brandAt('desktopAppId', `必须是 reverse-DNS 形式(如 com.example.app),实际 ${JSON.stringify(brand.desktopAppId)}`);
  }
  if (!REVERSE_DNS_RE.test(brand.iosBundleId ?? '')) brandAt('iosBundleId', '必须是 reverse-DNS 形式');
  if (!REVERSE_DNS_RE.test(brand.androidPackage ?? '')) brandAt('androidPackage', '必须是 reverse-DNS 形式');
  if (!Array.isArray(brand.urlSchemes) || brand.urlSchemes.length === 0) {
    brandAt('urlSchemes', '至少一个 scheme(首位为主 scheme)');
  } else {
    for (const scheme of brand.urlSchemes) {
      if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
        brandAt('urlSchemes', `scheme 必须是合法 URI scheme 小写形式,实际 ${JSON.stringify(scheme)}`);
        break;
      }
    }
  }

  // —— 独立发行的身份隔离(蓝图 §3.3 验收:不得与官方身份冲突) ——
  if (!isOfficial) {
    const officialIds = new Set(
      Object.values(BRAND_IDENTITY.appIdByRegion),
    );
    if (officialIds.has(brand.desktopAppId)) {
      brandAt('desktopAppId', `独立发行不得复用官方 app id(与官方并存的系统身份必须不同): ${brand.desktopAppId}`);
    }
    if (officialIds.has(brand.iosBundleId)) brandAt('iosBundleId', '独立发行不得复用官方 iOS bundle id');
    if (officialIds.has(brand.androidPackage)) brandAt('androidPackage', '独立发行不得复用官方 Android package');
    const officialSchemes = new Set(['cindy', 'cindydev', ...BRAND_IDENTITY.legacySchemes]);
    for (const scheme of brand.urlSchemes ?? []) {
      if (officialSchemes.has(scheme)) {
        brandAt('urlSchemes', `独立发行不得复用官方 scheme: ${scheme}`);
        break;
      }
    }
    const officialUserData = new Set(Object.values(BRAND_IDENTITY.userDataDirNameByRegion));
    if (officialUserData.has(brand.userDataName)) {
      brandAt('userDataName', `独立发行不得复用官方 userData 目录名(数据互读风险): ${brand.userDataName}`);
    }
    if (brand.secureStorageNamespace === 'cindy' || brand.secureStorageNamespace === 'cindydev') {
      brandAt('secureStorageNamespace', '独立发行不得复用官方凭据 namespace(凭证互读风险)');
    }
    if (profile.crossRealmOrgLoginEnabled) {
      at('crossRealmOrgLoginEnabled', '独立发行必须关闭跨 realm 组织登录(单 realm)');
    }
    if (profile.telemetryPolicy === 'official' || profile.updateMode === 'official') {
      at('telemetryPolicy/updateMode', 'official 值仅允许官方三身份使用');
    }
  }

  // —— endpointManifest ——
  const manifest = profile.endpointManifest;
  if (manifest.mode !== 'embedded' && manifest.mode !== 'remote') {
    at('endpointManifest.mode', `必须是 embedded 或 remote,实际 ${JSON.stringify((manifest as { mode?: unknown }).mode)}`);
  } else if (manifest.mode === 'remote') {
    // 官方 remote profile 的 bootstrapUrl 由打包链在 PR 6(蓝图 §3.5)接入时注入,
    // 现阶段允许缺省(声明性快照,无消费方);独立发行必须显式提供自举源。
    if (!isOfficial && !isHttpsUrl(manifest.bootstrapUrl)) {
      at('endpointManifest.bootstrapUrl', "mode='remote' 的独立发行必须提供 https 自举 URL");
    }
    if (manifest.bootstrapUrl !== undefined && !isHttpsUrl(manifest.bootstrapUrl)) {
      at('endpointManifest.bootstrapUrl', '提供时必须是 https URL');
    }
  } else if (manifest.bootstrapUrl !== undefined) {
    at('endpointManifest.bootstrapUrl', "mode='embedded' 时必须缺省(不做网络自举)");
  }
  const domains = manifest.trustedEndpointDomains;
  if (!Array.isArray(domains) || domains.length === 0) {
    at('endpointManifest.trustedEndpointDomains', '至少一个信任根域(离线缓存 fail-closed 需要)');
  } else {
    for (const d of domains) {
      if (!isDomainLike(d)) {
        at('endpointManifest.trustedEndpointDomains', `信任根必须是域名形式,实际 ${JSON.stringify(d)}`);
        break;
      }
    }
  }

  // —— capabilityDefaults ——
  if (typeof profile.capabilityDefaults !== 'object' || profile.capabilityDefaults === null) {
    at('capabilityDefaults', '必须是对象');
  } else {
    for (const key of Object.keys(profile.capabilityDefaults)) {
      if (!(DISTRIBUTION_CAPABILITY_KEYS as readonly string[]).includes(key)) {
        at(`capabilityDefaults.${key}`, `未知 capability 键(允许: ${DISTRIBUTION_CAPABILITY_KEYS.join(', ')})`);
      }
    }
    for (const key of DISTRIBUTION_CAPABILITY_KEYS) {
      const v = profile.capabilityDefaults[key];
      if (typeof v !== 'boolean') {
        at(`capabilityDefaults.${key}`, '每个已知 capability 键都必须显式给出 boolean');
      }
    }
  }

  if (!['official', 'self-hosted', 'disabled'].includes(profile.telemetryPolicy)) {
    at('telemetryPolicy', `必须是 official | self-hosted | disabled,实际 ${JSON.stringify(profile.telemetryPolicy)}`);
  }
  if (!['official', 'self-hosted', 'manual', 'disabled'].includes(profile.updateMode)) {
    at('updateMode', `必须是 official | self-hosted | manual | disabled,实际 ${JSON.stringify(profile.updateMode)}`);
  }
  return errors;
}

/**
 * 校验并返回 profile;任一问题即抛错(构建期硬失败语义)。
 */
export function assertDistributionProfile(profile: DistributionProfile): DistributionProfile {
  const errors = validateDistributionProfile(profile);
  if (errors.length > 0) {
    throw new Error(
      `Invalid distribution profile "${profile.distributionId}":\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  return profile;
}

// ---------------------------------------------------------------------------
// FreeWorkBuddy self-host profile(蓝图 §3.7 形态 B:自建 control plane)
// ---------------------------------------------------------------------------

/**
 * FreeWorkBuddy 独立发行 profile。
 *
 * owner 决策(2026-09-01,蓝图 §3.21 决策清单):
 *  - 维护主体:个人维护者(leyuan0602-glitch);法律页面由同源站点提供;
 *  - endpoint manifest 从唯一受信 origin 拉取，只启用已落地的账号、
 *    device-link 与官网能力；其余云能力保持关闭并由 UI capability-gate;
 *  - telemetry / update 不接官方服务，继续 disabled。
 * 机密(签名私钥 / keystore 密码)不在此处,由外部 secret 提供。
 */
export const SELFHOST_FREEWORKBUDDY_PROFILE: DistributionProfile = assertDistributionProfile(
  Object.freeze({
    distributionId: 'freeworkbuddy-selfhost',
    authRealm: 'global',
    crossRealmOrgLoginEnabled: false,
    brand: Object.freeze({
      productName: 'FreeWorkBuddy',
      companyName: 'leyuan0602-glitch',
      desktopAppId: 'me.freeworkbuddy.desktop',
      iosBundleId: 'me.freeworkbuddy.ios',
      androidPackage: 'me.freeworkbuddy.android',
      executableName: 'FreeWorkBuddy',
      urlSchemes: Object.freeze(['freeworkbuddy']),
      userDataName: 'FreeWorkBuddy',
      secureStorageNamespace: 'freeworkbuddy',
      websiteUrl: 'https://freeworkbuddy.me',
      // 法律页占位(Phase 2 随部署上线替换真实路径;构建期仅校验 https 形态)。
      privacyUrl: 'https://freeworkbuddy.me/privacy',
      termsUrl: 'https://freeworkbuddy.me/terms',
    }),
    endpointManifest: Object.freeze({
      mode: 'remote',
      bootstrapUrl: 'https://freeworkbuddy.me/endpoint.json',
      trustedEndpointDomains: Object.freeze(['freeworkbuddy.me']),
    }),
    capabilityDefaults: Object.freeze({
      canUseAccount: true,
      canUseDeviceLink: true,
      canUseManagedModels: false,
      canUseManagedVoice: false,
      canUseOAuthBroker: false,
      canUseHostedTelegramHook: false,
      canUseHostedXHook: false,
      canUseHostedSlackHook: false,
      canUploadPublicAssets: false,
      canUseFeedback: false,
      canUseSkillHubCloud: false,
      canUsePluginMarket: false,
      canPublishPlugins: false,
      canSendHeartbeat: false,
      canCheckDesktopUpdates: false,
      canOpenWebsite: true,
      canSendTelemetry: false,
    }),
    telemetryPolicy: 'disabled',
    updateMode: 'disabled',
  }),
);

/**
 * 独立发行 profile 注册表(构建期 env 引用 distributionId 选取)。
 * 新增独立发行在此登记;不在此表且非官方三身份的 id 一律拒绝,
 * 防止打错 env 静默产出身份错误的包(与 resolveCindyRegion 同策略)。
 */
export const SELFHOST_DISTRIBUTION_PROFILES: Readonly<Record<string, DistributionProfile>> =
  Object.freeze({
    'freeworkbuddy-selfhost': SELFHOST_FREEWORKBUDDY_PROFILE,
  } as Record<string, DistributionProfile>);

/**
 * 构建期 profile 选取入口(forge / vite.config / 打包脚本共用;纯函数)。
 *
 *  - distributionId 缺省 → 官方路径,按 regionInput(= CINDY_AUTH_REGION 语义)
 *    取官方 profile——现有官方构建行为逐字节不变;
 *  - 官方 id(cindy-cn 等):与 regionInput 矛盾即抛错(防两个 env 各说各话);
 *  - 独立发行 id → SELFHOST_DISTRIBUTION_PROFILES 注册表(已 assert);
 *  - 未知 id → 抛错,绝不回退官方值(蓝图 §3.3:profile 缺身份即构建失败)。
 */
export function resolveDistributionProfile(
  distributionId?: string | null,
  regionInput?: string | null,
): DistributionProfile {
  const id = distributionId?.trim() || '';
  if (!id) return OFFICIAL_DISTRIBUTION_PROFILES[resolveCindyRegion(regionInput)];
  if ((OFFICIAL_DISTRIBUTION_IDS as readonly string[]).includes(id)) {
    const region = id.slice('cindy-'.length) as CindyRegion;
    // regionInput 缺省 = 调用方只声明了 distribution;两处都给出时必须一致。
    if (regionInput?.trim() && resolveCindyRegion(regionInput) !== region) {
      throw new Error(
        `Distribution profile mismatch: distributionId=${id} but region=${resolveCindyRegion(regionInput)}`,
      );
    }
    return OFFICIAL_DISTRIBUTION_PROFILES[region];
  }
  const profile = SELFHOST_DISTRIBUTION_PROFILES[id];
  if (profile) return profile;
  throw new Error(
    `Unknown distribution profile: ${JSON.stringify(id)}; `
      + `expected one of ${[...OFFICIAL_DISTRIBUTION_IDS, ...Object.keys(SELFHOST_DISTRIBUTION_PROFILES)].join(', ')}`,
  );
}
