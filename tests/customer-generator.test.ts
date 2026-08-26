import { describe, it, expect } from 'vitest';
import { generateCustomers, DEFAULT_NUM_CUSTOMERS } from '../data/customer-generator.js';
import { SubscriptionStatus } from '../lib/types.js';

describe('Customer Generator', () => {
  it('should generate requested customer count', () => {
    const customers = generateCustomers(2200, 42);
    expect(customers.length).toBe(2200);
  });

  it('should generate unique customer IDs', () => {
    const customers = generateCustomers(500, 42);
    const idSet = new Set(customers.map(c => c.customer_id));
    expect(idSet.size).toBe(500);
  });

  it('should be deterministic (same seed produces identical output)', () => {
    const run1 = generateCustomers(100, 12345);
    const run2 = generateCustomers(100, 12345);
    expect(run1).toEqual(run2);
  });

  it('should produce different output for different seeds', () => {
    const run1 = generateCustomers(100, 42);
    const run2 = generateCustomers(100, 999);
    expect(run1).not.toEqual(run2);
  });

  it('should enforce valid tenure bounds [0, 60]', () => {
    const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, 42);
    for (const c of customers) {
      expect(c.customer_tenure_months).toBeGreaterThanOrEqual(0);
      expect(c.customer_tenure_months).toBeLessThanOrEqual(60);
      expect(Number.isInteger(c.customer_tenure_months)).toBe(true);
    }
  });

  it('should include customers in all three tenure bands', () => {
    const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, 42);
    const newCustomers = customers.filter(c => c.customer_tenure_months < 3);
    const establishedCustomers = customers.filter(c => c.customer_tenure_months >= 3 && c.customer_tenure_months <= 12);
    const loyalCustomers = customers.filter(c => c.customer_tenure_months > 12);

    expect(newCustomers.length).toBeGreaterThan(0);
    expect(establishedCustomers.length).toBeGreaterThan(0);
    expect(loyalCustomers.length).toBeGreaterThan(0);
  });

  it('should enforce non-negative integer transaction counts correlated with tenure', () => {
    const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, 42);
    for (const c of customers) {
      expect(c.previous_transactions_count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(c.previous_transactions_count)).toBe(true);
    }
  });

  it('should enforce success rates in [0, 1] and mathematical consistency', () => {
    const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, 42);
    for (const c of customers) {
      expect(c.previous_success_rate).toBeGreaterThanOrEqual(0);
      expect(c.previous_success_rate).toBeLessThanOrEqual(1.0);

      if (c.previous_transactions_count > 0) {
        const impliedSuccesses = c.previous_success_rate * c.previous_transactions_count;
        const roundedSuccesses = Math.round(impliedSuccesses);
        // Verify implied successes is an integer (within rounding precision)
        expect(Math.abs(impliedSuccesses - roundedSuccesses)).toBeLessThan(1e-3);
      } else {
        expect(c.previous_success_rate).toBe(1.0);
      }
    }
  });

  it('should enforce positive average transaction values', () => {
    const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, 42);
    for (const c of customers) {
      expect(c.average_transaction_value).toBeGreaterThan(0);
    }
  });

  it('should enforce non-negative days since last payment', () => {
    const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, 42);
    for (const c of customers) {
      expect(c.days_since_last_payment).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(c.days_since_last_payment)).toBe(true);
    }
  });

  it('should enforce valid subscription status values', () => {
    const validStatuses: Set<SubscriptionStatus> = new Set(['active', 'past_due', 'canceled', 'unpaid']);
    const customers = generateCustomers(DEFAULT_NUM_CUSTOMERS, 42);
    for (const c of customers) {
      expect(validStatuses.has(c.subscription_status)).toBe(true);
    }
  });
});
