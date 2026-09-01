/**
 * Central capability boundary for services owned by the Cindy account plane.
 *
 * Public CDN/endpoint manifests, updates and anonymous TapDB deliberately do
 * not use this gate. Account services must check it at their main-process
 * boundary even when the renderer also hides their entry point.
 *
 * 工作流 E(蓝图 §2.5/§3.6)扩展:capability 计算从单一 AppSessionMode 扩为
 *
 *   build supports feature
 *   AND distribution policy enables feature        (capabilityDefaults)
 *   AND required endpoint set is present           (resolved endpoint 非空)
 *   AND session satisfies auth/tenant requirements (cloud session)
 *
 * (第五层 server-negotiated sub-capability 随 Phase 2 self-host server 接入。)
 * main 是安全真相源;Renderer 只消费只读 snapshot(零端点 URL 暴露)。
 * 旧 6 键接口由新模型派生,存量消费方行为不变(官方构建 + cloud = 原语义)。
 */
import {
  getActiveAppSession,
  isAppSessionBoundaryPending,
  type AppSessionMode,
} from './appSessionState.js';
import {
  CURRENT_DISTRIBUTION_CAPABILITY_DEFAULTS,
} from '../shared/brandRegion';
import { getResolvedClientEndpoints } from './clientEndpointsService';
import { ipcMain } from 'electron';
import { throwIpcError } from './utils/ipcValidate.js';
import type { ClientEndpointKey, ClientEndpointMap } from '@cindy/maker-shared/client-endpoints';

export interface AppCapabilities {
  canUseCindyAccountServices: boolean;
  canUseCindyGateway: boolean;
  canUseDeviceLink: boolean;
  canUseSkillHubCloud: boolean;
  canUseCindyOAuthBroker: boolean;
  canUseCindyHeartbeat: boolean;
}

/**
 * 发行能力 taxonomy(蓝图 §2.5;键集与 maker-shared
 * DISTRIBUTION_CAPABILITY_KEYS 一致,brand-identity-sync 镜像锁定)。
 */
export interface DistributionCapabilitySnapshot {
  /** 登录入口(auth endpoint 存在即显示;登录成功与否由 auth 流程管)。 */
  canUseAccount: boolean;
  canUseDeviceLink: boolean;
  canUseManagedModels: boolean;
  canUseManagedVoice: boolean;
  canUseOAuthBroker: boolean;
  canUseHostedTelegramHook: boolean;
  canUseHostedXHook: boolean;
  canUseHostedSlackHook: boolean;
  canUploadPublicAssets: boolean;
  canUseFeedback: boolean;
  canUseSkillHubCloud: boolean;
  canUsePluginMarket: boolean;
  canPublishPlugins: boolean;
  /** 匿名心跳:不需要登录。 */
  canSendHeartbeat: boolean;
  /** 更新检查:不需要登录;updateMode=disabled 时 endpoint 为空自然为 false。 */
  canCheckDesktopUpdates: boolean;
  canOpenWebsite: boolean;
}

export type DistributionCapabilityKey = keyof DistributionCapabilitySnapshot;

/**
 * capability → 依赖的 endpoint key(蓝图 §2.5 表)。null = 不依赖端点。
 */
const CAPABILITY_ENDPOINT_REQUIREMENT: Readonly<
  Record<DistributionCapabilityKey, ClientEndpointKey | null>
> = Object.freeze({
  canUseAccount: 'authApiBaseUrl',
  canUseDeviceLink: 'deviceLinkApiBaseUrl',
  canUseManagedModels: 'modelAccessApiBaseUrl',
  canUseManagedVoice: 'voiceApiBaseUrl',
  canUseOAuthBroker: 'oauthBrokerApiBaseUrl',
  canUseHostedTelegramHook: 'telegramHookWsUrl',
  canUseHostedXHook: 'xHookWsUrl',
  canUseHostedSlackHook: 'slackHookWsUrl',
  canUploadPublicAssets: 'ossApiBaseUrl',
  canUseFeedback: 'githubApiBaseUrl',
  canUseSkillHubCloud: 'skillhubApiBaseUrl',
  canUsePluginMarket: 'pluginApiBaseUrl',
  canPublishPlugins: 'pluginApiBaseUrl',
  canSendHeartbeat: 'heartbeatUrl',
  canCheckDesktopUpdates: 'cdnBaseUrl',
  canOpenWebsite: 'websiteUrl',
});

/** 需要 cloud session 的能力(canUseAccount/heartbeat/updates/website 之外)。 */
const CLOUD_REQUIRED_CAPABILITIES: ReadonlySet<DistributionCapabilityKey> = new Set([
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
]);

