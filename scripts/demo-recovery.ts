import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord } from '../lib/types.js';
import { runSimulatedRecoveryDecision } from '../lib/recovery-orchestrator-simulated.js';
import { explainRecoveryDecision } from '../lib/recovery-orchestrator.js';

export async function runDemo() {
  const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
  if (!fs.existsSync(transactionsPath)) {
    throw new Error(`Transactions fixture not found at ${transactionsPath}.`);
  }

  const rawData = fs.readFileSync(transactionsPath, 'utf-8');
  const allRecords: CombinedGeneratedRecord[] = JSON.parse(rawData);

  console.log('================================================================');
  console.log('       REVENUE RECOVERY AUTOPILOT — DAY 5 DEMO ORCHESTRATOR');
  console.log('================================================================');
  console.log('Principle: "AI proposes, Policy Engine disposes."\n');

  // Case 1: Normal transient failure (network_timeout, attempt 1)
  const case1Record = allRecords.find(r => r.observable.transaction_id === 'txn_000006') ?? allRecords.find(r => r.observable.failure_reason === 'network_timeout' && r.observable.attempt_number === 1)!;
  console.log('----------------------------------------------------------------');
  console.log('CASE 1: NORMAL TRANSIENT FAILURE (network_timeout, attempt 1)');
  console.log('----------------------------------------------------------------');
  const result1 = await runSimulatedRecoveryDecision(case1Record);
  console.log(explainRecoveryDecision(result1));
  console.log('\n');

  // Case 2: Expired card (card_expired, attempt 1)
  const case2Record = allRecords.find(r => r.observable.transaction_id === 'txn_000030') ?? allRecords.find(r => r.observable.failure_reason === 'card_expired' && r.observable.attempt_number === 1)!;
  console.log('----------------------------------------------------------------');
  console.log('CASE 2: EXPIRED CARD HANDLING (card_expired, attempt 1)');
  console.log('----------------------------------------------------------------');
  const result2 = await runSimulatedRecoveryDecision(case2Record);
  console.log(explainRecoveryDecision(result2));
  console.log('\n');

  // Case 3: Naturally occurring live LLM override (txn_002790: bank_server_down, attempt 4)
  const case3Record = allRecords.find(r => r.observable.transaction_id === 'txn_002790') ?? allRecords.find(r => r.observable.attempt_number >= 4 && r.observable.failure_reason === 'bank_server_down')!;
  console.log('----------------------------------------------------------------');
  console.log('CASE 3: NATURALLY OCCURRING LIVE LLM OVERRIDE (txn_002790, attempt 4)');
  console.log('----------------------------------------------------------------');
  const result3 = await runSimulatedRecoveryDecision(case3Record);
  console.log(explainRecoveryDecision(result3));
  console.log('\n');

  // Case 4: LLM Fallback Case (Injecting failing LLM client)
  const case4Record = allRecords.find(r => r.observable.transaction_id === 'txn_000061') ?? allRecords[0]!;
  console.log('----------------------------------------------------------------');
  console.log('CASE 4: LLM FALLBACK CASE (Simulated API Failure via Dependency Injection)');
  console.log('----------------------------------------------------------------');
  const mockFailingClient = async () => {
    throw new Error('Groq API HTTP 503: Service Temporarily Unavailable');
  };
  const result4 = await runSimulatedRecoveryDecision(case4Record, { noCache: true, clientOverride: mockFailingClient });
  console.log(explainRecoveryDecision(result4));
  console.log('\n');

  // Case 5: Guaranteed Override Demonstration (Mock LLM Proposal)
  const case5Record = allRecords.find(r => r.observable.transaction_id === 'txn_000026') ?? allRecords.find(r => r.observable.attempt_number >= 4 && r.observable.failure_reason === 'network_timeout')!;
  console.log('----------------------------------------------------------------');
  console.log('Case 5: Guaranteed Override Demonstration (Mock LLM Proposal)');
  console.log('----------------------------------------------------------------');
  const mockUnsafeLLMClient = async () => {
    return {
      decision: {
        diagnosis: 'Mock LLM proposing retry on attempt 4 despite maximum attempt limit.',
        recommended_action: 'retry_now' as const,
        confidence: 0.88,
      },
      rawResponse: '{"diagnosis":"Mock LLM proposing retry on attempt 4.","recommended_action":"retry_now","confidence":0.88}',
    };
  };
  const result5 = await runSimulatedRecoveryDecision(case5Record, { noCache: true, clientOverride: mockUnsafeLLMClient });
  console.log(explainRecoveryDecision(result5));
  console.log('----------------------------------------------------------------\n');

  console.log('================================================================');
  console.log('                     DEMO COMPLETE SUCCESSFULLY');
  console.log('================================================================');
}

if (process.argv[1] && (process.argv[1].endsWith('demo-recovery.ts') || process.argv[1].endsWith('demo-recovery.js'))) {
  runDemo().catch(err => {
    console.error('Error running demo:', err);
    process.exit(1);
  });
}
