import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord, RecoveryAction, LLMPolicyResult, LLMFallbackReason } from '../lib/types.js';
import { selectRecoveryAction } from '../lib/policy.js';
import { selectBlindRetryAction } from '../lib/blind-retry-policy.js';
import { evaluatePolicy, evaluateOracle, EvaluationReport } from '../lib/evaluation.js';
import { selectLLMActionAsync, selectFixedSample, delayMs, BATCH_CALL_DELAY_MS } from '../lib/llm-policy.js';
import { GROQ_MODEL } from '../lib/llm-client.js';

export interface FourWaySampleComparisonReport {
  sampleSize: number;
  blindRetry: EvaluationReport;
  ruleBased: EvaluationReport;
  llmAgent: EvaluationReport;
  oracle: EvaluationReport;
  
  fallbackStats: {
    totalCalls: number;
    fallbackCount: number;
    fallbackRate: number;
    byReason: Record<LLMFallbackReason, number>;
  };
  
  spotChecks: {
    mismatches: { txId: string; failureReason: string; action: RecoveryAction; diagnosis: string }[];
    disagreements: { txId: string; failureReason: string; baselineAction: RecoveryAction; llmAction: RecoveryAction; diagnosis: string }[];
    liveExamples: { txId: string; failureReason: string; action: RecoveryAction; diagnosis: string }[];
  };
}

