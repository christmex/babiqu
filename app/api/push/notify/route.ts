import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { supabase } from "@/lib/supabase";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@babiqu.id",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    orderId: string;
    name: string;
    total: number;
    itemsSummary: string;
    jam: string;
  };

  console.log("[push/notify] incoming", body.name, body.total);

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) {
    console.error("[push/notify] supabase select error", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!subs || subs.length === 0) {
    console.log("[push/notify] no subscriptions");
    return NextResponse.json({ success: true, sent: 0 });
  }

  const rupiah = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(body.total);

  const payload = JSON.stringify({
    title: `🔔 Pesanan baru — ${body.name}`,
    body: `${body.itemsSummary} · ${rupiah} · ${body.jam}`,
    url: "/dapur-9c7f3b2a",
    orderId: body.orderId,
    tag: `order-${body.orderId}`,
  });

  const deadEndpoints: string[] = [];
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush
        .sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        )
        .catch((err: { statusCode?: number; message?: string }) => {
          console.error("[push/notify] send err", err.statusCode, err.message);
          if (err.statusCode === 404 || err.statusCode === 410) deadEndpoints.push(s.endpoint);
          throw err;
        })
    )
  );

  if (deadEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }

  const sent = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[push/notify] sent ${sent}/${subs.length}`);
  return NextResponse.json({ success: true, sent, total: subs.length });
}
