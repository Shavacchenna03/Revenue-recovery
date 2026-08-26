import { ObservableTransaction, RecoveryAction } from './types.js';

/**
 * Baseline Rule Interface
 * 
 * Defines an ordered decision rule for heuristic recovery action selection.
 */
export interface BaselineRule {
  id: string;
  name: string;
  description: string;
  action: RecoveryAction;
  condition: (tx: ObservableTransaction) => boolean;
}

/**
 * AGENT-SAFE BASELINE DECISION RULES (ORDERED PRECEDENCE - FIRST MATCH WINS)
 * 
 * ⚠️ AGENT-SAFE COMPONENT ⚠️
 * This policy receives ONLY ObservableTransaction features and is completely unaware
 * of hidden ground truth or simulation mechanics.
 */
export const BASELINE_RULES: readonly BaselineRule[] = [
  {
    id: 'rule-1-canceled-subscription',
    name: 'Canceled Subscription',
    description: 'Canceled subscription indicates a contract/churn issue requiring immediate manual escalation.',
    action: 'escalate',
    condition: (tx) => tx.subscription_status === 'canceled',
  },
  {
    id: 'rule-2-card-expired',
    name: 'Card Expired',
    description: 'Expired payment card cannot succeed on retry; requires customer to update payment details.',
    action: 'request_payment_method_update',
    condition: (tx) => tx.failure_reason === 'card_expired',
  },
  {
    id: 'rule-3a-auth-failed-repeated',
    name: 'Repeated Authentication Failure',
    description: 'Repeated 3DS/OTP authentication failures (attempt >= 4) suggest account issue requiring escalation.',
    action: 'escalate',
    condition: (tx) => tx.failure_reason === 'authentication_failed' && tx.attempt_number >= 4,
  },
  {
    id: 'rule-3b-auth-failed',
    name: 'Authentication Failed',
    description: 'Initial authentication failure warrants requesting updated payment method or re-authentication.',
    action: 'request_payment_method_update',
    condition: (tx) => tx.failure_reason === 'authentication_failed',
  },
  {
    id: 'rule-4-delinquent-payment-struggle',
    name: 'Delinquent Subscription Payment Instrument Failure',
    description: 'Insufficient funds or auth failure on past_due/unpaid subscription requires new payment method.',
    action: 'request_payment_method_update',
    condition: (tx) => 
      (tx.subscription_status === 'past_due' || tx.subscription_status === 'unpaid') &&
      (tx.failure_reason === 'insufficient_funds' || tx.failure_reason === 'authentication_failed'),
  },
  {
    id: 'rule-5-delinquent-subscription-reminder',
    name: 'Delinquent Subscription Reminder',
    description: 'Past due or unpaid subscription with other failure reasons requires a payment reminder.',
    action: 'send_reminder',
    condition: (tx) => tx.subscription_status === 'past_due' || tx.subscription_status === 'unpaid',
  },
  {
    id: 'rule-6a-insufficient-funds-early',
    name: 'Insufficient Funds (Early Attempts)',
    description: 'Insufficient funds on attempt 1 or 2 warrants delayed retry for account replenishment.',
    action: 'retry_later',
    condition: (tx) => tx.failure_reason === 'insufficient_funds' && tx.attempt_number <= 2,
  },
  {
    id: 'rule-6b-insufficient-funds-exhausted',
    name: 'Insufficient Funds (Exhausted Attempts)',
    description: 'Persistent insufficient funds after attempt 2 requires human escalation.',
    action: 'escalate',
    condition: (tx) => tx.failure_reason === 'insufficient_funds' && tx.attempt_number >= 3,
  },
  {
    id: 'rule-7a-network-timeout-early',
    name: 'Network Timeout (Early Attempts)',
    description: 'Transient network timeout on attempt 1 or 2 warrants immediate retry.',
    action: 'retry_now',
    condition: (tx) => tx.failure_reason === 'network_timeout' && tx.attempt_number <= 2,
  },
  {
    id: 'rule-7b-network-timeout-late',
    name: 'Network Timeout (Late Attempts)',
    description: 'Repeated network timeout (attempt 3 or 4) warrants delayed retry before escalation.',
    action: 'retry_later',
    condition: (tx) => tx.failure_reason === 'network_timeout' && tx.attempt_number >= 3,
  },
  {
    id: 'rule-8a-bank-server-down-early',
    name: 'Bank Server Down (Early Attempts)',
    description: 'Bank server downtime on attempt 1-3 warrants delayed retry for server recovery.',
    action: 'retry_later',
    condition: (tx) => tx.failure_reason === 'bank_server_down' && tx.attempt_number <= 3,
  },
  {
    id: 'rule-8b-bank-server-down-exhausted',
    name: 'Bank Server Down (Exhausted Attempts)',
    description: 'Persistent bank server failure after attempt 3 requires escalation.',
    action: 'escalate',
    condition: (tx) => tx.failure_reason === 'bank_server_down' && tx.attempt_number >= 4,
  },
  {
    id: 'rule-9a-technical-error-early',
    name: 'Technical Error (Early Attempts)',
    description: 'Technical gateway error on attempt 1 or 2 warrants immediate retry.',
    action: 'retry_now',
    condition: (tx) => tx.failure_reason === 'technical_error' && tx.attempt_number <= 2,
  },
  {
    id: 'rule-9b-technical-error-exhausted',
    name: 'Technical Error (Exhausted Attempts)',
    description: 'Persistent technical error after attempt 2 requires escalation.',
    action: 'escalate',
    condition: (tx) => tx.failure_reason === 'technical_error' && tx.attempt_number >= 3,
  },
  {
    id: 'rule-10-high-value-tiebreaker',
    name: 'High-Value Ambiguous Tie-Breaker',
    description: 'Ambiguous failure on high-value transaction (amount >= ₹5,000) warrants manual escalation.',
    action: 'escalate',
    condition: (tx) => tx.amount >= 5000,
  },
  {
    id: 'rule-11-default-fallback',
    name: 'Default Fallback',
    description: 'Default baseline action for ambiguous failed transactions.',
    action: 'retry_later',
    condition: () => true,
  },
];

