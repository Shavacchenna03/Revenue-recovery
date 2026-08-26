import { ObservableTransaction, RecoveryAction } from './types.js';

/**
 * Domain Guard: Verifies transaction payment_status is 'failed'.
 */
function assertFailedTransaction(transaction: ObservableTransaction): void {
  if (transaction.payment_status !== 'failed') {
    throw new Error(
      `selectBlindRetryAction called on a non-failed transaction: "${transaction.transaction_id}" has status "${transaction.payment_status}".`
    );
  }
}

/**
 * NAIVE BLIND RETRY BASELINE POLICY
 * 
 * ⚠️ AGENT-SAFE COMPONENT ⚠️
 * A deliberately naive reference policy that ignores all failure reasons, subscription states,
 * amounts, and payment methods, blindly choosing retry interventions based solely on attempt count:
 * - attempt 1 or 2 -> retry_now
 * - attempt 3 or 4 -> retry_later
 * 
 * Used as a low baseline benchmark to measure the domain-knowledge uplift of the rule-based policy.
 * 
 * @param transaction Public ObservableTransaction
 * @returns RecoveryAction ('retry_now' for attempts 1-2, 'retry_later' for attempts 3-4)
 */
export function selectBlindRetryAction(transaction: ObservableTransaction): RecoveryAction {
  assertFailedTransaction(transaction);

  if (transaction.attempt_number <= 2) {
    return 'retry_now';
  }
  return 'retry_later';
}
