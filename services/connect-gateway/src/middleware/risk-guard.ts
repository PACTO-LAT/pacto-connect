import type { CheckoutSession } from '@prisma/client';
import type { Context } from 'hono';
import { RiskError, riskErrorStatus, toGatewayErrorBody } from '../errors.js';
import { evaluateEscrowRisk, type RiskEvaluationResult } from '../risk/evaluate.js';
import { getRequestId } from './request-id.js';

export type RiskGuardOutcome = { result: RiskEvaluationResult | null } | { error: Response };

/**
 * Guard invoked on the escrow-creation path: evaluates the merchant's
 * velocity controls and counterparty lists for the prospective escrow and
 * returns either the (possibly null) decision, or an HTTP error response
 * when the decision is "block". Route handlers must return the error
 * response as-is and must not create the escrow.
 */
export async function guardEscrowRisk(
  c: Context,
  input: {
    session: Pick<CheckoutSession, 'id' | 'merchantId' | 'counterpartyRef'>;
    amount: number;
    asset: string;
  },
): Promise<RiskGuardOutcome> {
  try {
    const result = await evaluateEscrowRisk({
      merchantId: input.session.merchantId,
      counterpartyRef: input.session.counterpartyRef,
      sessionId: input.session.id,
      amount: input.amount,
      asset: input.asset,
      requestId: getRequestId(c),
    });
    return { result };
  } catch (error) {
    if (error instanceof RiskError) {
      return {
        error: c.json(
          toGatewayErrorBody('risk_error', error.code, error.message),
          riskErrorStatus(error.code),
        ),
      };
    }
    throw error;
  }
}