/**
 * Domain Guard: Verifies transaction payment_status is 'failed'.
 */
function assertFailedTransaction(transaction: ObservableTransaction): void {
  if (transaction.payment_status !== 'failed') {
    throw new Error(
      `selectRecoveryAction called on a non-failed transaction: "${transaction.transaction_id}" has status "${transaction.payment_status}".`
    );
  }
}

/**
 * Explains which baseline rule matched an ObservableTransaction and why.
 * 
 * @param transaction Public ObservableTransaction
 * @returns Object containing chosen action, matched BaselineRule, and 0-indexed rule index
 */
export function explainDecision(transaction: ObservableTransaction): {
  action: RecoveryAction;
  matchedRule: BaselineRule;
  ruleIndex: number;
} {
  assertFailedTransaction(transaction);

  for (let index = 0; index < BASELINE_RULES.length; index++) {
    const rule = BASELINE_RULES[index]!;
    if (rule.condition(transaction)) {
      return {
        action: rule.action,
        matchedRule: rule,
        ruleIndex: index,
      };
    }
  }

  // Fallback (unreachable given rule-11 condition: () => true)
  const lastIndex = BASELINE_RULES.length - 1;
  const fallbackRule = BASELINE_RULES[lastIndex]!;
  return {
    action: fallbackRule.action,
    matchedRule: fallbackRule,
    ruleIndex: lastIndex,
  };
}

/**
 * Deterministically selects the baseline RecoveryAction for a failed ObservableTransaction.
 * 
 * @param transaction Public ObservableTransaction
 * @returns Selected RecoveryAction
 */
export function selectRecoveryAction(transaction: ObservableTransaction): RecoveryAction {
  return explainDecision(transaction).action;
}

/**
 * Generates a human-readable Markdown table rendering of the full ordered baseline decision rules.
 */
export function generatePolicyDecisionTableMarkdown(): string {
  let md = `# Heuristic Baseline Policy Decision Table\n\n`;
  md += `**Evaluation Precedence**: First-Match-Wins (Evaluated from top to bottom, Rule 1 to Rule ${BASELINE_RULES.length})\n\n`;
  md += `| Precedence | Rule ID | Rule Name | Resulting Action | Description |\n`;
  md += `| :---: | :--- | :--- | :--- | :--- |\n`;

  for (let index = 0; index < BASELINE_RULES.length; index++) {
    const rule = BASELINE_RULES[index]!;
    md += `| **${index + 1}** | \`${rule.id}\` | **${rule.name}** | \`${rule.action}\` | ${rule.description} |\n`;
  }

  return md;
}
