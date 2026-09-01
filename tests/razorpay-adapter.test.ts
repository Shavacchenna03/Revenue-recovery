import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ObservableTransaction, RecoveryAction } from '../lib/types.js';
import { RazorpayExecutionAdapter, sanitizeSecrets } from '../lib/razorpay-adapter.js';
import { RazorpayRecoveryExecutor, SimulatorRecoveryExecutor } from '../lib/recovery-executor.js';
import { resolveExecutor, runRecoveryDecision } from '../lib/recovery-orchestrator.js';

describe('Razorpay Adapter & Provider Execution Architecture (Day 6)', () => {
  const mockTx: ObservableTransaction = {
    transaction_id: 'txn_rzp_test_001',
    customer_id: 'cust_rzp_001',
    amount: 1500,
    currency: 'INR',
    timestamp: '2026-08-01T10:00:00.000Z',
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

  const testKeyId = 'rzp_test_mockKeyId12345';
  const testKeySecret = 'mockSecretKey67890SecretValue';

  it('1. correct authentication header configuration', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'plink_test_auth_001', status: 'created' }),
    });

    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: testKeySecret,
      fetchFn: mockFetch as any,
    });

    await adapter.executeAction(mockTx, 'retry_now');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.razorpay.com/v1/payment_links');
    
    const expectedAuth = `Basic ${Buffer.from(`${testKeyId}:${testKeySecret}`).toString('base64')}`;
    expect(options.headers['Authorization']).toBe(expectedAuth);
  });

  it('2. successful provider response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        id: 'plink_success_123',
        status: 'created',
        short_url: 'https://rzp.io/i/succ123',
      }),
    });

    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: testKeySecret,
      fetchFn: mockFetch as any,
    });

    const res = await adapter.executeAction(mockTx, 'retry_now');
    expect(res.success).toBe(true);
    expect(res.provider).toBe('razorpay');
    expect(res.provider_reference_id).toBe('plink_success_123');
    expect(res.status_message.includes('plink_success_123')).toBe(true);
  });

  it('3. provider error response handling (sanitized)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'Invalid amount' } }),
    });

    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: testKeySecret,
      fetchFn: mockFetch as any,
    });

    const res = await adapter.executeAction(mockTx, 'retry_now');
    expect(res.success).toBe(false);
    expect(res.status_message.includes('HTTP 400')).toBe(true);
  });

  it('4. timeout/network failure handling', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network connection reset'));

    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: testKeySecret,
      fetchFn: mockFetch as any,
    });

    const res = await adapter.executeAction(mockTx, 'retry_now');
    expect(res.success).toBe(false);
    expect(res.status_message.includes('Network connection reset')).toBe(true);
  });

  it('5. malformed provider response handling', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'INVALID_NON_JSON_HTML_RESPONSE',
    });

    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: testKeySecret,
      fetchFn: mockFetch as any,
    });

    const res = await adapter.executeAction(mockTx, 'retry_now');
    expect(res.success).toBe(false);
    expect(res.status_message.includes('Failed to parse Razorpay API response as JSON')).toBe(true);
  });

  it('6. unsupported RecoveryAction handling (escalate)', async () => {
    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: testKeySecret,
    });

    const res = await adapter.executeAction(mockTx, 'escalate');
    expect(res.success).toBe(false);
    expect(res.unsupported_action).toBe(true);
    expect(res.status_message.includes('no direct Razorpay API operation exists')).toBe(true);
  });

  it('7. missing credentials error handling', async () => {
    const adapter = new RazorpayExecutionAdapter({ keyId: '', keySecret: '' });

    const res = await adapter.executeAction(mockTx, 'retry_now');
    expect(res.success).toBe(false);
    expect(res.details?.error_type).toBe('MISSING_CREDENTIALS');
  });

  it('8. SECRET LEAK GUARD: credential values never appear in thrown errors, logs, or results', async () => {
    const sensitiveSecret = 'SUPER_SECRET_TOKEN_99999_DO_NOT_LEAK';
    const mockFetch = vi.fn().mockRejectedValue(new Error(`Failed with raw key ${sensitiveSecret}`));

    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: sensitiveSecret,
      fetchFn: mockFetch as any,
    });

    const res = await adapter.executeAction(mockTx, 'retry_now');
    expect(res.status_message.includes(sensitiveSecret)).toBe(false);
    expect(res.status_message.includes('[REDACTED_SECRET]')).toBe(true);

    const sanitizedText = sanitizeSecrets(`Error containing ${sensitiveSecret}`, sensitiveSecret);
    expect(sanitizedText.includes(sensitiveSecret)).toBe(false);
  });

  it('9. deterministic request payload construction', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 'plink_payload_check', status: 'created' }),
    });

    const adapter = new RazorpayExecutionAdapter({
      keyId: testKeyId,
      keySecret: testKeySecret,
      fetchFn: mockFetch as any,
    });

    await adapter.executeAction(mockTx, 'retry_now');

    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(options.body);

    expect(body.amount).toBe(150000); // 1500 INR * 100 paise
    expect(body.currency).toBe('INR');
    expect(body.customer.name).toBe('Customer cust_rzp_001');
    expect(body.notify.sms).toBe(true);
    expect(body.notify.email).toBe(true);
  });

  it('10. SOURCE-LEVEL SECRET GUARD: Razorpay adapter source text MUST NOT contain hardcoded API keys', () => {
    const fullPath = path.resolve(process.cwd(), 'lib', 'razorpay-adapter.ts');
    const sourceText = fs.readFileSync(fullPath, 'utf-8');

    expect(sourceText.includes('rzp_test_')).toBe(false);
    expect(sourceText.includes('rzp_live_')).toBe(false);
  });

  it('11. .gitignore contains .env entry', () => {
    const gitignorePath = path.resolve(process.cwd(), '.gitignore');
    const gitignoreText = fs.readFileSync(gitignorePath, 'utf-8');

    const lines = gitignoreText.split('\n').map(l => l.trim());
    expect(lines.includes('.env')).toBe(true);
  });

  it('12. orchestrator defaults to Simulator executor even when Razorpay credentials exist in environment', () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy_key';
    process.env.RAZORPAY_KEY_SECRET = 'dummy_secret';

    // Calling resolveExecutor without executionMode: 'razorpay' or explicit executor MUST default to Simulator
    const defaultExec = resolveExecutor();
    expect(defaultExec.providerName).toBe('simulator');
    expect(defaultExec instanceof SimulatorRecoveryExecutor).toBe(true);

    // Explicit opt-in parameter returns Razorpay executor
    const razorpayExec = resolveExecutor({ executionMode: 'razorpay' });
    expect(razorpayExec.providerName).toBe('razorpay');
    expect(razorpayExec instanceof RazorpayRecoveryExecutor).toBe(true);

    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it('13. GOVERNED EXECUTION PATH TEST: Case A (Approved) & Case B (Overridden) with Mock Executor Spy', async () => {
    // Case A: LLM proposes retry_now on attempt 1 -> Policy Engine APPROVES -> Executor receives retry_now
    const mockExecutorA = {
      providerName: 'razorpay' as const,
      execute: vi.fn().mockResolvedValue({
        provider: 'razorpay' as const,
        action: 'retry_now' as RecoveryAction,
        attempted: true,
        success: true,
        provider_reference_id: 'plink_case_a',
        status_message: 'Executed retry_now via Payment Link',
      }),
    };

    const mockLLMClientA = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Transient timeout on attempt 1.',
        recommended_action: 'retry_now',
        confidence: 0.95,
      },
      rawResponse: '{}',
    });

    const decA = await runRecoveryDecision(mockTx, { noCache: true, clientOverride: mockLLMClientA });
    const execResA = await mockExecutorA.execute(mockTx, decA.final_action);

    expect(decA.proposed_action).toBe('retry_now');
    expect(decA.final_action).toBe('retry_now');
    expect(decA.overridden).toBe(false);
    expect(mockExecutorA.execute).toHaveBeenCalledWith(mockTx, 'retry_now');
    expect(execResA.provider_reference_id).toBe('plink_case_a');

    // Case B: LLM proposes retry_now on attempt 4 -> Policy Engine OVERRIDES to escalate -> Executor receives escalate
    const txAttempt4: ObservableTransaction = { ...mockTx, attempt_number: 4 };

    const mockExecutorB = {
      providerName: 'razorpay' as const,
      execute: vi.fn().mockResolvedValue({
        provider: 'razorpay' as const,
        action: 'escalate' as RecoveryAction,
        attempted: false,
        success: false,
        unsupported_action: true,
        status_message: 'Application-level action — no direct Razorpay API operation exists for escalate',
      }),
    };

    const mockLLMClientB = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Attempting retry on attempt 4.',
        recommended_action: 'retry_now', // Unsafe proposal!
        confidence: 0.85,
      },
      rawResponse: '{}',
    });

    const decB = await runRecoveryDecision(txAttempt4, { noCache: true, clientOverride: mockLLMClientB });
    const execResB = await mockExecutorB.execute(txAttempt4, decB.final_action);

    expect(decB.proposed_action).toBe('retry_now');
    expect(decB.final_action).toBe('escalate');
    expect(decB.overridden).toBe(true);

    // CRITICAL SPY ASSERTION: Executor MUST receive 'escalate', NOT 'retry_now'!
    expect(mockExecutorB.execute).toHaveBeenCalledWith(txAttempt4, 'escalate');
    expect(execResB.unsupported_action).toBe(true);
  });
});
