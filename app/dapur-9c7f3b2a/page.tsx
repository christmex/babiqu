"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

type Portion = {
  options: Record<string, string>;
  notes: string;
};

type OrderItem = {
  menu_id: string;
  menu_name: string;
  qty: number;
  portions: Portion[];
  subtotal: number;
};

type Order = {
  id: string;
  created_at: string;
  name: string;
  nomor_wa: string;
  alamat: string;
  jam_antar: string;
  items: OrderItem[];
  notes: string;
  total: number;
};

function formatRupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<"all" | "today">("today");

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setOrders(data || []);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const todayOrders = orders.filter((o) => isToday(o.created_at));
  const displayed = filter === "today" ? todayOrders : orders;
  const todayRevenue = todayOrders.reduce((s, o) => s + o.total, 0);
  const allRevenue = orders.reduce((s, o) => s + o.total, 0);

  return (
    <div className="min-h-screen bg-[#fdf8f2]">
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs tracking-[0.25em] uppercase text-[#7b1d1d] font-semibold mb-0.5">
              Babiqu
            </p>
            <h1 className="text-2xl font-bold text-[#1c1208]">Pesanan Masuk</h1>
            {lastUpdated && (
              <p className="text-xs text-[#b8a898] mt-0.5">
                Terakhir update: {lastUpdated.toLocaleTimeString("id-ID")}
              </p>
            )}
          </div>
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="px-4 py-2 bg-[#7b1d1d] text-white text-sm font-semibold rounded-xl hover:bg-[#6a1717] transition disabled:opacity-50"
          >
            {loading ? "..." : "Refresh"}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-white rounded-2xl border border-[#e8ddd0] p-4">
            <p className="text-[11px] text-[#8a7060] uppercase tracking-widest font-semibold">
              Pesanan Hari Ini
            </p>
            <p className="text-3xl font-bold text-[#1c1208] mt-1">{todayOrders.length}</p>
            <p className="text-xs text-[#7b1d1d] font-semibold mt-0.5">{formatRupiah(todayRevenue)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-[#e8ddd0] p-4">
            <p className="text-[11px] text-[#8a7060] uppercase tracking-widest font-semibold">
              Total Semua
            </p>
            <p className="text-3xl font-bold text-[#1c1208] mt-1">{orders.length}</p>
            <p className="text-xs text-[#7b1d1d] font-semibold mt-0.5">{formatRupiah(allRevenue)}</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {(["today", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                filter === f
                  ? "bg-[#7b1d1d] text-white border-[#7b1d1d]"
                  : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
              }`}
            >
              {f === "today" ? `Hari Ini (${todayOrders.length})` : `Semua (${orders.length})`}
            </button>
          ))}
        </div>

        {/* Orders */}
        <div className="space-y-4">
          {loading && (
            <p className="text-center text-[#8a7060] py-12">Memuat pesanan...</p>
          )}

          {!loading && displayed.length === 0 && (
            <div className="text-center py-12 text-[#b8a898]">
              {filter === "today" ? "Belum ada pesanan hari ini." : "Belum ada pesanan."}
            </div>
          )}

          {displayed.map((order, orderIdx) => {
            const prev = displayed[orderIdx - 1];
            const showDateHeader =
              orderIdx === 0 ||
              new Date(order.created_at).toDateString() !==
                new Date(prev.created_at).toDateString();

            return (
              <div key={order.id}>
                {showDateHeader && filter === "all" && (
                  <p className="text-xs font-semibold text-[#8a7060] uppercase tracking-wider px-1 pt-2 pb-1">
                    {isToday(order.created_at)
                      ? "Hari Ini"
                      : new Intl.DateTimeFormat("id-ID", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        }).format(new Date(order.created_at))}
                  </p>
                )}

                <div className="bg-white rounded-2xl border border-[#e8ddd0] p-5">
                  {/* Top row: name + time badge */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="font-bold text-[#1c1208] text-base leading-snug">
                        {order.name}
                      </p>
                      <a
                        href={`https://wa.me/${order.nomor_wa.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[#7b1d1d] hover:underline font-medium"
                      >
                        {order.nomor_wa}
                      </a>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-1 ${
                          order.jam_antar.includes("Siang")
                            ? "bg-amber-100 text-amber-700"
                            : "bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        {order.jam_antar.includes("Siang") ? "Siang" : "Malam"}
                      </span>
                      <p className="text-[11px] text-[#b8a898]">
                        {formatDate(order.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Address */}
                  <p className="text-sm text-[#5a3e2b] bg-[#fdf8f2] rounded-lg px-3 py-2 mb-3 leading-relaxed">
                    {order.alamat}
                  </p>

                  {/* Items */}
                  <div className="space-y-2 mb-3">
                    {order.items?.map((item, i) => (
                      <div key={i} className="border-l-2 border-[#e8ddd0] pl-3">
                        <div className="flex justify-between items-baseline gap-2">
                          <p className="text-sm font-semibold text-[#1c1208]">
                            {item.qty}× {item.menu_name}
                          </p>
                          <span className="text-xs text-[#8a7060] shrink-0">
                            {formatRupiah(item.subtotal)}
                          </span>
                        </div>
                        {item.portions?.map((p, pi) => (
                          <p key={pi} className="text-xs text-[#8a7060] mt-0.5">
                            {item.qty > 1 && (
                              <span className="font-semibold text-[#a07850]">
                                P{pi + 1}{" "}
                              </span>
                            )}
                            {Object.values(p.options)
                              .filter(Boolean)
                              .join(" · ")}
                            {p.notes?.trim() && (
                              <span className="text-[#a07850] italic">
                                {" "}
                                · {p.notes}
                              </span>
                            )}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Notes */}
                  {order.notes?.trim() && (
                    <p className="text-xs text-[#a07850] italic bg-amber-50 rounded-lg px-3 py-1.5 mb-3">
                      Catatan: {order.notes}
                    </p>
                  )}

                  {/* Total */}
                  <div className="flex items-center justify-between border-t border-[#f0e8de] pt-3">
                    <span className="text-xs text-[#8a7060]">Total</span>
                    <span className="font-bold text-[#7b1d1d] text-base">
                      {formatRupiah(order.total)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
