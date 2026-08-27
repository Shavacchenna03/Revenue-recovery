import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ObservableTransaction } from '../lib/types.js';
import { evaluatePolicyGuardrails, RecoveryPolicyEngine } from '../lib/policy-engine.js';
import { explainGovernedLLMDecisionAsync, selectGovernedLLMActionAsync } from '../lib/governed-policy.js';

describe('Policy Engine (Day 4 Deterministic Guardrails)', () => {
  const baseTx: ObservableTransaction = {
    transaction_id: 'txn_pe_test_001',
    customer_id: 'cust_pe_test_001',
    amount: 1500,
    currency: 'INR',
    timestamp: '2026-07-15T10:00:00.000Z',
    payment_method: 'card',
    payment_status: 'failed',
    failure_reason: 'network_timeout',
    attempt_number: 1,
    customer_tenure_months: 6,
    previous_transactions_count: 5,
    previous_success_rate: 0.8,
    average_transaction_value: 1500,
    days_since_last_payment: 10,
    subscription_status: 'active',
    device_type: 'mobile_android',
    checkout_completed: true,
  };

  it('1. valid retry_now proposal is approved', () => {
    const res = evaluatePolicyGuardrails(baseTx, 'retry_now');
    expect(res.approved_action).toBe('retry_now');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('2. valid retry_later proposal is approved', () => {
    const res = evaluatePolicyGuardrails(baseTx, 'retry_later');
    expect(res.approved_action).toBe('retry_later');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('3. send_reminder is approved when no guardrail applies', () => {
    const res = evaluatePolicyGuardrails(baseTx, 'send_reminder');
    expect(res.approved_action).toBe('send_reminder');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('4. request_payment_method_update is approved when no guardrail applies', () => {
    const res = evaluatePolicyGuardrails(baseTx, 'request_payment_method_update');
    expect(res.approved_action).toBe('request_payment_method_update');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('5. escalate is approved when no guardrail applies', () => {
    const res = evaluatePolicyGuardrails(baseTx, 'escalate');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('6. canceled subscription overrides retry_now', () => {
    const tx: ObservableTransaction = { ...baseTx, subscription_status: 'canceled' };
    const res = evaluatePolicyGuardrails(tx, 'retry_now');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-canceled-subscription');
  });

  it('7. canceled subscription overrides retry_later', () => {
    const tx: ObservableTransaction = { ...baseTx, subscription_status: 'canceled' };
    const res = evaluatePolicyGuardrails(tx, 'retry_later');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-canceled-subscription');
  });

  it('8. canceled subscription overrides send_reminder', () => {
    const tx: ObservableTransaction = { ...baseTx, subscription_status: 'canceled' };
    const res = evaluatePolicyGuardrails(tx, 'send_reminder');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-canceled-subscription');
  });

  it('9. card_expired overrides retry_now', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired' };
    const res = evaluatePolicyGuardrails(tx, 'retry_now');
    expect(res.approved_action).toBe('request_payment_method_update');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-card-expired');
  });

  it('10. card_expired overrides retry_later', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired' };
    const res = evaluatePolicyGuardrails(tx, 'retry_later');
    expect(res.approved_action).toBe('request_payment_method_update');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-card-expired');
  });

  it('11. card_expired at attempt_number 4 with proposed retry_now still resolves to request_payment_method_update (NOT escalate)', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired', attempt_number: 4 };
    const res = evaluatePolicyGuardrails(tx, 'retry_now');
    expect(res.approved_action).toBe('request_payment_method_update');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-card-expired');
  });

  it('12. attempt 4 + retry_now (non-card-expired failure reason) becomes escalate', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'network_timeout', attempt_number: 4 };
    const res = evaluatePolicyGuardrails(tx, 'retry_now');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-max-retries');
  });

  it('13. attempt 4 + retry_later (non-card-expired failure reason) becomes escalate', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'bank_server_down', attempt_number: 4 };
    const res = evaluatePolicyGuardrails(tx, 'retry_later');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-max-retries');
  });

  it('14. attempt 3 + retry_later remains retry_later', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'bank_server_down', attempt_number: 3 };
    const res = evaluatePolicyGuardrails(tx, 'retry_later');
    expect(res.approved_action).toBe('retry_later');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('15. repeated authentication failure on attempt 4 becomes escalate, tested with proposed_action = retry_now', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'authentication_failed', attempt_number: 4 };
    const res = evaluatePolicyGuardrails(tx, 'retry_now');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-max-retries'); // Max retries triggers for retry_now on attempt 4
  });

  it('16. repeated authentication failure on attempt 4 becomes escalate, tested with proposed_action = request_payment_method_update', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'authentication_failed', attempt_number: 4 };
    const res = evaluatePolicyGuardrails(tx, 'request_payment_method_update');
    expect(res.approved_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-repeated-authentication-failure');
  });

  it('17. repeated authentication failure on attempt 3 does not trigger guardrail 4', () => {
    const tx: ObservableTransaction = { ...baseTx, failure_reason: 'authentication_failed', attempt_number: 3 };
    const res = evaluatePolicyGuardrails(tx, 'send_reminder');
    expect(res.approved_action).toBe('send_reminder');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('18. domain guard throws for successful transaction', () => {
    const successTx: ObservableTransaction = { ...baseTx, payment_status: 'success', failure_reason: null };
    expect(() => evaluatePolicyGuardrails(successTx, 'retry_now')).toThrow(/evaluatePolicyGuardrails can only be called on failed transactions/);
  });

  it('19. deterministic: identical input produces identical decision', () => {
    const engine = new RecoveryPolicyEngine();
    const res1 = engine.evaluate(baseTx, 'retry_now');
    const res2 = evaluatePolicyGuardrails(baseTx, 'retry_now');
    expect(res1).toEqual(res2);
  });

  it('20. original transaction is not mutated', () => {
    const txCopy = JSON.parse(JSON.stringify(baseTx));
    evaluatePolicyGuardrails(baseTx, 'retry_now');
    expect(baseTx).toEqual(txCopy);
  });

  it('21. proposed action is preserved in the audit result', () => {
    const res = evaluatePolicyGuardrails(baseTx, 'send_reminder');
    expect(res.proposed_action).toBe('send_reminder');
  });

  it('22. overridden flag is correct', () => {
    const approvedRes = evaluatePolicyGuardrails(baseTx, 'retry_now');
    expect(approvedRes.overridden).toBe(false);

    const overriddenTx: ObservableTransaction = { ...baseTx, subscription_status: 'canceled' };
    const overriddenRes = evaluatePolicyGuardrails(overriddenTx, 'retry_now');
    expect(overriddenRes.overridden).toBe(true);
  });

  it('23. correct guardrail_id is returned', () => {
    const tx1: ObservableTransaction = { ...baseTx, subscription_status: 'canceled' };
    expect(evaluatePolicyGuardrails(tx1, 'retry_now').guardrail_id).toBe('guardrail-canceled-subscription');

    const tx2: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired' };
    expect(evaluatePolicyGuardrails(tx2, 'retry_now').guardrail_id).toBe('guardrail-card-expired');

    const tx3: ObservableTransaction = { ...baseTx, attempt_number: 4 };
    expect(evaluatePolicyGuardrails(tx3, 'retry_now').guardrail_id).toBe('guardrail-max-retries');

    const tx4: ObservableTransaction = { ...baseTx, failure_reason: 'authentication_failed', attempt_number: 4 };
    expect(evaluatePolicyGuardrails(tx4, 'request_payment_method_update').guardrail_id).toBe('guardrail-repeated-authentication-failure');
  });

  it('24. first-match-wins precedence is tested across all pairwise guardrail conflicts', () => {
    // Conflict 1: canceled + card_expired -> canceled wins
    const txCanceledExpired: ObservableTransaction = { ...baseTx, subscription_status: 'canceled', failure_reason: 'card_expired' };
    const res1 = evaluatePolicyGuardrails(txCanceledExpired, 'retry_now');
    expect(res1.guardrail_id).toBe('guardrail-canceled-subscription');
    expect(res1.approved_action).toBe('escalate');

    // Conflict 2: card_expired + max_retry (attempt 4) -> card_expired wins
    const txExpiredMaxAttempt: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired', attempt_number: 4 };
    const res2 = evaluatePolicyGuardrails(txExpiredMaxAttempt, 'retry_now');
    expect(res2.guardrail_id).toBe('guardrail-card-expired');
    expect(res2.approved_action).toBe('request_payment_method_update');

    // Conflict 3: max_retry + repeated_auth -> max_retry wins for retry action
    const txAuthMaxAttempt: ObservableTransaction = { ...baseTx, failure_reason: 'authentication_failed', attempt_number: 4 };
    const res3 = evaluatePolicyGuardrails(txAuthMaxAttempt, 'retry_now');
    expect(res3.guardrail_id).toBe('guardrail-max-retries');
    expect(res3.approved_action).toBe('escalate');
  });

  it('25. fallback-sourced proposal (used_fallback: true) is governed identically to a genuine LLM proposal', async () => {
    // Mock an LLM call that falls back
    const mockFallbackClient = vi.fn().mockRejectedValue(new Error('LLM API Error'));
    const txExpired: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired', attempt_number: 1 };

    const governedDecision = await explainGovernedLLMDecisionAsync(txExpired, { noCache: true, clientOverride: mockFallbackClient });
    expect(governedDecision.used_fallback).toBe(true);
    expect(governedDecision.approved_action).toBe('request_payment_method_update');

    const governedAction = await selectGovernedLLMActionAsync(txExpired, { noCache: true, clientOverride: mockFallbackClient });
    expect(governedAction).toBe('request_payment_method_update');
  });

  it('26. TYPE-LEVEL SAFETY GUARD: Policy Engine files must NOT import ground truth or evaluation types', () => {
    const filesToGuard = ['lib/policy-engine.ts', 'lib/governed-policy.ts'];

    for (const relPath of filesToGuard) {
      const fullPath = path.resolve(process.cwd(), relPath);
      const sourceText = fs.readFileSync(fullPath, 'utf-8');

      expect(sourceText.includes('GroundTruthTransaction')).toBe(false);
      expect(sourceText.includes('CombinedGeneratedRecord')).toBe(false);
      expect(sourceText.includes('RecoveryEnvironment')).toBe(false);
      expect(sourceText.includes('action_probabilities')).toBe(false);
      expect(sourceText.includes('noise_seed')).toBe(false);
    }
  });
});
