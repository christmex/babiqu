import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";

export type LimitConfig = {
  /** Max allowed hits within `windowSeconds`. */
  limit: number;
  /** Sliding window in seconds. */
  windowSeconds: number;
  /** Namespace prefix so different limiters don't collide. */
  prefix: string;
};

export const ORDER_LIMIT: LimitConfig = {
  prefix: "order",
  limit: 3,
  windowSeconds: 60,
};

export const LOGIN_LIMIT: LimitConfig = {
  prefix: "login",
  limit: 5,
  windowSeconds: 15 * 60,
};

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export type LimitResult = {
  success: boolean;
  /** Approximate remaining hits — based on config limit if allowed. */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
  limit: number;
};

/**
 * Atomically check + record a rate limit hit for `key` under `cfg`.
 * Calls Supabase `check_rate_limit` Postgres function.
 * On DB failure, fails OPEN (allow) to avoid locking out legit users.
 */
export async function checkLimit(
  cfg: LimitConfig,
  key: string
): Promise<LimitResult> {
  const fullKey = `${cfg.prefix}:${key}`;
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: fullKey,
    p_limit: cfg.limit,
    p_window_seconds: cfg.windowSeconds,
  });

  if (error) {
    console.error("[ratelimit] rpc error, failing open:", error.message);
    return {
      success: true,
      remaining: cfg.limit,
      retryAfter: 0,
      limit: cfg.limit,
    };
  }

  const allowed = Boolean(data);
  return {
    success: allowed,
    remaining: allowed ? Math.max(0, cfg.limit - 1) : 0,
    retryAfter: allowed ? 0 : cfg.windowSeconds,
    limit: cfg.limit,
  };
}
