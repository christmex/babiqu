import { NextRequest, NextResponse } from "next/server";
import { orderLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { supabase } from "@/lib/supabase";

type Body = {
  name: string;
  nomor_wa: string;
  alamat: string;
  jam_antar: string;
  notes?: string;
  items: Array<{
    menu_id: string;
    menu_name: string;
    qty: number;
    portions: Array<{ options: Record<string, string>; notes: string }>;
    subtotal: number;
  }>;
  total: number;
  batch_id: string | null;
  payment_method: string;
  payment_proof_url: string | null;
};

function isValidBody(b: unknown): b is Body {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.nomor_wa === "string" &&
    typeof o.alamat === "string" &&
    typeof o.jam_antar === "string" &&
    Array.isArray(o.items) &&
    typeof o.total === "number" &&
    typeof o.payment_method === "string"
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = await checkLimit(orderLimiter, ip);
  if (!limit.success) {
    const retryAfter = Math.max(0, Math.ceil((limit.reset - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: `Terlalu banyak percobaan. Coba lagi dalam ${retryAfter} detik.`,
        rateLimited: true,
        retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Basic server-side validation
  if (!body.name.trim() || !body.alamat.trim() || body.items.length === 0 || body.total <= 0) {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }

  const { data: inserted, error } = await supabase
    .from("orders")
    .insert({
      name: body.name,
      nomor_wa: body.nomor_wa,
      alamat: body.alamat,
      jam_antar: body.jam_antar,
      items: body.items,
      notes: body.notes ?? "",
      total: body.total,
      batch_id: body.batch_id,
      payment_method: body.payment_method,
      payment_proof_url: body.payment_proof_url,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[orders/create] insert error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Trigger push notification (fire-and-forget, same origin so no CORS)
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const pushUrl = host ? `${proto}://${host}/api/push/notify` : null;
  if (pushUrl) {
    const itemsSummary = body.items
      .map((it) => `${it.qty}× ${it.menu_name.split(" ").slice(0, 2).join(" ")}`)
      .join(", ");
    fetch(pushUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: inserted?.id ?? "",
        name: body.name,
        total: body.total,
        itemsSummary,
        jam: body.jam_antar.includes("Siang") ? "Siang" : "Malam",
      }),
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    id: inserted?.id,
    remaining: limit.remaining,
  });
}
