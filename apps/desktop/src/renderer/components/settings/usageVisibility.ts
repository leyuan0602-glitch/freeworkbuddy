/**
 * 用量历史 tab 的可见性。
 *
 * 与 billingVisibility 刻意不同: 计费页只对个人云账号开放, 而用量历史对**所有已登录身份**
 * 开放 (local / cloud personal / cloud org) —— 它读的是本机 daily_model_usage,
 * 不涉及账户与账单, 因此不该继承计费页的身份门 (issue #2785 维护者裁决)。
 */

export interface UsageSettingsIdentity {
  mode: 'signed-out' | 'local' | 'cloud';
}

/** 发行 capability 投影(可选):usage 读托管模型的用量,未部署即隐藏。 */
export interface UsageCapabilityGates {
  canUseManagedModels?: boolean;
}

export function canAccessUsageSettings(
  identity: UsageSettingsIdentity,
  capabilities?: UsageCapabilityGates,
): boolean {
  if (capabilities?.canUseManagedModels === false) return false;
  return identity.mode !== 'signed-out';
}
