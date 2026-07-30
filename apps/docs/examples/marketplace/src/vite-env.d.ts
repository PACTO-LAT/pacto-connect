/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PACTO_PUBLISHABLE_KEY: string;
  readonly VITE_PACTO_GATEWAY_URL: string;
  readonly VITE_PACTO_LISTING_USDC_100: string;
  readonly VITE_PACTO_LISTING_USDC_500: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
