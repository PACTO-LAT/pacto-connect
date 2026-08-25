import { signedAmount } from './ledger.js';
import type { MerchantStatement } from './statement.js';

const CSV_HEADER =
  'asset,occurred_at,entry_id,direction,kind,amount,signed_amount,source_escrow_id,corrects_entry_id,payout_run_id';

function formatAmount(value: number): string {
  return value.toFixed(8);
}

function formatIso(date: Date): string {
  return date.toISOString();
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeStatementCsv(statement: MerchantStatement): string {
  const rows: string[] = [CSV_HEADER];

  for (const section of statement.assets) {
    rows.push(
      [
        escapeCsv(section.asset),
        '',
        '',
        '',
        'opening_balance',
        '',
        formatAmount(section.opening),
        '',
        '',
        '',
      ].join(','),
    );

    for (const entry of section.entries) {
      rows.push(
        [
          escapeCsv(entry.asset),
          formatIso(entry.occurredAt),
          escapeCsv(entry.id),
          entry.direction,
          entry.kind,
          formatAmount(entry.amount),
          formatAmount(signedAmount(entry.direction, entry.amount)),
          escapeCsv(entry.sourceEscrowId ?? ''),
          escapeCsv(entry.correctsEntryId ?? ''),
          escapeCsv(entry.payoutRunId ?? ''),
        ].join(','),
      );
    }

    rows.push(
      [
        escapeCsv(section.asset),
        '',
        '',
        '',
        'closing_balance',
        '',
        formatAmount(section.closing),
        '',
        '',
        '',
      ].join(','),
    );
  }

  return `${rows.join('\n')}\n`;
}
