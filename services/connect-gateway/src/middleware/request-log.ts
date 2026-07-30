import type { Context, Next } from 'hono';
import { logger as defaultLogger, type Logger } from '../logger.js';
import { getRequestId } from './request-id.js';

export function requestLog(log: Logger = defaultLogger) {
  return async (c: Context, next: Next): Promise<void> => {
    const start = Date.now();
    try {
      await next();
    } catch (error) {
      const apiKeyId = c.get('apiKey')?.id;
      log.error('request', {
        method: c.req.method,
        path: c.req.path,
        status: 500,
        durationMs: Math.round(Date.now() - start),
        requestId: getRequestId(c),
        ...(apiKeyId !== undefined ? { apiKeyId } : {}),
        error,
      });
      throw error;
    }

    const status = c.res.status;
    const apiKeyId = c.get('apiKey')?.id;
    const fields = {
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: Math.round(Date.now() - start),
      requestId: getRequestId(c),
      ...(apiKeyId !== undefined ? { apiKeyId } : {}),
    };

    if (status >= 500) {
      log.error('request', fields);
    } else {
      log.info('request', fields);
    }
  };
}
