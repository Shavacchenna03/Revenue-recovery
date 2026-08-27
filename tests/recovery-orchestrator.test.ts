import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ObservableTransaction } from '../lib/types.js';
import { runRecoveryDecision, explainRecoveryDecision } from '../lib/recovery-orchestrator.js';

describe('Module 1: Recovery Orchestrator (Production-Shape Pipeline)', () => {
  const baseTx: ObservableTransaction = {
    transaction_id: 'txn_orch_test_001',
    customer_id: 'cust_orch_test_001',
    amount: 2500,
    currency: 'INR',
    timestamp: '2026-07-20T12:00:00.000Z',
    payment_method: 'card',
    payment_status: 'failed',
    failure_reason: 'network_timeout',
    attempt_number: 1,
    customer_tenure_months: 12,
    previous_transactions_count: 10,
    previous_success_rate: 0.9,
    average_transaction_value: 2500,
    days_since_last_payment: 5,
    subscription_status: 'active',
    device_type: 'desktop_web',
    checkout_completed: true,
  };

  it('1. LLM proposal flows into Policy Engine', async () => {
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Transient timeout on attempt 1.',
        recommended_action: 'retry_now',
        confidence: 0.92,
      },
      rawResponse: '{"diagnosis":"Transient timeout on attempt 1.","recommended_action":"retry_now","confidence":0.92}',
    });

    const res = await runRecoveryDecision(baseTx, { noCache: true, clientOverride: mockClient });
    expect(mockClient).toHaveBeenCalledTimes(1);
    expect(res.proposed_action).toBe('retry_now');
  });

  it('2. Approved proposal produces final_action === proposed_action, overridden: false', async () => {
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Transient timeout on attempt 1.',
        recommended_action: 'retry_now',
        confidence: 0.92,
      },
      rawResponse: '{}',
    });

    const res = await runRecoveryDecision(baseTx, { noCache: true, clientOverride: mockClient });
    expect(res.proposed_action).toBe('retry_now');
    expect(res.final_action).toBe('retry_now');
    expect(res.overridden).toBe(false);
    expect(res.guardrail_id).toBe('guardrail-default-approve');
  });

  it('3. Overridden proposal (attempt 4 + retry_now) produces final_action: escalate, overridden: true', async () => {
    const txAttempt4: ObservableTransaction = { ...baseTx, attempt_number: 4 };
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Proposing retry on attempt 4.',
        recommended_action: 'retry_now',
        confidence: 0.85,
      },
      rawResponse: '{}',
    });

    const res = await runRecoveryDecision(txAttempt4, { noCache: true, clientOverride: mockClient });
    expect(res.proposed_action).toBe('retry_now');
    expect(res.final_action).toBe('escalate');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-max-retries');
  });

  it('4. card_expired proposal is changed to request_payment_method_update', async () => {
    const txExpired: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired', attempt_number: 1 };
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Proposing retry on expired card.',
        recommended_action: 'retry_now',
        confidence: 0.8,
      },
      rawResponse: '{}',
    });

    const res = await runRecoveryDecision(txExpired, { noCache: true, clientOverride: mockClient });
    expect(res.proposed_action).toBe('retry_now');
    expect(res.final_action).toBe('request_payment_method_update');
    expect(res.overridden).toBe(true);
    expect(res.guardrail_id).toBe('guardrail-card-expired');
  });

  it('5. LLM fallback still passes through the Policy Engine (used_llm_fallback: true, guardrails enforced)', async () => {
    const failingClient = vi.fn().mockRejectedValue(new Error('LLM API Error'));
    const txExpired: ObservableTransaction = { ...baseTx, failure_reason: 'card_expired', attempt_number: 1 };

    const res = await runRecoveryDecision(txExpired, { noCache: true, clientOverride: failingClient });
    expect(res.used_llm_fallback).toBe(true);
    expect(res.llm_fallback_reason).toBe('api_error');
    // Fallback baseline produced request_payment_method_update, which passed Policy Engine
    expect(res.final_action).toBe('request_payment_method_update');
  });

  it('6. Result preserves llm_diagnosis and llm_confidence when available', async () => {
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Detailed diagnostic rationale.',
        recommended_action: 'retry_later',
        confidence: 0.88,
      },
      rawResponse: '{}',
    });

    const res = await runRecoveryDecision(baseTx, { noCache: true, clientOverride: mockClient });
    expect(res.llm_diagnosis).toBe('Detailed diagnostic rationale.');
    expect(res.llm_confidence).toBe(0.88);
  });

  it('7. Result correctly reports whether an override occurred', async () => {
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Test diagnosis.',
        recommended_action: 'retry_now',
        confidence: 0.9,
      },
      rawResponse: '{}',
    });

    // Approved case
    const appRes = await runRecoveryDecision(baseTx, { noCache: true, clientOverride: mockClient });
    expect(appRes.overridden).toBe(false);

    // Overridden case (canceled subscription)
    const txCanceled: ObservableTransaction = { ...baseTx, subscription_status: 'canceled' };
    const ovrRes = await runRecoveryDecision(txCanceled, { noCache: true, clientOverride: mockClient });
    expect(ovrRes.overridden).toBe(true);
  });

  it('8. Deterministic mocked execution produces stable, repeatable results', async () => {
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Deterministic test.',
        recommended_action: 'send_reminder',
        confidence: 0.75,
      },
      rawResponse: '{}',
    });

    const res1 = await runRecoveryDecision(baseTx, { noCache: true, clientOverride: mockClient });
    const res2 = await runRecoveryDecision(baseTx, { noCache: true, clientOverride: mockClient });
    expect(res1).toEqual(res2);
  });

  it('9. SOURCE-TEXT SAFETY GUARD: Module 1 source text MUST NOT access hidden ground truth', () => {
    const fullPath = path.resolve(process.cwd(), 'lib', 'recovery-orchestrator.ts');
    const sourceText = fs.readFileSync(fullPath, 'utf-8');

    expect(sourceText.includes('GroundTruthTransaction')).toBe(false);
    expect(sourceText.includes('CombinedGeneratedRecord')).toBe(false);
    expect(sourceText.includes('RecoveryEnvironment')).toBe(false);
    expect(sourceText.includes('action_probabilities')).toBe(false);
    expect(sourceText.includes('noise_seed')).toBe(false);
  });

  it('10. explainRecoveryDecision produces concise formatted explanation string', async () => {
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Transient server error.',
        recommended_action: 'retry_later',
        confidence: 0.91,
      },
      rawResponse: '{}',
    });

    const res = await runRecoveryDecision(baseTx, { noCache: true, clientOverride: mockClient });
    const explanation = explainRecoveryDecision(res);

    expect(explanation.includes('Transaction txn_orch_test_001')).toBe(true);
    expect(explanation.includes('Transient server error.')).toBe(true);
    expect(explanation.includes('APPROVED')).toBe(true);
    expect(explanation.includes('retry_later')).toBe(true);
  });
});
