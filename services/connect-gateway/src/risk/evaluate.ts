// Risk-evaluation module. Pure business logic plus persistence — no Hono,
// no HTTP status codes. See src/middleware/risk-guard.ts for the HTTP-facing
// wrapper invoked on the escrow-creation path.
import { RiskError } from '../errors.js';
import { createLogger, type Logger } from '../logger.js';
import { type RiskDecisionOutcome, recordRiskDecision } from './decisions.js';
import { isCounterpartyListed } from './lists.js';
import { getEffectiveRiskThresholds } from './settings.js';
import { computeMerchantVelocity } from './velocity.js';

const riskLogger: Logger = createLogger({ module: 'risk' });

export interface EvaluateEscrowRiskInput {
  merchantId: string | null | undefined;
  counterpartyRef?: string | null;
  sessionId: string;
  amount: number;
  asset: string;
  requestId?: string;
}

export interface RiskEvaluationResult {
  outcome: RiskDecisionOutcome;
  reason: string;
  decisionId: string;
}

function logDecision(input: {
  outcome: RiskDecisionOutcome;
  reason: string;
  merchantId: string;
  sessionId: string;
  counterpartyRef: string | null | undefined;
  amount: number;
  asset: string;
  requestId: string | undefined;
  decisionId: string;
}): void {
  const fields = {
    requestId: input.requestId,
    merchantId: input.merchantId,
    sessionId: input.sessionId,
    counterpartyRef: input.counterpartyRef ?? null,
    amount: input.amount,
    asset: input.asset,
    outcome: input.outcome,
    reason: input.reason,
    decisionId: input.decisionId,
  };

  if (input.outcome === 'block') {
    riskLogger.error('escrow risk decision: blocked', fields);
  } else if (input.outcome === 'review') {
    riskLogger.warn('escrow risk decision: flagged for review', fields);
  } else {
    riskLogger.info('escrow risk decision: allowed', fields);
  }
}

/**
 * Evaluate a prospective escrow against the owning merchant's velocity
 * controls and counterparty lists. Returns null when there is no merchant
 * context to evaluate against (platform-level sessions are out of scope for
 * per-merchant velocity control). Throws RiskError when the decision is
 * "block" — callers on the escrow-creation path must not create the escrow.
 */
export async function evaluateEscrowRisk(
  input: EvaluateEscrowRiskInput,
): Promise<RiskEvaluationResult | null> {
  const { merchantId } = input;
  if (!merchantId) {
    return null;
  }

  const counterpartyRef = input.counterpartyRef ?? null;

  // Deny-list precedence: a counterparty on the deny list is blocked
  // regardless of allow-list membership or velocity. Checked first.
  if (counterpartyRef) {
    const denied = await isCounterpartyListed(merchantId, counterpartyRef, 'deny');
    if (denied) {
      const decision = await recordRiskDecision({
        merchantId,
        sessionId: input.sessionId,
        counterpartyRef,
        amount: input.amount,
        asset: input.asset,
        outcome: 'block',
        reason: 'deny_list',
        requestId: input.requestId,
      });
      logDecision({
        outcome: 'block',
        reason: 'deny_list',
        merchantId,
        sessionId: input.sessionId,
        counterpartyRef,
        amount: input.amount,
        asset: input.asset,
        requestId: input.requestId,
        decisionId: decision.id,
      });
      throw new RiskError('deny_listed', `counterparty ${counterpartyRef} is on the deny list`);
    }

    const allowed = await isCounterpartyListed(merchantId, counterpartyRef, 'allow');
    if (allowed) {
      const decision = await recordRiskDecision({
        merchantId,
        sessionId: input.sessionId,
        counterpartyRef,
        amount: input.amount,
        asset: input.asset,
        outcome: 'allow',
        reason: 'allow_list',
        requestId: input.requestId,
      });
      logDecision({
        outcome: 'allow',
        reason: 'allow_list',
        merchantId,
        sessionId: input.sessionId,
        counterpartyRef,
        amount: input.amount,
        asset: input.asset,
        requestId: input.requestId,
        decisionId: decision.id,
      });
      return { outcome: 'allow', reason: 'allow_list', decisionId: decision.id };
    }
  }

  const thresholds = await getEffectiveRiskThresholds(merchantId);
  const totals = await computeMerchantVelocity(merchantId, thresholds.windowMs);
  const prospectiveValue = totals.value + input.amount;
  const prospectiveCount = totals.count + 1;

  let outcome: RiskDecisionOutcome = 'allow';
  let reason = 'within_limits';

  if (prospectiveValue > thresholds.valueThreshold) {
    outcome = 'block';
    reason = 'velocity_value_exceeded';
  } else if (prospectiveCount > thresholds.countThreshold) {
    outcome = 'block';
    reason = 'velocity_count_exceeded';
  } else if (prospectiveValue > thresholds.reviewValueThreshold) {
    outcome = 'review';
    reason = 'velocity_value_review';
  } else if (prospectiveCount > thresholds.reviewCountThreshold) {
    outcome = 'review';
    reason = 'velocity_count_review';
  }

  const decision = await recordRiskDecision({
    merchantId,
    sessionId: input.sessionId,
    counterpartyRef,
    amount: input.amount,
    asset: input.asset,
    outcome,
    reason,
    requestId: input.requestId,
  });

  logDecision({
    outcome,
    reason,
    merchantId,
    sessionId: input.sessionId,
    counterpartyRef,
    amount: input.amount,
    asset: input.asset,
    requestId: input.requestId,
    decisionId: decision.id,
  });

  if (reason === 'velocity_value_exceeded') {
    throw new RiskError(
      'velocity_value_exceeded',
      `merchant ${merchantId} exceeded its value threshold`,
    );
  }
  if (reason === 'velocity_count_exceeded') {
    throw new RiskError(
      'velocity_count_exceeded',
      `merchant ${merchantId} exceeded its count threshold`,
    );
  }

  return { outcome, reason, decisionId: decision.id };
}
