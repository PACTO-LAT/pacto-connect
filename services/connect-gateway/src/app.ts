import { REQUEST_ID_HEADER } from '@pacto-connect/core';
import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import { toGatewayErrorBody } from './errors.js';
import { logger } from './logger.js';
import { errorEnvelope } from './middleware/error-envelope.js';
import { originValidation } from './middleware/origin.js';
import {
  createRateLimiter,
  getRateLimitConfig,
  rateLimitMiddleware,
} from './middleware/rate-limit.js';
import { getRequestId, requestId } from './middleware/request-id.js';
import { requestLog } from './middleware/request-log.js';
import { adminRoutes } from './routes/admin.js';
import { escrowRoutes } from './routes/escrows.js';
import { inboundWebhookRoutes } from './routes/inbound-webhooks.js';
import { quoteRoutes } from './routes/quote.js';
import { sessionRoutes } from './routes/session.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { testControlRoutes } from './routes/test-controls.js';

type GatewayVariables = {
  apiKey: ApiKey;
  requestId?: string;
};

export function createApp(): Hono<{ Variables: GatewayVariables }> {
  const app = new Hono<{ Variables: GatewayVariables }>();
  const rateLimiter = createRateLimiter(getRateLimitConfig());

  app.use('*', requestId());
  app.use('*', requestLog());
  app.use('*', errorEnvelope());

  app.get('/health', (c) => c.json({ status: 'ok', service: 'connect-gateway' }));

  app.route('/admin', adminRoutes);

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/health' ||
      path.startsWith('/admin') ||
      path.startsWith('/v1/webhooks/inbound')
    ) {
      return next();
    }
    return originValidation(c, next);
  });

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/health' ||
      path.startsWith('/admin') ||
      path.startsWith('/v1/webhooks/inbound') ||
      c.req.method === 'OPTIONS'
    ) {
      return next();
    }
    return rateLimitMiddleware(rateLimiter, (ctx) => ctx.get('apiKey')?.id)(c, next);
  });

  app.route('/v1/session', sessionRoutes);
  app.route('/v1/escrows', escrowRoutes);
  app.route('/v1/subscriptions', subscriptionRoutes);
  app.route('/v1/test', testControlRoutes);
  app.route('/v1/quote', quoteRoutes);
  app.route('/v1/webhooks/inbound', inboundWebhookRoutes);

  app.all('*', (c) =>
    c.json(toGatewayErrorBody('gateway_error', 'not_found', 'resource not found'), 404),
  );

  app.onError((err, c) => {
    const requestIdValue = getRequestId(c);
    logger.error('unhandled error', {
      error: err,
      requestId: requestIdValue,
      path: c.req.path,
      method: c.req.method,
    });
    if (requestIdValue) {
      c.header(REQUEST_ID_HEADER, requestIdValue);
    }
    return c.json(
      toGatewayErrorBody('gateway_error', 'internal_error', 'internal server error', {
        pactoCode: 'PACTO_INTERNAL',
        requestId: requestIdValue,
      }),
      500,
    );
  });

  return app;
}

export const app = createApp();
