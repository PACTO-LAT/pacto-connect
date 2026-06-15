# Pacto Connect

**Embeddable SDK + widget to add [Pacto P2P](https://github.com/PACTO-LAT/pacto-p2p) stablecoin buy/sell flows to any site** — Stripe Checkout–style.

Drop-in components let any dApp or merchant offer "Buy/Sell stablecoins with Pacto" (CRCX, MXNX, USDC) over regional rails (SINPE, SPEI), secured by Trustless Work escrows on Stellar — without integrating the full Pacto platform.

## Architecture

```
pacto-connect/
├── packages/
│   ├── connect-core/      # Framework-agnostic SDK (handshake, REST client, escrow events)
│   ├── connect-react/     # <PactoCheckout/> + hooks
│   └── connect-elements/  # <pacto-checkout> web-component for non-React sites
├── services/
│   └── connect-gateway/   # BFF: issues pk_/sk_ keys, signs handshakes, proxies Pacto API, webhooks
└── apps/
    └── docs/              # Docs site + interactive playground
```

The **Connect Gateway** is the only component that talks to the Pacto P2P API. The integrator's SDK only ever holds a `publishableKey`, so the main platform's credentials are never exposed and the main repo is never modified.

## Getting started

```bash
npm install
npm run build      # build all packages
npm run dev        # watch mode across packages + gateway
npm run check      # Biome lint + format check
npm run type-check
```

## Packages

| Package | Description |
| ------- | ----------- |
| `@pacto-connect/core` | Framework-agnostic SDK core |
| `@pacto-connect/react` | React widget and hooks |
| `@pacto-connect/elements` | Web-component / iframe embed |
| `@pacto-connect/gateway` | Connect Gateway (BFF), not published |

## Roadmap

The build is tracked in [issues #1–#10](https://github.com/PACTO-LAT/pacto-connect/issues). Critical path: #1 → #2 → #3 → #5.

## License

MIT
