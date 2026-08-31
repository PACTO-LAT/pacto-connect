import { prisma } from '../db.js';
import { computeWindowStart, type VelocityTotals } from './window.js';

// Only allow/review decisions represent value that actually moved (an
// escrow was created); block decisions are excluded so a blocked attempt
// never itself contributes to future velocity totals.
const COUNTED_OUTCOMES = ['allow', 'review'] as const;

export async function computeMerchantVelocity(
  merchantId: string,
  windowMs: number,
  now: Date = new Date(),
): Promise<VelocityTotals> {
  const windowStart = computeWindowStart(now, windowMs);

  const aggregate = await prisma.riskDecision.aggregate({
    where: {
      merchantId,
      outcome: { in: [...COUNTED_OUTCOMES] },
      createdAt: { gt: windowStart },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    value: aggregate._sum.amount ?? 0,
    count: aggregate._count._all ?? 0,
  };
}
