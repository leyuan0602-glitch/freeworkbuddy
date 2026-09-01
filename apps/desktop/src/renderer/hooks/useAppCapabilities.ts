/**
 * useAppCapabilities — renderer 消费发行 capability 快照的唯一入口(工作流 E)。
 *
 * 数据流:main(appCapabilities.ts,真相源)→ preload 首帧 sendSync +
 * `app-capabilities:changed` 推送 → 本 hook。renderer **只拿布尔投影**,
 * 不接触任何端点 URL(蓝图 §3.6:UI 隐藏不能替代 main/IPC 边界的拒绝,
 * 两侧都要做)。
 *
 * 使用约定:
 *  - 入口隐藏用 `caps.canUseXxx === false` 判断(而非 truthy)——快照键恒全集;
 *  - 隐藏 UI 的同时,对应 main IPC 已由 requireAppCapability / 受控拒绝兜底,
 *    两层缺一不可。
 */
import { useSyncExternalStore } from 'react';

import type { DistributionCapabilitySnapshot } from '../../main/appCapabilities';

type CapabilitiesBridge = {
  appCapabilities: Record<string, boolean> | null;
  onAppCapabilitiesChanged: (
    cb: (capabilities: Record<string, boolean>) => void,
  ) => () => void;
};

function getBridge(): CapabilitiesBridge | null {
  const api = (window as unknown as { electronAPI?: Partial<CapabilitiesBridge> }).electronAPI;
  if (!api || typeof api.onAppCapabilitiesChanged !== 'function') return null;
  return api as CapabilitiesBridge;
}

let cachedSnapshot: DistributionCapabilitySnapshot | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const bridge = getBridge();
  const unsubscribe = bridge?.onAppCapabilitiesChanged((caps) => {
    cachedSnapshot = caps as unknown as DistributionCapabilitySnapshot;
    for (const l of listeners) l();
  });
  return () => {
    listeners.delete(listener);
    unsubscribe?.();
  };
}

const FALLBACK_CLOSED: DistributionCapabilitySnapshot = Object.freeze({
  // Electron 桥不可用(测试宿主/非 Electron 环境):fail closed ——
  // 未部署能力缺失比越权更安全;登录态入口由 auth 独立判断。
  canUseAccount: false,
      canUseDeviceLink: false,
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
  canOpenWebsite: false,
  canSendTelemetry: false,
});

function getSnapshot(): DistributionCapabilitySnapshot {
  if (cachedSnapshot === null) {
    const bridge = getBridge();
    cachedSnapshot = (bridge?.appCapabilities ?? null) as unknown as DistributionCapabilitySnapshot | null;
  }
  return cachedSnapshot ?? FALLBACK_CLOSED;
}

/** 发行 capability 快照(响应式)。键恒全集,判断用 `=== false` 显式隐藏。 */
export function useAppCapabilities(): DistributionCapabilitySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
