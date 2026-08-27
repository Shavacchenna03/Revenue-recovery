import { describe, it, expect, vi } from 'vitest';
import { CombinedGeneratedRecord } from '../lib/types.js';
import { runSimulatedRecoveryDecision } from '../lib/recovery-orchestrator-simulated.js';
import * as envModule from '../lib/environment.js';

describe('Module 2: Recovery Orchestrator Simulated (Demo / Evaluation Wrapper)', () => {
  const mockRecord: CombinedGeneratedRecord = {
    observable: {
      transaction_id: 'txn_sim_test_001',
      customer_id: 'cust_sim_test_001',
      amount: 4999,
      currency: 'INR',
      timestamp: '2026-07-25T14:00:00.000Z',
      payment_method: 'card',
      payment_status: 'failed',
      failure_reason: 'network_timeout',
      attempt_number: 4, // Will trigger Guardrail 3 (max retries)
      customer_tenure_months: 8,
      previous_transactions_count: 3,
      previous_success_rate: 0.7,
      average_transaction_value: 4999,
      days_since_last_payment: 12,
      subscription_status: 'active',
      device_type: 'mobile_android',
      checkout_completed: true,
    },
    hidden: {
      action_probabilities: {
        retry_now: 0.1,
        retry_later: 0.2,
        send_reminder: 0.3,
        request_payment_method_update: 0.4,
        escalate: 0.8,
      },
      noise_seed: 12345,
    },
  };

  it('10. Given an overridden decision, simulateRecovery is invoked with FINAL governed action (escalate), NOT raw proposal (retry_now)', async () => {
    // Spy on simulateRecovery to verify exact call arguments
    const simSpy = vi.spyOn(envModule, 'simulateRecovery');

    const mockLLMClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Attempting retry on attempt 4.',
        recommended_action: 'retry_now', // Unsafe proposal!
        confidence: 0.85,
      },
      rawResponse: '{}',
    });

    const result = await runSimulatedRecoveryDecision(mockRecord, { noCache: true, clientOverride: mockLLMClient });

    // Assert decision in output
    expect(result.decision.proposed_action).toBe('retry_now');
    expect(result.decision.final_action).toBe('escalate');
    expect(result.decision.overridden).toBe(true);

    // CRITICAL SPY ASSERTION: verify simulateRecovery received 'escalate', NOT 'retry_now'!
    expect(simSpy).toHaveBeenCalledWith(
      mockRecord.observable,
      mockRecord.hidden,
      'escalate'
    );

    simSpy.mockRestore();
  });

  it('11. recovered, revenue_recovered, reward, probability_used are correctly populated from environment RecoveryResult', async () => {
    const mockLLMClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Transient network failure.',
        recommended_action: 'retry_later',
        confidence: 0.9,
      },
      rawResponse: '{}',
    });

    const recordAttempt1: CombinedGeneratedRecord = {
      ...mockRecord,
      observable: { ...mockRecord.observable, attempt_number: 1 },
    };

    const result = await runSimulatedRecoveryDecision(recordAttempt1, { noCache: true, clientOverride: mockLLMClient });

    expect(typeof result.recovered).toBe('boolean');
    expect(typeof result.revenue_recovered).toBe('number');
    expect(typeof result.reward).toBe('number');
    expect(typeof result.probability_used).toBe('number');
    expect(result.probability_used).toBe(0.2); // Probability for retry_later in mockRecord.hidden
  });

  it('12 & 13. revenue_recovered === observable.amount when recovered is true, 0 when false', async () => {
    const mockLLMClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Test outcome calculation.',
        recommended_action: 'send_reminder',
        confidence: 0.8,
      },
      rawResponse: '{}',
    });

    const recordAttempt1: CombinedGeneratedRecord = {
      ...mockRecord,
      observable: { ...mockRecord.observable, amount: 3500, attempt_number: 1 },
    };

    const result = await runSimulatedRecoveryDecision(recordAttempt1, { noCache: true, clientOverride: mockLLMClient });

    if (result.recovered) {
      expect(result.revenue_recovered).toBe(3500);
      expect(result.reward).toBe(1);
    } else {
      expect(result.revenue_recovered).toBe(0);
      expect(result.reward).toBe(0);
    }
  });

  it('14. Module 2 forwards to simulateRecovery without duplicating recovery logic', async () => {
    const simSpy = vi.spyOn(envModule, 'simulateRecovery');

    const mockLLMClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Test delegation.',
        recommended_action: 'retry_later',
        confidence: 0.9,
      },
      rawResponse: '{}',
    });

    const recordAttempt1: CombinedGeneratedRecord = {
      ...mockRecord,
      observable: { ...mockRecord.observable, attempt_number: 1 },
    };

    await runSimulatedRecoveryDecision(recordAttempt1, { noCache: true, clientOverride: mockLLMClient });

    expect(simSpy).toHaveBeenCalledTimes(1);
    simSpy.mockRestore();
  });
});
