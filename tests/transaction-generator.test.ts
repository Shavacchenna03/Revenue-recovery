import { describe, it, expect } from 'vitest';
import { generateTransactions, DEFAULT_TRANSACTION_COUNT, DEFAULT_SEED } from '../data/transaction-generator.js';
import { generateCustomers, DEFAULT_NUM_CUSTOMERS } from '../data/customer-generator.js';
import { computeValidationMetrics } from '../data/generate.js';
import { RecoveryAction } from '../lib/types.js';

describe('Transaction Generator (Day 1 - Refined Multi-Feature Environment)', () => {
  const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, DEFAULT_SEED);
  const records = generateTransactions(customers, DEFAULT_TRANSACTION_COUNT, DEFAULT_SEED);

  it('1. should generate exactly 5,000 records', () => {
    expect(records.length).toBe(5000);
  });

  it('2. should produce unique transaction IDs', () => {
    const idSet = new Set(records.map(r => r.observable.transaction_id));
    expect(idSet.size).toBe(5000);
  });

  it('3. should reference valid customer IDs from customer population', () => {
    const customerIdSet = new Set(customers.map(c => c.customer_id));
    for (const r of records) {
      expect(customerIdSet.has(r.observable.customer_id)).toBe(true);
    }
  });

  it('4. should be deterministic (same seed produces identical output)', () => {
    const run1 = generateTransactions(customers, 200, 42);
    const run2 = generateTransactions(customers, 200, 42);
    expect(run1).toEqual(run2);
  });

  it('5. should produce different output for different seeds', () => {
    const run1 = generateTransactions(customers, 200, 42);
    const run2 = generateTransactions(customers, 200, 999);
    expect(run1).not.toEqual(run2);
  });

  it('6. should keep failure rate between 33% and 39%', () => {
    const failures = records.filter(r => r.observable.payment_status === 'failed');
    const failureRate = failures.length / records.length;
    expect(failureRate).toBeGreaterThanOrEqual(0.33);
    expect(failureRate).toBeLessThanOrEqual(0.39);
  });

  it('7. should produce failure reason distribution within reasonable tolerance bands', () => {
    const failures = records.filter(r => r.observable.payment_status === 'failed');
    const counts: Record<string, number> = {};
    for (const f of failures) {
      const reason = f.observable.failure_reason!;
      counts[reason] = (counts[reason] || 0) + 1;
    }

    const nFail = failures.length;
    expect(counts['insufficient_funds']! / nFail).toBeGreaterThan(0.20);
    expect(counts['insufficient_funds']! / nFail).toBeLessThan(0.30);

    expect(counts['authentication_failed']! / nFail).toBeGreaterThan(0.15);
    expect(counts['authentication_failed']! / nFail).toBeLessThan(0.25);

    expect(counts['network_timeout']! / nFail).toBeGreaterThan(0.15);
    expect(counts['network_timeout']! / nFail).toBeLessThan(0.25);

    expect(counts['card_expired']! / nFail).toBeGreaterThan(0.10);
    expect(counts['card_expired']! / nFail).toBeLessThan(0.20);

    expect(counts['bank_server_down']! / nFail).toBeGreaterThan(0.06);
    expect(counts['bank_server_down']! / nFail).toBeLessThan(0.15);

    expect(counts['technical_error']! / nFail).toBeGreaterThan(0.06);
    expect(counts['technical_error']! / nFail).toBeLessThan(0.15);
  });

  it('8. should enforce correct structure for successful transactions', () => {
    const successes = records.filter(r => r.observable.payment_status === 'success');
    for (const s of successes) {
      expect(s.observable.payment_status).toBe('success');
      expect(s.observable.failure_reason).toBeNull();
      expect(s.observable.checkout_completed).toBe(true);
    }
  });

  it('9. should enforce correct structure for failed transactions', () => {
    const failures = records.filter(r => r.observable.payment_status === 'failed');
    for (const f of failures) {
      expect(f.observable.payment_status).toBe('failed');
      expect(f.observable.failure_reason).not.toBeNull();
      expect(f.observable.checkout_completed).toBe(true);
    }
  });

  it('10. should enforce positive transaction amounts', () => {
    for (const r of records) {
      expect(r.observable.amount).toBeGreaterThan(0);
      expect(Number.isInteger(r.observable.amount)).toBe(true);
    }
  });

  it('11. should have amount distribution median in ₹1,500–₹2,500 and a visible right tail', () => {
    const amounts = records.map(r => r.observable.amount).sort((a, b) => a - b);
    const median = (amounts[Math.floor(amounts.length / 2)]! + amounts[Math.ceil(amounts.length / 2)]!) / 2;
    const max = amounts[amounts.length - 1]!;

    expect(median).toBeGreaterThanOrEqual(1500);
    expect(median).toBeLessThanOrEqual(2500);
    expect(max).toBeGreaterThan(15000);
  });

  it('12. should enforce attempt_number between 1 and 4', () => {
    for (const r of records) {
      expect(r.observable.attempt_number).toBeGreaterThanOrEqual(1);
      expect(r.observable.attempt_number).toBeLessThanOrEqual(4);
    }
  });

  it('13. should enforce all hidden action probabilities in [0, 1]', () => {
    for (const r of records) {
      for (const prob of Object.values(r.hidden.action_probabilities)) {
        expect(prob).toBeGreaterThanOrEqual(0);
        expect(prob).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it('14. should contain exactly all 5 RecoveryAction keys in hidden probability object', () => {
    const expectedKeys: RecoveryAction[] = ['retry_now', 'retry_later', 'send_reminder', 'request_payment_method_update', 'escalate'];
    for (const r of records) {
      const keys = Object.keys(r.hidden.action_probabilities);
      expect(keys.sort()).toEqual(expectedKeys.sort());
    }
  });

  it('15. should NOT leak hidden fields into observable object', () => {
    for (const r of records) {
      const obs = r.observable as unknown as Record<string, unknown>;
      expect(obs['action_probabilities']).toBeUndefined();
      expect(obs['true_outcome']).toBeUndefined();
      expect(obs['noise_seed']).toBeUndefined();
    }
  });

  it('16 & 20. should generate at least 90 messy cases in EACH direction (Cat A & Cat B)', () => {
    const metrics = computeValidationMetrics(records);
    expect(metrics.messyCases.catA).toBeGreaterThanOrEqual(90);
    expect(metrics.messyCases.catB).toBeGreaterThanOrEqual(90);
  });

  it('17. Correlation gate: |Pearson r| < 0.60 for all observable features vs hidden probabilities', () => {
    const metrics = computeValidationMetrics(records);
    if (metrics.maxAbsCorrelation >= 0.60) {
      console.error('Correlation matrix failure:', JSON.stringify(metrics.correlationMatrix, null, 2));
    }
    expect(metrics.maxAbsCorrelation).toBeLessThan(0.60);
  });

  it('18. Distribution gate: mean prob in [0.25, 0.75] and stddev >= 0.12 for each action', () => {
    const metrics = computeValidationMetrics(records);
    for (const stats of Object.values(metrics.actionProbStats)) {
      expect(stats.mean).toBeGreaterThanOrEqual(0.25);
      expect(stats.mean).toBeLessThanOrEqual(0.75);
      expect(stats.stddev).toBeGreaterThanOrEqual(0.12);
    }
  });

  it('19. noise_seed is not equal to global seed and varies across transactions', () => {
    const noiseSeeds = new Set<number>();
    for (const r of records) {
      expect(r.hidden.noise_seed).not.toBe(DEFAULT_SEED);
      noiseSeeds.add(r.hidden.noise_seed);
    }
    expect(noiseSeeds.size).toBe(5000);
  });

  it('21. Conditional gate: verify attempt_number affects recovery probabilities', () => {
    const metrics = computeValidationMetrics(records);
    const cs = metrics.conditionalStats.attemptStats;
    // Attempt 1 retry_now > Attempt 4 retry_now
    expect(cs.attempt1.retry_now).toBeGreaterThan(cs.attempt4.retry_now);
    // Attempt 4 escalate > Attempt 1 escalate
    expect(cs.attempt4.escalate).toBeGreaterThan(cs.attempt1.escalate);
  });

  it('22. Conditional gate: verify payment_method affects recovery probabilities', () => {
    const metrics = computeValidationMetrics(records);
    const ms = metrics.conditionalStats.methodStats;
    // Card request_payment_method_update > UPI request_payment_method_update
    expect(ms.card.request_payment_method_update).toBeGreaterThan(ms.upi.request_payment_method_update);
    // UPI retry_now > Card retry_now
    expect(ms.upi.retry_now).toBeGreaterThan(ms.card.retry_now);
  });

  it('23. Conditional gate: verify subscription_status affects recovery probabilities', () => {
    const metrics = computeValidationMetrics(records);
    const ss = metrics.conditionalStats.subscriptionStats;
    // Past due / Unpaid send_reminder > Active send_reminder
    expect(ss.pastDue.send_reminder).toBeGreaterThan(ss.active.send_reminder);
    expect(ss.unpaid.request_payment_method_update).toBeGreaterThan(ss.active.request_payment_method_update);
  });

  it('24. Conditional gate: verify failure_reason affects recovery probabilities', () => {
    const metrics = computeValidationMetrics(records);
    const fs = metrics.conditionalStats.failureReasonStats;
    // Card expired payment_method_update > Insufficient funds payment_method_update
    expect(fs.cardExpired.request_payment_method_update).toBeGreaterThan(fs.insufficientFunds.request_payment_method_update);
    // Insufficient funds retry_later > Card expired retry_later
    expect(fs.insufficientFunds.retry_later).toBeGreaterThan(fs.cardExpired.retry_later);
  });
});
