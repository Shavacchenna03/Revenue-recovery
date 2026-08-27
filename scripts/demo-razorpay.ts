import fs from 'node:fs';
import path from 'node:path';
import { CombinedGeneratedRecord, ObservableTransaction, ExecutionResult } from '../lib/types.js';
import { runRecoveryDecision } from '../lib/recovery-orchestrator.js';
import { RazorpayExecutionAdapter } from '../lib/razorpay-adapter.js';

export async function runRazorpayDemo() {
  const isLiveMode = process.argv.includes('--live') || process.env.RAZORPAY_DEMO_LIVE === 'true';

  console.log('================================================================');
  console.log('    REVENUE RECOVERY AUTOPILOT — DAY 6 RAZORPAY ADAPTER DEMO');
  console.log('================================================================');
  console.log(`Execution Mode: ${isLiveMode ? '🔴 LIVE TEST-MODE API CALLS' : '🟢 SAFE MOCK / DRY-RUN MODE (Default)'}`);
  console.log('Principle: "AI proposes, Policy Engine disposes, Razorpay executes."\n');

  const transactionsPath = path.resolve(process.cwd(), 'data', 'fixtures', 'transactions.json');
  if (!fs.existsSync(transactionsPath)) {
    throw new Error(`Transactions fixture not found at ${transactionsPath}.`);
  }

  const rawData = fs.readFileSync(transactionsPath, 'utf-8');
  const allRecords: CombinedGeneratedRecord[] = JSON.parse(rawData);

  // Mock fetch for Dry-Run mode
  const mockFetchFn = async (url: string, init?: any) => {
    const bodyStr = init?.body ? String(init.body) : '{}';
    const body = JSON.parse(bodyStr);
    const linkId = `plink_dryrun_${Math.floor(100000 + Math.random() * 900000)}`;

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: linkId,
        entity: 'payment_link',
        amount: body.amount ?? 10000,
        currency: body.currency ?? 'INR',
        status: 'created',
        short_url: `https://rzp.io/i/${linkId}`,
      }),
    };
  };

  const adapterOptions = isLiveMode
    ? {} // Uses process.env.RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET
    : { keyId: 'rzp_test_dryrunKeyId', keySecret: 'dryrunSecretValue', fetchFn: mockFetchFn as any };

  const razorpayAdapter = new RazorpayExecutionAdapter(adapterOptions);

  // Helper for demo execution
  const executeCase = async (title: string, tx: ObservableTransaction, clientOverride?: any) => {
    console.log('----------------------------------------------------------------');
    console.log(title);
    console.log('----------------------------------------------------------------');
    console.log(`Transaction ID : ${tx.transaction_id}`);
    console.log(`Failure Reason : ${tx.failure_reason ?? 'none'} (Attempt ${tx.attempt_number})`);
    console.log(`Amount         : ₹${tx.amount.toLocaleString('en-IN')}`);

    // 1. Module 1: Governance Pipeline (LLM -> Policy Engine -> Final Action)
    const decision = await runRecoveryDecision(tx, { noCache: false, clientOverride });

    console.log(`\n1. AI Proposal:`);
    console.log(`   Diagnosis  : ${decision.llm_diagnosis ?? 'No diagnosis'}`);
    console.log(`   Confidence : ${typeof decision.llm_confidence === 'number' ? decision.llm_confidence.toFixed(2) : 'N/A'}`);
    console.log(`   Proposed   : ${decision.proposed_action}`);

    console.log(`\n2. Policy Engine Guardrail:`);
    console.log(`   Decision   : ${decision.overridden ? 'OVERRIDDEN' : 'APPROVED'}`);
    console.log(`   Guardrail  : ${decision.guardrail_id}`);
    if (decision.overridden) {
      console.log(`   Reason     : ${decision.guardrail_reason}`);
    }

    console.log(`\n3. Final Approved Action:`);
    console.log(`   ${decision.final_action}`);

    // 2. Razorpay Adapter Execution
    let execResult: ExecutionResult;
    if (decision.final_action === 'escalate') {
      execResult = {
        success: false,
        provider: 'razorpay',
        action: 'escalate',
        unsupported_action: true,
        status_message: 'Application-level action — no direct Razorpay API operation exists for escalate.',
      };
    } else {
      execResult = await razorpayAdapter.executeAction(tx, decision.final_action);
    }

    console.log(`\n4. Razorpay Provider Execution Result:`);
    console.log(`   Provider   : ${execResult.provider}`);
    console.log(`   Success    : ${execResult.success}`);
    console.log(`   Message    : ${execResult.status_message}`);
    if (execResult.provider_reference_id) {
      console.log(`   Ref ID     : ${execResult.provider_reference_id}`);
    }
    if (execResult.unsupported_action) {
      console.log(`   Note       : Unsupported by Razorpay adapter — handled at application level.`);
    }
    console.log('\n');
  };

  // Case 1: Normal Transient Failure (retry_now)
  const case1 = allRecords.find(r => r.observable.transaction_id === 'txn_000006')!.observable;
  await executeCase('CASE 1: NORMAL TRANSIENT FAILURE → Payment Link (retry_now)', case1);

  // Case 2: Expired Card (request_payment_method_update)
  const case2 = allRecords.find(r => r.observable.transaction_id === 'txn_000030')!.observable;
  await executeCase('CASE 2: EXPIRED CARD → Payment Link with Method Choice (request_payment_method_update)', case2);

  // Case 3: Naturally Occurring Override (txn_002790, attempt 4)
  const case3 = allRecords.find(r => r.observable.transaction_id === 'txn_002790')!.observable;
  await executeCase('CASE 3: LIVE LLM OVERRIDE → Application-Level Escalation (escalate)', case3);

  // Case 4: Guaranteed Override (Mock LLM proposing retry_now on attempt 4)
  const case4 = allRecords.find(r => r.observable.transaction_id === 'txn_000026')!.observable;
  const mockUnsafeLLMClient = async () => ({
    decision: {
      diagnosis: 'Mock LLM proposing retry_now on attempt 4.',
      recommended_action: 'retry_now' as const,
      confidence: 0.88,
    },
    rawResponse: '{}',
  });
  await executeCase('CASE 4: MOCK LLM OVERRIDE → Policy Engine Blocks Unsafe Action (escalate)', case4, mockUnsafeLLMClient);

  console.log('================================================================');
  console.log('             RAZORPAY DEMO COMPLETE SUCCESSFULLY');
  console.log('================================================================');
}

if (process.argv[1] && (process.argv[1].endsWith('demo-razorpay.ts') || process.argv[1].endsWith('demo-razorpay.js'))) {
  runRazorpayDemo().catch(err => {
    console.error('Error running Razorpay demo:', err);
    process.exit(1);
  });
}
