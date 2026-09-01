import { createApp } from './app.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`  REVENUE RECOVERY AUTOPILOT — APPLICATION API SERVER (DAY 7)`);
  console.log(`================================================================`);
  console.log(`Server listening at http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  GET  http://localhost:${PORT}/api/transactions`);
  console.log(`  GET  http://localhost:${PORT}/api/transactions/:id`);
  console.log(`  POST http://localhost:${PORT}/api/recovery/analyze`);
  console.log(`================================================================`);
});
