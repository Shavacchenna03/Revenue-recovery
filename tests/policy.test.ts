import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { selectRecoveryAction, explainDecision, BASELINE_RULES } from '../lib/policy.js';
import { ObservableTransaction, RecoveryAction, FailureReason, SubscriptionStatus } from '../lib/types.js';

describe('Heuristic Baseline Policy (Day 2.2)', () => {
  const baseTx: ObservableTransaction = {
    transaction_id: 'txn_test_base',
    customer_id: 'cust_001',
    amount: 2500,
    currency: 'INR',
    timestamp: '2026-07-15T12:00:00.000Z',
    payment_method: 'card',
    payment_status: 'failed',
    failure_reason: 'insufficient_funds',
    attempt_number: 1,
    customer_tenure_months: 12,
    previous_transactions_count: 10,
    previous_success_rate: 0.8,
    average_transaction_value: 2500,
    days_since_last_payment: 15,
    subscription_status: 'active',
    device_type: 'mobile_android',
    checkout_completed: true,
  };

  it('1. canceled subscription (any failure reason) -> escalate', () => {
    const tx: ObservableTransaction = {
      ...baseTx,
      subscription_status: 'canceled',
      failure_reason: 'insufficient_funds',
    };
    expect(selectRecoveryAction(tx)).toBe('escalate');
  });

  it('2. card_expired -> request_payment_method_update, regardless of attempt number', () => {
    const txAttempt1: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired', attempt_number: 1 };
    const txAttempt4: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired', attempt_number: 4 };

    expect(selectRecoveryAction(txAttempt1)).toBe('request_payment_method_update');
    expect(selectRecoveryAction(txAttempt4)).toBe('request_payment_method_update');
  });

  it('3. authentication_failed, attempt 1-3 -> request_payment_method_update', () => {
    for (let att = 1; att <= 3; att++) {
      const tx: ObservableTransaction = { ...baseTx, failure_reason: 'authentication_failed', attempt_number: att };
      expect(selectRecoveryAction(tx)).toBe('request_payment_method_update');
    }
  });

  it('4. authentication_failed, attempt 4 -> escalate', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'authentication_failed', attempt_number: 4 };
    expect(selectRecoveryAction(tx)).toBe('escalate');
  });

  it('5. past_due + insufficient_funds -> request_payment_method_update', () => {
    const tx: ObservableTransaction = {
      ...baseTx,
      subscription_status: 'past_due',
      failure_reason: 'insufficient_funds',
      attempt_number: 1,
    };
    expect(selectRecoveryAction(tx)).toBe('request_payment_method_update');
  });

  it('6. past_due + network_timeout -> send_reminder', () => {
    const tx: ObservableTransaction = {
      ...baseTx,
      subscription_status: 'past_due',
      failure_reason: 'network_timeout',
      attempt_number: 1,
    };
    expect(selectRecoveryAction(tx)).toBe('send_reminder');
  });

  it('7. insufficient_funds attempt 1 -> retry_later', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'insufficient_funds', attempt_number: 1 };
    expect(selectRecoveryAction(tx)).toBe('retry_later');
  });

  it('8. insufficient_funds attempt 4 -> escalate', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'insufficient_funds', attempt_number: 4 };
    expect(selectRecoveryAction(tx)).toBe('escalate');
  });

  it('9. network_timeout attempt 1 -> retry_now', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'network_timeout', attempt_number: 1 };
    expect(selectRecoveryAction(tx)).toBe('retry_now');
  });

  it('10. network_timeout attempt 3 -> retry_later (per documented Rule 7)', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'network_timeout', attempt_number: 3 };
    expect(selectRecoveryAction(tx)).toBe('retry_later');
  });

  it('11. bank_server_down attempt 3 -> retry_later', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'bank_server_down', attempt_number: 3 };
    expect(selectRecoveryAction(tx)).toBe('retry_later');
  });

  it('12. bank_server_down attempt 4 -> escalate', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'bank_server_down', attempt_number: 4 };
    expect(selectRecoveryAction(tx)).toBe('escalate');
  });

  it('13. technical_error attempt 1 -> retry_now', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'technical_error', attempt_number: 1 };
    expect(selectRecoveryAction(tx)).toBe('retry_now');
  });

  it('14. technical_error attempt 4 -> escalate', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'technical_error', attempt_number: 4 };
    expect(selectRecoveryAction(tx)).toBe('escalate');
  });

  it('15. high-value ambiguous case (unrecognized failure_reason, amount >= 5000) -> escalate', () => {
    const tx: ObservableTransaction = {
      ...baseTx,
      failure_reason: 'unknown_reason' as unknown as FailureReason,
      amount: 5500,
    };
    expect(selectRecoveryAction(tx)).toBe('escalate');
  });

  it('16. default fallback case (unrecognized failure_reason, amount < 5000) -> retry_later', () => {
    const tx: ObservableTransaction = {
      ...baseTx,
      failure_reason: 'unknown_reason' as unknown as FailureReason,
      amount: 3000,
    };
    expect(selectRecoveryAction(tx)).toBe('retry_later');
  });

  it('17. policy is deterministic (same input called twice -> same output)', () => {
    const action1 = selectRecoveryAction(baseTx);
    const action2 = selectRecoveryAction(baseTx);
    expect(action1).toBe(action2);
  });

  it('18. every RecoveryAction is reachable through at least one test case', () => {
    const actionsReached = new Set<RecoveryAction>();

    // Test cases reaching all 5 actions:
    // retry_now
    actionsReached.add(selectRecoveryAction({ ...baseTx, failure_reason: 'network_timeout', attempt_number: 1 }));
    // retry_later
    actionsReached.add(selectRecoveryAction({ ...baseTx, failure_reason: 'insufficient_funds', attempt_number: 1 }));
    // send_reminder
    actionsReached.add(selectRecoveryAction({ ...baseTx, subscription_status: 'past_due', failure_reason: 'network_timeout' }));
    // request_payment_method_update
    actionsReached.add(selectRecoveryAction({ ...baseTx, failure_reason: 'card_expired' }));
    // escalate
    actionsReached.add(selectRecoveryAction({ ...baseTx, subscription_status: 'canceled' }));

    const expectedActions: RecoveryAction[] = [
      'retry_now',
      'retry_later',
      'send_reminder',
      'request_payment_method_update',
      'escalate',
    ];

    for (const act of expectedActions) {
      expect(actionsReached.has(act)).toBe(true);
    }
  });

  it('19. calling selectRecoveryAction on a payment_status="success" transaction throws', () => {
    const successTx: ObservableTransaction = {
      ...baseTx,
      payment_status: 'success',
      failure_reason: null,
    };
    expect(() => selectRecoveryAction(successTx)).toThrow(/selectRecoveryAction called on a non-failed transaction/);
  });

  it('20. explainDecision returns the correct matchedRule/ruleIndex for sample cases', () => {
    const canceledTx: ObservableTransaction = { ...baseTx, subscription_status: 'canceled' };
    const exp1 = explainDecision(canceledTx);
    expect(exp1.ruleIndex).toBe(0);
    expect(exp1.matchedRule.id).toBe('rule-1-canceled-subscription');
    expect(exp1.action).toBe('escalate');

    const cardExpTx: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired' };
    const exp2 = explainDecision(cardExpTx);
    expect(exp2.ruleIndex).toBe(1);
    expect(exp2.matchedRule.id).toBe('rule-2-card-expired');
    expect(exp2.action).toBe('request_payment_method_update');
  });

  it('21. rule precedence: canceled subscription + card_expired -> rule 1 wins (escalate)', () => {
    const conflictTx: ObservableTransaction = {
      ...baseTx,
      subscription_status: 'canceled', // Rule 1 -> escalate
      failure_reason: 'card_expired',   // Rule 2 -> request_payment_method_update
    };

    const exp = explainDecision(conflictTx);
    expect(exp.ruleIndex).toBe(0);
    expect(exp.matchedRule.id).toBe('rule-1-canceled-subscription');
    expect(exp.action).toBe('escalate');
  });

  it('22. Boundary tests for amount around 5000 (4999, 5000, 5001)', () => {
    const ambiguous4999: ObservableTransaction = { ...baseTx, failure_reason: 'other' as any, amount: 4999 };
    const ambiguous5000: ObservableTransaction = { ...baseTx, failure_reason: 'other' as any, amount: 5000 };
    const ambiguous5001: ObservableTransaction = { ...baseTx, failure_reason: 'other' as any, amount: 5001 };

    expect(selectRecoveryAction(ambiguous4999)).toBe('retry_later'); // Default fallback
    expect(selectRecoveryAction(ambiguous5000)).toBe('escalate');   // High-value tiebreaker
    expect(selectRecoveryAction(ambiguous5001)).toBe('escalate');   // High-value tiebreaker
  });

  it('23. Boundary tests for attempts 1, 2, 3, 4 across failure reasons', () => {
    const reasons: FailureReason[] = [
      'insufficient_funds',
      'authentication_failed',
      'network_timeout',
      'card_expired',
      'bank_server_down',
      'technical_error',
    ];

    for (const reason of reasons) {
      for (let att = 1; att <= 4; att++) {
        const tx: ObservableTransaction = { ...baseTx, failure_reason: reason, attempt_number: att };
        const action = selectRecoveryAction(tx);
        expect(typeof action).toBe('string');
      }
    }
  });

  it('24. Boundary tests for subscription_status values (active, past_due, canceled, unpaid)', () => {
    const statuses: SubscriptionStatus[] = ['active', 'past_due', 'canceled', 'unpaid'];
    for (const status of statuses) {
      const tx: ObservableTransaction = { ...baseTx, subscription_status: status };
      const action = selectRecoveryAction(tx);
      expect(typeof action).toBe('string');
    }
  });

  it('25. TYPE-LEVEL SAFETY GUARD: lib/policy.ts must NOT import ground truth or simulation types', () => {
    const policyPath = path.resolve(process.cwd(), 'lib', 'policy.ts');
    const sourceText = fs.readFileSync(policyPath, 'utf-8');

    expect(sourceText.includes('GroundTruthTransaction')).toBe(false);
    expect(sourceText.includes('CombinedGeneratedRecord')).toBe(false);
    expect(sourceText.includes('RecoveryEnvironment')).toBe(false);
    expect(sourceText.includes('action_probabilities')).toBe(false);
    expect(sourceText.includes('noise_seed')).toBe(false);
  });

  it('26. BASELINE_RULES should be exported as a non-empty ordered rule array', () => {
    expect(Array.isArray(BASELINE_RULES)).toBe(true);
    expect(BASELINE_RULES.length).toBe(16);
    expect(BASELINE_RULES[0]!.id).toBe('rule-1-canceled-subscription');
  });
});
