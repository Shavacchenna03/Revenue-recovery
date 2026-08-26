import { Customer, SubscriptionStatus } from '../lib/types.js';
import { SeededRandom } from '../lib/random.js';

export const DEFAULT_NUM_CUSTOMERS = 2200;
export const DEFAULT_SEED = 42;

/**
 * Weighted Subscription Status Distribution:
 * - active: 70%
 * - past_due: 15%
 * - unpaid: 10%
 * - canceled: 5%
 */
const SUBSCRIPTION_STATUS_WEIGHTS: { status: SubscriptionStatus; weight: number }[] = [
  { status: 'active', weight: 0.70 },
  { status: 'past_due', weight: 0.15 },
  { status: 'unpaid', weight: 0.10 },
  { status: 'canceled', weight: 0.05 },
];

/**
 * Generates a synthetic customer population.
 * 
 * @param count Number of customer records to generate (default: 2200)
 * @param seed Seed for deterministic random number generation (default: 42)
 */
export function generateCustomers(
  count: number = DEFAULT_NUM_CUSTOMERS,
  seed: number = DEFAULT_SEED
): Customer[] {
  const rng = new SeededRandom(seed);
  const customers: Customer[] = [];

  const statusItems = SUBSCRIPTION_STATUS_WEIGHTS.map(s => s.status);
  const statusWeights = SUBSCRIPTION_STATUS_WEIGHTS.map(s => s.weight);

  for (let i = 0; i < count; i++) {
    const customer_id = `cust_${String(i + 1).padStart(5, '0')}`;

    // 1. Tenure Distribution Mixture:
    // - 20% New (<3 months: 0, 1, 2)
    // - 45% Established (3 to 12 months)
    // - 35% Loyal (13 to 60 months)
    const tenureCategoryRoll = rng.nextFloat();
    let customer_tenure_months: number;

    if (tenureCategoryRoll < 0.20) {
      // New (< 3 months)
      customer_tenure_months = rng.nextInt(0, 2);
    } else if (tenureCategoryRoll < 0.65) {
      // Established (3 to 12 months)
      customer_tenure_months = rng.nextInt(3, 12);
    } else {
      // Loyal (13 to 60 months)
      customer_tenure_months = rng.nextInt(13, 60);
    }

    // 2. Previous Transactions Count:
    // Correlated with tenure + noise
    const baseTxPerMonth = rng.nextNormal(2.2, 0.8);
    const positiveTxRate = Math.max(0.5, baseTxPerMonth);
    const expectedTx = Math.round(customer_tenure_months * positiveTxRate);
    const noise = rng.nextInt(-2, 4);
    const previous_transactions_count = Math.max(0, expectedTx + noise);

    // 3. Historical Success Rate & Successes:
    // Modeled with integer successes to ensure strict mathematical consistency
    let previous_success_rate: number;
    if (previous_transactions_count === 0) {
      // Default rate of 1.0 for new customers with zero prior history
      previous_success_rate = 1.0;
    } else {
      // Base customer quality factor (slightly higher for longer tenure, plus Gaussian noise)
      const tenureBonus = Math.min(0.1, (customer_tenure_months / 60) * 0.1);
      const rawQuality = rng.nextNormal(0.82 + tenureBonus, 0.10);
      const targetRate = Math.max(0.35, Math.min(1.0, rawQuality));
      
      const historical_successes = Math.min(
        previous_transactions_count,
        Math.max(0, Math.round(targetRate * previous_transactions_count))
      );
      previous_success_rate = historical_successes / previous_transactions_count;
    }

    // 4. Average Transaction Value (Right-skewed Log-Normal):
    // Target median around ₹2,000 (ln(2000) ~ 7.6) with long tail
    const logVal = rng.nextNormal(7.6, 0.55);
    const rawVal = Math.exp(logVal);
    // Clamp to minimum ₹100, round to integer INR
    const average_transaction_value = Math.max(100, Math.round(rawVal));

    // 5. Days Since Last Payment:
    // Active customers have lower days, plus noise
    const baseDays = rng.nextInt(1, 45);
    const tenureInertia = rng.nextInt(0, Math.floor(customer_tenure_months / 2));
    const days_since_last_payment = Math.max(0, baseDays + tenureInertia);

    // 6. Subscription Status (Weighted):
    const subscription_status = rng.choiceWeighted(statusItems, statusWeights);

    customers.push({
      customer_id,
      customer_tenure_months,
      previous_transactions_count,
      previous_success_rate,
      average_transaction_value,
      days_since_last_payment,
      subscription_status,
    });
  }

  return customers;
}
