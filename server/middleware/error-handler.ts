import { Request, Response, NextFunction } from 'express';
import { sanitizeSecrets } from '../../lib/razorpay-adapter.js';

export function errorHandlerMiddleware(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const rawMessage = err?.message ?? String(err);
  const safeMessage = sanitizeSecrets(rawMessage, process.env.RAZORPAY_KEY_SECRET, process.env.RAZORPAY_KEY_ID);

  const statusCode = err?.status ?? err?.statusCode ?? 500;
  const errorCode = err?.code ?? (statusCode === 404 ? 'TRANSACTION_NOT_FOUND' : 'INTERNAL_ERROR');

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: safeMessage,
      ...(err?.details ? { details: err.details } : {}),
    },
  });
}
