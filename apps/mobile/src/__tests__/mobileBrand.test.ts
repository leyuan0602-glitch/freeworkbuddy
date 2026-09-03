import { describe, expect, it } from 'vitest';

import {
  localizeMobileBrand,
  localizeMobileBrandResource,
  resolveMobileProductName,
} from '@/config/mobileBrand';

describe('mobile distribution branding', () => {
  it('keeps official builds on Cindy and resolves FreeWorkBuddy self-hosting', () => {
    expect(resolveMobileProductName(null)).toBe('Cindy');
    expect(resolveMobileProductName('cindy-global')).toBe('Cindy');
    expect(resolveMobileProductName('freeworkbuddy-selfhost')).toBe(
      'FreeWorkBuddy',
    );
  });

  it('projects the self-host product name through catalog strings', () => {
    expect(localizeMobileBrand('Sign in to Cindy', 'FreeWorkBuddy')).toBe(
      'Sign in to FreeWorkBuddy',
    );
    expect(
      localizeMobileBrandResource(
        { title: 'Cindy', nested: ['Open Cindy', 3] },
        'FreeWorkBuddy',
      ),
    ).toEqual({
      title: 'FreeWorkBuddy',
      nested: ['Open FreeWorkBuddy', 3],
    });
  });
});
