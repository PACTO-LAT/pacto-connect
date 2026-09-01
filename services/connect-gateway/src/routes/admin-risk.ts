import type { RiskDecisionOutcome, RiskListType } from '@prisma/client';
import { Hono } from 'hono';
import { getMerchant } from '../merchants.js';
import { listRiskDecisions } from '../risk/decisions.js';
import {
  addRiskListEntry,
  listRiskListEntries,
  RiskListEntryConflictError,
  removeRiskListEntry,
} from '../risk/lists.js';
import { getMerchantRiskSettings, upsertMerchantRiskSettings } from '../risk/settings.js';

const adminRisk = new Hono();

const LIST_TYPES: readonly RiskListType[] = ['allow', 'deny'];
const DECISION_OUTCOMES: readonly RiskDecisionOutcome[] = ['allow', 'review', 'block'];

function isRiskListType(value: string | undefined): value is RiskListType {
  return value !== undefined && (LIST_TYPES as readonly string[]).includes(value);
}

function isDecisionOutcome(value: string | undefined): value is RiskDecisionOutcome {
  return value !== undefined && (DECISION_OUTCOMES as readonly string[]).includes(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isPositiveNumber(value) && Number.isInteger(value);
}

adminRisk.get('/merchants/:id/risk/settings', async (c) => {
  const merchantId = c.req.param('id');
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }

  const settings = await getMerchantRiskSettings(merchantId);
  return c.json({ settings });
});

adminRisk.put('/merchants/:id/risk/settings', async (c) => {
  const merchantId = c.req.param('id');
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }

  const body = await c.req.json<{
    windowMs?: number | null;
    valueThreshold?: number | null;
    countThreshold?: number | null;
    reviewValueThreshold?: number | null;
    reviewCountThreshold?: number | null;
  }>();

  const numericFields: Array<[keyof typeof body, (v: unknown) => boolean]> = [
    ['windowMs', isPositiveInteger],
    ['valueThreshold', isPositiveNumber],
    ['countThreshold', isPositiveInteger],
    ['reviewValueThreshold', isPositiveNumber],
    ['reviewCountThreshold', isPositiveInteger],
  ];

  for (const [field, validator] of numericFields) {
    const value = body[field];
    if (value !== undefined && value !== null && !validator(value)) {
      return c.json({ error: `${field} must be a positive number when provided` }, 400);
    }
  }

  const settings = await upsertMerchantRiskSettings(merchantId, body);
  return c.json({ settings });
});

adminRisk.get('/merchants/:id/risk/lists', async (c) => {
  const merchantId = c.req.param('id');
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }

  const typeParam = c.req.query('type');
  if (typeParam !== undefined && !isRiskListType(typeParam)) {
    return c.json({ error: 'type must be "allow" or "deny"' }, 400);
  }

  const entries = await listRiskListEntries(merchantId, typeParam);
  return c.json({ entries });
});

adminRisk.post('/merchants/:id/risk/lists', async (c) => {
  const merchantId = c.req.param('id');
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }

  const body = await c.req.json<{ listType?: string; counterpartyRef?: string; note?: string }>();

  if (!isRiskListType(body.listType)) {
    return c.json({ error: 'listType must be "allow" or "deny"' }, 400);
  }
  if (!body.counterpartyRef || typeof body.counterpartyRef !== 'string') {
    return c.json({ error: 'counterpartyRef is required' }, 400);
  }

  try {
    const entry = await addRiskListEntry({
      merchantId,
      listType: body.listType,
      counterpartyRef: body.counterpartyRef,
      note: body.note,
    });
    return c.json({ entry }, 201);
  } catch (error) {
    if (error instanceof RiskListEntryConflictError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

adminRisk.delete('/merchants/:id/risk/lists/:entryId', async (c) => {
  const merchantId = c.req.param('id');
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }

  const ok = await removeRiskListEntry(merchantId, c.req.param('entryId'));
  if (!ok) {
    return c.json({ error: 'list entry not found' }, 404);
  }
  return c.body(null, 204);
});

adminRisk.get('/merchants/:id/risk/decisions', async (c) => {
  const merchantId = c.req.param('id');
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }

  const outcomeParam = c.req.query('outcome');
  if (outcomeParam !== undefined && !isDecisionOutcome(outcomeParam)) {
    return c.json({ error: 'outcome must be "allow", "review", or "block"' }, 400);
  }

  const limitParam = c.req.query('limit');
  let limit: number | undefined;
  if (limitParam !== undefined) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return c.json({ error: 'limit must be a positive number' }, 400);
    }
    limit = parsed;
  }

  const decisions = await listRiskDecisions(merchantId, { outcome: outcomeParam, limit });
  return c.json({ decisions });
});

export { adminRisk as adminRiskRoutes };
