import { 
  ObservableTransaction, 
  GroundTruthTransaction, 
  CombinedGeneratedRecord, 
  RecoveryAction, 
  RecoveryResult 
} from './types.js';
import { simulateRecovery } from './environment.js';

// ============================================================================
// EVALUATION METRICS INTERFACES
// ============================================================================

export interface MetricBreakdown {
  /** Identifier/name of the category or action */
  name: string;
  
  /** Number of evaluated failed transactions in this category (n) */
  evaluated_transactions: number;
  
  /** Number of transactions successfully recovered */
  recovered_transactions: number;
  
  /** Count-based recovery success rate (0.0 to 1.0) */
  recovery_rate: number;
  
  /** Total evaluation reward earned (+1 per recovery) */
  total_reward: number;
  
  /** Sum of transaction amounts at risk (in INR) */
  revenue_at_risk: number;
  
  /** Sum of transaction amounts successfully recovered (in INR) */
  revenue_recovered: number;
  
  /** Monetary recovery rate (revenue_recovered / revenue_at_risk) */
  revenue_recovery_rate: number;
  
  /** Flag indicating low sample size (true if n < 30) */
  low_sample: boolean;
  
  /** Flag indicating divergence between revenue_recovery_rate and recovery_rate (> 0.05 absolute diff) */
  rate_divergence: boolean;
}

export type ActionMetric = MetricBreakdown & { action: RecoveryAction };

export interface EvaluationReport {
  /** Total transactions in the loaded dataset */
  total_transactions: number;
  
  /** Failed/at-risk transactions evaluated by the policy */
  evaluated_transactions: number;
  
  /** Successful background transactions skipped */
  skipped_transactions: number;
  
  /** Total count of recovered transactions */
  recovered_transactions: number;
  
  /** Count-based recovery rate across evaluated transactions (0.0 to 1.0) */
  recovery_rate: number;
  
  /** Total evaluation reward points earned */
  total_reward: number;
  
  /** Average reward per evaluated transaction */
  average_reward: number;
  
  /** Total revenue at risk across evaluated failed transactions (INR) */
  revenue_at_risk: number;
  
  /** Total revenue recovered (INR) */
  revenue_recovered: number;
  
  /** Overall revenue recovery rate (revenue_recovered / revenue_at_risk) */
  revenue_recovery_rate: number;
  
  /** Metrics broken down by selected RecoveryAction */
  action_metrics: Record<RecoveryAction, ActionMetric>;
  
  /** Metrics broken down by failure reason */
  failure_reason_metrics: Record<string, MetricBreakdown>;
  
  /** Metrics broken down by attempt number (1..4) */
  attempt_number_metrics: Record<number, MetricBreakdown>;
  
  /** Metrics broken down by payment method */
  payment_method_metrics: Record<string, MetricBreakdown>;
  
  /** Metrics broken down by subscription status */
  subscription_status_metrics: Record<string, MetricBreakdown>;
}

export interface OracleBenchmarkComparison {
  baseline: EvaluationReport;
  oracle: EvaluationReport;
  
  /** Count-based recovery rate difference (oracle.recovery_rate - baseline.recovery_rate) */
  recovery_rate_gap: number;
  
  /** Reward point difference (oracle.total_reward - baseline.total_reward) */
  total_reward_gap: number;
  
  /** Revenue recovered difference in INR (oracle.revenue_recovered - baseline.revenue_recovered) */
  revenue_recovered_gap_inr: number;
  
  /** Revenue recovery rate difference (oracle.revenue_recovery_rate - baseline.revenue_recovery_rate) */
  revenue_recovery_rate_gap: number;
}

// ============================================================================
// HELPER CALCULATOR FOR METRIC BREAKDOWNS
// ============================================================================

