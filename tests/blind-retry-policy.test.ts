import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { selectBlindRetryAction } from '../lib/blind-retry-policy.js';
import { ObservableTransaction } from '../lib/types.js';

describe('Blind Retry Baseline Policy (Naive Low Baseline)', () => {
  const baseTx: ObservableTransaction = {
    transaction_id: 'txn_blind_test',
    customer_id: 'cust_001',
    amount: 2500,
    currency: 'INR',
    timestamp: '2026-07-15T12:00:00.000Z',
    payment_method: 'card',
    payment_status: 'failed',
    failure_reason: 'card_expired',
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

  it('1. should return retry_now for attempt 1', () => {
    const tx = { ...baseTx, attempt_number: 1 };
    expect(selectBlindRetryAction(tx)).toBe('retry_now');
  });

  it('2. should return retry_now for attempt 2', () => {
    const tx = { ...baseTx, attempt_number: 2 };
    expect(selectBlindRetryAction(tx)).toBe('retry_now');
  });

  it('3. should return retry_later for attempt 3', () => {
    const tx = { ...baseTx, attempt_number: 3 };
    expect(selectBlindRetryAction(tx)).toBe('retry_later');
  });

  it('4. should return retry_later for attempt 4', () => {
    const tx = { ...baseTx, attempt_number: 4 };
    expect(selectBlindRetryAction(tx)).toBe('retry_later');
  });

  it('5. should throw domain guard error when called on a non-failed transaction', () => {
    const successTx: ObservableTransaction = { ...baseTx, payment_status: 'success', failure_reason: null };
    expect(() => selectBlindRetryAction(successTx)).toThrow(
      /selectBlindRetryAction called on a non-failed transaction/
    );
  });

  it('6. should be deterministic (same input produces identical output)', () => {
    const act1 = selectBlindRetryAction(baseTx);
    const act2 = selectBlindRetryAction(baseTx);
    expect(act1).toBe(act2);
  });

  it('7. TYPE-LEVEL SAFETY GUARD: lib/blind-retry-policy.ts must NOT import ground truth or simulation types', () => {
    const policyPath = path.resolve(process.cwd(), 'lib', 'blind-retry-policy.ts');
    const sourceText = fs.readFileSync(policyPath, 'utf-8');

    expect(sourceText.includes('GroundTruthTransaction')).toBe(false);
    expect(sourceText.includes('CombinedGeneratedRecord')).toBe(false);
    expect(sourceText.includes('RecoveryEnvironment')).toBe(false);
    expect(sourceText.includes('action_probabilities')).toBe(false);
    expect(sourceText.includes('noise_seed')).toBe(false);
  });
});
