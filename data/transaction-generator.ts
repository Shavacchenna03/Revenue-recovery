import { 
  Customer, 
  ObservableTransaction, 
  GroundTruthTransaction, 
  CombinedGeneratedRecord, 
  PaymentMethod, 
  PaymentStatus, 
  FailureReason, 
  SubscriptionStatus,
  DeviceType, 
  RecoveryAction 
} from '../lib/types.js';
import { SeededRandom } from '../lib/random.js';
import { generateCustomers, DEFAULT_NUM_CUSTOMERS } from './customer-generator.js';

export const DEFAULT_TRANSACTION_COUNT = 5000;
export const DEFAULT_SEED = 42;

/**
 * CONFIGURATION CONSTANTS FOR SIGMOID & GENERATION PROCESS
 * (Step 10c: Named constants config object with multi-feature logit adjustments)
 */
export const GENERATOR_CONFIG = {
  // Target transaction status mix
  TARGET_FAILURE_RATE: 0.36,

  // Failure reason weights among failed transactions
  FAILURE_REASON_WEIGHTS: [
    { reason: 'insufficient_funds' as FailureReason, weight: 0.25 },
    { reason: 'authentication_failed' as FailureReason, weight: 0.20 },
    { reason: 'network_timeout' as FailureReason, weight: 0.20 },
    { reason: 'card_expired' as FailureReason, weight: 0.15 },
    { reason: 'bank_server_down' as FailureReason, weight: 0.10 },
    { reason: 'technical_error' as FailureReason, weight: 0.10 },
  ],

  // Payment method weights
  PAYMENT_METHOD_WEIGHTS: [
    { method: 'upi' as PaymentMethod, weight: 0.45 },
    { method: 'card' as PaymentMethod, weight: 0.35 },
    { method: 'netbanking' as PaymentMethod, weight: 0.15 },
    { method: 'wallet' as PaymentMethod, weight: 0.05 },
  ],

  // Device type weights
  DEVICE_TYPE_WEIGHTS: [
    { device: 'mobile_android' as DeviceType, weight: 0.40 },
    { device: 'mobile_ios' as DeviceType, weight: 0.25 },
    { device: 'desktop_web' as DeviceType, weight: 0.20 },
    { device: 'mobile_web' as DeviceType, weight: 0.15 },
  ],

  // Attempt number weights for failed transactions
  FAILED_ATTEMPT_WEIGHTS: [
    { attempt: 1, weight: 0.65 },
    { attempt: 2, weight: 0.22 },
    { attempt: 3, weight: 0.09 },
    { attempt: 4, weight: 0.04 },
  ],

  // Latent model parameters (Calibrated noise for multi-feature conditional environment)
  HIDDEN_QUALITY_WEIGHT: 0.40,
  TRANSACTION_NOISE_STDDEV: 0.85,

  // Base action offsets (logit level)
  ACTION_BASE_OFFSETS: {
    retry_now: -0.1,
    retry_later: 0.3,
    send_reminder: -0.1,
    request_payment_method_update: -0.2,
    escalate: -0.5,
  } as Record<RecoveryAction, number>,

  // Failure reason logit adjustments for each action (Strongest signal)
  FAILURE_REASON_EFFECTS: {
    insufficient_funds: {
      retry_now: -1.3,
      retry_later: 1.6,
      send_reminder: 0.7,
      request_payment_method_update: 0.4,
      escalate: -0.7,
    },
    authentication_failed: {
      retry_now: -1.1,
      retry_later: 0.2,
      send_reminder: -0.3,
      request_payment_method_update: 1.9,
      escalate: -0.6,
    },
    network_timeout: {
      retry_now: 1.7,
      retry_later: 1.4,
      send_reminder: -0.5,
      request_payment_method_update: -0.8,
      escalate: -0.8,
    },
    card_expired: {
      retry_now: -2.2,
      retry_later: -1.6,
      send_reminder: -0.5,
      request_payment_method_update: 2.4,
      escalate: -0.5,
    },
    bank_server_down: {
      retry_now: 0.4,
      retry_later: 1.7,
      send_reminder: -0.4,
      request_payment_method_update: -0.6,
      escalate: 0.4,
    },
    technical_error: {
      retry_now: 0.4,
      retry_later: 0.9,
      send_reminder: -0.2,
      request_payment_method_update: -0.3,
      escalate: 0.6,
    },
    none: {
      retry_now: 0.4,
      retry_later: 0.5,
      send_reminder: 0.1,
      request_payment_method_update: 0.1,
      escalate: -0.3,
    },
  } as Record<string, Record<RecoveryAction, number>>,

  // Attempt number logit adjustments for each action (Step 1)
  ATTEMPT_NUMBER_EFFECTS: {
    1: { retry_now: 0.2, retry_later: 0.3, send_reminder: 0.0, request_payment_method_update: 0.0, escalate: -0.5 },
    2: { retry_now: -0.2, retry_later: 0.0, send_reminder: 0.1, request_payment_method_update: 0.1, escalate: -0.2 },
    3: { retry_now: -0.7, retry_later: -0.5, send_reminder: 0.2, request_payment_method_update: 0.3, escalate: 0.4 },
    4: { retry_now: -1.4, retry_later: -1.2, send_reminder: 0.3, request_payment_method_update: 0.5, escalate: 1.1 },
  } as Record<number, Record<RecoveryAction, number>>,

  // Payment method logit adjustments for each action (Step 2)
  PAYMENT_METHOD_EFFECTS: {
    card: { retry_now: -0.2, retry_later: 0.0, send_reminder: -0.1, request_payment_method_update: 1.2, escalate: 0.0 },
    upi: { retry_now: 0.5, retry_later: 0.2, send_reminder: 0.4, request_payment_method_update: -0.6, escalate: -0.2 },
    netbanking: { retry_now: -0.1, retry_later: 0.6, send_reminder: 0.1, request_payment_method_update: -0.3, escalate: 0.1 },
    wallet: { retry_now: 0.5, retry_later: 0.1, send_reminder: 0.2, request_payment_method_update: -0.4, escalate: -0.2 },
  } as Record<PaymentMethod, Record<RecoveryAction, number>>,

  // Subscription status logit adjustments for each action (Step 3)
  SUBSCRIPTION_STATUS_EFFECTS: {
    active: { retry_now: 0.1, retry_later: 0.1, send_reminder: 0.0, request_payment_method_update: 0.0, escalate: -0.2 },
    past_due: { retry_now: -0.2, retry_later: 0.1, send_reminder: 0.6, request_payment_method_update: 0.4, escalate: 0.1 },
    unpaid: { retry_now: -0.5, retry_later: -0.2, send_reminder: 0.8, request_payment_method_update: 0.9, escalate: 0.3 },
    canceled: { retry_now: -0.9, retry_later: -0.8, send_reminder: -0.3, request_payment_method_update: 0.6, escalate: 0.8 },
  } as Record<SubscriptionStatus, Record<RecoveryAction, number>>,
};

