export interface Product {
  id: string;
  name: string;
  description: string;
  priceLabel: string;
  listingId: string;
}

export const products: Product[] = [
  {
    id: 'usdc-100',
    name: '100 USDC',
    description: 'Starter pack for everyday transfers and payments.',
    priceLabel: '₡5,000',
    listingId: import.meta.env.VITE_PACTO_LISTING_USDC_100 ?? 'lst_demo_100',
  },
  {
    id: 'usdc-500',
    name: '500 USDC',
    description: 'Bulk purchase with better effective rate for merchants.',
    priceLabel: '₡24,000',
    listingId: import.meta.env.VITE_PACTO_LISTING_USDC_500 ?? 'lst_demo_500',
  },
];

export const publishableKey =
  import.meta.env.VITE_PACTO_PUBLISHABLE_KEY ?? 'pk_test_demo';
export const gatewayUrl = import.meta.env.VITE_PACTO_GATEWAY_URL || undefined;
