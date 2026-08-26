import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord } from '../lib/types.js';
import { selectRecoveryAction } from '../lib/policy.js';
import { selectBlindRetryAction } from '../lib/blind-retry-policy.js';
import { 
  evaluatePolicy, 
  evaluateOracle, 
  EvaluationReport 
} from '../lib/evaluation.js';

export interface ThreeWayPolicyComparison {
  blindRetry: EvaluationReport;
  ruleBased: EvaluationReport;
  oracle: EvaluationReport;
  
  upliftCountRate: number; // percentage points (ruleBased - blindRetry)
  upliftCountTxs: number;
  upliftRevRate: number; // percentage points (ruleBased - blindRetry)
  upliftRevINR: number;
  upliftReward: number;
}

export function generateThreeWayComparisonMarkdownReport(comp: ThreeWayPolicyComparison): string {
  const b = comp.blindRetry;
  const r = comp.ruleBased;
  const o = comp.oracle;

  let md = `# Policy Comparison Report\n\n`;
  md += `**Evaluation Harness Version**: Day 2.3  \n`;
  md += `**Dataset**: 5,000 transactions (${b.evaluated_transactions.toLocaleString()} failed transactions evaluated)  \n`;
  md += `**Synthetic Seed**: 42  \n\n`;
  md += `---\n\n`;

  md += `## 1. Three-Way Policy Comparison\n\n`;
  md += `| Policy | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Total Reward |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  md += `| **Blind Retry** (Naive Baseline) | ${(b.recovery_rate * 100).toFixed(2)}% | ₹${b.revenue_at_risk.toLocaleString('en-IN')} | ₹${b.revenue_recovered.toLocaleString('en-IN')} | ${(b.revenue_recovery_rate * 100).toFixed(2)}% | ${b.total_reward.toLocaleString()} pts |\n`;
  md += `| **Rule-Based Baseline** (Day 2.2) | ${(r.recovery_rate * 100).toFixed(2)}% | ₹${r.revenue_at_risk.toLocaleString('en-IN')} | ₹${r.revenue_recovered.toLocaleString('en-IN')} | ${(r.revenue_recovery_rate * 100).toFixed(2)}% | ${r.total_reward.toLocaleString()} pts |\n`;
  md += `| **Theoretical Oracle** (Upper Bound) | ${(o.recovery_rate * 100).toFixed(2)}% | ₹${o.revenue_at_risk.toLocaleString('en-IN')} | ₹${o.revenue_recovered.toLocaleString('en-IN')} | ${(o.revenue_recovery_rate * 100).toFixed(2)}% | ${o.total_reward.toLocaleString()} pts |\n\n`;

  md += `---\n\n`;
  md += `## 2. Rule-Based Baseline Uplift over Naive Blind Retry\n\n`;
  md += `- **Count Recovery Rate Uplift**: +${(comp.upliftCountRate * 100).toFixed(2)} percentage points (+${comp.upliftCountTxs.toLocaleString()} recovered transactions)\n`;
  md += `- **Revenue Recovery Rate Uplift**: +${(comp.upliftRevRate * 100).toFixed(2)} percentage points (+₹${comp.upliftRevINR.toLocaleString('en-IN')} recovered revenue)\n`;
  md += `- **Total Evaluation Reward Uplift**: +${comp.upliftReward.toLocaleString()} pts\n\n`;

  md += `---\n\n`;
  md += `## 3. Key Observations & Takeaways\n\n`;
  md += `1. **Naivety of Blind Retry**: Blind retry blindly applies \`retry_now\` (attempts 1-2) or \`retry_later\` (attempts 3-4) without considering failure reason or subscription state. It achieves a revenue recovery rate of ${(b.revenue_recovery_rate * 100).toFixed(2)}% (₹${b.revenue_recovered.toLocaleString('en-IN')}).\n`;
  md += `2. **Domain-Knowledge Uplift**: Incorporating basic failure reason and subscription rules in the **Rule-Based Baseline** increases revenue recovery rate from ${(b.revenue_recovery_rate * 100).toFixed(2)}% to ${(r.revenue_recovery_rate * 100).toFixed(2)}%, generating an additional **+₹${comp.upliftRevINR.toLocaleString('en-IN')}** (+${(comp.upliftRevRate * 100).toFixed(2)} percentage points) in recovered revenue.\n`;
  md += `3. **Remaining Opportunity to Oracle**: The theoretical oracle reaches ${(o.revenue_recovery_rate * 100).toFixed(2)}% revenue recovery (₹${o.revenue_recovered.toLocaleString('en-IN')}), leaving a **+₹${(o.revenue_recovered - r.revenue_recovered).toLocaleString('en-IN')}** (+${((o.revenue_recovery_rate - r.revenue_recovery_rate) * 100).toFixed(2)} percentage points) gap for future machine learning and AI agent optimization.\n`;

  return md;
}

