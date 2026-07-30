import { classifyGatewayError, isPactoErrorCode } from '@pacto-connect/core';
import type { Context, Next } from 'hono';
import { getRequestId } from './request-id.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorEnvelope() {
  return async (c: Context, next: Next): Promise<void> => {
    await next();

    if (c.res.status < 400) {
      return;
    }

    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return;
    }

    let body: unknown;
    try {
      body = await c.res.clone().json();
    } catch {
      return;
    }

    if (!isPlainObject(body) || !('error' in body)) {
      return;
    }

    const status = c.res.status;
    const requestId = getRequestId(c);
    let newBody: unknown;

    if (isPlainObject(body.error)) {
      const type = typeof body.error.type === 'string' ? body.error.type : 'gateway_error';
      const code = typeof body.error.code === 'string' ? body.error.code : 'unknown_error';
      const message = typeof body.error.message === 'string' ? body.error.message : 'unknown error';
      const pactoCode = isPactoErrorCode(body.error.pactoCode)
        ? body.error.pactoCode
        : classifyGatewayError({ status, type, code });

      newBody = {
        ...body,
        error: {
          ...body.error,
          type,
          code,
          message,
          pactoCode,
          ...(requestId !== undefined ? { requestId } : {}),
        },
      };
    } else if (typeof body.error === 'string') {
      const code = typeof body.code === 'string' ? body.code : 'unknown_error';
      const pactoCode = classifyGatewayError({ status, type: 'gateway_error', code });
      newBody = {
        error: {
          type: 'gateway_error',
          code,
          message: body.error,
          pactoCode,
          ...(requestId !== undefined ? { requestId } : {}),
        },
      };
    } else {
      return;
    }

    const headers = new Headers(c.res.headers);
    headers.delete('content-length');
    c.res = new Response(JSON.stringify(newBody), { status, headers });
  };
}
