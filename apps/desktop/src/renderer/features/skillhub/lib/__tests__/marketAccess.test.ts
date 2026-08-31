import { describe, expect, it } from 'vitest';

import { canAccessSkillhubMarket } from '../marketAccess';

function user(
  overrides: Partial<{
    membershipKind: 'personal' | 'org';
    orgName: string | null;
    orgSlug: string | null;
  }> = {},
) {
  return {
    id: 'membership-1',
    membershipKind: 'org' as const,
    orgName: null,
    orgSlug: null,
    ...overrides,
  };
}

describe('canAccessSkillhubMarket', () => {
  it('allows personal accounts', () => {
    expect(canAccessSkillhubMarket(user({ membershipKind: 'personal' }))).toBe(true);
  });

  it('allows every organization without inspecting its slug or display name', () => {
    expect(canAccessSkillhubMarket(user({ orgSlug: 'xd', orgName: '心动' }))).toBe(true);
    expect(canAccessSkillhubMarket(user({ orgSlug: 'disco-corp', orgName: 'Disco Corp' }))).toBe(true);
    expect(canAccessSkillhubMarket(user({ orgSlug: null, orgName: null }))).toBe(true);
  });

  it('does not request cloud data without a logged-in Cindy account', () => {
    expect(canAccessSkillhubMarket(null)).toBe(false);
  });
});
