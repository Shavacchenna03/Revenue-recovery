import fs from 'node:fs';
import path from 'node:path';
import { ObservableTransaction, RecoveryAction, LLMRecoveryDecision } from './types.js';

export const GROQ_MODEL = 'qwen/qwen3.8-27b';

/**
 * Auto-loads GROQ_API_KEY from a root .env file if not already set in process.env.
 */
function loadEnvKeyIfNeeded(): string | undefined {
  if (process.env.GROQ_API_KEY?.trim()) {
    return process.env.GROQ_API_KEY.trim();
  }
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*GROQ_API_KEY\s*=\s*["']?([^"'\s#]+)["']?/);
      if (match && match[1]) {
        process.env.GROQ_API_KEY = match[1];
        return match[1];
      }
    }
  }
  return undefined;
}

export class LLMResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMResponseValidationError';
  }
}

const VALID_ACTIONS: Set<RecoveryAction> = new Set([
  'retry_now',
  'retry_later',
  'send_reminder',
  'request_payment_method_update',
  'escalate',
]);

/**
 * Formats an ObservableTransaction into a structured, readable prose prompt for the LLM.
 * 
 * ⚠️ AGENT-SAFE PROMPT ⚠️
 * Formats ONLY publicly observable features. Contains zero hidden ground-truth information.
 */
export function formatObservableTransactionPrompt(tx: ObservableTransaction): string {
  return `You are an expert payment recovery AI assistant for a subscription billing platform.
Analyze the following failed payment transaction and select the single best recovery intervention action.

TRANSACTION CONTEXT:
- Amount: ${tx.currency} ${tx.amount.toLocaleString()}
- Payment Method: ${tx.payment_method}
- Failure Reason: ${tx.failure_reason ?? 'unknown'}
- Attempt Number: ${tx.attempt_number}
- Subscription Status: ${tx.subscription_status}
- Device Type: ${tx.device_type}

CUSTOMER PROFILE:
- Tenure: ${tx.customer_tenure_months} months
- Previous Transactions: ${tx.previous_transactions_count}
- Historical Success Rate: ${(tx.previous_success_rate * 100).toFixed(1)}%
- Average Transaction Value: ${tx.currency} ${tx.average_transaction_value.toLocaleString()}
- Days Since Last Payment: ${tx.days_since_last_payment} days

INSTRUCTIONS:
Evaluate this failure and recommend the optimal recovery action from this exact set:
1. "retry_now" (for immediate transient network/technical glitches on early attempts)
2. "retry_later" (for transient bank server downtime or early insufficient funds)
3. "send_reminder" (for past_due/unpaid subscriptions requiring customer action)
4. "request_payment_method_update" (for card expiration, initial auth failures, or invalid instruments)
5. "escalate" (for canceled subscriptions, repeated auth failures, or persistent multi-attempt failures)

Output ONLY a JSON object (no markdown formatting outside the JSON) with the following structure:
{
  "diagnosis": "One concise sentence diagnosing the root cause of the payment failure.",
  "recommended_action": "one of retry_now | retry_later | send_reminder | request_payment_method_update | escalate",
  "confidence": 0.85
}`;
}

/**
 * Parses and strictly validates a raw text response from the LLM.
 * 
 * Strips code fences, parses JSON, and enforces schema validity.
 */
export function parseAndValidateLLMResponse(rawText: string): LLMRecoveryDecision {
  if (!rawText || typeof rawText !== 'string') {
    throw new LLMResponseValidationError('Empty or non-string response received from LLM.');
  }

  // 1. Strip markdown code fences if present (```json ... ``` or ``` ...)
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // 2. Parse JSON
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new LLMResponseValidationError(`Failed to parse LLM response as JSON: ${err.message}. Raw text: "${rawText.substring(0, 100)}"`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LLMResponseValidationError('Parsed LLM response is not a valid JSON object.');
  }

  // 3. Validate recommended_action
  const action = parsed.recommended_action;
  if (!action || !VALID_ACTIONS.has(action as RecoveryAction)) {
    throw new LLMResponseValidationError(
      `Invalid or unrecognized recommended_action: "${action}". Must be one of: ${Array.from(VALID_ACTIONS).join(', ')}`
    );
  }

  // 4. Validate confidence
  let confidence = parsed.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    throw new LLMResponseValidationError(`Invalid confidence value: ${confidence}. Must be a number between 0 and 1.`);
  }
  // Clamp confidence to [0, 1] if slightly out of bounds
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

  // 5. Validate diagnosis
  const diagnosis = parsed.diagnosis;
  if (typeof diagnosis !== 'string' || diagnosis.trim().length === 0) {
    throw new LLMResponseValidationError('Missing or empty diagnosis string in LLM response.');
  }

  return {
    diagnosis: diagnosis.trim(),
    recommended_action: action as RecoveryAction,
    confidence,
  };
}

/**
 * Calls the Groq API endpoint to get a recovery recommendation for an ObservableTransaction.
 * 
 * @param transaction Public ObservableTransaction
 * @returns Object containing parsed LLMRecoveryDecision and raw string response
 */
export async function callLLMForRecovery(
  transaction: ObservableTransaction
): Promise<{ decision: LLMRecoveryDecision; rawResponse: string }> {
  const apiKey = loadEnvKeyIfNeeded();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is missing. Set GROQ_API_KEY in terminal or in a root .env file before making live LLM calls.');
  }

  const prompt = formatObservableTransactionPrompt(transaction);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const status = response.status;
    const err = new Error(`Groq API returned HTTP ${status}: ${errorBody}`);
    (err as any).status = status;
    throw err;
  }

  const data: any = await response.json();
  const rawResponseText = data?.choices?.[0]?.message?.content ?? '';
  const decision = parseAndValidateLLMResponse(rawResponseText);

  return {
    decision,
    rawResponse: rawResponseText,
  };
}
