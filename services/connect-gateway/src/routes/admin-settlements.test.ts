import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../merchants.js', () => ({
  getMerchant: vi.fn(),
}));
vi.mock('../ledger.js', () => ({
  appendCorrectionEntry: vi.fn(),
  closeSettlementPeriod: vi.fn(),
  getSettlementPeriod: vi.fn(),
  parsePeriodKey: vi.fn((key: string) => {
    if (!/^\d{4}-\d{2}$/.test(key)) {
      throw new Error(`invalid period key: ${key}`);
    }
    const [yearStr, monthStr] = key.split('-');
    return {
      startsAt: new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1)),
      endsAt: new Date(Date.UTC(Number(yearStr), Number(monthStr), 1)),
    };
  }),
  PeriodClosedError: class PeriodClosedError extends Error {
    constructor(periodKey: string) {
      super(`settlement period ${periodKey} is closed`);
      this.name = 'PeriodClosedError';
    }
  },
  LedgerEntryNotFoundError: class LedgerEntryNotFoundError extends Error {
    constructor(entryId: string) {
      super(`ledger entry ${entryId} not found`);
      this.name = 'LedgerEntryNotFoundError';
    }
  },
}));
vi.mock('../payout-run.js', () => ({
  generatePayoutRun: vi.fn(),
  getPayoutRun: vi.fn(),
  listPayoutRuns: vi.fn(),
}));
vi.mock('../statement.js', () => ({
  generateMerchantStatement: vi.fn(),
}));
vi.mock('../statement-csv.js', () => ({
  serializeStatementCsv: vi.fn(() => 'asset,occurred_at\n'),
}));
vi.mock('../middleware/admin.js', () => ({
  adminAuth: (_c: unknown, next: () => Promise<void>) => next(),
}));

import {
  appendCorrectionEntry,
  closeSettlementPeriod,
  getSettlementPeriod,
  LedgerEntryNotFoundError,
  PeriodClosedError,
} from '../ledger.js';
import { getMerchant } from '../merchants.js';
import { generatePayoutRun, getPayoutRun, listPayoutRuns } from '../payout-run.js';
import { generateMerchantStatement } from '../statement.js';
import { adminRoutes } from './admin.js';

describe('admin settlement routes', () => {
  beforeEach(() => {
    vi.mocked(getMerchant).mockReset();
    vi.mocked(closeSettlementPeriod).mockReset();
    vi.mocked(appendCorrectionEntry).mockReset();
    vi.mocked(getSettlementPeriod).mockReset();
    vi.mocked(generatePayoutRun).mockReset();
    vi.mocked(listPayoutRuns).mockReset();
    vi.mocked(getPayoutRun).mockReset();
    vi.mocked(generateMerchantStatement).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('POST close period returns the closed period', async () => {
    vi.mocked(getMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(closeSettlementPeriod).mockResolvedValue({
      id: 'prd_1',
      merchantId: 'mrc_1',
      periodKey: '2026-08',
      status: 'closed',
    } as never);

    const res = await adminRoutes.request('/merchants/mrc_1/periods/2026-08/close', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });

  it('POST correction returns 409 when period is closed', async () => {
    vi.mocked(getMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(appendCorrectionEntry).mockRejectedValue(new PeriodClosedError('2026-08'));

    const res = await adminRoutes.request('/merchants/mrc_1/ledger/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correctsEntryId: 'led_1' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST correction returns 404 when entry is missing', async () => {
    vi.mocked(getMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(appendCorrectionEntry).mockRejectedValue(new LedgerEntryNotFoundError('led_x'));

    const res = await adminRoutes.request('/merchants/mrc_1/ledger/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correctsEntryId: 'led_x' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST payout run creates a run', async () => {
    vi.mocked(getMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(getSettlementPeriod).mockResolvedValue({ id: 'prd_1' } as never);
    vi.mocked(generatePayoutRun).mockResolvedValue({ id: 'pay_1', total: 100 } as never);

    const res = await adminRoutes.request('/merchants/mrc_1/periods/2026-08/payout-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset: 'USDC' }),
    });
    expect(res.status).toBe(201);
  });

  it('GET payout-runs lists runs', async () => {
    vi.mocked(listPayoutRuns).mockResolvedValue([{ id: 'pay_1' }] as never);
    const res = await adminRoutes.request('/payout-runs?merchantId=mrc_1&periodKey=2026-08');
    expect(res.status).toBe(200);
  });

  it('GET payout-runs/:id inspects a run', async () => {
    vi.mocked(getPayoutRun).mockResolvedValue({ id: 'pay_1' } as never);
    const res = await adminRoutes.request('/payout-runs/pay_1');
    expect(res.status).toBe(200);
  });

  it('GET statement.csv exports CSV', async () => {
    vi.mocked(getMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(generateMerchantStatement).mockResolvedValue({
      merchantId: 'mrc_1',
      periodKey: '2026-08',
      assets: [],
    } as never);

    const res = await adminRoutes.request('/merchants/mrc_1/periods/2026-08/statement.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });
});
