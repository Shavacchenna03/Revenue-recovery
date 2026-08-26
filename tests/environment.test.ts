import { describe, it, expect } from 'vitest';
import { simulateRecovery, RecoveryEnvironment, deriveActionSeed } from '../lib/environment.js';
import { ObservableTransaction, GroundTruthTransaction, RecoveryAction } from '../lib/types.js';

describe('Recovery Environment Simulator (Day 2)', () => {
  const sampleObservable: ObservableTransaction = {
    transaction_id: 'txn_test_001',
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

  const sampleHidden: GroundTruthTransaction = {
    action_probabilities: {
      retry_now: 0.10,
      retry_later: 0.20,
      send_reminder: 0.40,
      request_payment_method_update: 0.95,
      escalate: 0.05,
    },
    noise_seed: 987654321,
  };

  it('1. should produce successful outcomes when probability is high', () => {
    const env = new RecoveryEnvironment();
    const res = env.simulateRecovery(sampleObservable, sampleHidden, 'request_payment_method_update');
    expect(res.recovered).toBe(true);
    expect(res.reward).toBe(1);
    expect(res.probability_used).toBe(0.95);
  });

  it('2. should produce failed outcomes when probability is low', () => {
    const res = simulateRecovery(sampleObservable, sampleHidden, 'escalate');
    expect(res.recovered).toBe(false);
    expect(res.reward).toBe(0);
    expect(res.probability_used).toBe(0.05);
  });

  it('3. should be deterministic (same seed + transaction + action produces identical result)', () => {
    const run1 = simulateRecovery(sampleObservable, sampleHidden, 'send_reminder');
    const run2 = simulateRecovery(sampleObservable, sampleHidden, 'send_reminder');
    const run3 = simulateRecovery(sampleObservable, sampleHidden, 'send_reminder');

    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);
  });

  it('4. should produce different action-specific outcomes based on selected action', () => {
    const resHigh = simulateRecovery(sampleObservable, sampleHidden, 'request_payment_method_update');
    const resLow = simulateRecovery(sampleObservable, sampleHidden, 'escalate');

    expect(resHigh.probability_used).toBe(0.95);
    expect(resLow.probability_used).toBe(0.05);
    expect(resHigh.recovered).not.toBe(resLow.recovered);
  });

  it('5. should reject or safely handle invalid probability values and invalid actions', () => {
    const invalidHiddenHigh: GroundTruthTransaction = {
      action_probabilities: { ...sampleHidden.action_probabilities, retry_now: 1.5 },
      noise_seed: 42,
    };
    const invalidHiddenNaN: GroundTruthTransaction = {
      action_probabilities: { ...sampleHidden.action_probabilities, retry_now: NaN },
      noise_seed: 42,
    };

    expect(() => simulateRecovery(sampleObservable, invalidHiddenHigh, 'retry_now')).toThrow();
    expect(() => simulateRecovery(sampleObservable, invalidHiddenNaN, 'retry_now')).toThrow();
    expect(() => simulateRecovery(sampleObservable, sampleHidden, 'invalid_action' as RecoveryAction)).toThrow();
  });

  it('6. should use the selected action probability rather than another action probability', () => {
    const customHidden: GroundTruthTransaction = {
      action_probabilities: {
        retry_now: 0.99,
        retry_later: 0.80,
        send_reminder: 0.50,
        request_payment_method_update: 0.20,
        escalate: 0.01,
      },
      noise_seed: 12345,
    };

    const resEscalate = simulateRecovery(sampleObservable, customHidden, 'escalate');
    expect(resEscalate.probability_used).toBe(0.01);

    const resRetry = simulateRecovery(sampleObservable, customHidden, 'retry_now');
    expect(resRetry.probability_used).toBe(0.99);
  });

  it('7. should enforce reward matching recovered outcome (recovered=true -> 1, false -> 0)', () => {
    const actions: RecoveryAction[] = ['retry_now', 'retry_later', 'send_reminder', 'request_payment_method_update', 'escalate'];
    for (const act of actions) {
      const res = simulateRecovery(sampleObservable, sampleHidden, act);
      if (res.recovered) {
        expect(res.reward).toBe(1);
      } else {
        expect(res.reward).toBe(0);
      }
    }
  });

  it('8. should NOT mutate ObservableTransaction', () => {
    const obsCopy = JSON.parse(JSON.stringify(sampleObservable));
    Object.freeze(sampleObservable);

    simulateRecovery(sampleObservable, sampleHidden, 'retry_now');
    expect(sampleObservable).toEqual(obsCopy);
  });

  it('9. should NOT mutate GroundTruthTransaction', () => {
    const hiddenCopy = JSON.parse(JSON.stringify(sampleHidden));
    Object.freeze(sampleHidden);
    Object.freeze(sampleHidden.action_probabilities);

    simulateRecovery(sampleObservable, sampleHidden, 'retry_now');
    expect(sampleHidden).toEqual(hiddenCopy);
  });

  it('10. should support all five RecoveryAction values', () => {
    const actions: RecoveryAction[] = [
      'retry_now',
      'retry_later',
      'send_reminder',
      'request_payment_method_update',
      'escalate',
    ];

    for (const act of actions) {
      const res = simulateRecovery(sampleObservable, sampleHidden, act);
      expect(res.action).toBe(act);
      expect(res.transaction_id).toBe(sampleObservable.transaction_id);
      expect(typeof res.recovered).toBe('boolean');
      expect(typeof res.probability_used).toBe('number');
      expect(typeof res.reward).toBe('number');
      expect(typeof res.noise_seed).toBe('number');
    }
  });

  it('11. should derive unique deterministic action seeds from noise_seed + action', () => {
    const seedRetry = deriveActionSeed(42, 'retry_now');
    const seedEscalate = deriveActionSeed(42, 'escalate');
    expect(seedRetry).not.toBe(seedEscalate);
    expect(seedRetry).toBe(deriveActionSeed(42, 'retry_now'));
  });
});
