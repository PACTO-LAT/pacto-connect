import { serve } from '@hono/node-server';
import { Hono } from 'hono';

/**
 * Connect Gateway (BFF) — scaffolding only.
 * Real features live in the issues:
 *  - #1 publishable/secret keys + origin validation
 *  - #7 signed webhooks
 *  - #8 OTC quote engine
 *  - #9 sandbox / test mode
 */
const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok', service: 'connect-gateway' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`connect-gateway listening on http://localhost:${info.port}`);
});

export { app };
