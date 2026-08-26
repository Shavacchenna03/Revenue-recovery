import { 
  ObservableTransaction, 
  GroundTruthTransaction, 
  RecoveryAction, 
  RecoveryResult 
} from './types.js';
import { SeededRandom } from './random.js';

/**
 * Deterministically derives an action-specific PRNG seed from the transaction's noise_seed and action.
 * 
 * @param noiseSeed Transaction noise seed from GroundTruthTransaction
 * @param action Selected RecoveryAction
 * @returns 32-bit unsigned integer seed
 */
export function deriveActionSeed(noiseSeed: number, action: RecoveryAction): number {
  let hash = 2166136261 >>> 0;
  const str = `${noiseSeed}_${action}`;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * RECOVERY ENVIRONMENT SIMULATOR (Evaluation Infrastructure)
 * 
 * 🛑 EVALUATION-ONLY COMPONENT 🛑
 * This simulator is evaluation infrastructure and must NEVER be imported into agent/policy code.
 * It consumes hidden ground-truth action probabilities to deterministically evaluate intervention decisions.
 */
export class RecoveryEnvironment {
  /**
   * Simulates the outcome of executing a RecoveryAction on a failed/at-risk payment transaction.
   * 
   * @param observable Publicly visible ObservableTransaction
   * @param hidden Hidden GroundTruthTransaction containing action probabilities and noise seed
   * @param action Selected RecoveryAction intervention
   * @returns RecoveryResult object containing outcome, reward, and evaluation metadata
   */
  public simulateRecovery(
    observable: ObservableTransaction,
    hidden: GroundTruthTransaction,
    action: RecoveryAction
  ): RecoveryResult {
    // 1. Safety check for supported recovery actions
    const validActions: Set<RecoveryAction> = new Set([
      'retry_now',
      'retry_later',
      'send_reminder',
      'request_payment_method_update',
      'escalate',
    ]);
    if (!validActions.has(action)) {
      throw new Error(`Unsupported or invalid RecoveryAction: "${String(action)}"`);
    }

    // 2. Extract and validate the target action probability
    const prob = hidden.action_probabilities?.[action];
    if (typeof prob !== 'number' || Number.isNaN(prob) || prob < 0 || prob > 1) {
      throw new Error(
        `Invalid or missing probability for action "${action}": ${prob}. Probability must be a number in [0, 1].`
      );
    }

    // 3. Derive action-specific deterministic PRNG seed
    const actionSeed = deriveActionSeed(hidden.noise_seed, action);
    const rng = new SeededRandom(actionSeed);

    // 4. Sample stochastic outcome deterministically
    const roll = rng.nextFloat();
    const recovered = roll < prob;

    // 5. Calculate explicit evaluation reward (+1 for recovery success, 0 for failure)
    const reward = recovered ? 1 : 0;

    return {
      transaction_id: observable.transaction_id,
      action,
      recovered,
      probability_used: prob,
      reward,
      noise_seed: hidden.noise_seed,
    };
  }
}

// Global singleton helper export
const defaultEnv = new RecoveryEnvironment();

/**
 * Convenience function for simulating recovery outcome.
 */
export function simulateRecovery(
  observable: ObservableTransaction,
  hidden: GroundTruthTransaction,
  action: RecoveryAction
): RecoveryResult {
  return defaultEnv.simulateRecovery(observable, hidden, action);
}
