# Pacto Connect — Docs

Docs site, interactive playground, and runnable example storefronts.

## Dev

```bash
# From repo root
npm install && npm run build

# Docs (port 3100)
cd apps/docs && npm run dev

# Example apps individually (ports 3201–3203)
cd apps/docs/examples/react-storefront && npm run dev
cd apps/docs/examples/static-storefront && npm run dev
cd apps/docs/examples/marketplace && npm run dev

# All examples at once
npm run dev:examples
```

Build examples into `public/examples/` for playground iframes:

```bash
cd apps/docs && npm run build:examples
```

Set `NEXT_PUBLIC_EXAMPLE_DEV_MODE=true` when running the docs dev server to iframe local example servers instead of the static build.

## Pages

- `/quickstart` — SDK onboarding
- `/examples` — source walkthroughs for example integrations
- `/playground` — widget configurator + live example embeds