/**
 * Deterministic hash algorithm (FNV-1a 32-bit) to derive per-transaction noise_seed
 */
export function deriveNoiseSeed(globalSeed: number, transactionId: string): number {
  let hash = 2166136261 >>> 0;
  const str = `${globalSeed}_${transactionId}`;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * Standard Sigmoid activation function mapping real logit score to probability (0, 1)
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Generates a synthetic transaction dataset containing observable features and hidden evaluation ground truth.
 * 
 * @param customers Customer population array
 * @param count Number of transaction records to generate (default: 5000)
 * @param seed Global seed for deterministic PRNG (default: 42)
 */
export function generateTransactions(
  customers: Customer[] = generateCustomers(DEFAULT_NUM_CUSTOMERS, DEFAULT_SEED),
  count: number = DEFAULT_TRANSACTION_COUNT,
  seed: number = DEFAULT_SEED
): CombinedGeneratedRecord[] {
  const rng = new SeededRandom(seed);
  const records: CombinedGeneratedRecord[] = [];

  // Step 10b: Generate hidden customer quality factors independently per customer
  // (Not derived from previous_success_rate)
  const customerHiddenQualityMap = new Map<string, number>();
  for (const customer of customers) {
    const tenureFactor = (customer.customer_tenure_months / 60 - 0.5) * 0.4;
    const independentDraw = rng.nextNormal(0, 1.0);
    const hiddenQuality = Math.max(-2.5, Math.min(2.5, independentDraw + tenureFactor));
    customerHiddenQualityMap.set(customer.customer_id, hiddenQuality);
  }

  // Pre-calculate customer selection weights (more-tenured / higher-tx customer favored)
  const customerWeights = customers.map(c => {
    const tenureWeight = Math.sqrt(c.customer_tenure_months + 1);
    const txWeight = 1 + c.previous_transactions_count / 10;
    return tenureWeight * txWeight;
  });

  const failureReasons = GENERATOR_CONFIG.FAILURE_REASON_WEIGHTS.map(f => f.reason);
  const failureWeights = GENERATOR_CONFIG.FAILURE_REASON_WEIGHTS.map(f => f.weight);

  const methods = GENERATOR_CONFIG.PAYMENT_METHOD_WEIGHTS.map(m => m.method);
  const methodWeights = GENERATOR_CONFIG.PAYMENT_METHOD_WEIGHTS.map(m => m.weight);

  const devices = GENERATOR_CONFIG.DEVICE_TYPE_WEIGHTS.map(d => d.device);
  const deviceWeights = GENERATOR_CONFIG.DEVICE_TYPE_WEIGHTS.map(d => d.weight);

  const attemptNums = GENERATOR_CONFIG.FAILED_ATTEMPT_WEIGHTS.map(a => a.attempt);
  const attemptWeights = GENERATOR_CONFIG.FAILED_ATTEMPT_WEIGHTS.map(a => a.weight);

  // Time range: 2026-01-01 to 2026-08-25
  const startTimeMs = new Date('2026-01-01T00:00:00.000Z').getTime();
  const endTimeMs = new Date('2026-08-25T23:59:59.000Z').getTime();
  const timeSpanMs = endTimeMs - startTimeMs;

  const actions: RecoveryAction[] = [
    'retry_now',
    'retry_later',
    'send_reminder',
    'request_payment_method_update',
    'escalate',
  ];

  for (let i = 0; i < count; i++) {
    const transaction_id = `txn_${String(i + 1).padStart(6, '0')}`;

    // Step 3: Weighted customer selection
    const customer = rng.choiceWeighted(customers, customerWeights);
    const hiddenQuality = customerHiddenQualityMap.get(customer.customer_id) ?? 0;

    // Step 6: Payment status generation (~36% failed, ~64% success)
    const isFailed = rng.nextFloat() < GENERATOR_CONFIG.TARGET_FAILURE_RATE;
    const payment_status: PaymentStatus = isFailed ? 'failed' : 'success';

    // Step 2 & 6: Failure reason
    let failure_reason: FailureReason = null;
    if (isFailed) {
      failure_reason = rng.choiceWeighted(failureReasons, failureWeights);
    }

    // Step 7: Attempt number
    let attempt_number: number;
    if (isFailed) {
      attempt_number = rng.choiceWeighted(attemptNums, attemptWeights);
    } else {
      attempt_number = rng.nextFloat() < 0.95 ? 1 : 2;
    }

    // Step 4: Transaction amount (multiplicative log-normal noise around customer ATV)
    const logNoise = rng.nextNormal(0, 0.25);
    const amountMult = Math.exp(logNoise);
    const rawAmount = customer.average_transaction_value * amountMult;
    const amount = Math.max(100, Math.round(rawAmount));

    // Step 5: Payment method
    const payment_method = rng.choiceWeighted(methods, methodWeights);

    // Step 8: Timestamp
    const randomTimeOffset = Math.floor(rng.nextFloat() * timeSpanMs);
    const timestamp = new Date(startTimeMs + randomTimeOffset).toISOString();

    // Step 9: Device type
    const device_type = rng.choiceWeighted(devices, deviceWeights);

    // Step 1: Observable Transaction object
    const observable: ObservableTransaction = {
      transaction_id,
      customer_id: customer.customer_id,
      amount,
      currency: 'INR',
      timestamp,
      payment_method,
      payment_status,
      failure_reason,
      attempt_number,
      customer_tenure_months: customer.customer_tenure_months,
      previous_transactions_count: customer.previous_transactions_count,
      previous_success_rate: customer.previous_success_rate,
      average_transaction_value: customer.average_transaction_value,
      days_since_last_payment: customer.days_since_last_payment,
      subscription_status: customer.subscription_status,
      device_type,
      checkout_completed: true,
    };

    // Multi-feature Logit Calculation
    const action_probabilities: Record<RecoveryAction, number> = {} as Record<RecoveryAction, number>;
    const reasonKey = failure_reason ?? 'none';
    const reasonEffects = GENERATOR_CONFIG.FAILURE_REASON_EFFECTS[reasonKey] ?? GENERATOR_CONFIG.FAILURE_REASON_EFFECTS['none']!;

    const attemptEffects = GENERATOR_CONFIG.ATTEMPT_NUMBER_EFFECTS[attempt_number] ?? GENERATOR_CONFIG.ATTEMPT_NUMBER_EFFECTS[1]!;
    const methodEffects = GENERATOR_CONFIG.PAYMENT_METHOD_EFFECTS[payment_method] ?? GENERATOR_CONFIG.PAYMENT_METHOD_EFFECTS['card']!;
    const subEffects = GENERATOR_CONFIG.SUBSCRIPTION_STATUS_EFFECTS[customer.subscription_status] ?? GENERATOR_CONFIG.SUBSCRIPTION_STATUS_EFFECTS['active']!;

    // Step 4: Customer history as weak signals
    const historySignal = 
      (0.30 * (customer.previous_success_rate - 0.70)) +
      (0.20 * (Math.min(customer.previous_transactions_count, 30) / 30 - 0.5)) +
      (0.25 * (customer.customer_tenure_months / 60 - 0.5)) -
      (0.30 * (Math.min(customer.days_since_last_payment, 90) / 90));

    // Step 5: Amount as a weak business-value signal
    let amountEscalateBonus = 0;
    let amountRetryBonus = 0;
    if (amount > 5000) {
      amountEscalateBonus = 0.4;
    } else if (amount < 1000) {
      amountRetryBonus = 0.3;
    }

    // Transaction-level stochastic environment noise
    const txnNoise = rng.nextNormal(0, GENERATOR_CONFIG.TRANSACTION_NOISE_STDDEV);

    for (const act of actions) {
      const baseOffset = GENERATOR_CONFIG.ACTION_BASE_OFFSETS[act];
      const reasonEffect = reasonEffects[act] ?? 0;
      const attemptEffect = attemptEffects[act] ?? 0;
      const methodEffect = methodEffects[act] ?? 0;
      const subEffect = subEffects[act] ?? 0;

      let amtEffect = 0;
      if (act === 'escalate') amtEffect = amountEscalateBonus;
      if (act === 'retry_now' || act === 'send_reminder') amtEffect = amountRetryBonus;

      const actionNoise = rng.nextNormal(0, 0.35);

      const logitScore = baseOffset + 
        (GENERATOR_CONFIG.HIDDEN_QUALITY_WEIGHT * hiddenQuality) + 
        reasonEffect + 
        attemptEffect + 
        methodEffect + 
        subEffect + 
        historySignal + 
        amtEffect + 
        txnNoise + 
        actionNoise;

      const prob = sigmoid(logitScore);
      action_probabilities[act] = Number(prob.toFixed(4));
    }

    // Step 10d: Derived deterministic noise_seed per transaction
    const noise_seed = deriveNoiseSeed(seed, transaction_id);

    const hidden: GroundTruthTransaction = {
      action_probabilities,
      noise_seed,
    };

    records.push({
      observable,
      hidden,
    });
  }

  return records;
}
