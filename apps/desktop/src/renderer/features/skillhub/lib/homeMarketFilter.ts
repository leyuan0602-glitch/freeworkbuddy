import type { CatalogScope, MarketSkill, SortBy, Visibility } from '../hooks/useMarketList';

export type HomeMarketFilter = 'public' | 'organization' | 'mine';

export interface HomeMarketQuery {
  scope: CatalogScope;
  visibility: Visibility;
  sort: SortBy;
}

export function visibleHomeMarketFilters(showOrganization: boolean): HomeMarketFilter[] {
  return showOrganization ? ['public', 'organization', 'mine'] : ['public', 'mine'];
}

export function isHomeMarketResponseCurrent(
  query: HomeMarketQuery,
  response: { scope: CatalogScope | null; mine: boolean | null },
): boolean {
  return response.scope === query.scope && response.mine === (query.visibility === 'mine');
}

/** Maps home tabs onto the legacy-compatible SkillHub query contract. */
export function homeMarketQuery(filter: HomeMarketFilter): HomeMarketQuery {
  if (filter === 'organization') {
    return { scope: 'team', visibility: 'all', sort: 'trending' };
  }
  if (filter === 'mine') {
    return { scope: 'all', visibility: 'mine', sort: 'updated_at' };
  }
  return { scope: 'market', visibility: 'all', sort: 'trending' };
}

/** Prevents a completed request for the previous tab from flashing under a new selection. */
export function matchesHomeMarketFilter(
  skill: Pick<MarketSkill, 'isMine' | 'ownerType' | 'publishedVisibility' | 'visibility'>,
  filter: HomeMarketFilter,
): boolean {
  if (filter === 'mine') return skill.isMine;
  if (filter === 'public') {
    return skill.publishedVisibility === 'public'
      || (skill.publishedVisibility === undefined && skill.visibility === 'PUBLIC');
  }
  const organizationOwned = skill.ownerType === 'org'
    || skill.ownerType === 'organization'
    || skill.ownerType === 'team';
  const shared = skill.publishedVisibility === 'shared'
    || (skill.publishedVisibility === undefined && skill.visibility === 'DEPARTMENT_SCOPED');
  return organizationOwned && shared;
}
