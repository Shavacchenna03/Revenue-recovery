import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
const content = fs.readFileSync(envPath, 'utf-8');
const match = content.match(/GROQ_API_KEY=["']?([^"'\r\n]+)["']?/);
const apiKey = match ? match[1] : '';

console.log('Using API Key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING');

const res = await fetch('https://api.groq.com/openai/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` }
});

const data = await res.json();
console.log('Status:', res.status);
console.log('Available Models:', data.data ? data.data.map((m: any) => m.id) : data);