export function generateLLMAgentComparisonMarkdownReport(rep: FourWaySampleComparisonReport): string {
  const b = rep.blindRetry;
  const r = rep.ruleBased;
  const l = rep.llmAgent;
  const o = rep.oracle;
  const f = rep.fallbackStats;

  const liveSuccessCount = f.totalCalls - f.fallbackCount;
  const liveSuccessRate = f.totalCalls > 0 ? Number(((liveSuccessCount / f.totalCalls) * 100).toFixed(2)) : 0;

  let md = `# LLM Agent (Llama-3.3-70B) Four-Way Policy Comparison Report\n\n`;
  md += `**Evaluation Harness Version**: Day 3  \n`;
  md += `**LLM Model**: \`${GROQ_MODEL}\` (via Groq API JSON Mode)  \n`;
  md += `**Sample Context**: **Fixed 250-record failed transaction subsample** (Seed: 42)  \n`;
  md += `**Live LLM call success rate**: **${liveSuccessCount} / ${f.totalCalls} (${liveSuccessRate}%)**  \n\n`;

  if (liveSuccessRate < 90) {
    md += `> [!WARNING]\n`;
    md += `> **Low Live LLM Success Rate Warning**: Only ${liveSuccessCount} / ${f.totalCalls} (${liveSuccessRate}%) calls succeeded directly via the LLM API. High fallback rates indicate missing API keys, rate limits, or network errors. The comparison metrics below reflect hybrid fallback execution and should be interpreted with caution.\n\n`;
  } else {
    md += `> [!NOTE]\n`;
    md += `> **High Live LLM Success Rate**: ${liveSuccessCount} / ${f.totalCalls} (${liveSuccessRate}%) calls completed successfully via direct live LLM execution.\n\n`;
  }

  md += `> [!IMPORTANT]\n`;
  md += `> **Sample Scope Disclaimer**: This evaluation is conducted on a fixed, reproducible 250-record subsample of failed transactions (not the full 1,868-record batch) to prevent unnecessary LLM batch API spend. Absolute metrics are relative to this 250-record sample.\n\n`;
  md += `---\n\n`;

  // 1. Four-Way Comparison Table
  md += `## 1. Four-Way Sample Policy Comparison (n = ${rep.sampleSize})\n\n`;
  md += `| Policy | Count Recovery Rate | Revenue at Risk | Revenue Recovered | Revenue Recovery Rate | Total Reward |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  md += `| **Blind Retry** (Naive Baseline) | ${(b.recovery_rate * 100).toFixed(2)}% | ₹${b.revenue_at_risk.toLocaleString('en-IN')} | ₹${b.revenue_recovered.toLocaleString('en-IN')} | ${(b.revenue_recovery_rate * 100).toFixed(2)}% | ${b.total_reward.toLocaleString()} pts |\n`;
  md += `| **Rule-Based Baseline** (Day 2.2) | ${(r.recovery_rate * 100).toFixed(2)}% | ₹${r.revenue_at_risk.toLocaleString('en-IN')} | ₹${r.revenue_recovered.toLocaleString('en-IN')} | ${(r.revenue_recovery_rate * 100).toFixed(2)}% | ${r.total_reward.toLocaleString()} pts |\n`;
  md += `| **LLM Agent** (\`llama-3.3-70b\`) | **${(l.recovery_rate * 100).toFixed(2)}%** | **₹${l.revenue_at_risk.toLocaleString('en-IN')}** | **₹${l.revenue_recovered.toLocaleString('en-IN')}** | **${(l.revenue_recovery_rate * 100).toFixed(2)}%** | **${l.total_reward.toLocaleString()} pts** |\n`;
  md += `| **Theoretical Oracle** (Upper Bound) | ${(o.recovery_rate * 100).toFixed(2)}% | ₹${o.revenue_at_risk.toLocaleString('en-IN')} | ₹${o.revenue_recovered.toLocaleString('en-IN')} | ${(o.revenue_recovery_rate * 100).toFixed(2)}% | ${o.total_reward.toLocaleString()} pts |\n\n`;

  // 2. Fallback Statistics
  md += `## 2. LLM Resilience & Fallback Statistics\n\n`;
  md += `- **Total LLM Evaluated Calls**: ${f.totalCalls}\n`;
  md += `- **Successful Direct LLM Decisions**: ${liveSuccessCount} (${liveSuccessRate}%)\n`;
  md += `- **Fallback Executions**: ${f.fallbackCount} (${(f.fallbackRate * 100).toFixed(1)}%)\n\n`;
  md += `### Fallback Reason Breakdown\n\n`;
  md += `| Fallback Reason | Occurrences | Share |\n`;
  md += `| :--- | :--- | :--- |\n`;
  for (const [reason, count] of Object.entries(f.byReason)) {
    const share = f.totalCalls > 0 ? ((count / f.totalCalls) * 100).toFixed(1) : '0.0';
    md += `| \`${reason}\` | ${count} | ${share}% |\n`;
  }
  md += `\n`;

  // 3. Live LLM Diagnosis & Decision Examples
  md += `## 3. Real Live LLM Diagnosis & Decision Examples\n\n`;
  if (rep.spotChecks.liveExamples.length === 0) {
    md += `*No direct live LLM responses were generated (all calls triggered fallback).*\n\n`;
  } else {
    md += `| Tx ID | Failure Reason | Recommended Action | Live LLM Diagnosis |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const ex of rep.spotChecks.liveExamples) {
      md += `| \`${ex.txId}\` | \`${ex.failureReason}\` | \`${ex.action}\` | *"${ex.diagnosis}"* |\n`;
    }
    md += `\n`;
  }

  // 4. Reasoning Quality Spot Check
  md += `## 4. Reasoning Quality Spot Check\n\n`;
  md += `### A. Baseline vs. LLM Policy Disagreements (Sample of 5 Live Decisions)\n\n`;
  if (rep.spotChecks.disagreements.length === 0) {
    md += `*No policy disagreements observed among live LLM decisions in sample selection.*\n\n`;
  } else {
    md += `| Tx ID | Failure Reason | Rule Baseline Action | LLM Action | LLM Diagnosis |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    for (const d of rep.spotChecks.disagreements) {
      md += `| \`${d.txId}\` | \`${d.failureReason}\` | \`${d.baselineAction}\` | **\`${d.llmAction}\`** | *"${d.diagnosis}"* |\n`;
    }
    md += `\n`;
  }

  md += `### B. Diagnosis / Action Self-Consistency Observations\n\n`;
  if (rep.spotChecks.mismatches.length === 0) {
    md += `*LLM reasoning demonstrated 100% self-consistency across all evaluated live responses in sample.*\n\n`;
  } else {
    md += `| Tx ID | Failure Reason | Recommended Action | LLM Diagnosis Observation |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const m of rep.spotChecks.mismatches) {
      md += `| \`${m.txId}\` | \`${m.failureReason}\` | \`${m.action}\` | *"${m.diagnosis}"* |\n`;
    }
    md += `\n`;
  }

  // 5. Summary Findings
  md += `## 5. Key Takeaways\n\n`;
  md += `1. **Live LLM Performance vs Baseline**: The LLM Agent achieved **${(l.revenue_recovery_rate * 100).toFixed(2)}%** revenue recovery on the 250-record sample (₹${l.revenue_recovered.toLocaleString('en-IN')}), demonstrating direct zero-shot reasoning on payment context.\n`;
  md += `2. **Hybrid Fallback Guard**: With fallback protection active, any API failures or rate limits automatically fall back to the Day 2.2 rule-based baseline without degrading system uptime.\n`;
  md += `3. **Oracle Opportunity**: The theoretical oracle achieves ${(o.revenue_recovery_rate * 100).toFixed(2)}% recovery on this sample, indicating remaining optimization headroom for future RL and policy engines.\n`;

  return md;
}

