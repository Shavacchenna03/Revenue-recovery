import { 
  ObservableTransaction, 
  RecoveryAction, 
  RecoveryDecisionResult, 
  RecoveryOrchestrationResult, 
  ExecutionResult,
  PaymentMethod,
  PaymentStatus,
  FailureReason,
  SubscriptionStatus,
  DeviceType
} from '../lib/types.js';

export interface ObservableTransactionDTO {
  transaction_id: string;
  customer_id: string;
  amount: number;
  currency: string;
  timestamp: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  failure_reason: FailureReason | null;
  attempt_number: number;
  customer_tenure_months: number;
  previous_transactions_count: number;
  previous_success_rate: number;
  average_transaction_value: number;
  days_since_last_payment: number;
  subscription_status: SubscriptionStatus;
  device_type: DeviceType;
  checkout_completed: boolean;
}

export interface AnalysisResponseDTO {
  transaction_id: string;
  observable_summary: {
    amount: number;
    currency: string;
    failure_reason: FailureReason | null;
    attempt_number: number;
    payment_method: PaymentMethod;
    subscription_status: SubscriptionStatus;
  };
  llm_diagnosis?: string | undefined;
  llm_confidence?: number | undefined;
  proposed_action: RecoveryAction;
  policy_engine: {
    decision: 'approved' | 'overridden';
    guardrail_id: string;
    reason: string;
  };
  final_action: RecoveryAction;
  execution: {
    provider: 'simulator' | 'razorpay';
    attempted: boolean;
    success: boolean;
    recovered?: boolean | undefined;
    revenue_recovered?: number | undefined;
    message: string;
    reference_id?: string | undefined;
    unsupported_action?: boolean | undefined;
  };
  used_llm_fallback: boolean;
  llm_fallback_reason?: string | undefined;
}

export interface ApiErrorDTO {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Serializes an ObservableTransaction into a safe DTO, ensuring NO hidden data fields are exposed.
 */
export function serializeObservableTransactionDTO(tx: ObservableTransaction): ObservableTransactionDTO {
  return {
    transaction_id: tx.transaction_id,
    customer_id: tx.customer_id,
    amount: tx.amount,
    currency: tx.currency,
    timestamp: tx.timestamp,
    payment_method: tx.payment_method,
    payment_status: tx.payment_status,
    failure_reason: tx.failure_reason,
    attempt_number: tx.attempt_number,
    customer_tenure_months: tx.customer_tenure_months,
    previous_transactions_count: tx.previous_transactions_count,
    previous_success_rate: tx.previous_success_rate,
    average_transaction_value: tx.average_transaction_value,
    days_since_last_payment: tx.days_since_last_payment,
    subscription_status: tx.subscription_status,
    device_type: tx.device_type,
    checkout_completed: tx.checkout_completed,
  };
}

/**
 * Serializes a recovery decision & execution result into a clean AnalysisResponseDTO.
 * 
 * ⚠️ ANTI-LEAKAGE GUARD ⚠️
 * Explicitly hand-picks fields to ensure hidden ground truth fields (action_probabilities, noise_seed)
 * NEVER reach the HTTP response payload.
 */
export function serializeAnalysisResponseDTO(
  tx: ObservableTransaction,
  decision: RecoveryDecisionResult,
  executionRes: ExecutionResult,
  simulatedOutcome?: RecoveryOrchestrationResult
): AnalysisResponseDTO {
  const dto: AnalysisResponseDTO = {
    transaction_id: tx.transaction_id,
    observable_summary: {
      amount: tx.amount,
      currency: tx.currency,
      failure_reason: tx.failure_reason,
      attempt_number: tx.attempt_number,
      payment_method: tx.payment_method,
      subscription_status: tx.subscription_status,
    },
    proposed_action: decision.proposed_action,
    policy_engine: {
      decision: decision.overridden ? 'overridden' : 'approved',
      guardrail_id: decision.guardrail_id,
      reason: decision.guardrail_reason,
    },
    final_action: decision.final_action,
    execution: {
      provider: executionRes.provider,
      attempted: executionRes.attempted,
      success: executionRes.success,
      message: executionRes.status_message,
    },
    used_llm_fallback: decision.used_llm_fallback,
  };

  if (decision.llm_diagnosis !== undefined) dto.llm_diagnosis = decision.llm_diagnosis;
  if (decision.llm_confidence !== undefined) dto.llm_confidence = decision.llm_confidence;
  if (decision.llm_fallback_reason !== undefined) dto.llm_fallback_reason = decision.llm_fallback_reason;

  if (executionRes.provider === 'simulator' && simulatedOutcome) {
    dto.execution.recovered = simulatedOutcome.recovered;
    dto.execution.revenue_recovered = simulatedOutcome.revenue_recovered;
  }
  if (executionRes.provider_reference_id !== undefined) {
    dto.execution.reference_id = executionRes.provider_reference_id;
  }
  if (executionRes.unsupported_action !== undefined) {
    dto.execution.unsupported_action = executionRes.unsupported_action;
  }

  return dto;
}