/**
 * 纯函数:按蓝图 §2.5 计算链推导发行 capability 快照。
 *
 * @param capabilityDefaults 发行覆盖层(null = 官方,全部缺省 true);
 *   键缺省视为 true(新能力对旧 distribution 向前兼容)。
 * @param endpoints 已解析端点(null = 清单未就绪 → 端点维度全关,安全方向)。
 */
export function deriveDistributionCapabilitySnapshot(input: {
  capabilityDefaults: Readonly<Record<string, boolean>> | null;
  endpoints: Readonly<Record<ClientEndpointKey, string>> | null;
  sessionMode: AppSessionMode;
  boundaryPending: boolean;
}): DistributionCapabilitySnapshot {
  const cloud = input.sessionMode === 'cloud' && !input.boundaryPending;
  const out = {} as DistributionCapabilitySnapshot;
  for (const key of Object.keys(CAPABILITY_ENDPOINT_REQUIREMENT) as DistributionCapabilityKey[]) {
    const policyDefault = input.capabilityDefaults?.[key] ?? true;
    if (!policyDefault) {
      out[key] = false;
      continue;
    }
    const endpointKey = CAPABILITY_ENDPOINT_REQUIREMENT[key];
    const endpointPresent = endpointKey === null || Boolean(input.endpoints?.[endpointKey]);
    if (!endpointPresent) {
      out[key] = false;
      continue;
    }
    out[key] = CLOUD_REQUIRED_CAPABILITIES.has(key) ? cloud : true;
  }
  return out;
}

export function deriveAppCapabilities(
  mode: AppSessionMode,
  boundaryPending = false,
): AppCapabilities {
  const cloud = mode === 'cloud' && !boundaryPending;
  return {
    canUseCindyAccountServices: cloud,
    canUseCindyGateway: cloud,
    canUseDeviceLink: cloud,
    canUseSkillHubCloud: cloud,
    canUseCindyOAuthBroker: cloud,
    canUseCindyHeartbeat: cloud,
  };
}

export function getAppCapabilities(): AppCapabilities {
  const session = getActiveAppSession();
  const boundaryPending = isAppSessionBoundaryPending();
  const snapshot = getDistributionCapabilitySnapshot();
  const cloud = session.mode === 'cloud' && !boundaryPending;
  // 旧 6 键 = 新模型派生(发行/端点维度生效;官方 + cloud + 端点齐全 = 原语义)。
  return {
    canUseCindyAccountServices: cloud && snapshot.canUseAccount,
    canUseCindyGateway: cloud && snapshot.canUseManagedModels,
    canUseDeviceLink: cloud && snapshot.canUseDeviceLink,
    canUseSkillHubCloud: cloud && snapshot.canUseSkillHubCloud,
    canUseCindyOAuthBroker: cloud && snapshot.canUseOAuthBroker,
    canUseCindyHeartbeat: cloud && snapshot.canSendHeartbeat,
  };
}

/**
 * 运行时 capability snapshot(main 是真相源)。端点清单未就绪时端点维度全关
 * (安全方向:能力缺失比越权更安全),登录维度照常计算。
 */
export function getDistributionCapabilitySnapshot(): DistributionCapabilitySnapshot {
  const session = getActiveAppSession();
  let endpoints: Readonly<Record<ClientEndpointKey, string>> | null = null;
  try {
    endpoints = getResolvedClientEndpoints();
  } catch {
    // client endpoints not initialized(启动早期):端点维度全关。
    endpoints = null;
  }
  return deriveDistributionCapabilitySnapshot({
    capabilityDefaults: CURRENT_DISTRIBUTION_CAPABILITY_DEFAULTS,
    endpoints,
    sessionMode: session.mode,
    boundaryPending: isAppSessionBoundaryPending(),
  });
}

/** renderer 首帧同步读取 capability snapshot(preload 模块级 sendSync)。 */
export const APP_CAPABILITIES_SYNC_CHANNEL = 'app-capabilities:get-sync';

/** 必须在 createWindow() 前注册(与 registerClientEndpointsIpc 同一启动序)。 */
export function registerAppCapabilitiesIpc(): void {
  ipcMain.on(APP_CAPABILITIES_SYNC_CHANNEL, (event) => {
    event.returnValue = getDistributionCapabilitySnapshot();
  });
}

export function requireAppCapability(
  capability: keyof AppCapabilities,
  message = 'This feature requires a Cindy account.',
): void {
  const session = getActiveAppSession();
  const boundaryPending = isAppSessionBoundaryPending();
  if (deriveAppCapabilities(session.mode, boundaryPending)[capability]) return;
  if (boundaryPending) {
    throwIpcError(
      'PRECONDITION_FAILED',
      'App session is switching; retry after the owner boundary settles.',
    );
  }
  throwIpcError('PERMISSION_DENIED', message);
}
