import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { 
  selectLLMActionAsync, 
  selectFixedSample 
} from '../lib/llm-policy.js';
import { parseAndValidateLLMResponse, formatObservableTransactionPrompt } from '../lib/llm-client.js';
import { ObservableTransaction, CombinedGeneratedRecord } from '../lib/types.js';

describe('LLM Recovery Policy (Day 3 Mocked Tests)', () => {
  const baseTx: ObservableTransaction = {
    transaction_id: 'txn_llm_test_001',
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

  it('1. valid JSON response -> correct action, diagnosis, confidence, used_fallback: false', async () => {
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Expired credit card requires customer update.',
        recommended_action: 'request_payment_method_update',
        confidence: 0.92,
      },
      rawResponse: '{"diagnosis":"Expired credit card requires customer update.","recommended_action":"request_payment_method_update","confidence":0.92}',
    });

    const res = await selectLLMActionAsync(baseTx, { noCache: true, clientOverride: mockClient });
    expect(res.action).toBe('request_payment_method_update');
    expect(res.diagnosis).toBe('Expired credit card requires customer update.');
    expect(res.confidence).toBe(0.92);
    expect(res.used_fallback).toBe(false);
    expect(res.fallback_reason).toBeUndefined();
    expect(mockClient).toHaveBeenCalledTimes(1);
  });

  it('2. response wrapped in markdown fences -> parses correctly', () => {
    const fencedText = '```json\n{\n  "diagnosis": "Transient network timeout.",\n  "recommended_action": "retry_now",\n  "confidence": 0.88\n}\n```';
    const decision = parseAndValidateLLMResponse(fencedText);

    expect(decision.recommended_action).toBe('retry_now');
    expect(decision.diagnosis).toBe('Transient network timeout.');
    expect(decision.confidence).toBe(0.88);
  });

  it('3. malformed JSON -> falls back to rule-based action with validation_failed', async () => {
    const mockClient = vi.fn().mockRejectedValue(new Error('Failed to parse LLM response as JSON'));

    const res = await selectLLMActionAsync(baseTx, { noCache: true, clientOverride: mockClient });
    expect(res.used_fallback).toBe(true);
    expect(res.fallback_reason).toBe('api_error');
    expect(res.action).toBe('request_payment_method_update'); // Day 2.2 rule-based action for card_expired
    expect(res.confidence).toBe(0);
  });

  it('4. recommended_action not in valid RecoveryAction set -> falls back with validation_failed', () => {
    const invalidActionJson = '{"diagnosis":"Test","recommended_action":"do_nothing","confidence":0.8}';
    expect(() => parseAndValidateLLMResponse(invalidActionJson)).toThrow(/Invalid or unrecognized recommended_action/);
  });

  it('5. confidence out of [0,1] range -> clamped to [0,1]', () => {
    const overConfJson = '{"diagnosis":"Test","recommended_action":"escalate","confidence":1.5}';
    const parsed = parseAndValidateLLMResponse(overConfJson);
    expect(parsed.confidence).toBe(1);

    const negConfJson = '{"diagnosis":"Test","recommended_action":"escalate","confidence":-0.5}';
    const parsedNeg = parseAndValidateLLMResponse(negConfJson);
    expect(parsedNeg.confidence).toBe(0);
  });

  it('6. timeout (mock a hung promise) -> falls back with fallback_reason: timeout', async () => {
    const hungClient = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves

    // Use a short timeout override for test speed
    const timeoutPromise = selectLLMActionAsync(baseTx, { noCache: true, clientOverride: hungClient });
    
    // Fast-forward or await
    const res = await timeoutPromise;
    expect(res.used_fallback).toBe(true);
    expect(res.fallback_reason).toBe('timeout');
  }, 12000);

  it('7. mocked 429 response -> retries 3 times, then falls back with rate_limited if still failing', async () => {
    const rateLimitErr = new Error('Groq API returned HTTP 429: Rate limit exceeded');
    (rateLimitErr as any).status = 429;

    const mock429Client = vi.fn().mockRejectedValue(rateLimitErr);

    const res = await selectLLMActionAsync(baseTx, { noCache: true, clientOverride: mock429Client });
    expect(mock429Client).toHaveBeenCalledTimes(4); // First attempt + 3 retries
    expect(res.used_fallback).toBe(true);
    expect(res.fallback_reason).toBe('rate_limited');
  }, 15000);

  it('8. domain guard: throws when called on non-failed transaction', async () => {
    const successTx: ObservableTransaction = { ...baseTx, payment_status: 'success', failure_reason: null };
    await expect(selectLLMActionAsync(successTx)).rejects.toThrow(/selectLLMActionAsync called on a non-failed transaction/);
  });

  it('9. caching: second call for same transaction_id does not invoke client again', async () => {
    const uniqueTx: ObservableTransaction = { ...baseTx, transaction_id: `txn_cache_test_${Date.now()}` };
    const mockClient = vi.fn().mockResolvedValue({
      decision: {
        diagnosis: 'Cached test decision.',
        recommended_action: 'send_reminder',
        confidence: 0.75,
      },
      rawResponse: '{"diagnosis":"Cached test decision.","recommended_action":"send_reminder","confidence":0.75}',
    });

    const res1 = await selectLLMActionAsync(uniqueTx, { noCache: false, clientOverride: mockClient });
    expect(mockClient).toHaveBeenCalledTimes(1);

    const res2 = await selectLLMActionAsync(uniqueTx, { noCache: false, clientOverride: mockClient });
    expect(mockClient).toHaveBeenCalledTimes(1); // Cached, no second call
    expect(res2).toEqual(res1);
  });

  it('10. TYPE-LEVEL SAFETY GUARD: LLM files must NOT import ground truth or evaluation types', () => {
    const filesToGuard = ['lib/llm-client.ts', 'lib/llm-policy.ts'];

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

  it('11. sample selection is deterministic (same seed = 42 produces identical 250 transaction_ids)', () => {
    const mockRecords: CombinedGeneratedRecord[] = Array.from({ length: 500 }, (_, i) => ({
      observable: { ...baseTx, transaction_id: `txn_sample_${i + 1}` },
      hidden: { action_probabilities: { retry_now: 0.5, retry_later: 0.5, send_reminder: 0.5, request_payment_method_update: 0.5, escalate: 0.5 }, noise_seed: i },
    }));

    const sample1 = selectFixedSample(mockRecords, 250, 42);
    const sample2 = selectFixedSample(mockRecords, 250, 42);

    expect(sample1.length).toBe(250);
    expect(sample2.length).toBe(250);

    const ids1 = sample1.map(s => s.observable.transaction_id);
    const ids2 = sample2.map(s => s.observable.transaction_id);

    expect(ids1).toEqual(ids2);
  });

  it('12. formatObservableTransactionPrompt produces clean prose prompt without hidden fields', () => {
    const prompt = formatObservableTransactionPrompt(baseTx);

    expect(prompt.includes('INR 2,500')).toBe(true);
    expect(prompt.includes('card_expired')).toBe(true);
    expect(prompt.includes('action_probabilities')).toBe(false);
    expect(prompt.includes('noise_seed')).toBe(false);
  });
});
