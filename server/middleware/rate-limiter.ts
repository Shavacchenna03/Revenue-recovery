import { Request, Response, NextFunction } from 'express';

export interface RateLimiterOptions {
  windowMs?: number; // Time window in ms (default 60,000ms = 1 minute)
  max?: number;      // Max requests per window (default 60)
}

export function createRateLimiter(options?: RateLimiterOptions) {
  const windowMs = options?.windowMs ?? 60000;
  const maxRequests = options?.max ?? 60;

  const hits = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();

    let record = hits.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      hits.set(ip, record);
      return next();
    }

    if (record.count >= maxRequests) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded. Please wait before making more requests.',
        },
      });
    }

    record.count++;
    return next();
  };
}