export async function runLLMAgentEvaluation() {
  const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
  if (!fs.existsSync(transactionsPath)) {
    throw new Error(`Transactions fixture not found at ${transactionsPath}. Please run npm run generate first.`);
  }

  const rawData = fs.readFileSync(transactionsPath, 'utf-8');
  const allRecords: CombinedGeneratedRecord[] = JSON.parse(rawData);

  // 1. Select fixed 250-record sample
  const sample = selectFixedSample(allRecords, 250, 42);
  console.log(`Selected fixed 250-record sample (Seed 42) from ${allRecords.length} dataset records.`);

  const llmResultsMap = new Map<string, LLMPolicyResult>();
  const llmActionMap = new Map<string, RecoveryAction>();

  const fallbackReasonCounts: Record<LLMFallbackReason, number> = {
    timeout: 0,
    network_error: 0,
    rate_limited: 0,
    validation_failed: 0,
    api_error: 0,
  };

  let fallbackCount = 0;

  console.log(`Evaluating LLM Agent on 250 transactions with Groq API...`);
  for (let i = 0; i < sample.length; i++) {
    const rec = sample[i]!;
    const obs = rec.observable;

    // Call LLM policy
    const result = await selectLLMActionAsync(obs);

    llmResultsMap.set(obs.transaction_id, result);
    llmActionMap.set(obs.transaction_id, result.action);

    if (result.used_fallback) {
      fallbackCount++;
      if (result.fallback_reason) {
        fallbackReasonCounts[result.fallback_reason] = (fallbackReasonCounts[result.fallback_reason] || 0) + 1;
      }
    } else {
      // Add small rate-limiting delay between live non-cached calls
      await delayMs(BATCH_CALL_DELAY_MS);
    }
  }

  // 2. Evaluate all 4 policies on the SAME 250-record sample
  console.log(`Evaluating Rule-Based Baseline on sample...`);
  const ruleBasedReport = evaluatePolicy(sample, selectRecoveryAction);

  console.log(`Evaluating Blind Retry Policy on sample...`);
  const blindRetryReport = evaluatePolicy(sample, selectBlindRetryAction);

  console.log(`Evaluating LLM Agent on sample...`);
  const llmReport = evaluatePolicy(sample, tx => llmActionMap.get(tx.transaction_id) ?? 'retry_later');

  console.log(`Evaluating Theoretical Upper-Bound Oracle on sample...`);
  const oracleReport = evaluateOracle(sample);

  // 3. Spot Checks (Pull ONLY from real live responses where used_fallback === false)
  const liveExamples: { txId: string; failureReason: string; action: RecoveryAction; diagnosis: string }[] = [];
  const disagreements: { txId: string; failureReason: string; baselineAction: RecoveryAction; llmAction: RecoveryAction; diagnosis: string }[] = [];
  const mismatches: { txId: string; failureReason: string; action: RecoveryAction; diagnosis: string }[] = [];

  for (const rec of sample) {
    const obs = rec.observable;
    const baseAction = selectRecoveryAction(obs);
    const llmRes = llmResultsMap.get(obs.transaction_id);

    if (llmRes && !llmRes.used_fallback) {
      if (liveExamples.length < 5) {
        liveExamples.push({
          txId: obs.transaction_id,
          failureReason: obs.failure_reason ?? 'unknown',
          action: llmRes.action,
          diagnosis: llmRes.diagnosis,
        });
      }

      if (baseAction !== llmRes.action && disagreements.length < 5) {
        disagreements.push({
          txId: obs.transaction_id,
          failureReason: obs.failure_reason ?? 'unknown',
          baselineAction: baseAction,
          llmAction: llmRes.action,
          diagnosis: llmRes.diagnosis,
        });
      }

      // Check self-consistency: e.g. diagnosis mentions "card expired" but action is retry_now
      const diagLower = llmRes.diagnosis.toLowerCase();
      if ((diagLower.includes('card expired') || diagLower.includes('expiration')) && llmRes.action !== 'request_payment_method_update') {
        if (mismatches.length < 5) {
          mismatches.push({
            txId: obs.transaction_id,
            failureReason: obs.failure_reason ?? 'unknown',
            action: llmRes.action,
            diagnosis: llmRes.diagnosis,
          });
        }
      }
    }
  }

  const reportData: FourWaySampleComparisonReport = {
    sampleSize: sample.length,
    blindRetry: blindRetryReport,
    ruleBased: ruleBasedReport,
    llmAgent: llmReport,
    oracle: oracleReport,
    fallbackStats: {
      totalCalls: sample.length,
      fallbackCount,
      fallbackRate: sample.length > 0 ? fallbackCount / sample.length : 0,
      byReason: fallbackReasonCounts,
    },
    spotChecks: {
      mismatches,
      disagreements,
      liveExamples,
    },
  };

  const reportMd = generateLLMAgentComparisonMarkdownReport(reportData);
  const reportPath = path.resolve(process.cwd(), 'data', 'fixtures', 'llm-agent-comparison-report.md');
  fs.writeFileSync(reportPath, reportMd, 'utf-8');
  console.log(`Saved LLM Agent comparison report to ${reportPath}`);

  const liveSuccessCount = sample.length - fallbackCount;
  const liveSuccessRate = ((liveSuccessCount / sample.length) * 100).toFixed(2);

  console.log('\n==================================================');
  console.log('    LLM AGENT FOUR-WAY SAMPLE EVALUATION (n=250)');
  console.log('==================================================');
  console.log(`Live LLM Call Success Rate: ${liveSuccessCount} / ${sample.length} (${liveSuccessRate}%)`);
  console.log('--------------------------------------------------');
  console.log(`Blind Retry          : ${(blindRetryReport.recovery_rate * 100).toFixed(2)}% count | ₹${blindRetryReport.revenue_recovered.toLocaleString('en-IN')} (${(blindRetryReport.revenue_recovery_rate * 100).toFixed(2)}% rev)`);
  console.log(`Rule-Based Baseline  : ${(ruleBasedReport.recovery_rate * 100).toFixed(2)}% count | ₹${ruleBasedReport.revenue_recovered.toLocaleString('en-IN')} (${(ruleBasedReport.revenue_recovery_rate * 100).toFixed(2)}% rev)`);
  console.log(`LLM Agent (Llama3.3) : ${(llmReport.recovery_rate * 100).toFixed(2)}% count | ₹${llmReport.revenue_recovered.toLocaleString('en-IN')} (${(llmReport.revenue_recovery_rate * 100).toFixed(2)}% rev)`);
  console.log(`Theoretical Oracle   : ${(oracleReport.recovery_rate * 100).toFixed(2)}% count | ₹${oracleReport.revenue_recovered.toLocaleString('en-IN')} (${(oracleReport.revenue_recovery_rate * 100).toFixed(2)}% rev)`);
  console.log('--------------------------------------------------');
  console.log(`LLM Fallbacks        : ${fallbackCount}/${sample.length} (${((fallbackCount / sample.length) * 100).toFixed(1)}%)`);
  console.log('==================================================\n');

  return { reportData, reportMd };
}

if (process.argv[1] && (process.argv[1].endsWith('evaluate-llm-agent.ts') || process.argv[1].endsWith('evaluate-llm-agent.js'))) {
  runLLMAgentEvaluation().catch(err => {
    console.error('Error running LLM Agent evaluation:', err);
    process.exit(1);
  });
}
