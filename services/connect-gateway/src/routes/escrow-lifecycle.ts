import type { ApiKey } from '@prisma/client';
import { Hono } from 'hono';
import {
  cancelEscrow,
  openDisputeEscrow,
  refundEscrow,
  resolveDisputeEscrow,
  SimulatorError,
} from '../escrow/lifecycle.js';
import { toGatewayErrorBody } from '../errors.js';
import { idempotency } from '../middleware/idempotency.js';
import {
  authenticateEscrowRequest,
  liveNotImplemented,
  serializeDispute,
  serializeEscrow,
  serializeRefund,
  simulatorErrorResponse,
} from './escrows.js';

type EscrowRouteVariables = { apiKey: ApiKey; requestId?: string };

const lifecycle = new Hono<{ Variables: EscrowRouteVariables }>();

function extractAdminToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function adminAuth(c: Parameters<typeof authenticateEscrowRequest>[0]): Response | null {
  const expected = process.env.GATEWAY_ADMIN_TOKEN;
  if (!expected) {
    return c.json(toGatewayErrorBody('gateway_error', 'not_configured', 'admin token not configured'), 503);
  }
  const token = extractAdminToken(c);
  if (!token || token !== expected) {
    return c.json(toGatewayErrorBody('auth_error', 'invalid_admin_token', 'Admin authorization required'), 401);
  }
  return null;
}

lifecycle.post('/:id/cancel', idempotency(), async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const body = await c.req.json<{ reason?: string }>().catch(() => ({}));

  try {
    const result = await cancelEscrow({
      sessionId: session.id,
      escrowId: c.req.param('id'),
      apiKeyId: apiKey.id,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    });

    if (!result) {
      return c.json(toGatewayErrorBody('escrow_error', 'escrow_not_found', 'Escrow not found'), 404);
    }

    return c.json({ escrow: serializeEscrow(result.data.escrow) });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }
    throw error;
  }
});

lifecycle.post('/:id/refund', idempotency(), async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const body = await c.req.json<{ amount?: string; reason?: string }>();

  if (!body.amount || typeof body.amount !== 'string') {
    return c.json(toGatewayErrorBody('validation_error', 'invalid_request', 'amount is required'), 400);
  }
  if (!body.reason || typeof body.reason !== 'string') {
    return c.json(toGatewayErrorBody('validation_error', 'invalid_request', 'reason is required'), 400);
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount)) {
    return c.json(toGatewayErrorBody('validation_error', 'invalid_request', 'amount must be a number'), 400);
  }

  try {
    const result = await refundEscrow({
      sessionId: session.id,
      escrowId: c.req.param('id'),
      apiKeyId: apiKey.id,
      amount,
      reason: body.reason,
      actor: 'merchant',
    });

    if (!result) {
      return c.json(toGatewayErrorBody('escrow_error', 'escrow_not_found', 'Escrow not found'), 404);
    }

    return c.json({
      escrow: serializeEscrow(result.data.escrow),
      refund: serializeRefund(result.data.refund),
    });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }
    throw error;
  }
});

lifecycle.post('/:id/disputes', idempotency(), async (c) => {
  const auth = await authenticateEscrowRequest(c);
  if ('error' in auth) {
    return auth.error;
  }

  const { session, apiKey } = auth;
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const body = await c.req.json<{
    actor?: string;
    reason?: string;
    evidenceRefs?: string[];
  }>();

  if (body.actor !== 'buyer' && body.actor !== 'seller') {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'actor must be buyer or seller'),
      400,
    );
  }
  if (!body.reason || typeof body.reason !== 'string') {
    return c.json(toGatewayErrorBody('validation_error', 'invalid_request', 'reason is required'), 400);
  }

  try {
    const result = await openDisputeEscrow({
      sessionId: session.id,
      escrowId: c.req.param('id'),
      apiKeyId: apiKey.id,
      actor: body.actor,
      reason: body.reason,
      evidenceRefs: Array.isArray(body.evidenceRefs)
        ? body.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
        : undefined,
    });

    if (!result) {
      return c.json(toGatewayErrorBody('escrow_error', 'escrow_not_found', 'Escrow not found'), 404);
    }

    return c.json({
      escrow: serializeEscrow(result.data.escrow),
      dispute: serializeDispute(result.data.dispute),
    });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }
    throw error;
  }
});

lifecycle.post('/:id/disputes/:disputeId/resolve', idempotency(), async (c) => {
  const adminError = adminAuth(c);
  if (adminError) {
    return adminError;
  }

  const apiKey = c.get('apiKey');
  if (apiKey.mode !== 'test') {
    return liveNotImplemented(c);
  }

  const body = await c.req.json<{ outcome?: string; note?: string }>();

  if (body.outcome !== 'release' && body.outcome !== 'refund') {
    return c.json(
      toGatewayErrorBody('validation_error', 'invalid_request', 'outcome must be release or refund'),
      400,
    );
  }

  try {
    const result = await resolveDisputeEscrow({
      escrowId: c.req.param('id'),
      disputeId: c.req.param('disputeId'),
      apiKeyId: apiKey.id,
      outcome: body.outcome,
      note: typeof body.note === 'string' ? body.note : undefined,
    });

    if (!result) {
      return c.json(toGatewayErrorBody('escrow_error', 'escrow_not_found', 'Escrow not found'), 404);
    }

    return c.json({
      escrow: serializeEscrow(result.data.escrow),
      dispute: serializeDispute(result.data.dispute),
    });
  } catch (error) {
    if (error instanceof SimulatorError) {
      return simulatorErrorResponse(c, error);
    }
    throw error;
  }
});

export { lifecycle as escrowLifecycleRoutes };
