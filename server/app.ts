import express from 'express';
import { createApiRouter, ApiRouterOptions } from './routes/api.js';
import { createRateLimiter, RateLimiterOptions } from './middleware/rate-limiter.js';
import { errorHandlerMiddleware } from './middleware/error-handler.js';
import { TransactionDataStore } from './data-store.js';
import { SelectLLMActionOptions } from '../lib/llm-policy.js';
import { RecoveryExecutor } from '../lib/types.js';

export interface AppOptions {
  dataStore?: TransactionDataStore;
  llmOptions?: SelectLLMActionOptions;
  razorpayExecutorOverride?: RecoveryExecutor;
  rateLimitOptions?: RateLimiterOptions;
  enableTestCrashRoute?: boolean;
}

export function createApp(options?: AppOptions) {
  const app = express();

  app.use(express.json());

  // Rate Limiter for /api routes
  app.use('/api', createRateLimiter(options?.rateLimitOptions));

  const routerOpts: ApiRouterOptions = {};
  if (options?.dataStore) routerOpts.dataStore = options.dataStore;
  if (options?.llmOptions) routerOpts.llmOptions = options.llmOptions;
  if (options?.razorpayExecutorOverride) routerOpts.razorpayExecutorOverride = options.razorpayExecutorOverride;
  if (options?.enableTestCrashRoute) routerOpts.enableTestCrashRoute = options.enableTestCrashRoute;

  // API Routes
  app.use('/api', createApiRouter(routerOpts));

  // Top-Level Error Handling Middleware
  app.use(errorHandlerMiddleware);

  return app;
}
