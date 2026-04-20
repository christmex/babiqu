import { NextRequest, NextResponse } from "next/server";
import { loginLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = await checkLimit(loginLimiter, ip);

  if (!limit.success) {
    const retryAfter = Math.max(0, Math.ceil((limit.reset - Date.now()) / 1000));
    return NextResponse.json(
      { ok: false, locked: true, retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let password: string | undefined;
  try {
    const body = (await req.json()) as { password?: string };
    password = body.password;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 }
    );
  }

  const ok = typeof password === "string" && password === expected;
  return NextResponse.json({
    ok,
    remaining: limit.remaining,
    limit: limit.limit,
  });
}
