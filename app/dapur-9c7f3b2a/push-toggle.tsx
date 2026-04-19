"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { subscribeUser, unsubscribeUser, sendTestNotification } from "../push-actions";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof window !== "undefined" ? window.atob(base64) : "";
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setSupported(true);
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setSubscribed(true);
        setEndpoint(sub.endpoint);
      }
    });
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  async function handleSubscribe() {
    setLoading(true);
    setMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMsg("Izin notifikasi ditolak");
        setLoading(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      const serialized = JSON.parse(JSON.stringify(sub)) as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      const res = await subscribeUser(serialized);
      if (res.success) {
        setSubscribed(true);
        setEndpoint(sub.endpoint);
        setMsg("Notifikasi aktif ✓");
      } else {
        setMsg(`Gagal: ${res.error}`);
      }
    } catch (err) {
      setMsg(`Error: ${(err as Error).message}`);
    }
    setLoading(false);
  }

  async function handleUnsubscribe() {
    setLoading(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await unsubscribeUser(sub.endpoint);
      }
      setSubscribed(false);
      setEndpoint(null);
      setMsg("Notifikasi dimatikan");
    } catch (err) {
      setMsg(`Error: ${(err as Error).message}`);
    }
    setLoading(false);
  }

  async function handleTest() {
    if (!endpoint) return;
    setLoading(true);
    const res = await sendTestNotification(endpoint, "Tes dari admin panel 🎉");
    setMsg(res.success ? "Test terkirim ✓" : `Gagal: ${res.error}`);
    setLoading(false);
  }

  if (!supported) return null;

  return (
    <div className="flex items-center gap-2">
      {subscribed ? (
        <>
          <button
            onClick={handleTest}
            disabled={loading}
            title="Kirim test notif"
            className="flex items-center justify-center w-9 h-9 bg-[#1c1c1e] rounded-xl border border-white/[0.08] text-amber-400 hover:border-amber-500/40 transition disabled:opacity-40"
          >
            <BellRing size={15} />
          </button>
          <button
            onClick={handleUnsubscribe}
            disabled={loading}
            title="Matikan notifikasi"
            className="flex items-center justify-center w-9 h-9 bg-[#1c1c1e] rounded-xl border border-white/[0.08] text-gray-500 hover:text-red-400 transition disabled:opacity-40"
          >
            <BellOff size={15} />
          </button>
        </>
      ) : (
        <button
          onClick={handleSubscribe}
          disabled={loading}
          title="Aktifkan notifikasi pesanan baru"
          className="flex items-center justify-center w-9 h-9 bg-[#1c1c1e] rounded-xl border border-white/[0.08] text-gray-500 hover:text-amber-400 hover:border-amber-500/40 transition disabled:opacity-40"
        >
          <Bell size={15} />
        </button>
      )}
      {msg && (
        <span className="absolute top-16 right-4 bg-[#1c1c1e] border border-white/10 text-xs text-gray-300 px-3 py-1.5 rounded-xl shadow-lg z-50">
          {msg}
        </span>
      )}
    </div>
  );
}
