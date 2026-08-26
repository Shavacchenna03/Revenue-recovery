import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord } from '../lib/types.js';
import { selectRecoveryAction } from '../lib/policy.js';
import { 
  evaluatePolicy, 
  compareWithOracle, 
  generateBaselineEvaluationMarkdownReport 
} from '../lib/evaluation.js';

export function runBaselineEvaluation() {
  const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
  if (!fs.existsSync(transactionsPath)) {
    throw new Error(`Transactions fixture not found at ${transactionsPath}. Please run npm run generate first.`);
  }

  console.log(`Loading transaction dataset from ${transactionsPath}...`);
  const rawData = fs.readFileSync(transactionsPath, 'utf-8');
  const records: CombinedGeneratedRecord[] = JSON.parse(rawData);

  console.log(`Evaluating agent-safe baseline policy on ${records.length} transactions...`);
  const baselineReport = evaluatePolicy(records, selectRecoveryAction);

  console.log(`Evaluating theoretical upper-bound oracle benchmark...`);
  const oracleComparison = compareWithOracle(records, baselineReport);

  const reportMd = generateBaselineEvaluationMarkdownReport(baselineReport, oracleComparison);

  const reportPath = path.resolve(process.cwd(), 'data', 'fixtures', 'baseline-evaluation-report.md');
  fs.writeFileSync(reportPath, reportMd, 'utf-8');
  console.log(`Saved baseline evaluation report to ${reportPath}`);

  const oracle = oracleComparison.oracle;

  console.log('\n==================================================');
  console.log('       BASELINE EVALUATION SUMMARY REPORT');
  console.log('==================================================');
  console.log(`Total Dataset Records   : ${baselineReport.total_transactions}`);
  console.log(`Evaluated Failed Txs    : ${baselineReport.evaluated_transactions}`);
  console.log(`Skipped Success Txs     : ${baselineReport.skipped_transactions}`);
  console.log('--------------------------------------------------');
  console.log(`Baseline Recovered Txs  : ${baselineReport.recovered_transactions} (${(baselineReport.recovery_rate * 100).toFixed(2)}%)`);
  console.log(`Baseline Revenue Risk   : ₹${baselineReport.revenue_at_risk.toLocaleString('en-IN')}`);
  console.log(`Baseline Revenue Recov  : ₹${baselineReport.revenue_recovered.toLocaleString('en-IN')} (${(baselineReport.revenue_recovery_rate * 100).toFixed(2)}%)`);
  console.log(`Baseline Total Reward   : ${baselineReport.total_reward} pts`);
  console.log('--------------------------------------------------');
  console.log(`Oracle Recovered Txs    : ${oracle.recovered_transactions} (${(oracle.recovery_rate * 100).toFixed(2)}%)`);
  console.log(`Oracle Revenue Recov    : ₹${oracle.revenue_recovered.toLocaleString('en-IN')} (${(oracle.revenue_recovery_rate * 100).toFixed(2)}%)`);
  console.log(`Oracle Total Reward     : ${oracle.total_reward} pts`);
  console.log('--------------------------------------------------');
  console.log(`Opportunity Gap (Count) : +${(oracleComparison.recovery_rate_gap * 100).toFixed(2)}% (+${oracleComparison.total_reward_gap} txs)`);
  console.log(`Opportunity Gap (Rev)   : +₹${oracleComparison.revenue_recovered_gap_inr.toLocaleString('en-IN')} (+${(oracleComparison.revenue_recovery_rate_gap * 100).toFixed(2)}%)`);
  console.log('==================================================\n');

  return { baselineReport, oracleComparison, reportMd };
}

if (process.argv[1] && (process.argv[1].endsWith('evaluate-baseline.ts') || process.argv[1].endsWith('evaluate-baseline.js'))) {
  runBaselineEvaluation();
}
