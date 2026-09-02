export type BillingSettingsIdentity = {
  mode: 'signed-out' | 'local' | 'cloud';
  membershipKind: 'personal' | 'org' | null;
};

/**
 * 发行 capability 投影(可选)。billing 属托管模型域:发行未提供
 * modelAccessApiBaseUrl 时(capability === false),即使身份满足也必须隐藏。
 */
export interface BillingCapabilityGates {
  canUseManagedModels?: boolean;
}

export function canAccessBillingSettings(
  identity: BillingSettingsIdentity,
  capabilities?: BillingCapabilityGates,
): boolean {
  if (capabilities?.canUseManagedModels === false) return false;
  return identity.mode === 'cloud' && identity.membershipKind === 'personal';
}
