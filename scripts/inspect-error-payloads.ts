import { createApp } from '../server/app.js';
import request from 'supertest';

async function main() {
  const app = createApp({ rateLimitOptions: { max: 2, windowMs: 60000 } });

  // 1. Malformed request body
  const resMalformed = await request(app)
    .post('/api/recovery/analyze')
    .send({ invalid_key: 'malformed_payload' });

  console.log('=== 1. MALFORMED REQUEST RESPONSE (HTTP ' + resMalformed.status + ') ===');
  console.log(JSON.stringify(resMalformed.body, null, 2));

  // 2. Rate limit exceeded (making 3 requests with limit = 2)
  await request(app).get('/api/health');
  await request(app).get('/api/health');
  const resRateLimited = await request(app).get('/api/health');

  console.log('\n=== 2. RATE LIMITED RESPONSE (HTTP ' + resRateLimited.status + ') ===');
  console.log(JSON.stringify(resRateLimited.body, null, 2));
}

main().catch(console.error);
