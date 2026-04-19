"use server";

import webpush from "web-push";
import { supabase } from "@/lib/supabase";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@babiqu.id",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

type SerializedSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function subscribeUser(sub: SerializedSubscription) {
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      { onConflict: "endpoint" }
    );
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function unsubscribeUser(endpoint: string) {
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function sendTestNotification(endpoint: string, message: string) {
  const { data: sub } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("endpoint", endpoint)
    .single();
  if (!sub) return { success: false, error: "Subscription not found" };

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: "Babiqu — Test",
        body: message || "Notifikasi test berhasil 🎉",
        url: "/dapur-9c7f3b2a",
      })
    );
    return { success: true };
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 404 || e.statusCode === 410) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    }
    return { success: false, error: e.message || "Failed to send" };
  }
}

export async function sendNewOrderNotification(params: {
  orderId: string;
  name: string;
  total: number;
  itemsSummary: string;
  jam: string;
}) {
  const { data: subs } = await supabase.from("push_subscriptions").select("*");
  if (!subs || subs.length === 0) return { success: true, sent: 0 };

  const rupiah = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(params.total);

  const payload = JSON.stringify({
    title: `🔔 Pesanan baru — ${params.name}`,
    body: `${params.itemsSummary} · ${rupiah} · ${params.jam}`,
    url: "/dapur-9c7f3b2a",
    orderId: params.orderId,
    tag: `order-${params.orderId}`,
  });

  const deadEndpoints: string[] = [];
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush
        .sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        )
        .catch((err: { statusCode?: number }) => {
          if (err.statusCode === 404 || err.statusCode === 410) deadEndpoints.push(s.endpoint);
          throw err;
        })
    )
  );

  if (deadEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return { success: true, sent, total: subs.length };
}
