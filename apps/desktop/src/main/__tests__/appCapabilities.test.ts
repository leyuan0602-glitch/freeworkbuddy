import { describe, expect, it } from 'vitest';

import {
  deriveAppCapabilities,
  deriveDistributionCapabilitySnapshot,
  type DistributionCapabilitySnapshot,
} from '../appCapabilities';

/**
 * 工作流 E(蓝图 §2.5/§3.6):capability 四层计算链的单测——
 * distribution policy × endpoint presence × session × build。
 * main 是真相源,renderer 只消费布尔投影;旧 6 键接口由新模型派生。
 */

const ALL_ENDPOINTS: Record<string, string> = {
  authApiBaseUrl: 'https://auth.example',
  deviceLinkApiBaseUrl: 'https://dl.example',
  oauthBrokerApiBaseUrl: 'https://oauth.example',
  ossApiBaseUrl: 'https://oss.example',
  heartbeatUrl: 'https://hb.example',
  telegramHookWsUrl: 'wss://tg.example',
  xHookWsUrl: 'wss://x.example',
  slackHookWsUrl: 'wss://slack.example',
  websiteUrl: 'https://site.example',
  modelAccessApiBaseUrl: 'https://models.example',
  voiceApiBaseUrl: 'https://voice.example',
  githubApiBaseUrl: 'https://gh.example',
  skillhubApiBaseUrl: 'https://skills.example',
  pluginApiBaseUrl: 'https://plugins.example',
  cdnBaseUrl: 'https://cdn.example',
  mobileUpdateBaseUrl: '',
};

function snapshot(
  overrides?: Partial<Parameters<typeof deriveDistributionCapabilitySnapshot>[0]>,
): DistributionCapabilitySnapshot {
  return deriveDistributionCapabilitySnapshot({
    capabilityDefaults: null,
    endpoints: ALL_ENDPOINTS as never,
    sessionMode: 'cloud',
    boundaryPending: false,
    ...overrides,
  });
}

describe('deriveDistributionCapabilitySnapshot', () => {
  it('官方 + 端点齐全 + cloud:全部能力开启', () => {
    expect(snapshot()).toMatchObject({
      canUseAccount: true,
      canUseDeviceLink: true,
      canUseManagedModels: true,
      canUseHostedTelegramHook: true,
      canUsePluginMarket: true,
      canPublishPlugins: true,
      canSendHeartbeat: true,
      canCheckDesktopUpdates: true,
      canOpenWebsite: true,
    });
  });

  it('distribution 覆盖层:false 的能力无条件关闭(第二层)', () => {
    const s = snapshot({
      capabilityDefaults: { canUseSkillHubCloud: false, canSendHeartbeat: false },
    });
    expect(s.canUseSkillHubCloud).toBe(false);
    expect(s.canSendHeartbeat).toBe(false);
    // 未覆盖的键缺省 true
    expect(s.canUseAccount).toBe(true);
  });

  it('endpoint 缺失即关闭,与 session 无关(第三层,蓝图 §2.5 表)', () => {
    const noEndpoints = snapshot({ endpoints: { authApiBaseUrl: '' } as never });
    // 端点维度全关
    expect(noEndpoints.canUseAccount).toBe(false);
    expect(noEndpoints.canUseDeviceLink).toBe(false);
    expect(noEndpoints.canSendHeartbeat).toBe(false);
    expect(noEndpoints.canOpenWebsite).toBe(false);
  });

  it('逐端点空值:只关依赖该端点的能力(蓝图 §2.5 行为表)', () => {
    const cases: Array<[string, string, keyof DistributionCapabilitySnapshot]> = [
      ['telegramHookWsUrl', 'canUseHostedTelegramHook', 'canUseHostedTelegramHook'],
      ['heartbeatUrl', 'canSendHeartbeat', 'canSendHeartbeat'],
      ['cdnBaseUrl', 'canCheckDesktopUpdates', 'canCheckDesktopUpdates'],
      ['websiteUrl', 'canOpenWebsite', 'canOpenWebsite'],
    ];
    for (const [endpointKey, , capability] of cases) {
      const endpoints = { ...ALL_ENDPOINTS, [endpointKey]: '' } as never;
      const s = snapshot({ endpoints });
      expect(s[capability]).toBe(false);
      // 其余能力不受牵连(抽查)
      expect(s.canUseAccount).toBe(true);
    }
    // canPublishPlugins 与 canUsePluginMarket 共用 pluginApiBaseUrl
    const noPlugin = snapshot({ endpoints: { ...ALL_ENDPOINTS, pluginApiBaseUrl: '' } as never });
    expect(noPlugin.canUsePluginMarket).toBe(false);
    expect(noPlugin.canPublishPlugins).toBe(false);
    expect(noPlugin.canUseSkillHubCloud).toBe(true);
  });

  it('cloud-required 能力在非 cloud session 下关闭(第四层);登录入口与匿名能力不受影响', () => {
    for (const mode of ['signed-out', 'local'] as const) {
      const s = snapshot({ sessionMode: mode });
      expect(s.canUseDeviceLink).toBe(false);
      expect(s.canUseManagedModels).toBe(false);
      expect(s.canUseHostedSlackHook).toBe(false);
      expect(s.canPublishPlugins).toBe(false);
      // 蓝图 §2.5:登录入口显示只需 endpoint 存在;心跳/更新/官网无需登录。
      expect(s.canUseAccount).toBe(true);
      expect(s.canSendHeartbeat).toBe(true);
      expect(s.canCheckDesktopUpdates).toBe(true);
      expect(s.canOpenWebsite).toBe(true);
    }
  });

  it('boundary pending 时 cloud-required 能力关闭(会话切换期)', () => {
    expect(snapshot({ boundaryPending: true }).canUseDeviceLink).toBe(false);
  });

  it('Local-first self-host 全关 profile:端点全空 + defaults 全 false → 全 false', () => {
    const defaults = Object.fromEntries(
      Object.keys(ALL_ENDPOINTS).map(() => []) as never,
    ) as never;
    void defaults;
    const allFalse = Object.fromEntries(
      (
        [
          'canUseAccount', 'canUseDeviceLink', 'canUseManagedModels', 'canUseManagedVoice',
          'canUseOAuthBroker', 'canUseHostedTelegramHook', 'canUseHostedXHook',
          'canUseHostedSlackHook', 'canUploadPublicAssets', 'canUseFeedback',
          'canUseSkillHubCloud', 'canUsePluginMarket', 'canPublishPlugins',
          'canSendHeartbeat', 'canCheckDesktopUpdates', 'canOpenWebsite',
        ] as const
      ).map((k) => [k, false]),
    );
    const s = snapshot({
      capabilityDefaults: allFalse,
      endpoints: { authApiBaseUrl: '' } as never,
      sessionMode: 'local',
    });
    expect(Object.values(s).every((v) => v === false)).toBe(true);
  });
});

describe('deriveAppCapabilities(旧 6 键接口,由新模型派生)', () => {
  it('cloud + 端点齐全 = 原语义(cloud 全开)', () => {
    // deriveAppCapabilities 不读端点(旧签名保持);桥接逻辑在 getAppCapabilities。
    expect(deriveAppCapabilities('cloud')).toMatchObject({
      canUseCindyAccountServices: true,
      canUseDeviceLink: true,
    });
    expect(deriveAppCapabilities('local')).toMatchObject({
      canUseCindyAccountServices: false,
      canUseDeviceLink: false,
    });
  });
});
