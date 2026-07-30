import { serve } from '@hono/node-server';
import { app } from './app.js';
import { logger } from './logger.js';
import { recordSettlement } from './merchants.js';
import { startSubscriptionRunner } from './subscriptions/runner.js';
import { setSettlementSink } from './testmode/simulator.js';
import { initTracing } from './tracing.js';
import { startDeliveryRunner } from './webhooks/runner.js';

if (initTracing()) {
  logger.info('otel tracing enabled');
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  logger.info('connect-gateway listening', { port: info.port });
  startDeliveryRunner();
  logger.info('webhook delivery runner started');
  startSubscriptionRunner();
  logger.info('subscription runner started');
  setSettlementSink((s) => {
    recordSettlement(s).catch((error) => {
      logger.error('failed to record merchant settlement', { error });
    });
  });
});

export { app };
