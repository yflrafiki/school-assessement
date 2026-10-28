import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window, per-IP limiter kept in memory. Good enough for one instance;
 * swap the Map for a Redis store when the API runs on several instances.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }): RequestHandler {
  const hits = new Map<string, Window>();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, w] of hits) if (w.resetAt <= now) hits.delete(key);
  }, opts.windowMs);
  timer.unref();

  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === 'true') return next();
    const key = `${opts.name}:${req.ip}`;
    const now = Date.now();
    let w = hits.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, w);
    }
    w.count += 1;
    if (w.count > opts.max) {
      res.setHeader('Retry-After', Math.ceil((w.resetAt - now) / 1000));
      return next(new AppError('RATE_LIMITED', 'Too many attempts. Please wait and try again.'));
    }
    next();
  };
}
