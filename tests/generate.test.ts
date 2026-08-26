import { describe, it, expect } from 'vitest';
import { generateTransactions } from '../data/transaction-generator.js';
import { generateCustomers } from '../data/customer-generator.js';
import { computeValidationMetrics } from '../data/generate.js';
import { ObservableTransaction, GroundTruthTransaction, CombinedGeneratedRecord, RecoveryAction } from '../lib/types.js';

describe('Synthetic Dataset Generator Skeleton', () => {
  it('should export computeValidationMetrics function', () => {
    expect(typeof computeValidationMetrics).toBe('function');
  });

  it('should compute metrics from dataset array', () => {
    const dataset = generateTransactions(generateCustomers(50, 42), 10, 42);
    const metrics = computeValidationMetrics(dataset);
    expect(metrics.total).toBe(10);
  });

  it('should strictly satisfy type boundaries for observable and hidden fields', () => {
    const sampleObservable: ObservableTransaction = {
      transaction_id: 'txn_123',
      customer_id: 'cust_456',
      amount: 499900,
      currency: 'INR',
      timestamp: new Date().toISOString(),
      payment_method: 'upi',
      payment_status: 'failed',
      failure_reason: 'insufficient_funds',
      attempt_number: 1,
      customer_tenure_months: 12,
      previous_transactions_count: 5,
      previous_success_rate: 0.8,
      average_transaction_value: 250000,
      days_since_last_payment: 30,
      subscription_status: 'active',
      device_type: 'mobile_android',
      checkout_completed: true,
    };

    const actionProbabilities: Record<RecoveryAction, number> = {
      retry_now: 0.1,
      retry_later: 0.85,
      send_reminder: 0.4,
      request_payment_method_update: 0.6,
      escalate: 0.2,
    };

    const sampleHidden: GroundTruthTransaction = {
      action_probabilities: actionProbabilities,
      noise_seed: 42,
    };

    const sampleRecord: CombinedGeneratedRecord = {
      observable: sampleObservable,
      hidden: sampleHidden,
    };

    expect(sampleRecord.observable.transaction_id).toBe('txn_123');
    expect(sampleRecord.hidden.action_probabilities.retry_later).toBe(0.85);
  });
});