function computeBreakdown(name: string, results: { observable: ObservableTransaction; result: RecoveryResult }[]): MetricBreakdown {
  const n = results.length;
  if (n === 0) {
    return {
      name,
      evaluated_transactions: 0,
      recovered_transactions: 0,
      recovery_rate: 0,
      total_reward: 0,
      revenue_at_risk: 0,
      revenue_recovered: 0,
      revenue_recovery_rate: 0,
      low_sample: true,
      rate_divergence: false,
    };
  }

  let recoveredCount = 0;
  let totalReward = 0;
  let revAtRisk = 0;
  let revRecovered = 0;

  for (const { observable, result } of results) {
    const amt = Math.round(observable.amount);
    revAtRisk += amt;
    if (result.recovered) {
      recoveredCount++;
      totalReward += result.reward;
      revRecovered += amt;
    }
  }

  const countRate = Number((recoveredCount / n).toFixed(4));
  const revRate = revAtRisk > 0 ? Number((revRecovered / revAtRisk).toFixed(4)) : 0;
  const lowSample = n < 30;
  const rateDivergence = Math.abs(revRate - countRate) > 0.05;

  return {
    name,
    evaluated_transactions: n,
    recovered_transactions: recoveredCount,
    recovery_rate: countRate,
    total_reward: totalReward,
    revenue_at_risk: revAtRisk,
    revenue_recovered: revRecovered,
    revenue_recovery_rate: revRate,
    low_sample: lowSample,
    rate_divergence: rateDivergence,
  };
}

// ============================================================================
// CORE EVALUATION HARNESS
// ============================================================================

/**
 * Evaluates an agent policy function against a synthetic payment dataset fixture.
 * 
 * ARCHITECTURAL SAFETY GUARANTEE:
 * - Policy function receives ONLY ObservableTransaction objects.
 * - Input records and transactions are NOT mutated.
 * - Non-failed transactions are skipped safely.
 * - Unexpected errors propagate loudly.
 * 
 * @param records Array of CombinedGeneratedRecord objects
 * @param policy Policy function mapping ObservableTransaction to RecoveryAction
 * @returns EvaluationReport containing overall, action, and category breakdowns
 */
export function evaluatePolicy(
  records: CombinedGeneratedRecord[],
  policy: (tx: ObservableTransaction) => RecoveryAction
): EvaluationReport {
  const total_transactions = records.length;

  const evaluatedPairs: { observable: ObservableTransaction; hidden: GroundTruthTransaction; result: RecoveryResult }[] = [];
  let skippedCount = 0;

  for (const record of records) {
    if (!record || !record.observable) {
      throw new Error('Malformed or missing transaction record encountered during evaluation.');
    }

    const obs = record.observable;
    if (obs.payment_status !== 'failed') {
      skippedCount++;
      continue;
    }

    // Pass ONLY observable transaction to policy
    const action = policy(obs);

    // Pass observable + hidden + selected action to simulator
    const result = simulateRecovery(obs, record.hidden, action);

    evaluatedPairs.push({
      observable: obs,
      hidden: record.hidden,
      result,
    });
  }

  const evaluatedCount = evaluatedPairs.length;
  let totalRecovered = 0;
  let totalReward = 0;
  let totalRevAtRisk = 0;
  let totalRevRecovered = 0;

  for (const item of evaluatedPairs) {
    const amt = Math.round(item.observable.amount);
    totalRevAtRisk += amt;
    if (item.result.recovered) {
      totalRecovered++;
      totalReward += item.result.reward;
      totalRevRecovered += amt;
    }
  }

  const overallCountRate = evaluatedCount > 0 ? Number((totalRecovered / evaluatedCount).toFixed(4)) : 0;
  const overallRevRate = totalRevAtRisk > 0 ? Number((totalRevRecovered / totalRevAtRisk).toFixed(4)) : 0;
  const averageReward = evaluatedCount > 0 ? Number((totalReward / evaluatedCount).toFixed(4)) : 0;

  // Action Breakdown
  const actions: RecoveryAction[] = ['retry_now', 'retry_later', 'send_reminder', 'request_payment_method_update', 'escalate'];
  const actionMetrics: Record<RecoveryAction, ActionMetric> = {} as any;

  for (const act of actions) {
    const actGroup = evaluatedPairs.filter(p => p.result.action === act);
    const breakdown = computeBreakdown(act, actGroup);
    actionMetrics[act] = { ...breakdown, action: act };
  }

  // Failure Reason Breakdown
  const failureReasonMap = new Map<string, { observable: ObservableTransaction; result: RecoveryResult }[]>();
  for (const item of evaluatedPairs) {
    const reason = item.observable.failure_reason ?? 'unknown';
    if (!failureReasonMap.has(reason)) failureReasonMap.set(reason, []);
    failureReasonMap.get(reason)!.push(item);
  }
  const failureReasonMetrics: Record<string, MetricBreakdown> = {};
  for (const [reason, group] of failureReasonMap) {
    failureReasonMetrics[reason] = computeBreakdown(reason, group);
  }

  // Attempt Number Breakdown
  const attemptMap = new Map<number, { observable: ObservableTransaction; result: RecoveryResult }[]>();
  for (const item of evaluatedPairs) {
    const att = item.observable.attempt_number;
    if (!attemptMap.has(att)) attemptMap.set(att, []);
    attemptMap.get(att)!.push(item);
  }
  const attemptMetrics: Record<number, MetricBreakdown> = {};
  for (const [att, group] of attemptMap) {
    attemptMetrics[att] = computeBreakdown(`Attempt ${att}`, group);
  }

  // Payment Method Breakdown
  const methodMap = new Map<string, { observable: ObservableTransaction; result: RecoveryResult }[]>();
  for (const item of evaluatedPairs) {
    const m = item.observable.payment_method;
    if (!methodMap.has(m)) methodMap.set(m, []);
    methodMap.get(m)!.push(item);
  }
  const paymentMethodMetrics: Record<string, MetricBreakdown> = {};
  for (const [m, group] of methodMap) {
    paymentMethodMetrics[m] = computeBreakdown(m, group);
  }

  // Subscription Status Breakdown
  const subMap = new Map<string, { observable: ObservableTransaction; result: RecoveryResult }[]>();
  for (const item of evaluatedPairs) {
    const s = item.observable.subscription_status;
    if (!subMap.has(s)) subMap.set(s, []);
    subMap.get(s)!.push(item);
  }
  const subscriptionMetrics: Record<string, MetricBreakdown> = {};
  for (const [s, group] of subMap) {
    subscriptionMetrics[s] = computeBreakdown(s, group);
  }

  return {
    total_transactions,
    evaluated_transactions: evaluatedCount,
    skipped_transactions: skippedCount,
    recovered_transactions: totalRecovered,
    recovery_rate: overallCountRate,
    total_reward: totalReward,
    average_reward: averageReward,
    revenue_at_risk: totalRevAtRisk,
    revenue_recovered: totalRevRecovered,
    revenue_recovery_rate: overallRevRate,
    action_metrics: actionMetrics,
    failure_reason_metrics: failureReasonMetrics,
    attempt_number_metrics: attemptMetrics,
    payment_method_metrics: paymentMethodMetrics,
    subscription_status_metrics: subscriptionMetrics,
  };
}

