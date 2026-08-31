import { describe, expect, it } from 'vitest';
import type { MerchantStatement } from './statement.js';
import { serializeStatementCsv } from './statement-csv.js';

const statement: MerchantStatement = {
  merchantId: 'mrc_1',
  periodKey: '2026-08',
  startsAt: new Date('2026-08-01T00:00:00.000Z'),
  endsAt: new Date('2026-09-01T00:00:00.000Z'),
  assets: [
    {
      asset: 'USDC',
      opening: 0,
      entries: [
        {
          id: 'led_1',
          merchantId: 'mrc_1',
          periodId: 'prd_1',
          periodKey: '2026-08',
          sourceEscrowId: 'esc_1',
          direction: 'credit',
          kind: 'settlement',
          amount: 100,
          asset: 'USDC',
          correctsEntryId: null,
          occurredAt: new Date('2026-08-10T00:00:00.000Z'),
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
          payoutRunId: null,
        },
      ],
      closing: 100,
    },
  ],
};

describe('statement-csv module', () => {
  it('serializeStatementCsv is byte-stable for the same statement', () => {
    const first = serializeStatementCsv(statement);
    const second = serializeStatementCsv(statement);
    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(first.startsWith('asset,occurred_at,entry_id')).toBe(true);
  });
});
