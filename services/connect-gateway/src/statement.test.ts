import { describe, expect, it } from 'vitest';
import { signedAmount } from './ledger.js';
import type { MerchantStatement } from './statement.js';
import { assertStatementReconciles } from './statement.js';

describe('statement module', () => {
  it('assertStatementReconciles passes when opening plus entries equals closing', () => {
    const statement: MerchantStatement = {
      merchantId: 'mrc_1',
      periodKey: '2026-08',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-09-01T00:00:00.000Z'),
      assets: [
        {
          asset: 'USDC',
          opening: 25,
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
            {
              id: 'led_2',
              merchantId: 'mrc_1',
              periodId: 'prd_1',
              periodKey: '2026-08',
              sourceEscrowId: 'esc_1',
              direction: 'debit',
              kind: 'correction',
              amount: 10,
              asset: 'USDC',
              correctsEntryId: 'led_1',
              occurredAt: new Date('2026-08-12T00:00:00.000Z'),
              createdAt: new Date('2026-08-12T00:00:00.000Z'),
              payoutRunId: null,
            },
          ],
          closing: 115,
        },
      ],
    };

    const entrySum = statement.assets[0]!.entries.reduce(
      (sum, entry) => sum + signedAmount(entry.direction, entry.amount),
      0,
    );
    expect(statement.assets[0]!.opening + entrySum).toBe(statement.assets[0]!.closing);
    expect(assertStatementReconciles(statement)).toBe(true);
  });
});
