interface MarketAccessUser {
  id: string;
}

/**
 * Skill Hub 只在 Cindy 云账号登录后发起请求。
 * 账号类型、组织和 Skill 可见范围均由 SkillHub 服务端根据已验证身份裁决，
 * 客户端不再维护组织白名单。
 */
export function canAccessSkillhubMarket(user: MarketAccessUser | null): boolean {
  return user !== null;
}
