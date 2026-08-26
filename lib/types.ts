/**
 * Revenue Recovery Autopilot - Core Type Definitions
 * 
 * ARCHITECTURAL DESIGN NOTE:
 * There is a strict boundary between AGENT-SAFE (Observable) data types
 * and EVALUATION-ONLY (Hidden Ground Truth) data types.
 * 
 * Future AI agents and scoring logic MUST ONLY import and operate on `ObservableTransaction`.
 * Evaluators, simulators, and dataset generation pipelines use `GroundTruthTransaction`
 * or `CombinedGeneratedRecord`.
 */

// ============================================================================
// Domain Enums & Value Types
// ============================================================================

export type PaymentMethod = 
  | 'upi'
  | 'card'
  | 'netbanking'
  | 'wallet';

export type PaymentStatus = 
  | 'failed'
  | 'processing'
  | 'success';

export type FailureReason = 
  | 'insufficient_funds'
  | 'authentication_failed'
  | 'network_timeout'
  | 'card_expired'
  | 'bank_server_down'
  | 'technical_error'
  | null;

export type SubscriptionStatus = 
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

export type DeviceType = 
  | 'mobile_android'
  | 'mobile_ios'
  | 'desktop_web'
  | 'mobile_web';

/**
 * RECOVERY ACTIONS
 * 
 * Interventions that an agent or strategy engine can select to attempt recovery.
 */
export type RecoveryAction = 
  | 'retry_now'
  | 'retry_later'
  | 'send_reminder'
  | 'request_payment_method_update'
  | 'escalate';

// ============================================================================
// Customer Profile Type
// ============================================================================

/**
 * Customer profile metadata used during transaction synthesis.
 */
export interface Customer {
  customer_id: string;
  customer_tenure_months: number;
  previous_transactions_count: number;
  previous_success_rate: number; // Float between 0.0 and 1.0
  average_transaction_value: number;
  days_since_last_payment: number;
  subscription_status: SubscriptionStatus;
}

// ============================================================================
// AGENT-SAFE / OBSERVABLE TYPES
// ============================================================================

/**
 * OBSERVABLE TRANSACTION FEATURE SET
 * 
 * ⚠️ AGENT-SAFE TYPE ⚠️
 * This interface contains ONLY feature fields visible to the recovery agent/scorer.
 * Under no circumstances should hidden ground truth probabilities or evaluation targets be added here.
 */
export interface ObservableTransaction {
  /** Unique ID for the payment transaction */
  transaction_id: string;
  
  /** Identifier of the customer making the transaction */
  customer_id: string;
  
  /** Transaction amount in smallest currency units or standard denomination */
  amount: number;
  
  /** ISO 4217 Currency Code (e.g. 'INR', 'USD') */
  currency: string;
  
  /** ISO 8601 Timestamp of transaction attempt */
  timestamp: string;
  
  /** Payment instrument used */
  payment_method: PaymentMethod;
  
  /** Status of the transaction attempt */
  payment_status: PaymentStatus;
  
  /** Categorized failure reason (null if success) */
  failure_reason: FailureReason;
  
  /** Sequence number of this payment attempt (1-indexed) */
  attempt_number: number;
  
  /** Customer tenure in months at time of transaction */
  customer_tenure_months: number;
  
  /** Historical count of transactions for this customer */
  previous_transactions_count: number;
  
  /** Historical success rate (0.0 to 1.0) */
  previous_success_rate: number;
  
  /** Historical average transaction value */
  average_transaction_value: number;
  
  /** Days elapsed since customer's previous payment */
  days_since_last_payment: number;
  
  /** Subscription state of the customer */
  subscription_status: SubscriptionStatus;
  
  /** Device type used during checkout */
  device_type: DeviceType;
  
  /** Whether the user completed the checkout funnel */
  checkout_completed: boolean;
}

// ============================================================================
// HIDDEN / EVALUATION-ONLY TYPES
// ============================================================================

/**
 * GROUND TRUTH EVALUATION DATA
 * 
 * 🛑 EVALUATION-ONLY / HIDDEN TYPE 🛑
 * Ground truth is action-dependent. Rather than storing a static outcome, this object
 * stores the hidden probability of success for each available recovery intervention.
 * 
 * The environment simulator uses these probabilities (and `noise_seed`) to evaluate
 * whatever action the agent chooses.
 * 
 * THESE FIELDS MUST NEVER BE EXPOSED TO AGENT / SCORING LOGIC.
 */
export interface GroundTruthTransaction {
  /** Hidden probability (0.0 to 1.0) of recovery success for each possible intervention */
  action_probabilities: Record<RecoveryAction, number>;
  
  /** Deterministic noise seed used during synthesis for reproducible stochastic evaluation */
  noise_seed: number;
}

/**
 * COMBINED GENERATED RECORD
 * 
 * 🛑 EVALUATION / PIPELINE ONLY 🛑
 * Internal dataset representation pairing observable features with hidden ground truth.
 * Used exclusively by dataset generator and offline evaluation harnesses.
 */
export interface CombinedGeneratedRecord {
  /** Publicly observable transaction features */
  observable: ObservableTransaction;
  
  /** Hidden ground-truth evaluation target */
  hidden: GroundTruthTransaction;
}
