import { ObservableTransaction, RecoveryAction, GovernedLLMDecision } from './types.js';
import { selectLLMActionAsync, SelectLLMActionOptions } from './llm-policy.js';
import { evaluatePolicyGuardrails } from './policy-engine.js';

/**
 * Returns a rich, audited GovernedLLMDecision object containing proposal details,
 * policy engine approval/override results, LLM diagnosis, confidence, and fallback metrics.
 */
export async function explainGovernedLLMDecisionAsync(
  transaction: ObservableTransaction,
  options?: SelectLLMActionOptions
): Promise<GovernedLLMDecision> {
  const llmResult = await selectLLMActionAsync(transaction, options);
  const proposedAction = llmResult.action;

  // Pass proposal (genuine LLM or fallback-sourced) through Policy Engine
  const engineDecision = evaluatePolicyGuardrails(transaction, proposedAction);

  return {
    transaction_id: transaction.transaction_id,
    proposed_action: proposedAction,
    approved_action: engineDecision.approved_action,
    overridden: engineDecision.overridden,
    guardrail_id: engineDecision.guardrail_id,
    reason: engineDecision.reason,
    diagnosis: llmResult.diagnosis,
    confidence: llmResult.confidence,
    used_fallback: llmResult.used_fallback,
    ...(llmResult.fallback_reason ? { fallback_reason: llmResult.fallback_reason } : {}),
    ...(llmResult.raw_response ? { raw_response: llmResult.raw_response } : {}),
  };
}

/**
 * Governed LLM Policy Action Selector.
 * 
 * Takes an ObservableTransaction, obtains an LLM proposal (or fallback proposal),
 * passes it through the Policy Engine, and returns the approved RecoveryAction.
 * 
 * Signature compatible with evaluatePolicyAsync / evaluatePolicy.
 */
export async function selectGovernedLLMActionAsync(
  transaction: ObservableTransaction,
  options?: SelectLLMActionOptions
): Promise<RecoveryAction> {
  const governedDecision = await explainGovernedLLMDecisionAsync(transaction, options);
  return governedDecision.approved_action;
}
