# Marketplace Example

Multi-product storefront demonstrating a single `@pacto-connect/react` checkout integration with per-product `listingId` values.

## Prerequisites

From the **repo root** (once):

```bash
npm install
npm run build
```

Optional — run the Connect Gateway locally for a full checkout flow:

```bash
cd services/connect-gateway
cp .env.example .env
npm run dev
```

## Setup

```bash
cp .env.example .env
```

## Run

```bash
npm run dev
```

Open [http://localhost:3203/examples/marketplace/](http://localhost:3203/examples/marketplace/).

## Build (for docs playground)

```bash
npm run build
```

Output is written to `apps/docs/public/examples/marketplace/`.
