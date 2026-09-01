import { describe, expect, it } from 'vitest';
import {
  homeMarketQuery,
  isHomeMarketResponseCurrent,
  matchesHomeMarketFilter,
  visibleHomeCatalogTabs,
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

  it('places local skills after public and the optional organization tab', () => {
    expect(visibleHomeCatalogTabs(false)).toEqual(['public', 'local']);
    expect(visibleHomeCatalogTabs(true)).toEqual(['public', 'organization', 'local']);
  });

  it('does not present a response from the previous tab as current', () => {
    expect(isHomeMarketResponseCurrent(homeMarketQuery('public'), {
      scope: 'market',
      mine: true,
    })).toBe(false);
    expect(isHomeMarketResponseCurrent(homeMarketQuery('public'), {
      scope: 'market',
      mine: false,
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
