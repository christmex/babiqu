import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";

const hasUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

const redis = hasUpstash ? Redis.fromEnv() : null;

/** 3 orders per minute per IP. */
export const orderLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "60 s"),
      analytics: false,
      prefix: "rl:order",
    })
  : null;

/** 5 login attempts per 15 minutes per IP. */
export const loginLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "900 s"),
      analytics: false,
      prefix: "rl:login",
    })
  : null;

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export type LimitResult = {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
};

/**
 * Check a rate limit. Returns `{ success: true }` if limiter not configured
 * (fail-open) so the app still works without Upstash env vars.
 */
export async function checkLimit(
  limiter: Ratelimit | null,
  key: string
): Promise<LimitResult> {
  if (!limiter) {
    return { success: true, remaining: 999, reset: 0, limit: 999 };
  }
  const res = await limiter.limit(key);
  return {
    success: res.success,
    remaining: res.remaining,
    reset: res.reset,
    limit: res.limit,
  };
}
