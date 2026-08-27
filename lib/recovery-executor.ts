import { 
  ObservableTransaction, 
  RecoveryAction, 
  GroundTruthTransaction, 
  ExecutionResult, 
  RecoveryExecutor 
} from './types.js';
import { simulateRecovery } from './environment.js';
import { RazorpayExecutionAdapter, RazorpayAdapterOptions } from './razorpay-adapter.js';

/**
 * Simulator Implementation of RecoveryExecutor.
 * Wraps the local synthetic RecoveryEnvironment simulator.
 */
export class SimulatorRecoveryExecutor implements RecoveryExecutor {
  public readonly providerName = 'simulator' as const;

  public async execute(
    transaction: ObservableTransaction,
    action: RecoveryAction,
    hidden?: GroundTruthTransaction
  ): Promise<ExecutionResult> {
    if (!hidden) {
      throw new Error('SimulatorRecoveryExecutor requires hidden GroundTruthTransaction to simulate recovery.');
    }

    const simResult = simulateRecovery(transaction, hidden, action);

    return {
      success: simResult.recovered,
      provider: 'simulator',
      action,
      status_message: simResult.recovered
        ? `Simulated recovery succeeded for transaction ${transaction.transaction_id}.`
        : `Simulated recovery failed for transaction ${transaction.transaction_id}.`,
      details: {
        probability_used: simResult.probability_used,
        reward: simResult.reward,
        noise_seed: simResult.noise_seed,
      },
    };
  }
}

/**
 * Razorpay Implementation of RecoveryExecutor.
 * Wraps the RazorpayExecutionAdapter for payment provider execution.
 */
export class RazorpayRecoveryExecutor implements RecoveryExecutor {
  public readonly providerName = 'razorpay' as const;
  private adapter: RazorpayExecutionAdapter;

  constructor(options?: RazorpayAdapterOptions) {
    this.adapter = new RazorpayExecutionAdapter(options);
  }

  public async execute(
    transaction: ObservableTransaction,
    action: RecoveryAction
  ): Promise<ExecutionResult> {
    return this.adapter.executeAction(transaction, action);
  }
}
