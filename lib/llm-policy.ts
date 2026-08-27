import fs from 'node:fs';
import path from 'node:path';
import { 
  ObservableTransaction, 
  RecoveryAction, 
  LLMPolicyResult, 
  LLMFallbackReason 
} from './types.js';
import { selectRecoveryAction } from './policy.js';
import { 
  callLLMForRecovery, 
  LLMResponseValidationError 
} from './llm-client.js';
import { SeededRandom } from './random.js';

export const LLM_CALL_TIMEOUT_MS = 10000;
export const RATE_LIMIT_RETRY_BACKOFF_MS = 1500;
export const BATCH_CALL_DELAY_MS = 500;

const CACHE_FILE_PATH = path.resolve(process.cwd(), 'data', 'fixtures', 'llm-response-cache.json');

/**
 * Loads cached LLM policy results from disk.
 */
export function loadLLMCache(): Record<string, LLMPolicyResult> {
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const content = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[LLM Policy Cache] Failed to load response cache file, starting fresh.');
  }
  return {};
}

/**
 * Saves LLM policy results cache to disk.
 */
export function saveLLMCache(cache: Record<string, LLMPolicyResult>): void {
  try {
    const dir = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[LLM Policy Cache] Failed to save response cache to disk.');
  }
}

/**
 * Helper utility to delay execution for rate limiting.
 */
export function delayMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Selects a FIXED, SEEDED sample of failed transactions for LLM evaluation.
 * 
 * Uses SeededRandom(seed = 42) to deterministically select the exact same 250 records every run.
 */
export function selectFixedSample<T extends { observable: ObservableTransaction }>(
  records: T[],
  sampleSize = 250,
  seed = 42
): T[] {
  const failedRecords = records.filter(r => r.observable && r.observable.payment_status === 'failed');
  if (failedRecords.length <= sampleSize) {
    return failedRecords;
  }

  const rng = new SeededRandom(seed);
  const shuffled = [...failedRecords];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }

  return shuffled.slice(0, sampleSize);
}

/**
 * Domain Guard: Verifies transaction payment_status is 'failed'.
 */
function assertFailedTransaction(transaction: ObservableTransaction): void {
  if (transaction.payment_status !== 'failed') {
    throw new Error(
      `selectLLMActionAsync called on a non-failed transaction: "${transaction.transaction_id}" has status "${transaction.payment_status}".`
    );
  }
}

/**
 * LLM-BACKED RECOVERY POLICY ENGINE WITH HYBRID FALLBACK
 * 
 * ⚠️ AGENT-SAFE COMPONENT ⚠️
 */
export interface SelectLLMActionOptions {
  noCache?: boolean;
  clientOverride?: typeof callLLMForRecovery;
}

/**
 * Async policy function that selects a RecoveryAction for a given ObservableTransaction.
 * 
 * Includes automated retry-with-backoff, local response caching, 10s timeout,
 * and seamless fallback to the Day 2.2 rule-based policy upon API/validation failure.
 * 
 * @param transaction Public ObservableTransaction
 * @param options Configuration options ({ noCache?: boolean, clientOverride?: typeof callLLMForRecovery })
 * @returns LLMPolicyResult containing selected action, diagnosis, confidence, and fallback metadata
 */
export async function selectLLMActionAsync(
  transaction: ObservableTransaction,
  options?: SelectLLMActionOptions
): Promise<LLMPolicyResult> {
  assertFailedTransaction(transaction);

  const txId = transaction.transaction_id;
  const useCache = !options?.noCache;

  // 1. Check local persistent disk cache
  if (useCache) {
    const cache = loadLLMCache();
    if (cache[txId]) {
      return cache[txId]!;
    }
  }

  const client = options?.clientOverride ?? callLLMForRecovery;

  // Helper for executing LLM call with 10s timeout
  const executeCallWithTimeout = async () => {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const err = new Error('LLM API request timed out after 10 seconds');
        (err as any).name = 'TimeoutError';
        reject(err);
      }, LLM_CALL_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([client(transaction), timeoutPromise]);
      return result;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  let fallbackReason: LLMFallbackReason = 'api_error';
  let lastRawResponse: string | undefined;

  try {
    let responseData: { decision: any; rawResponse: string } | undefined;
    let attempts = 0;
    const maxRetries = 3;

    while (attempts <= maxRetries) {
      try {
        attempts++;
        responseData = await executeCallWithTimeout();
        break; // Success!
      } catch (err: any) {
        if ((err?.status === 429 || err?.message?.includes('429')) && attempts <= maxRetries) {
          const waitMs = RATE_LIMIT_RETRY_BACKOFF_MS * attempts;
          console.warn(`[LLM Policy] 429 Rate limited on ${txId} (attempt ${attempts}/${maxRetries}). Retrying after ${waitMs}ms...`);
          await delayMs(waitMs);
        } else {
          throw err;
        }
      }
    }

    if (!responseData) {
      throw new Error('No response received from LLM API.');
    }

    const result: LLMPolicyResult = {
      action: responseData.decision.recommended_action as RecoveryAction,
      diagnosis: responseData.decision.diagnosis,
      confidence: responseData.decision.confidence,
      used_fallback: false,
      raw_response: responseData.rawResponse,
    };

    // Save to disk cache
    if (useCache) {
      const cache = loadLLMCache();
      cache[txId] = result;
      saveLLMCache(cache);
    }

    return result;

  } catch (err: any) {
    // Determine exact fallback reason
    if (err instanceof LLMResponseValidationError) {
      fallbackReason = 'validation_failed';
    } else if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
      fallbackReason = 'timeout';
    } else if (err.status === 429 || err.message?.includes('429')) {
      fallbackReason = 'rate_limited';
    } else if (err.message?.includes('fetch failed') || err.message?.includes('ENOTFOUND') || err.name === 'TypeError') {
      fallbackReason = 'network_error';
    } else {
      fallbackReason = 'api_error';
    }

    console.warn(`[LLM Policy Fallback] ${txId} fallback triggered: ${fallbackReason} (${err.message})`);

    // Fall back to Day 2.2 Rule-Based Baseline Policy
    const baselineAction = selectRecoveryAction(transaction);

    const fallbackResult: LLMPolicyResult = {
      action: baselineAction,
      diagnosis: `LLM fallback: ${fallbackReason} (${err.message})`,
      confidence: 0,
      used_fallback: true,
      fallback_reason: fallbackReason,
      ...(lastRawResponse ? { raw_response: lastRawResponse } : {}),
    };

    // Cache fallback result so we don't spam broken calls on repeat runs
    if (useCache) {
      const cache = loadLLMCache();
      cache[txId] = fallbackResult;
      saveLLMCache(cache);
    }

    return fallbackResult;
  }
}
