import { CombinedGeneratedRecord, RecoveryOrchestrationResult } from './types.js';
import { runRecoveryDecision } from './recovery-orchestrator.js';
import { simulateRecovery } from './environment.js';
import { SelectLLMActionOptions } from './llm-policy.js';

/**
 * DEMO / EVALUATION-ONLY RECOVERY ORCHESTRATOR WRAPPER (Module 2)
 * 
 * 🛑 EVALUATION / DEMO INFRASTRUCTURE ONLY 🛑
 * Accepts a CombinedGeneratedRecord (observable + hidden ground truth),
 * delegates the decision to Module 1 (runRecoveryDecision),
 * and executes the resulting FINAL governed action in the evaluation environment (simulateRecovery).
 * 
 * THIS FILE IS EVALUATION INFRASTRUCTURE AND MAY REFERENCE HIDDEN GROUND TRUTH TYPES.
 * It must NEVER be used as a production entry point.
 * 
 * @param record Full CombinedGeneratedRecord containing observable features and hidden ground truth
 * @param options Optional configuration / dependency injection (e.g. LLM client override, noCache flag)
 * @returns Promise<RecoveryOrchestrationResult> Decision + simulated execution outcome
 */
export async function runSimulatedRecoveryDecision(
  record: CombinedGeneratedRecord,
  options?: SelectLLMActionOptions
): Promise<RecoveryOrchestrationResult> {
  // 1. Delegate decision to Module 1 (production-shape pipeline)
  const decision = await runRecoveryDecision(record.observable, options);

  // 2. Execute the FINAL governed action (never the raw proposal directly) in the simulator
  const simResult = simulateRecovery(
    record.observable,
    record.hidden,
    decision.final_action
  );

  // 3. Combine decision result with environment execution outcome
  return {
    decision,
    recovered: simResult.recovered,
    revenue_recovered: simResult.recovered ? record.observable.amount : 0,
    reward: simResult.reward,
    probability_used: simResult.probability_used,
  };
}
