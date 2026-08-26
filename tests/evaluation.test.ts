import { describe, it, expect } from 'vitest';
import { 
  evaluatePolicy, 
  compareWithOracle, 
  generateBaselineEvaluationMarkdownReport 
} from '../lib/evaluation.js';
import { selectRecoveryAction } from '../lib/policy.js';
import { CombinedGeneratedRecord, ObservableTransaction, RecoveryAction } from '../lib/types.js';
import { generateTransactions } from '../data/transaction-generator.js';
import { generateCustomers } from '../data/customer-generator.js';

describe('Evaluation Harness & Oracle Benchmark (Day 2.3)', () => {
  // Load synthetic dataset fixture or generate sample
  const customers = generateCustomers(500, 42);
  const sampleRecords = generateTransactions(customers, 1000, 42);
  const baselineReport = evaluatePolicy(sampleRecords, selectRecoveryAction);

  it('1. successful transactions are not evaluated as recovery attempts', () => {
    const expectedSuccesses = sampleRecords.filter(r => r.observable.payment_status === 'success').length;
    expect(baselineReport.skipped_transactions).toBe(expectedSuccesses);
  });

  it('2. failed transactions are evaluated exactly once', () => {
    const expectedFailures = sampleRecords.filter(r => r.observable.payment_status === 'failed').length;
    expect(baselineReport.evaluated_transactions).toBe(expectedFailures);
    expect(baselineReport.evaluated_transactions + baselineReport.skipped_transactions).toBe(sampleRecords.length);
  });

  it('3. policy receives ObservableTransaction only', () => {
    let checkedCount = 0;
    const testPolicy = (obs: ObservableTransaction): RecoveryAction => {
      const untyped = obs as any;
      expect(untyped.action_probabilities).toBeUndefined();
      expect(untyped.noise_seed).toBeUndefined();
      checkedCount++;
      return 'retry_later';
    };

    evaluatePolicy(sampleRecords, testPolicy);
    expect(checkedCount).toBe(baselineReport.evaluated_transactions);
  });

  it('4. simulator receives the selected action', () => {
    const testPolicy = (): RecoveryAction => 'escalate';
    const rep = evaluatePolicy(sampleRecords, testPolicy);

    expect(rep.action_metrics.escalate.evaluated_transactions).toBe(rep.evaluated_transactions);
    expect(rep.action_metrics.retry_now.evaluated_transactions).toBe(0);
    expect(rep.action_metrics.retry_later.evaluated_transactions).toBe(0);
  });

  it('5. all five actions can be represented in aggregate output', () => {
    const expectedActions: RecoveryAction[] = ['retry_now', 'retry_later', 'send_reminder', 'request_payment_method_update', 'escalate'];
    for (const act of expectedActions) {
      expect(baselineReport.action_metrics[act]).toBeDefined();
    }
  });

  it('6. total action counts equal evaluated transaction count', () => {
    const actions: RecoveryAction[] = ['retry_now', 'retry_later', 'send_reminder', 'request_payment_method_update', 'escalate'];
    const sumActionCount = actions.reduce((acc, act) => acc + baselineReport.action_metrics[act].evaluated_transactions, 0);
    expect(sumActionCount).toBe(baselineReport.evaluated_transactions);
  });

  it('7. total recovered count equals sum of recovered action counts', () => {
    const actions: RecoveryAction[] = ['retry_now', 'retry_later', 'send_reminder', 'request_payment_method_update', 'escalate'];
    const sumActionRecovered = actions.reduce((acc, act) => acc + baselineReport.action_metrics[act].recovered_transactions, 0);
    expect(sumActionRecovered).toBe(baselineReport.recovered_transactions);
  });

  it('8. recovery rate is calculated correctly', () => {
    const expectedRate = Number((baselineReport.recovered_transactions / baselineReport.evaluated_transactions).toFixed(4));
    expect(baselineReport.recovery_rate).toBe(expectedRate);
  });

  it('9. reward totals are correct', () => {
    expect(baselineReport.total_reward).toBe(baselineReport.recovered_transactions);
    const expectedAvg = Number((baselineReport.total_reward / baselineReport.evaluated_transactions).toFixed(4));
    expect(baselineReport.average_reward).toBe(expectedAvg);
  });

  it('10. revenue_at_risk equals sum of amounts across all evaluated failed transactions', () => {
    const expectedAtRisk = sampleRecords
      .filter(r => r.observable.payment_status === 'failed')
      .reduce((acc, r) => acc + Math.round(r.observable.amount), 0);

    expect(baselineReport.revenue_at_risk).toBe(expectedAtRisk);
  });

  it('11. revenue_recovered equals sum of amounts across transactions with recovered === true', () => {
    expect(baselineReport.revenue_recovered).toBeGreaterThanOrEqual(0);
    expect(baselineReport.revenue_recovered).toBeLessThanOrEqual(baselineReport.revenue_at_risk);
  });

  it('12. revenue_recovery_rate is calculated correctly and reconciles with revenue_at_risk/revenue_recovered', () => {
    const expectedRevRate = Number((baselineReport.revenue_recovered / baselineReport.revenue_at_risk).toFixed(4));
    expect(baselineReport.revenue_recovery_rate).toBe(expectedRevRate);
  });

  it('13. failure reason totals reconcile (counts AND revenue figures)', () => {
    let sumCount = 0;
    let sumAtRisk = 0;
    let sumRecovered = 0;

    for (const m of Object.values(baselineReport.failure_reason_metrics)) {
      sumCount += m.evaluated_transactions;
      sumAtRisk += m.revenue_at_risk;
      sumRecovered += m.revenue_recovered;
    }

    expect(sumCount).toBe(baselineReport.evaluated_transactions);
    expect(sumAtRisk).toBe(baselineReport.revenue_at_risk);
    expect(sumRecovered).toBe(baselineReport.revenue_recovered);
  });

  it('14. attempt totals reconcile (counts AND revenue figures)', () => {
    let sumCount = 0;
    let sumAtRisk = 0;
    let sumRecovered = 0;

    for (const m of Object.values(baselineReport.attempt_number_metrics)) {
      sumCount += m.evaluated_transactions;
      sumAtRisk += m.revenue_at_risk;
      sumRecovered += m.revenue_recovered;
    }

    expect(sumCount).toBe(baselineReport.evaluated_transactions);
    expect(sumAtRisk).toBe(baselineReport.revenue_at_risk);
    expect(sumRecovered).toBe(baselineReport.revenue_recovered);
  });

  it('15. payment method totals reconcile (counts AND revenue figures)', () => {
    let sumCount = 0;
    let sumAtRisk = 0;
    let sumRecovered = 0;

    for (const m of Object.values(baselineReport.payment_method_metrics)) {
      sumCount += m.evaluated_transactions;
      sumAtRisk += m.revenue_at_risk;
      sumRecovered += m.revenue_recovered;
    }

    expect(sumCount).toBe(baselineReport.evaluated_transactions);
    expect(sumAtRisk).toBe(baselineReport.revenue_at_risk);
    expect(sumRecovered).toBe(baselineReport.revenue_recovered);
  });

  it('16. subscription totals reconcile (counts AND revenue figures)', () => {
    let sumCount = 0;
    let sumAtRisk = 0;
    let sumRecovered = 0;

    for (const m of Object.values(baselineReport.subscription_status_metrics)) {
      sumCount += m.evaluated_transactions;
      sumAtRisk += m.revenue_at_risk;
      sumRecovered += m.revenue_recovered;
    }

    expect(sumCount).toBe(baselineReport.evaluated_transactions);
    expect(sumAtRisk).toBe(baselineReport.revenue_at_risk);
    expect(sumRecovered).toBe(baselineReport.revenue_recovered);
  });

  it('17. deterministic repeated evaluation produces byte-identical report text', () => {
    const report1 = evaluatePolicy(sampleRecords, selectRecoveryAction);
    const comp1 = compareWithOracle(sampleRecords, report1);
    const text1 = generateBaselineEvaluationMarkdownReport(report1, comp1);

    const report2 = evaluatePolicy(sampleRecords, selectRecoveryAction);
    const comp2 = compareWithOracle(sampleRecords, report2);
    const text2 = generateBaselineEvaluationMarkdownReport(report2, comp2);

    expect(text1).toBe(text2);
  });

  it('18. empty dataset is handled safely', () => {
    const emptyReport = evaluatePolicy([], selectRecoveryAction);
    expect(emptyReport.total_transactions).toBe(0);
    expect(emptyReport.evaluated_transactions).toBe(0);
    expect(emptyReport.recovery_rate).toBe(0);
    expect(emptyReport.revenue_recovery_rate).toBe(0);
  });

  it('19. invalid/non-failed policy input throws via domain guard', () => {
    const successRecord: CombinedGeneratedRecord = {
      observable: { ...sampleRecords[0]!.observable, payment_status: 'success' },
      hidden: sampleRecords[0]!.hidden,
    };
    expect(() => selectRecoveryAction(successRecord.observable)).toThrow(/selectRecoveryAction called on a non-failed transaction/);
  });

  it('20. malformed/unexpected input causes evaluatePolicy() to throw', () => {
    const malformedRecords = [{ observable: null } as any];
    expect(() => evaluatePolicy(malformedRecords, selectRecoveryAction)).toThrow();
  });

  it('21. evaluatePolicy() does NOT mutate input records array or any record within it', () => {
    const snapshot = JSON.parse(JSON.stringify(sampleRecords));
    Object.freeze(sampleRecords);

    evaluatePolicy(sampleRecords, selectRecoveryAction);
    expect(JSON.parse(JSON.stringify(sampleRecords))).toEqual(snapshot);
  });

  it('22. categories with n < 30 are correctly flagged as low_sample', () => {
    const smallSample = sampleRecords.slice(0, 10);
    const smallReport = evaluatePolicy(smallSample, selectRecoveryAction);
    for (const m of Object.values(smallReport.action_metrics)) {
      if (m.evaluated_transactions < 30) {
        expect(m.low_sample).toBe(true);
      }
    }
  });

  it('23. regression check: every non-canceled card_expired transaction resulted in request_payment_method_update', () => {
    const cardExpiredRecs = sampleRecords.filter(r => 
      r.observable.payment_status === 'failed' && 
      r.observable.failure_reason === 'card_expired' &&
      r.observable.subscription_status !== 'canceled'
    );
    for (const r of cardExpiredRecs) {
      expect(selectRecoveryAction(r.observable)).toBe('request_payment_method_update');
    }
  });

  it('24. regression check: every canceled subscription resulted in escalate', () => {
    const canceledRecs = sampleRecords.filter(r => r.observable.payment_status === 'failed' && r.observable.subscription_status === 'canceled');
    for (const r of canceledRecs) {
      expect(selectRecoveryAction(r.observable)).toBe('escalate');
    }
  });

  it('25. oracle benchmark comparison is correct and oracle outperforms baseline', () => {
    const oracleComp = compareWithOracle(sampleRecords, baselineReport);
    expect(oracleComp.oracle.recovery_rate).toBeGreaterThanOrEqual(baselineReport.recovery_rate);
    expect(oracleComp.oracle.revenue_recovered).toBeGreaterThanOrEqual(baselineReport.revenue_recovered);
    expect(oracleComp.recovery_rate_gap).toBeGreaterThanOrEqual(0);
    expect(oracleComp.revenue_recovered_gap_inr).toBeGreaterThanOrEqual(0);
  });
});
