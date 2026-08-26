import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
const content = fs.readFileSync(envPath, 'utf-8');
const match = content.match(/GROQ_API_KEY=["']?([^"'\r\n]+)["']?/);
const apiKey = match ? match[1] : '';

const modelsToTest = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

for (const model of modelsToTest) {
  console.log(`Testing model: ${model}...`);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Return a JSON object with key "status": "ok".' }],
        temperature: 0.2,
        max_tokens: 100,
        response_format: { type: 'json_object' }
      })
    });
    console.log(`Status for ${model}:`, res.status);
    const data: any = await res.json();
    if (res.ok) {
      console.log(`SUCCESS [${model}]:`, data.choices[0].message.content);
    } else {
      console.log(`ERROR [${model}]:`, data);
    }
  } catch (err: any) {
    console.log(`EXCEPTION [${model}]:`, err.message);
  }
}
