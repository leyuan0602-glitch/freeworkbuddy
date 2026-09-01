import { describe, expect, it } from 'vitest';
import {
  homeMarketQuery,
  isHomeMarketResponseCurrent,
  matchesHomeMarketFilter,
  visibleHomeMarketFilters,
} from '../homeMarketFilter';

describe('Skill home market filters', () => {
  it('maps public and organization to the legacy-compatible catalog scopes', () => {
    expect(homeMarketQuery('public')).toEqual({
      scope: 'market',
      visibility: 'all',
      sort: 'trending',
    });
    expect(homeMarketQuery('organization')).toEqual({
      scope: 'team',
      visibility: 'all',
      sort: 'trending',
    });
  });

  it('uses the published-management mode for mine', () => {
    expect(homeMarketQuery('mine')).toEqual({
      scope: 'all',
      visibility: 'mine',
      sort: 'updated_at',
    });
  });

  it('hides organization for personal memberships', () => {
    expect(visibleHomeMarketFilters(false)).toEqual(['public', 'mine']);
    expect(visibleHomeMarketFilters(true)).toEqual(['public', 'organization', 'mine']);
  });

  it('does not present a response from the previous tab as current', () => {
    expect(isHomeMarketResponseCurrent(homeMarketQuery('mine'), {
      scope: 'market',
      mine: false,
    })).toBe(false);
    expect(isHomeMarketResponseCurrent(homeMarketQuery('mine'), {
      scope: 'all',
      mine: true,
    })).toBe(true);
  });

  it('keeps public and shared organization items mutually exclusive', () => {
    const publicOrganizationSkill = {
      isMine: false,
      ownerType: 'organization',
      publishedVisibility: 'public' as const,
      visibility: 'PUBLIC' as const,
    };
    const sharedOrganizationSkill = {
      isMine: false,
      ownerType: 'organization',
      publishedVisibility: 'shared' as const,
      visibility: 'DEPARTMENT_SCOPED' as const,
    };

    expect(matchesHomeMarketFilter(publicOrganizationSkill, 'public')).toBe(true);
    expect(matchesHomeMarketFilter(publicOrganizationSkill, 'organization')).toBe(false);
    expect(matchesHomeMarketFilter(sharedOrganizationSkill, 'public')).toBe(false);
    expect(matchesHomeMarketFilter(sharedOrganizationSkill, 'organization')).toBe(true);
  });
});
