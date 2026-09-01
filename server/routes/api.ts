import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { TransactionDataStore } from '../data-store.js';
import { 
  serializeObservableTransactionDTO, 
  serializeAnalysisResponseDTO 
} from '../dto.js';
import { runRecoveryDecision } from '../../lib/recovery-orchestrator.js';
import { runSimulatedRecoveryDecision } from '../../lib/recovery-orchestrator-simulated.js';
import { SimulatorRecoveryExecutor, RazorpayRecoveryExecutor } from '../../lib/recovery-executor.js';
import { RecoveryExecutor, ObservableTransaction } from '../../lib/types.js';
import { SelectLLMActionOptions } from '../../lib/llm-policy.js';

export interface ApiRouterOptions {
  dataStore?: TransactionDataStore;
  llmOptions?: SelectLLMActionOptions;
  razorpayExecutorOverride?: RecoveryExecutor;
  enableTestCrashRoute?: boolean;
}

const PaymentMethodSchema = z.enum(['upi', 'card', 'netbanking', 'wallet']);
const PaymentStatusSchema = z.enum(['failed', 'processing', 'success']);
const FailureReasonSchema = z.enum([
  'insufficient_funds',
  'authentication_failed',
  'network_timeout',
  'card_expired',
  'bank_server_down',
  'technical_error'
]).nullable();
const SubscriptionStatusSchema = z.enum(['active', 'past_due', 'canceled', 'unpaid']);
const DeviceTypeSchema = z.enum(['mobile_android', 'mobile_ios', 'desktop_web', 'mobile_web']);

const ObservableTransactionSchema = z.object({
  transaction_id: z.string().min(1),
  customer_id: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string(),
  timestamp: z.string(),
  payment_method: PaymentMethodSchema,
  payment_status: PaymentStatusSchema,
  failure_reason: FailureReasonSchema,
  attempt_number: z.number().int().min(1),
  customer_tenure_months: z.number(),
  previous_transactions_count: z.number(),
  previous_success_rate: z.number(),
  average_transaction_value: z.number(),
  days_since_last_payment: z.number(),
  subscription_status: SubscriptionStatusSchema,
  device_type: DeviceTypeSchema,
  checkout_completed: z.boolean(),
});

const AnalyzeRequestSchema = z.object({
  transaction_id: z.string().optional(),
  transaction: ObservableTransactionSchema.optional(),
  executionMode: z.enum(['simulator', 'razorpay']).optional().default('simulator'),
}).refine(data => Boolean(data.transaction_id) || Boolean(data.transaction), {
  message: 'Must provide either transaction_id or transaction object.',
  path: ['transaction_id'],
});

const TransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  failure_reason: z.string().optional(),
  payment_method: z.string().optional(),
  subscription_status: z.string().optional(),
});

export function createApiRouter(options?: ApiRouterOptions): Router {
  const router = Router();
  const dataStore = options?.dataStore ?? new TransactionDataStore();

  // GET /api/health
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  if (options?.enableTestCrashRoute) {
    router.get('/test-crash', (_req: Request, _res: Response) => {
      throw new Error('Simulated crash error');
    });
  }

  // GET /api/transactions
  router.get('/transactions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const queryResult = TransactionsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: queryResult.error.format(),
          },
        });
      }

      const pOptions: any = {
        limit: queryResult.data.limit,
        offset: queryResult.data.offset,
      };
      if (queryResult.data.failure_reason !== undefined) pOptions.failure_reason = queryResult.data.failure_reason;
      if (queryResult.data.payment_method !== undefined) pOptions.payment_method = queryResult.data.payment_method;
      if (queryResult.data.subscription_status !== undefined) pOptions.subscription_status = queryResult.data.subscription_status;

      const paginated = dataStore.getPaginatedTransactions(pOptions);
      return res.json(paginated);
    } catch (err) {
      return next(err);
    }
  });

  // GET /api/transactions/:id
  router.get('/transactions/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const paramId = req.params.id;
      const transactionId = Array.isArray(paramId) ? paramId[0] : paramId;

      if (!transactionId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Transaction ID param is required.',
          },
        });
      }

      const record = dataStore.getRecordById(transactionId);

      if (!record) {
        return res.status(404).json({
          error: {
            code: 'TRANSACTION_NOT_FOUND',
            message: `Transaction with ID '${transactionId}' was not found.`,
          },
        });
      }

      const dto = serializeObservableTransactionDTO(record.observable);
      return res.json(dto);
    } catch (err) {
      return next(err);
    }
  });

  // POST /api/recovery/analyze
  router.post('/recovery/analyze', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Request Validation (Short-circuits before LLM/Executor calls)
      const parseResult = AnalyzeRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request payload format',
            details: parseResult.error.format(),
          },
        });
      }

      const { transaction_id, transaction, executionMode } = parseResult.data;

      // 2. Shape A: Fixture Lookup via transaction_id
      if (transaction_id) {
        const record = dataStore.getRecordById(transaction_id);
        if (!record) {
          return res.status(404).json({
            error: {
              code: 'TRANSACTION_NOT_FOUND',
              message: `Transaction with ID '${transaction_id}' was not found in fixture dataset.`,
            },
          });
        }

        if (executionMode === 'simulator') {
          // Module 2 simulated execution against ground truth
          const simOutcome = await runSimulatedRecoveryDecision(record, options?.llmOptions);
          const simExecutor = new SimulatorRecoveryExecutor();
          const execRes = await simExecutor.execute(record.observable, simOutcome.decision.final_action, record.hidden);
          const dto = serializeAnalysisResponseDTO(record.observable, simOutcome.decision, execRes, simOutcome);
          return res.json(dto);
        } else {
          // Razorpay mode for fixture transaction
          const decision = await runRecoveryDecision(record.observable, options?.llmOptions);
          const rzpExecutor = options?.razorpayExecutorOverride ?? new RazorpayRecoveryExecutor();
          const execRes = await rzpExecutor.execute(record.observable, decision.final_action);
          const dto = serializeAnalysisResponseDTO(record.observable, decision, execRes);
          return res.json(dto);
        }
      }

      // 3. Shape B: Raw transaction body passed directly (NOT in fixture)
      if (transaction) {
        if (executionMode === 'simulator') {
          return res.status(400).json({
            error: {
              code: 'SIMULATION_REQUIRES_FIXTURE_TRANSACTION',
              message: 'Simulation mode requires a known fixture transaction with hidden ground truth data. Use executionMode: "razorpay" or pass a transaction_id.',
            },
          });
        }

        // Razorpay mode for custom raw transaction
        const typedTx = transaction as ObservableTransaction;
        const decision = await runRecoveryDecision(typedTx, options?.llmOptions);
        const rzpExecutor = options?.razorpayExecutorOverride ?? new RazorpayRecoveryExecutor();
        const execRes = await rzpExecutor.execute(typedTx, decision.final_action);
        const dto = serializeAnalysisResponseDTO(typedTx, decision, execRes);
        return res.json(dto);
      }

      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Must provide either transaction_id or transaction object.',
        },
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