// ============================================================================
// THEORETICAL ORACLE BENCHMARK
// ============================================================================

/**
 * Theoretical Upper-Bound Oracle Evaluation
 * 
 * 🛑 EVALUATION-ONLY BENCHMARK 🛑
 * Selects the action with the absolute highest hidden action_probability for each transaction.
 * THIS BENCHMARK MUST NEVER BE ACCESSED BY AGENT OR DEPLOYED POLICY CODE.
 */
export function evaluateOracle(records: CombinedGeneratedRecord[]): EvaluationReport {
  const actions: RecoveryAction[] = ['retry_now', 'retry_later', 'send_reminder', 'request_payment_method_update', 'escalate'];

  const oraclePolicy = (obs: ObservableTransaction): RecoveryAction => {
    // Locate the matching record to inspect hidden probabilities
    const rec = records.find(r => r.observable.transaction_id === obs.transaction_id);
    if (!rec) return 'retry_later';

    let bestAction: RecoveryAction = 'retry_later';
    let maxProb = -1;

    for (const act of actions) {
      const prob = rec.hidden.action_probabilities[act] ?? 0;
      if (prob > maxProb) {
        maxProb = prob;
        bestAction = act;
      }
    }

    return bestAction;
  };

  return evaluatePolicy(records, oraclePolicy);
}

/**
 * Compares a baseline policy evaluation against the theoretical oracle upper-bound.
 */
