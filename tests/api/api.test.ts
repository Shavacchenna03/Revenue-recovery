import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';
import { ObservableTransaction } from '../../lib/types.js';

describe('Application API Server Layer (Day 7)', () => {
  const sampleTx: ObservableTransaction = {
    transaction_id: 'txn_000006',
    customer_id: 'cust_000006',
    amount: 748,
    currency: 'INR',
    timestamp: '2026-08-01T10:00:00.000Z',
    payment_method: 'upi',
    payment_status: 'failed',
    failure_reason: 'network_timeout',
    attempt_number: 1,
    customer_tenure_months: 6,
    previous_transactions_count: 5,
    previous_success_rate: 0.8,
    average_transaction_value: 750,
    days_since_last_payment: 10,
    subscription_status: 'active',
    device_type: 'mobile_android',
    checkout_completed: true,
  };

  const mockLLMClientApproved = vi.fn().mockResolvedValue({
    decision: {
      diagnosis: 'Transient timeout on attempt 1.',
      recommended_action: 'retry_now',
      confidence: 0.95,
    },
    rawResponse: '{}',
  });

  const mockLLMClientUnsafe = vi.fn().mockResolvedValue({
    decision: {
      diagnosis: 'Mock LLM proposing retry_now on attempt 4.',
      recommended_action: 'retry_now',
      confidence: 0.85,
    },
    rawResponse: '{}',
  });

  it('1. GET /api/transactions/:id returns observable fields only (200) or 404 for unknown id', async () => {
    const app = createApp({ rateLimitOptions: { max: 100 } });

    // 200 for existing fixture transaction
    const res200 = await request(app).get('/api/transactions/txn_000006');
    expect(res200.status).toBe(200);
    expect(res200.body.transaction_id).toBe('txn_000006');
    expect(res200.body.amount).toBe(748);

    // 404 for unknown transaction id
    const res404 = await request(app).get('/api/transactions/txn_unknown_999999');
    expect(res404.status).toBe(404);
    expect(res404.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('2. Response JSON for GET /api/transactions/:id DOES NOT contain hidden-data field names', async () => {
    const app = createApp({ rateLimitOptions: { max: 100 } });
    const res = await request(app).get('/api/transactions/txn_000006');

    const jsonString = JSON.stringify(res.body);
    expect(jsonString.includes('action_probabilities')).toBe(false);
    expect(jsonString.includes('noise_seed')).toBe(false);
    expect(jsonString.includes('true_failure_cause')).toBe(false);
  });

  it('3. GET /api/transactions supports pagination and filtering', async () => {
    const app = createApp({ rateLimitOptions: { max: 100 } });

    const res = await request(app)
      .get('/api/transactions')
      .query({ limit: 5, offset: 0, failure_reason: 'card_expired' });

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(0);
    for (const item of res.body.items) {
      expect(item.failure_reason).toBe('card_expired');
    }
  });

  it('4. POST /api/recovery/analyze with valid fixture transaction_id and default executionMode returns full DTO', async () => {
    const app = createApp({
      llmOptions: { noCache: true, clientOverride: mockLLMClientApproved },
      rateLimitOptions: { max: 100 },
    });

    const res = await request(app)
      .post('/api/recovery/analyze')
      .send({ transaction_id: 'txn_000006' });

    expect(res.status).toBe(200);
    expect(res.body.transaction_id).toBe('txn_000006');
    expect(res.body.proposed_action).toBe('retry_now');
    expect(res.body.final_action).toBe('retry_now');
    expect(res.body.policy_engine.decision).toBe('approved');
    expect(res.body.execution.provider).toBe('simulator');
    expect(res.body.execution.attempted).toBe(true);
    expect(typeof res.body.execution.recovered).toBe('boolean');
    expect(typeof res.body.execution.success).toBe('boolean');

    // Anti-leakage guard assertion on response payload
    const jsonString = JSON.stringify(res.body);
    expect(jsonString.includes('action_probabilities')).toBe(false);
    expect(jsonString.includes('noise_seed')).toBe(false);
  });

  it('5. POST /api/recovery/analyze with executionMode: "razorpay" uses Razorpay executor path (mocked adapter)', async () => {
    const mockRzpExecutor = {
      providerName: 'razorpay' as const,
      execute: vi.fn().mockResolvedValue({
        provider: 'razorpay' as const,
        action: 'retry_now' as const,
        attempted: true,
        success: true,
        provider_reference_id: 'plink_api_test_123',
        status_message: 'Created Razorpay Payment Link plink_api_test_123',
      }),
    };

    const app = createApp({
      llmOptions: { noCache: true, clientOverride: mockLLMClientApproved },
      razorpayExecutorOverride: mockRzpExecutor,
      rateLimitOptions: { max: 100 },
    });

    const res = await request(app)
      .post('/api/recovery/analyze')
      .send({ transaction_id: 'txn_000006', executionMode: 'razorpay' });

    expect(res.status).toBe(200);
    expect(res.body.execution.provider).toBe('razorpay');
    expect(res.body.execution.attempted).toBe(true);
    expect(res.body.execution.success).toBe(true);
    expect(res.body.execution.reference_id).toBe('plink_api_test_123');
    expect(mockRzpExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('6. POST /api/recovery/analyze with raw transaction body and executionMode: "simulator" returns 400 SIMULATION_REQUIRES_FIXTURE_TRANSACTION', async () => {
    const app = createApp({ rateLimitOptions: { max: 100 } });

    const res = await request(app)
      .post('/api/recovery/analyze')
      .send({ transaction: sampleTx, executionMode: 'simulator' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SIMULATION_REQUIRES_FIXTURE_TRANSACTION');
  });

  it('7. Overridden policy decision (attempt 4 + retry proposal) correctly reflects overridden status & final_action', async () => {
    const app = createApp({
      llmOptions: { noCache: true, clientOverride: mockLLMClientUnsafe },
      rateLimitOptions: { max: 100 },
    });

    // txn_000026 is attempt_number: 4
    const res = await request(app)
      .post('/api/recovery/analyze')
      .send({ transaction_id: 'txn_000026' });

    expect(res.status).toBe(200);
    expect(res.body.proposed_action).toBe('retry_now');
    expect(res.body.final_action).toBe('escalate');
    expect(res.body.policy_engine.decision).toBe('overridden');
    expect(res.body.policy_engine.guardrail_id).toBe('guardrail-max-retries');
    expect(res.body.execution.attempted).toBe(true);
  });

  it('8. REGRESSION TEST: Same transaction (txn_000026, escalate) produces DIFFERENT & CORRECTLY LABELED execution shapes in simulator vs razorpay mode', async () => {
    const mockRzpExecutor = {
      providerName: 'razorpay' as const,
      execute: vi.fn().mockResolvedValue({
        provider: 'razorpay' as const,
        action: 'escalate' as const,
        attempted: false,
        success: false,
        unsupported_action: true,
        status_message: 'Application-level action — no direct Razorpay API operation exists for escalate.',
      }),
    };

    const app = createApp({
      llmOptions: { noCache: true, clientOverride: mockLLMClientUnsafe },
      razorpayExecutorOverride: mockRzpExecutor,
      rateLimitOptions: { max: 100 },
    });

    // Run 1: Simulator Mode
    const resSim = await request(app)
      .post('/api/recovery/analyze')
      .send({ transaction_id: 'txn_000026', executionMode: 'simulator' });

    // Run 2: Razorpay Mode
    const resRzp = await request(app)
      .post('/api/recovery/analyze')
      .send({ transaction_id: 'txn_000026', executionMode: 'razorpay' });

    // Simulator shape assertion: attempted = true (sampled in synthetic environment)
    expect(resSim.status).toBe(200);
    expect(resSim.body.execution.provider).toBe('simulator');
    expect(resSim.body.execution.attempted).toBe(true);
    expect(typeof resSim.body.execution.recovered).toBe('boolean');
    expect(resSim.body.execution.unsupported_action).toBeUndefined();

    // Razorpay shape assertion: attempted = false (no provider operation exists for escalate)
    expect(resRzp.status).toBe(200);
    expect(resRzp.body.execution.provider).toBe('razorpay');
    expect(resRzp.body.execution.attempted).toBe(false);
    expect(resRzp.body.execution.success).toBe(false);
    expect(resRzp.body.execution.unsupported_action).toBe(true);
    expect(resRzp.body.execution.recovered).toBeUndefined();
  });

  it('9. Malformed request body returns structured 400 validation error (LLM short-circuits)', async () => {
    const mockLLMSpy = vi.fn();
    const app = createApp({
      llmOptions: { noCache: true, clientOverride: mockLLMSpy },
      rateLimitOptions: { max: 100 },
    });

    const res = await request(app)
      .post('/api/recovery/analyze')
      .send({ invalid_key: 'malformed_payload' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockLLMSpy).not.toHaveBeenCalled(); // LLM was never called!
  });

  it('10. Rate limiting triggers structured 429 response after configured threshold', async () => {
    const app = createApp({
      rateLimitOptions: { max: 2, windowMs: 60000 },
    });

    const res1 = await request(app).get('/api/health');
    const res2 = await request(app).get('/api/health');
    const res3 = await request(app).get('/api/health');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(429);
    expect(res3.body.error.code).toBe('RATE_LIMITED');
  });

  it('11. Error responses never contain raw Razorpay secret values (sanitized at API layer)', async () => {
    const sensitiveSecret = 'SECRET_KEY_NEVER_LEAK_12345';
    process.env.RAZORPAY_KEY_SECRET = sensitiveSecret;

    const failingRzpExecutor = {
      providerName: 'razorpay' as const,
      execute: vi.fn().mockImplementation(() => {
        throw new Error(`Razorpay Auth Error with secret ${sensitiveSecret}`);
      }),
    };

    const app = createApp({
      llmOptions: { noCache: true, clientOverride: mockLLMClientApproved },
      razorpayExecutorOverride: failingRzpExecutor,
      rateLimitOptions: { max: 100 },
    });

    const res = await request(app)
      .post('/api/recovery/analyze')
      .send({ transaction_id: 'txn_000006', executionMode: 'razorpay' });

    expect(res.status).toBe(500);
    const jsonString = JSON.stringify(res.body);
    expect(jsonString.includes(sensitiveSecret)).toBe(false);
    expect(jsonString.includes('[REDACTED_SECRET]')).toBe(true);

    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it('12. Unhandled internal errors return structured INTERNAL_ERROR response without raw stack trace', async () => {
    const app = createApp({
      rateLimitOptions: { max: 100 },
      enableTestCrashRoute: true,
    });

    const res = await request(app).get('/api/test-crash');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Simulated crash error');
    expect(res.body.stack).toBeUndefined(); // Stack trace is never exposed!
  });
});
