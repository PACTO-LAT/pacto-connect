import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../merchants.js', () => ({ getMerchant: vi.fn() }));
vi.mock('../risk/lists.js', () => ({
  addRiskListEntry: vi.fn(),
  listRiskListEntries: vi.fn(),
  removeRiskListEntry: vi.fn(),
  RiskListEntryConflictError: class RiskListEntryConflictError extends Error {},
}));
vi.mock('../risk/settings.js', () => ({
  getMerchantRiskSettings: vi.fn(),
  upsertMerchantRiskSettings: vi.fn(),
}));
vi.mock('../risk/decisions.js', () => ({
  listRiskDecisions: vi.fn(),
}));
vi.mock('../middleware/admin.js', () => ({
  adminAuth: (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../db.js', () => ({ prisma: {} }));

import { getMerchant } from '../merchants.js';
import { listRiskDecisions } from '../risk/decisions.js';
import {
  addRiskListEntry,
  listRiskListEntries,
  RiskListEntryConflictError,
  removeRiskListEntry,
} from '../risk/lists.js';
import { getMerchantRiskSettings, upsertMerchantRiskSettings } from '../risk/settings.js';
import { adminRoutes } from './admin.js';

const merchant = { id: 'mrc_1', name: 'Acme', status: 'active' } as never;

describe('admin risk routes', () => {
  beforeEach(() => {
    vi.mocked(getMerchant).mockReset();
    vi.mocked(getMerchantRiskSettings).mockReset();
    vi.mocked(upsertMerchantRiskSettings).mockReset();
    vi.mocked(listRiskListEntries).mockReset();
    vi.mocked(addRiskListEntry).mockReset();
    vi.mocked(removeRiskListEntry).mockReset();
    vi.mocked(listRiskDecisions).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET .../risk/settings 404s for an unknown merchant', async () => {
    vi.mocked(getMerchant).mockResolvedValue(null);
    const res = await adminRoutes.request('/merchants/mrc_x/risk/settings');
    expect(res.status).toBe(404);
  });

  it('GET .../risk/settings returns the settings', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(getMerchantRiskSettings).mockResolvedValue({
      merchantId: 'mrc_1',
      windowMs: null,
      valueThreshold: 75_000,
      countThreshold: null,
      reviewValueThreshold: null,
      reviewCountThreshold: null,
      updatedAt: null,
    });

    const res = await adminRoutes.request('/merchants/mrc_1/risk/settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.valueThreshold).toBe(75_000);
  });

  it('PUT .../risk/settings rejects a non-positive threshold', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    const res = await adminRoutes.request('/merchants/mrc_1/risk/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueThreshold: -5 }),
    });
    expect(res.status).toBe(400);
    expect(upsertMerchantRiskSettings).not.toHaveBeenCalled();
  });

  it('PUT .../risk/settings updates thresholds', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(upsertMerchantRiskSettings).mockResolvedValue({
      merchantId: 'mrc_1',
      windowMs: null,
      valueThreshold: 90_000,
      countThreshold: null,
      reviewValueThreshold: null,
      reviewCountThreshold: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res = await adminRoutes.request('/merchants/mrc_1/risk/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueThreshold: 90_000 }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(upsertMerchantRiskSettings).mock.calls[0]![0]).toBe('mrc_1');
    expect(vi.mocked(upsertMerchantRiskSettings).mock.calls[0]![1]).toEqual({
      valueThreshold: 90_000,
    });
  });

  it('GET .../risk/lists rejects an invalid type filter', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    const res = await adminRoutes.request('/merchants/mrc_1/risk/lists?type=bogus');
    expect(res.status).toBe(400);
  });

  it('GET .../risk/lists lists entries filtered by type', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(listRiskListEntries).mockResolvedValue([
      {
        id: 'rle_1',
        merchantId: 'mrc_1',
        listType: 'deny',
        counterpartyRef: 'wallet_bad',
        note: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const res = await adminRoutes.request('/merchants/mrc_1/risk/lists?type=deny');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(vi.mocked(listRiskListEntries).mock.calls[0]).toEqual(['mrc_1', 'deny']);
  });

  it('POST .../risk/lists creates an entry', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(addRiskListEntry).mockResolvedValue({
      id: 'rle_1',
      merchantId: 'mrc_1',
      listType: 'allow',
      counterpartyRef: 'wallet_good',
      note: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res = await adminRoutes.request('/merchants/mrc_1/risk/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listType: 'allow', counterpartyRef: 'wallet_good' }),
    });
    expect(res.status).toBe(201);
  });

  it('POST .../risk/lists returns 409 on a duplicate entry', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(addRiskListEntry).mockRejectedValue(
      new RiskListEntryConflictError('allow', 'wallet_good'),
    );

    const res = await adminRoutes.request('/merchants/mrc_1/risk/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listType: 'allow', counterpartyRef: 'wallet_good' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST .../risk/lists rejects an invalid listType', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    const res = await adminRoutes.request('/merchants/mrc_1/risk/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listType: 'bogus', counterpartyRef: 'wallet_good' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE .../risk/lists/:entryId removes an entry', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(removeRiskListEntry).mockResolvedValue(true);

    const res = await adminRoutes.request('/merchants/mrc_1/risk/lists/rle_1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
  });

  it('DELETE .../risk/lists/:entryId 404s when not found', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(removeRiskListEntry).mockResolvedValue(false);

    const res = await adminRoutes.request('/merchants/mrc_1/risk/lists/rle_x', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('GET .../risk/decisions retrieves review decisions (not silently allowed)', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    vi.mocked(listRiskDecisions).mockResolvedValue([
      {
        id: 'rdc_1',
        merchantId: 'mrc_1',
        sessionId: 'session_1',
        counterpartyRef: 'wallet_1',
        amount: 900,
        asset: 'USDC',
        outcome: 'review',
        reason: 'velocity_value_review',
        requestId: 'req_1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const res = await adminRoutes.request('/merchants/mrc_1/risk/decisions?outcome=review');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0].outcome).toBe('review');
    expect(vi.mocked(listRiskDecisions).mock.calls[0]![1]).toEqual({
      outcome: 'review',
      limit: undefined,
    });
  });

  it('GET .../risk/decisions rejects an invalid outcome filter', async () => {
    vi.mocked(getMerchant).mockResolvedValue(merchant);
    const res = await adminRoutes.request('/merchants/mrc_1/risk/decisions?outcome=bogus');
    expect(res.status).toBe(400);
  });
});