export function compareWithOracle(
  records: CombinedGeneratedRecord[],
  baselineReport: EvaluationReport
): OracleBenchmarkComparison {
  const oracleReport = evaluateOracle(records);

  const recoveryRateGap = Number((oracleReport.recovery_rate - baselineReport.recovery_rate).toFixed(4));
  const rewardGap = oracleReport.total_reward - baselineReport.total_reward;
  const revGapINR = oracleReport.revenue_recovered - baselineReport.revenue_recovered;
  const revRateGap = Number((oracleReport.revenue_recovery_rate - baselineReport.revenue_recovery_rate).toFixed(4));

  return {
    baseline: baselineReport,
    oracle: oracleReport,
    recovery_rate_gap: recoveryRateGap,
    total_reward_gap: rewardGap,
    revenue_recovered_gap_inr: revGapINR,
    revenue_recovery_rate_gap: revRateGap,
  };
}

// ============================================================================
// DURABLE MARKDOWN REPORT GENERATOR
// ============================================================================

export function generateBaselineEvaluationMarkdownReport(
  baseline: EvaluationReport,
  oracleComparison: OracleBenchmarkComparison
): string {
  const oracle = oracleComparison.oracle;

  let md = `# Baseline Policy Evaluation Report\n\n`;
  md += `**Evaluation Harness Version**: Day 2.3  \n`;
  md += `**Evaluation Mode**: Agent-Safe Heuristic Baseline vs. Theoretical Upper-Bound Oracle  \n\n`;
  md += `---\n\n`;

  // 1. Dataset Summary
  md += `## 1. Dataset Summary\n\n`;
  md += `- **Total Dataset Size**: ${baseline.total_transactions.toLocaleString()} transactions\n`;
  md += `- **Synthetic Seed**: 42\n`;
  md += `- **Failed Transactions Evaluated**: ${baseline.evaluated_transactions.toLocaleString()}\n`;
  md += `- **Successful Transactions Skipped**: ${baseline.skipped_transactions.toLocaleString()}\n\n`;

  // 2. Overall Performance
  md += `## 2. Overall Performance\n\n`;
  md += `| Metric | Heuristic Baseline | Theoretical Oracle | Gap / Opportunity |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  md += `| **Count-based Recovery Rate** | ${(baseline.recovery_rate * 100).toFixed(2)}% | ${(oracle.recovery_rate * 100).toFixed(2)}% | +${(oracleComparison.recovery_rate_gap * 100).toFixed(2)}% |\n`;
  md += `| **Revenue at Risk** | ₹${baseline.revenue_at_risk.toLocaleString('en-IN')} | ₹${oracle.revenue_at_risk.toLocaleString('en-IN')} | — |\n`;
  md += `| **Revenue Recovered** | ₹${baseline.revenue_recovered.toLocaleString('en-IN')} | ₹${oracle.revenue_recovered.toLocaleString('en-IN')} | +₹${oracleComparison.revenue_recovered_gap_inr.toLocaleString('en-IN')} |\n`;
  md += `| **Revenue Recovery Rate** | ${(baseline.revenue_recovery_rate * 100).toFixed(2)}% | ${(oracle.revenue_recovery_rate * 100).toFixed(2)}% | +${(oracleComparison.revenue_recovery_rate_gap * 100).toFixed(2)}% |\n`;
  md += `| **Total Evaluation Reward** | ${baseline.total_reward.toLocaleString()} pts | ${oracle.total_reward.toLocaleString()} pts | +${oracleComparison.total_reward_gap.toLocaleString()} pts |\n`;
  md += `| **Average Reward per Failed Tx** | ${baseline.average_reward} pts | ${oracle.average_reward} pts | +${(oracle.average_reward - baseline.average_reward).toFixed(4)} pts |\n\n`;

  // Helper renderer for breakdown tables
  const renderTable = (metricsObj: Record<string | number, MetricBreakdown>, title: string) => {
    let t = `### ${title}\n\n`;
    t += `| Category | Evaluated (n) | Recovered | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Sample Note |\n`;
    t += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    for (const [key, m] of Object.entries(metricsObj)) {
      const sampleNote = m.low_sample ? `⚠️ (small sample, n=${m.evaluated_transactions})` : `✅ Normal`;
      const divNote = m.rate_divergence ? ` *` : ``;
      t += `| \`${key}\` | ${m.evaluated_transactions.toLocaleString()} | ${m.recovered_transactions.toLocaleString()} | ${(m.recovery_rate * 100).toFixed(2)}% | ₹${m.revenue_at_risk.toLocaleString('en-IN')} | ₹${m.revenue_recovered.toLocaleString('en-IN')} | ${(m.revenue_recovery_rate * 100).toFixed(2)}%${divNote} | ${sampleNote} |\n`;
    }
    t += `\n`;
    return t;
  };

  // 3. Action Distribution
  md += `## 3. Action Distribution\n\n`;
  md += renderTable(baseline.action_metrics as any, 'Recovery Action Selections');

  // 4. Recovery by Failure Reason
  md += `## 4. Recovery by Failure Reason\n\n`;
  md += renderTable(baseline.failure_reason_metrics, 'Failure Reason Breakdown');

  // 5. Recovery by Attempt Number
  md += `## 5. Recovery by Attempt Number\n\n`;
  md += renderTable(baseline.attempt_number_metrics, 'Attempt Number Breakdown');

  // 6. Recovery by Payment Method
  md += `## 6. Recovery by Payment Method\n\n`;
  md += renderTable(baseline.payment_method_metrics, 'Payment Method Breakdown');

  // 7. Recovery by Subscription Status
  md += `## 7. Recovery by Subscription Status\n\n`;
  md += renderTable(baseline.subscription_status_metrics, 'Subscription Status Breakdown');

  // 8. Oracle Benchmark Comparison
  md += `## 8. Theoretical Oracle Benchmark Summary\n\n`;
  md += `- **Oracle Count Recovery Rate**: ${(oracle.recovery_rate * 100).toFixed(2)}%\n`;
  md += `- **Oracle Revenue Recovery Rate**: ${(oracle.revenue_recovery_rate * 100).toFixed(2)}%\n`;
  md += `- **Oracle Total Reward**: ${oracle.total_reward.toLocaleString()} pts\n`;
  md += `- **Baseline-to-Oracle Performance Gap**: +${(oracleComparison.recovery_rate_gap * 100).toFixed(2)}% (+₹${oracleComparison.revenue_recovered_gap_inr.toLocaleString('en-IN')})\n\n`;

  // 9. Interpretation & Caveats
  md += `## 9. Interpretation & Statistical Observations\n\n`;
  md += `1. **Baseline vs. Oracle Gap**: The heuristic baseline achieves a revenue recovery rate of ${(baseline.revenue_recovery_rate * 100).toFixed(2)}% (₹${baseline.revenue_recovered.toLocaleString('en-IN')}), leaving an uncaptured recovery potential of +₹${oracleComparison.revenue_recovered_gap_inr.toLocaleString('en-IN')} (+${(oracleComparison.revenue_recovery_rate_gap * 100).toFixed(2)}%) compared to the theoretical oracle.\n`;
  
  // List low sample size categories
  const lowSampleCats: string[] = [];
  const divCats: string[] = [];

  const checkSample = (obj: Record<string | number, MetricBreakdown>) => {
    for (const [k, m] of Object.entries(obj)) {
      if (m.low_sample) lowSampleCats.push(`\`${k}\` (n=${m.evaluated_transactions})`);
      if (m.rate_divergence) divCats.push(`\`${k}\` (Count: ${(m.recovery_rate * 100).toFixed(1)}%, Rev: ${(m.revenue_recovery_rate * 100).toFixed(1)}%)`);
    }
  };

  checkSample(baseline.action_metrics as any);
  checkSample(baseline.failure_reason_metrics);
  checkSample(baseline.attempt_number_metrics);
  checkSample(baseline.payment_method_metrics);
  checkSample(baseline.subscription_status_metrics);

  if (lowSampleCats.length > 0) {
    md += `2. **Low Sample Size Categories ($n < 30$)**: The following categories have small sample sizes and their recovery rates are less statistically reliable: ${lowSampleCats.join(', ')}.\n`;
  } else {
    md += `2. **Low Sample Size Categories ($n < 30$)**: None. All evaluated categories meet the $n \\ge 30$ threshold for statistical reliability.\n`;
  }

  if (divCats.length > 0) {
    md += `3. **Count vs. Revenue Divergence (> 5 percentage points)**: Marked with an asterisk (*), the following categories show notable divergence between count-based recovery rate and revenue-based recovery rate: ${divCats.join(', ')}. This indicates the baseline policy performs differently on high-value vs. low-value transactions within these buckets.\n`;
  } else {
    md += `3. **Count vs. Revenue Divergence (> 5 percentage points)**: None observed. Count-based recovery rates align closely with revenue recovery rates across all main categories.\n`;
  }

  return md;
}
