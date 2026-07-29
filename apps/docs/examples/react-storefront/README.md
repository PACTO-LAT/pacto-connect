# React Storefront Example

Minimal Next.js product page that opens the Pacto checkout modal via `@pacto-connect/react`.

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
cp .env.example .env.local
```

## Run

```bash
npm run dev
```

Open [http://localhost:3201/examples/react](http://localhost:3201/examples/react).

## Build (for docs playground)

```bash
npm run build
```

Output is copied to `apps/docs/public/examples/react/`.
