import { generateRequestId, REQUEST_ID_HEADER } from '@pacto-connect/core';
import type { Context, Next } from 'hono';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{6,128}$/;

export function getRequestId(c: Context): string | undefined {
  return c.get('requestId') as string | undefined;
}

export function requestId() {
  return async (c: Context, next: Next): Promise<void> => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : generateRequestId();
    c.set('requestId', id);
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, id);
  };
}
