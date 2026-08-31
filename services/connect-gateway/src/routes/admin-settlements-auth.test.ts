import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

vi.mock('../keys.js', () => ({
  findActiveApiKeyByPublishableKey: vi.fn(),
  isOriginAllowed: vi.fn(),
  normalizeOrigin: vi.fn(),
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  cutoverApiKey: vi.fn(),
}));

vi.mock('../merchants.js', () => ({
  getMerchant: vi.fn(),
  createMerchant: vi.fn(),
  listMerchantsForApiKey: vi.fn(),
  setMerchantStatus: vi.fn(),
}));

vi.mock('../statement.js', () => ({
  generateMerchantStatement: vi.fn(),
}));

vi.mock('../statement-csv.js', () => ({
  serializeStatementCsv: vi.fn(() => 'asset,occurred_at\n'),
}));

import { getMerchant } from '../merchants.js';
import { generateMerchantStatement } from '../statement.js';

describe('admin settlement auth', () => {
  beforeEach(() => {
    process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
    vi.mocked(getMerchant).mockReset();
    vi.mocked(generateMerchantStatement).mockReset();
  });

  it('GET statement.csv without token returns 401', async () => {
    const app = createApp();
    const res = await app.request('/admin/merchants/mrc_1/periods/2026-08/statement.csv');
    expect(res.status).toBe(401);
  });

  it('GET statement.csv with token returns CSV', async () => {
    vi.mocked(getMerchant).mockResolvedValue({ id: 'mrc_1' } as never);
    vi.mocked(generateMerchantStatement).mockResolvedValue({
      merchantId: 'mrc_1',
      periodKey: '2026-08',
      assets: [],
    } as never);

    const app = createApp();
    const res = await app.request('/admin/merchants/mrc_1/periods/2026-08/statement.csv', {
      headers: { Authorization: 'Bearer test-admin-token' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });
});
