import { NextRequest, NextResponse } from "next/server";
import { LOGIN_LIMIT, checkLimit, getClientIp } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = await checkLimit(LOGIN_LIMIT, ip);

  if (!limit.success) {
    return NextResponse.json(
      { ok: false, locked: true, retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
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
