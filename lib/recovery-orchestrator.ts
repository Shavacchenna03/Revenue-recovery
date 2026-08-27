import { ObservableTransaction, RecoveryDecisionResult, RecoveryOrchestrationResult, RecoveryExecutor } from './types.js';
import { explainGovernedLLMDecisionAsync } from './governed-policy.js';
import { SelectLLMActionOptions } from './llm-policy.js';
import { RazorpayAdapterOptions } from './razorpay-adapter.js';
import { SimulatorRecoveryExecutor, RazorpayRecoveryExecutor } from './recovery-executor.js';

export interface RunRecoveryOptions extends SelectLLMActionOptions {
  executor?: RecoveryExecutor;
  executionMode?: 'simulator' | 'razorpay';
  razorpayOptions?: RazorpayAdapterOptions;
}

/**
 * Resolves the appropriate RecoveryExecutor based on explicit opt-in arguments.
 * 
 * ⚠️ SAFETY RULE ⚠️
 * Defaults strictly to SimulatorRecoveryExecutor.
 * Razorpay executor is ONLY selected if executionMode === 'razorpay' OR an explicit executor instance is passed.
 * Mere presence of RAZORPAY_KEY_ID in environment is NEVER sufficient to trigger real API calls.
 */
export function resolveExecutor(options?: RunRecoveryOptions): RecoveryExecutor {
  if (options?.executor) {
    return options.executor;
  }
  if (options?.executionMode === 'razorpay') {
    return new RazorpayRecoveryExecutor(options?.razorpayOptions);
  }
  return new SimulatorRecoveryExecutor();
}

/**
 * PRODUCTION-SHAPE RECOVERY DECISION PIPELINE (Module 1)
 * 
 * ⚠️ AGENT-SAFE / PRODUCTION COMPONENT ⚠️
 * Accepts an ObservableTransaction, requests an LLM proposed action (with automatic fallback handling),
 * passes the proposal through the Policy Engine guardrails, and returns a structured RecoveryDecisionResult.
 * 
 * HAS ZERO DEPENDENCY ON HIDDEN GROUND TRUTH OR THE RECOVERY SIMULATOR.
 * Directly reusable by a future Razorpay execution adapter and API/UI layer.
 * 
 * @param transaction Public ObservableTransaction
 * @param options Optional configuration / dependency injection (e.g. LLM client override, noCache flag)
 * @returns Promise<RecoveryDecisionResult> Structured decision output
 */
export async function runRecoveryDecision(
  transaction: ObservableTransaction,
  options?: RunRecoveryOptions
): Promise<RecoveryDecisionResult> {
  const governedDecision = await explainGovernedLLMDecisionAsync(transaction, options);

  return {
    transaction_id: transaction.transaction_id,
    proposed_action: governedDecision.proposed_action,
    final_action: governedDecision.approved_action,
    overridden: governedDecision.overridden,
    guardrail_id: governedDecision.guardrail_id,
    guardrail_reason: governedDecision.reason,
    llm_diagnosis: governedDecision.diagnosis,
    llm_confidence: governedDecision.confidence,
    used_llm_fallback: governedDecision.used_fallback,
    ...(governedDecision.fallback_reason ? { llm_fallback_reason: governedDecision.fallback_reason } : {}),
  };
}

/**
 * Generates a concise, human-readable prose explanation of a recovery decision or simulated outcome.
 * Suitable for UI dashboards, log auditing, and user inspection.
 * 
 * Handles both decision-only results (RecoveryDecisionResult) and full simulated outcome results (RecoveryOrchestrationResult).
 * 
 * @param result RecoveryDecisionResult or RecoveryOrchestrationResult
 * @returns Formatted multi-line string explanation
 */
export function explainRecoveryDecision(
  result: RecoveryDecisionResult | RecoveryOrchestrationResult
): string {
  const isSimulated = 'decision' in result;
  const decision: RecoveryDecisionResult = isSimulated ? result.decision : result;
  const outcome = isSimulated ? result : undefined;

  let lines: string[] = [];

  lines.push(`Transaction ${decision.transaction_id}`);
  lines.push(``);

  // 1. LLM Section
  lines.push(`LLM:`);
  if (decision.llm_diagnosis) {
    lines.push(`  Diagnosis: ${decision.llm_diagnosis}`);
  }
  if (typeof decision.llm_confidence === 'number') {
    lines.push(`  Confidence: ${decision.llm_confidence.toFixed(2)}`);
  }
  lines.push(`  Proposed: ${decision.proposed_action}`);
  if (decision.used_llm_fallback) {
    lines.push(`  Fallback Triggered: ${decision.llm_fallback_reason ?? 'unknown'}`);
  }
  lines.push(``);

  // 2. Policy Engine Section
  lines.push(`Policy Engine:`);
  lines.push(`  Decision: ${decision.overridden ? 'OVERRIDDEN' : 'APPROVED'}`);
  lines.push(`  Guardrail: ${decision.guardrail_id}`);
  if (decision.overridden) {
    lines.push(`  Reason: ${decision.guardrail_reason}`);
  }
  lines.push(``);

  // 3. Final Action Section
  lines.push(`Final Action:`);
  lines.push(`  ${decision.final_action}`);

  // 4. Execution Outcome Section (if simulated)
  if (outcome) {
    lines.push(``);
    lines.push(`Execution:`);
    lines.push(`  ${outcome.recovered ? 'RECOVERED' : 'FAILED'}`);
    lines.push(`  Revenue Recovered: ₹${outcome.revenue_recovered.toLocaleString('en-IN')}`);
    lines.push(`  Success Probability Used: ${(outcome.probability_used * 100).toFixed(1)}%`);
  }

  return lines.join('\n');
}
