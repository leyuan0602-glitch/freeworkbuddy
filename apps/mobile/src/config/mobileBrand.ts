import Constants from 'expo-constants';

import { BRAND_NAME } from '@cindy/maker-shared/branding';

const PRODUCT_NAME_BY_DISTRIBUTION: Readonly<Record<string, string>> = {
  'freeworkbuddy-selfhost': 'FreeWorkBuddy',
};

export function resolveMobileProductName(
  distributionId: string | null | undefined,
): string {
  return distributionId
    ? PRODUCT_NAME_BY_DISTRIBUTION[distributionId] ?? BRAND_NAME
    : BRAND_NAME;
}

export const MOBILE_PRODUCT_NAME = resolveMobileProductName(
  (
    Constants.expoConfig?.extra as
      | { cindy?: { distributionId?: string } }
      | undefined
  )?.cindy?.distributionId,
);

export function localizeMobileBrand(
  value: string,
  productName = MOBILE_PRODUCT_NAME,
): string {
  return productName === BRAND_NAME
    ? value
    : value.replaceAll(BRAND_NAME, productName);
}

export function localizeMobileBrandResource<T>(
  value: T,
  productName = MOBILE_PRODUCT_NAME,
): T {
  if (productName === BRAND_NAME) return value;
  if (typeof value === 'string') {
    return localizeMobileBrand(value, productName) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      localizeMobileBrandResource(item, productName),
    ) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        localizeMobileBrandResource(item, productName),
      ]),
    ) as T;
  }
  return value;
}
