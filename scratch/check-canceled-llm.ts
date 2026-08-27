import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord } from '../lib/types.js';
import { loadLLMCache, selectFixedSample } from '../lib/llm-policy.js';
import { evaluatePolicyGuardrails } from '../lib/policy-engine.js';

const cache = loadLLMCache();
const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
const allRecords: CombinedGeneratedRecord[] = JSON.parse(fs.readFileSync(transactionsPath, 'utf-8'));
const sample = selectFixedSample(allRecords, 250, 42);

const canceledInSample = sample.filter(s => s.observable.subscription_status === 'canceled');
for (const s of canceledInSample) {
  const txId = s.observable.transaction_id;
  const llmRes = cache[txId];
  if (llmRes) {
    const decision = evaluatePolicyGuardrails(s.observable, llmRes.action);
    console.log(`Tx ${txId}: failure=${s.observable.failure_reason}, attempt=${s.observable.attempt_number}, LLM proposed=${llmRes.action}, approved=${decision.approved_action}, overridden=${decision.overridden}, guardrail=${decision.guardrail_id}`);
  }
}
