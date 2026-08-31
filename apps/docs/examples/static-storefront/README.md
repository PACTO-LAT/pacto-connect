# Static Storefront Example

Plain HTML + JavaScript storefront using `@pacto-connect/elements` and `pacto.mount()`. Vite is used only for local dev and bundling — no React or other UI framework.

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

Open [http://localhost:3202/examples/static/](http://localhost:3202/examples/static/).

## Build (for docs playground)

```bash
npm run build
```

Output is written to `apps/docs/public/examples/static/`.
