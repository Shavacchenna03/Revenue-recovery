import fs from 'node:fs';
import path from 'node:path';
import { formatObservableTransactionPrompt } from '../lib/llm-client.js';
import { ObservableTransaction } from '../lib/types.js';

const envPath = path.resolve(process.cwd(), '.env');
const content = fs.readFileSync(envPath, 'utf-8');
const match = content.match(/GROQ_API_KEY=["']?([^"'\r\n]+)["']?/);
const apiKey = match ? match[1] : '';

const sampleTx: ObservableTransaction = {
  transaction_id: 'txn_001',
  customer_id: 'cust_001',
  amount: 2500,
  currency: 'INR',
  timestamp: '2026-07-15T12:00:00.000Z',
  payment_method: 'card',
  payment_status: 'failed',
  failure_reason: 'card_expired',
  attempt_number: 1,
  customer_tenure_months: 12,
  previous_transactions_count: 10,
  previous_success_rate: 0.8,
  average_transaction_value: 2500,
  days_since_last_payment: 15,
  subscription_status: 'active',
  device_type: 'mobile_android',
  checkout_completed: true,
};

const prompt = formatObservableTransactionPrompt(sampleTx);

const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 300,
    response_format: { type: 'json_object' }
  })
});

console.log('Status:', res.status);
const data: any = await res.json();
console.log('Response:', data.choices[0].message.content);
