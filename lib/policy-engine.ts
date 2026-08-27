import { ObservableTransaction, RecoveryAction, PolicyEngineDecision } from './types.js';

export interface GuardrailRule {
  id: string;
  name: string;
  evaluate: (tx: ObservableTransaction, proposedAction: RecoveryAction) => {
    matches: boolean;
    approvedAction: RecoveryAction;
    reason: string;
  };
}

/**
 * Ordered list of deterministic safety guardrails.
 * First matching guardrail wins.
 */
export const POLICY_GUARDRAILS: GuardrailRule[] = [
  {
    id: 'guardrail-canceled-subscription',
    name: 'Canceled Subscription',
    evaluate: (tx, proposedAction) => {
      const matches = tx.subscription_status === 'canceled';
      return {
        matches,
        approvedAction: 'escalate',
        reason: `Canceled subscription requires immediate escalation; overriding proposed action '${proposedAction}'.`,
      };
    },
  },
  {
    id: 'guardrail-card-expired',
    name: 'Card Expired',
    evaluate: (tx, proposedAction) => {
      const matches = tx.failure_reason === 'card_expired';
      return {
        matches,
        approvedAction: 'request_payment_method_update',
        reason: `Retrying an expired card is futile; customer must update payment method. Overriding proposed action '${proposedAction}'.`,
      };
    },
  },
  {
    id: 'guardrail-max-retries',
    name: 'Exhausted Retry Limit',
    evaluate: (tx, proposedAction) => {
      const matches = tx.attempt_number >= 4 && (proposedAction === 'retry_now' || proposedAction === 'retry_later');
      return {
        matches,
        approvedAction: 'escalate',
        reason: `Maximum retry attempt limit reached (attempt ${tx.attempt_number} >= 4). Retry action '${proposedAction}' blocked and escalated.`,
      };
    },
  },
  {
    id: 'guardrail-repeated-authentication-failure',
    name: 'Repeated Authentication Failure',
    evaluate: (tx, proposedAction) => {
      const matches = tx.failure_reason === 'authentication_failed' && tx.attempt_number >= 4;
      return {
        matches,
        approvedAction: 'escalate',
        reason: `Repeated authentication failure at attempt ${tx.attempt_number} >= 4 requires escalation; overriding proposed action '${proposedAction}'.`,
      };
    },
  },
];

export class RecoveryPolicyEngine {
  /**
   * Evaluates an ObservableTransaction and a proposed RecoveryAction against safety guardrails.
   * Returns a structured PolicyEngineDecision.
   */
  public evaluate(
    transaction: ObservableTransaction,
    proposedAction: RecoveryAction
  ): PolicyEngineDecision {
    if (transaction.payment_status !== 'failed') {
      throw new Error(
        `PolicyEngine error: evaluatePolicyGuardrails can only be called on failed transactions. Received payment_status: '${transaction.payment_status}'.`
      );
    }

    for (const guardrail of POLICY_GUARDRAILS) {
      const result = guardrail.evaluate(transaction, proposedAction);
      if (result.matches) {
        const overridden = result.approvedAction !== proposedAction;
        return {
          transaction_id: transaction.transaction_id,
          proposed_action: proposedAction,
          approved_action: result.approvedAction,
          overridden,
          guardrail_id: guardrail.id,
          reason: result.reason,
        };
      }
    }

    // Default approval if no guardrails triggered
    return {
      transaction_id: transaction.transaction_id,
      proposed_action: proposedAction,
      approved_action: proposedAction,
      overridden: false,
      guardrail_id: 'guardrail-default-approve',
      reason: 'Proposed action passed all safety and policy engine guardrail checks.',
    };
  }
}

const engineInstance = new RecoveryPolicyEngine();

/**
 * Functional wrapper for deterministic policy engine evaluation.
 */
export function evaluatePolicyGuardrails(
  transaction: ObservableTransaction,
  proposedAction: RecoveryAction
): PolicyEngineDecision {
  return engineInstance.evaluate(transaction, proposedAction);
}
