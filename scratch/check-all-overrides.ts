import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord } from '../lib/types.js';
import { loadLLMCache, selectFixedSample } from '../lib/llm-policy.js';

const cache = loadLLMCache();
const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
const allRecords: CombinedGeneratedRecord[] = JSON.parse(fs.readFileSync(transactionsPath, 'utf-8'));
const sample = selectFixedSample(allRecords, 250, 42);

console.log('--- 250 SAMPLE BREAKDOWN FOR SPECIAL GUARDRAIL CONDITIONS ---');

const canceledInSample = sample.filter(s => s.observable.subscription_status === 'canceled');
console.log(`Canceled sub in sample (${canceledInSample.length}):`, canceledInSample.map(s => s.observable.transaction_id));

const expiredInSample = sample.filter(s => s.observable.failure_reason === 'card_expired');
console.log(`Card expired in sample (${expiredInSample.length}):`, expiredInSample.map(s => `${s.observable.transaction_id} (LLM proposed: ${cache[s.observable.transaction_id]?.action})`));

const maxRetryInSample = sample.filter(s => s.observable.attempt_number >= 4);
console.log(`Max retry (attempt >= 4) in sample (${maxRetryInSample.length}):`, maxRetryInSample.map(s => `${s.observable.transaction_id} (Reason: ${s.observable.failure_reason}, LLM proposed: ${cache[s.observable.transaction_id]?.action})`));

const authFailedAttempt4 = sample.filter(s => s.observable.failure_reason === 'authentication_failed' && s.observable.attempt_number >= 4);
console.log(`Auth failed attempt 4 in sample (${authFailedAttempt4.length}):`, authFailedAttempt4.map(s => `${s.observable.transaction_id} (LLM proposed: ${cache[s.observable.transaction_id]?.action})`));
