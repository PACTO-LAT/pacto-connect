import { Hono } from 'hono';
import {
  appendCorrectionEntry,
  closeSettlementPeriod,
  getSettlementPeriod,
  LedgerEntryNotFoundError,
  PeriodClosedError,
  parsePeriodKey,
} from '../ledger.js';
import { getMerchant } from '../merchants.js';
import { generatePayoutRun, getPayoutRun, listPayoutRuns } from '../payout-run.js';
import { generateMerchantStatement } from '../statement.js';
import { serializeStatementCsv } from '../statement-csv.js';

const adminSettlements = new Hono();

function isValidPeriodKey(periodKey: string): boolean {
  try {
    parsePeriodKey(periodKey);
    return true;
  } catch {
    return false;
  }
}

adminSettlements.post('/merchants/:id/periods/:periodKey/close', async (c) => {
  const merchantId = c.req.param('id');
  const periodKey = c.req.param('periodKey');
  if (!isValidPeriodKey(periodKey)) {
    return c.json({ error: 'invalid periodKey' }, 400);
  }
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }
  const period = await closeSettlementPeriod(merchantId, periodKey);
  return c.json({ period });
});

adminSettlements.post('/merchants/:id/ledger/corrections', async (c) => {
  const merchantId = c.req.param('id');
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }
  const body = await c.req.json<{ correctsEntryId?: string; amount?: number }>();
  if (!body.correctsEntryId || typeof body.correctsEntryId !== 'string') {
    return c.json({ error: 'correctsEntryId is required' }, 400);
  }
  if (body.amount !== undefined && (typeof body.amount !== 'number' || body.amount <= 0)) {
    return c.json({ error: 'amount must be a positive number' }, 400);
  }
  try {
    const entry = await appendCorrectionEntry({
      merchantId,
      correctsEntryId: body.correctsEntryId,
      amount: body.amount,
    });
    return c.json({ entry }, 201);
  } catch (error) {
    if (error instanceof LedgerEntryNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof PeriodClosedError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

adminSettlements.post('/merchants/:id/periods/:periodKey/payout-runs', async (c) => {
  const merchantId = c.req.param('id');
  const periodKey = c.req.param('periodKey');
  if (!isValidPeriodKey(periodKey)) {
    return c.json({ error: 'invalid periodKey' }, 400);
  }
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }
  const body = await c.req.json<{ asset?: string }>();
  if (!body.asset || typeof body.asset !== 'string') {
    return c.json({ error: 'asset is required' }, 400);
  }
  const period = await getSettlementPeriod(merchantId, periodKey);
  if (!period) {
    return c.json({ error: 'settlement period not found' }, 404);
  }
  const run = await generatePayoutRun({ merchantId, periodKey, asset: body.asset });
  return c.json({ run }, 201);
});

adminSettlements.get('/payout-runs', async (c) => {
  const merchantId = c.req.query('merchantId');
  const periodKey = c.req.query('periodKey');
  if (periodKey && !merchantId) {
    return c.json({ error: 'merchantId is required when periodKey is provided' }, 400);
  }
  if (periodKey && !isValidPeriodKey(periodKey)) {
    return c.json({ error: 'invalid periodKey' }, 400);
  }
  const runs = await listPayoutRuns({ merchantId, periodKey });
  return c.json({ runs });
});

adminSettlements.get('/payout-runs/:id', async (c) => {
  const run = await getPayoutRun(c.req.param('id'));
  if (!run) {
    return c.json({ error: 'payout run not found' }, 404);
  }
  return c.json({ run });
});

adminSettlements.get('/merchants/:id/periods/:periodKey/statement.csv', async (c) => {
  const merchantId = c.req.param('id');
  const periodKey = c.req.param('periodKey');
  if (!isValidPeriodKey(periodKey)) {
    return c.json({ error: 'invalid periodKey' }, 400);
  }
  const merchant = await getMerchant(merchantId);
  if (!merchant) {
    return c.json({ error: 'merchant not found' }, 404);
  }
  const statement = await generateMerchantStatement({ merchantId, periodKey });
  if (!statement) {
    return c.json({ error: 'settlement period not found' }, 404);
  }
  const csv = serializeStatementCsv(statement);
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header(
    'Content-Disposition',
    `attachment; filename="statement-${merchantId}-${periodKey}.csv"`,
  );
  return c.body(csv);
});

export { adminSettlements as adminSettlementRoutes };
