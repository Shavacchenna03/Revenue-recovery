import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord } from '../lib/types.js';
import { loadLLMCache } from '../lib/llm-policy.js';
import { evaluatePolicyGuardrails } from '../lib/policy-engine.js';

const cache = loadLLMCache();
const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
const allRecords: CombinedGeneratedRecord[] = JSON.parse(fs.readFileSync(transactionsPath, 'utf-8'));

console.log(`Cache has ${Object.keys(cache).length} entries. Total records: ${allRecords.length}.`);

const overridesByGuardrail: Record<string, Array<{ txId: string; proposed: string; approved: string; reason: string }>> = {};

for (const [txId, llmRes] of Object.entries(cache)) {
  const rec = allRecords.find(r => r.observable.transaction_id === txId);
  if (!rec) continue;

  const decision = evaluatePolicyGuardrails(rec.observable, llmRes.action);
  if (decision.overridden) {
    if (!overridesByGuardrail[decision.guardrail_id]) {
      overridesByGuardrail[decision.guardrail_id] = [];
    }
    overridesByGuardrail[decision.guardrail_id]!.push({
      txId,
      proposed: llmRes.action,
      approved: decision.approved_action,
      reason: decision.reason,
    });
  }
}

console.log('\n--- CACHED OVERRIDES FOUND ---');
console.log(JSON.stringify(overridesByGuardrail, null, 2));