export function runAllPoliciesEvaluation() {
  const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
  if (!fs.existsSync(transactionsPath)) {
    throw new Error(`Transactions fixture not found at ${transactionsPath}. Please run npm run generate first.`);
  }

  const rawData = fs.readFileSync(transactionsPath, 'utf-8');
  const records: CombinedGeneratedRecord[] = JSON.parse(rawData);

  console.log(`Evaluating Naive Blind Retry policy...`);
  const blindRetryReport = evaluatePolicy(records, selectBlindRetryAction);

  console.log(`Evaluating Rule-Based Baseline policy...`);
  const ruleBasedReport = evaluatePolicy(records, selectRecoveryAction);

  console.log(`Evaluating Theoretical Upper-Bound Oracle benchmark...`);
  const oracleReport = evaluateOracle(records);

  const comp: ThreeWayPolicyComparison = {
    blindRetry: blindRetryReport,
    ruleBased: ruleBasedReport,
    oracle: oracleReport,
    upliftCountRate: Number((ruleBasedReport.recovery_rate - blindRetryReport.recovery_rate).toFixed(4)),
    upliftCountTxs: ruleBasedReport.recovered_transactions - blindRetryReport.recovered_transactions,
    upliftRevRate: Number((ruleBasedReport.revenue_recovery_rate - blindRetryReport.revenue_recovery_rate).toFixed(4)),
    upliftRevINR: ruleBasedReport.revenue_recovered - blindRetryReport.revenue_recovered,
    upliftReward: ruleBasedReport.total_reward - blindRetryReport.total_reward,
  };

  const reportMd = generateThreeWayComparisonMarkdownReport(comp);
  const reportPath = path.resolve(process.cwd(), 'data', 'fixtures', 'policy-comparison-report.md');
  fs.writeFileSync(reportPath, reportMd, 'utf-8');
  console.log(`Saved three-way policy comparison report to ${reportPath}`);

  console.log('\n==================================================');
  console.log('       THREE-WAY POLICY COMPARISON SUMMARY');
  console.log('==================================================');
  console.log(`Blind Retry          : ${(blindRetryReport.recovery_rate * 100).toFixed(2)}% count | ₹${blindRetryReport.revenue_recovered.toLocaleString('en-IN')} (${(blindRetryReport.revenue_recovery_rate * 100).toFixed(2)}% rev)`);
  console.log(`Rule-Based Baseline  : ${(ruleBasedReport.recovery_rate * 100).toFixed(2)}% count | ₹${ruleBasedReport.revenue_recovered.toLocaleString('en-IN')} (${(ruleBasedReport.revenue_recovery_rate * 100).toFixed(2)}% rev)`);
  console.log(`Theoretical Oracle   : ${(oracleReport.recovery_rate * 100).toFixed(2)}% count | ₹${oracleReport.revenue_recovered.toLocaleString('en-IN')} (${(oracleReport.revenue_recovery_rate * 100).toFixed(2)}% rev)`);
  console.log('--------------------------------------------------');
  console.log(`Rule Baseline Uplift : +${(comp.upliftRevRate * 100).toFixed(2)}% rev (+₹${comp.upliftRevINR.toLocaleString('en-IN')}) over Blind Retry`);
  console.log('==================================================\n');

  return { comp, reportMd };
}

if (process.argv[1] && (process.argv[1].endsWith('evaluate-all-policies.ts') || process.argv[1].endsWith('evaluate-all-policies.js'))) {
  runAllPoliciesEvaluation();
}
