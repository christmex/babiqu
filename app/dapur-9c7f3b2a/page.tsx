"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Portion = { options: Record<string, string>; notes: string };
type OrderItem = { menu_id: string; menu_name: string; qty: number; portions: Portion[]; subtotal: number };
type OrderStatus = "active" | "delivered" | "cancelled";
type Order = {
  id: string; created_at: string; name: string; nomor_wa: string;
  alamat: string; jam_antar: string; items: OrderItem[];
  notes: string; total: number; status: OrderStatus; cancel_reason: string;
  batch_id: string | null;
};
type Expense = {
  id: string; created_at: string; date: string;
  amount: number; description: string; category: string;
  batch_id: string | null;
};
type Batch = {
  id: string; created_at: string; label: string;
  open_date: string; close_date: string; delivery_date: string; notes: string;
};

const EXPENSE_CATEGORIES = ["Bahan Baku", "Operasional", "Kemasan", "Transportasi", "Lainnya"];
const PERIOD_LABELS = { today: "Hari Ini", week: "7 Hari", month: "30 Hari", all: "Semua" } as const;
type Period = keyof typeof PERIOD_LABELS;

function formatBatchDate(d: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d + "T00:00:00"));
}
function isBatchActive(b: Batch) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  return b.open_date <= today && b.close_date >= today;
}
function isBatchUpcoming(b: Batch) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  return b.open_date > today;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRupiah(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n);
}
function formatDate(iso: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}
function formatDateShort(iso: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
}
function isInPeriod(iso: string, period: Period) {
  const d = new Date(iso);
  const now = new Date();
  if (period === "today") return d.toDateString() === now.toDateString();
  const cutoff = new Date(now);
  if (period === "week") cutoff.setDate(now.getDate() - 7);
  else if (period === "month") cutoff.setDate(now.getDate() - 30);
  else return true;
  return d >= cutoff;
}
function isToday(iso: string) { return new Date(iso).toDateString() === new Date().toDateString(); }

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [tab, setTab] = useState<"pesanan" | "keuangan" | "pengeluaran" | "batch">("pesanan");
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Cancel state
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);

  // Expense form
  const [expForm, setExpForm] = useState({
    description: "", amount: "", category: "Bahan Baku",
    date: new Date().toISOString().slice(0, 10), batch_id: "",
  });
  const [expLoading, setExpLoading] = useState(false);

  // Batch form
  const todayIso = new Date().toISOString().slice(0, 10);
  const [batchForm, setBatchForm] = useState({
    label: "", open_date: todayIso, close_date: todayIso, delivery_date: todayIso, notes: "",
  });
  const [batchLoading, setBatchLoading] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);

  // Filters
  const [orderFilter, setOrderFilter] = useState<"today" | "all">("today");
  const [period, setPeriod] = useState<Period>("today");
  const [showDelivery, setShowDelivery] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: ord }, { data: exp }, { data: bat }] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("expenses").select("*").order("date", { ascending: false }).limit(500),
      supabase.from("batches").select("*").order("open_date", { ascending: false }).limit(100),
    ]);
    setOrders((ord as Order[]) || []);
    setExpenses(exp || []);
    setBatches(bat || []);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Status helpers ────────────────────────────────────────────────────────

  async function updateStatus(orderId: string, status: OrderStatus, extra?: { cancel_reason?: string }) {
    await supabase.from("orders").update({ status, ...extra }).eq("id", orderId);
    setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status, ...(extra || {}) } : o));
  }

  async function handleCancel(orderId: string) {
    if (!cancelReason.trim()) return;
    setCancelLoading(true);
    await updateStatus(orderId, "cancelled", { cancel_reason: cancelReason.trim() });
    setCancelling(null); setCancelReason(""); setCancelLoading(false);
  }

  async function handleDeliver(orderId: string) {
    await updateStatus(orderId, "delivered");
  }

  async function handleRestore(orderId: string) {
    await updateStatus(orderId, "active", { cancel_reason: "" });
  }

  // ── Add expense ──────────────────────────────────────────────────────────

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseInt(expForm.amount.replace(/\D/g, ""));
    if (!expForm.description.trim() || !amount) return;
    setExpLoading(true);
    const { data } = await supabase.from("expenses").insert({
      description: expForm.description.trim(), amount,
      category: expForm.category, date: expForm.date,
      batch_id: expForm.batch_id || null,
    }).select().single();
    if (data) setExpenses((prev) => [data, ...prev]);
    setExpForm({ description: "", amount: "", category: "Bahan Baku", date: new Date().toISOString().slice(0, 10), batch_id: "" });
    setExpLoading(false);
  }

  async function handleAddBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!batchForm.label.trim()) return;
    setBatchLoading(true);
    const { data } = await supabase.from("batches").insert({
      label: batchForm.label.trim(),
      open_date: batchForm.open_date,
      close_date: batchForm.close_date,
      delivery_date: batchForm.delivery_date,
      notes: batchForm.notes.trim(),
    }).select().single();
    if (data) setBatches((prev) => [data, ...prev]);
    setBatchForm({ label: "", open_date: todayIso, close_date: todayIso, delivery_date: todayIso, notes: "" });
    setBatchLoading(false);
  }

  async function handleDeleteBatch(id: string) {
    await supabase.from("batches").delete().eq("id", id);
    setBatches((prev) => prev.filter((b) => b.id !== id));
    setDeletingBatch(null);
  }

  async function handleDeleteExpense(id: string) {
    await supabase.from("expenses").delete().eq("id", id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const todayOrders = orders.filter((o) => isToday(o.created_at));
  const todayActive = todayOrders.filter((o) => o.status === "active");
  const todayDelivered = todayOrders.filter((o) => o.status === "delivered");
  const activeOrders = orders.filter((o) => o.status !== "cancelled");

  // Today's delivery list = active (not yet delivered, not cancelled)
  const deliveryList = todayActive.sort((a, b) => {
    // Siang first, then Malam
    const sA = a.jam_antar.includes("Siang") ? 0 : 1;
    const sB = b.jam_antar.includes("Siang") ? 0 : 1;
    return sA - sB;
  });

  const periodOrders = orders.filter((o) => isInPeriod(o.created_at, period) && o.status !== "cancelled");
  const periodExpenses = expenses.filter((e) => isInPeriod(e.date, period));
  const periodRevenue = periodOrders.reduce((s, o) => s + o.total, 0);
  const periodExpTotal = periodExpenses.reduce((s, e) => s + e.amount, 0);
  const periodProfit = periodRevenue - periodExpTotal;

  const displayedOrders = orderFilter === "today" ? todayOrders : orders;

  const expByCategory = EXPENSE_CATEGORIES.map((cat) => ({
    cat, total: periodExpenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter((x) => x.total > 0);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#fdf8f2]">
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs tracking-[0.25em] uppercase text-[#7b1d1d] font-semibold mb-0.5">Babiqu</p>
            <h1 className="text-2xl font-bold text-[#1c1208]">Dapur Dashboard</h1>
            {lastUpdated && (
              <p className="text-xs text-[#b8a898] mt-0.5">Update: {lastUpdated.toLocaleTimeString("id-ID")}</p>
            )}
          </div>
          <button onClick={fetchAll} disabled={loading}
            className="px-4 py-2 bg-[#7b1d1d] text-white text-sm font-semibold rounded-xl hover:bg-[#6a1717] transition disabled:opacity-50">
            {loading ? "..." : "Refresh"}
          </button>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { label: "Aktif", value: todayActive.length, color: "text-[#1c1208]" },
            { label: "Selesai", value: todayDelivered.length, color: "text-green-700" },
            { label: "Batal", value: todayOrders.filter((o) => o.status === "cancelled").length, color: "text-red-500" },
            { label: "Omzet Hari Ini", value: formatRupiah(todayDelivered.reduce((s,o) => s+o.total,0) + todayActive.reduce((s,o) => s+o.total,0)), color: "text-[#7b1d1d]", small: true },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-[#e8ddd0] p-3">
              <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold leading-tight">{s.label}</p>
              <p className={`font-bold mt-1 ${s.color} ${s.small ? "text-sm" : "text-2xl"}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {([
            ["pesanan", "Pesanan"],
            ["keuangan", "Keuangan"],
            ["pengeluaran", "Pengeluaran"],
            ["batch", "Batch PO"],
          ] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                tab === t ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB: PESANAN ────────────────────────────────────────────────── */}
        {tab === "pesanan" && (
          <div className="space-y-4">

            {/* Delivery list */}
            {deliveryList.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8ddd0] overflow-hidden">
                <button onClick={() => setShowDelivery((v) => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#fdf8f2] transition">
                  <p className="text-xs font-bold text-[#7b1d1d] uppercase tracking-wider">
                    Rute Antar Hari Ini ({deliveryList.length})
                  </p>
                  <span className="text-[#a07850]">{showDelivery ? "−" : "+"}</span>
                </button>
                {showDelivery && (
                  <div className="divide-y divide-[#f0e8de]">
                    {deliveryList.map((o, i) => (
                      <div key={o.id} className="flex items-start gap-3 px-5 py-3">
                        <span className="text-[11px] font-bold text-[#a07850] w-5 shrink-0 mt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[#1c1208]">{o.name}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              o.jam_antar.includes("Siang") ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                            }`}>
                              {o.jam_antar.includes("Siang") ? "Siang" : "Malam"}
                            </span>
                          </div>
                          <p className="text-xs text-[#5a3e2b] mt-0.5">{o.alamat}</p>
                          <p className="text-[11px] text-[#8a7060] mt-0.5">
                            {o.items?.map((it) => `${it.qty}× ${it.menu_name.split(" ").slice(0, 2).join(" ")}`).join(", ")}
                          </p>
                        </div>
                        <button onClick={() => handleDeliver(o.id)}
                          className="text-[11px] font-semibold text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg px-2.5 py-1 transition shrink-0">
                          Selesai
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Filter */}
            <div className="flex gap-2">
              {(["today", "all"] as const).map((f) => (
                <button key={f} onClick={() => setOrderFilter(f)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                    orderFilter === f ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
                  }`}>
                  {f === "today" ? `Hari Ini (${todayOrders.length})` : `Semua (${orders.length})`}
                </button>
              ))}
            </div>

            {loading && <p className="text-center text-[#8a7060] py-12">Memuat...</p>}
            {!loading && displayedOrders.length === 0 && (
              <p className="text-center text-[#b8a898] py-12">
                {orderFilter === "today" ? "Belum ada pesanan hari ini." : "Belum ada pesanan."}
              </p>
            )}

            {displayedOrders.map((order, idx) => {
              const prev = displayedOrders[idx - 1];
              const showDate = orderFilter === "all" && (
                idx === 0 || new Date(order.created_at).toDateString() !== new Date(prev.created_at).toDateString()
              );
              const isCancelled = order.status === "cancelled";
              const isDelivered = order.status === "delivered";

              return (
                <div key={order.id}>
                  {showDate && (
                    <p className="text-xs font-semibold text-[#8a7060] uppercase tracking-wider px-1 pt-2 pb-1">
                      {isToday(order.created_at) ? "Hari Ini" : new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" }).format(new Date(order.created_at))}
                    </p>
                  )}

                  <div className={`bg-white rounded-2xl border p-5 transition-all ${
                    isCancelled ? "opacity-50 border-red-200" : isDelivered ? "border-green-200 bg-green-50/30" : "border-[#e8ddd0]"
                  }`}>
                    {/* Status banner */}
                    {isCancelled && (
                      <div className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
                        <p className="text-xs text-red-600 font-medium">
                          Dibatalkan{order.cancel_reason ? `: ${order.cancel_reason}` : ""}
                        </p>
                        <button onClick={() => handleRestore(order.id)}
                          className="text-xs text-[#7b1d1d] hover:underline font-semibold shrink-0 ml-2">Pulihkan</button>
                      </div>
                    )}
                    {isDelivered && (
                      <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2 mb-3">
                        <p className="text-xs text-green-700 font-semibold">Sudah diantar</p>
                        <button onClick={() => handleRestore(order.id)}
                          className="text-xs text-[#8a7060] hover:text-[#1c1208] font-medium">Batalkan status</button>
                      </div>
                    )}

                    {/* Top row */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-bold text-[#1c1208] text-base leading-snug">{order.name}</p>
                        <a href={`https://wa.me/${order.nomor_wa.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
                          className="text-sm text-[#7b1d1d] hover:underline font-medium">{order.nomor_wa}</a>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mb-1 ${
                          order.jam_antar.includes("Siang") ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                        }`}>
                          {order.jam_antar.includes("Siang") ? "Siang" : "Malam"}
                        </span>
                        <p className="text-[11px] text-[#b8a898]">{formatDate(order.created_at)}</p>
                      </div>
                    </div>

                    {/* Address */}
                    <p className="text-sm text-[#5a3e2b] bg-[#fdf8f2] rounded-lg px-3 py-2 mb-3">{order.alamat}</p>

                    {/* Items */}
                    <div className="space-y-2 mb-3">
                      {order.items?.map((item, i) => (
                        <div key={i} className="border-l-2 border-[#e8ddd0] pl-3">
                          <div className="flex justify-between items-baseline gap-2">
                            <p className="text-sm font-semibold text-[#1c1208]">{item.qty}× {item.menu_name}</p>
                            <span className="text-xs text-[#8a7060] shrink-0">{formatRupiah(item.subtotal)}</span>
                          </div>
                          {item.portions?.map((p, pi) => (
                            <p key={pi} className="text-xs text-[#8a7060] mt-0.5">
                              {item.qty > 1 && <span className="font-semibold text-[#a07850]">P{pi + 1} </span>}
                              {Object.values(p.options).filter(Boolean).join(" · ")}
                              {p.notes?.trim() && <span className="text-[#a07850] italic"> · {p.notes}</span>}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>

                    {order.notes?.trim() && (
                      <p className="text-xs text-[#a07850] italic bg-amber-50 rounded-lg px-3 py-1.5 mb-3">Catatan: {order.notes}</p>
                    )}

                    {/* Actions + Total */}
                    <div className="flex items-center justify-between border-t border-[#f0e8de] pt-3 gap-3">
                      <div className="flex items-center gap-2">
                        {order.status === "active" && (
                          <>
                            <button onClick={() => handleDeliver(order.id)}
                              className="text-xs font-semibold text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg px-3 py-1.5 transition">
                              Tandai Selesai
                            </button>
                            {cancelling === order.id ? (
                              <div className="flex items-center gap-2">
                                <input autoFocus value={cancelReason}
                                  onChange={(e) => setCancelReason(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") handleCancel(order.id); if (e.key === "Escape") { setCancelling(null); setCancelReason(""); } }}
                                  placeholder="Alasan..."
                                  className="text-xs border border-red-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-red-400 w-36"
                                />
                                <button onClick={() => handleCancel(order.id)} disabled={cancelLoading || !cancelReason.trim()}
                                  className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 px-2.5 py-1.5 rounded-lg transition disabled:opacity-40">
                                  {cancelLoading ? "..." : "OK"}
                                </button>
                                <button onClick={() => { setCancelling(null); setCancelReason(""); }}
                                  className="text-xs text-[#8a7060]">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => setCancelling(order.id)}
                                className="text-xs text-red-400 hover:text-red-600 font-medium transition">Batal</button>
                            )}
                          </>
                        )}
                      </div>
                      <span className="font-bold text-[#7b1d1d] text-base shrink-0">{formatRupiah(order.total)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TAB: KEUANGAN ───────────────────────────────────────────────── */}
        {tab === "keuangan" && (
          <div className="space-y-5">
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${
                    period === p ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
                  }`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl border border-[#e8ddd0] p-4">
                <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold">Pemasukan</p>
                <p className="text-xl font-bold text-[#1c1208] mt-1">{formatRupiah(periodRevenue)}</p>
                <p className="text-[11px] text-[#8a7060] mt-0.5">{periodOrders.length} pesanan</p>
              </div>
              <div className="bg-white rounded-2xl border border-[#e8ddd0] p-4">
                <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold">Pengeluaran</p>
                <p className="text-xl font-bold text-[#1c1208] mt-1">{formatRupiah(periodExpTotal)}</p>
                <p className="text-[11px] text-[#8a7060] mt-0.5">{periodExpenses.length} item</p>
              </div>
              <div className={`rounded-2xl border p-4 ${periodProfit >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-[#8a7060]">Keuntungan</p>
                <p className={`text-xl font-bold mt-1 ${periodProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {formatRupiah(periodProfit)}
                </p>
                <p className={`text-[11px] mt-0.5 font-semibold ${periodProfit >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {periodRevenue > 0 ? `${Math.round((periodProfit / periodRevenue) * 100)}% margin` : "—"}
                </p>
              </div>
            </div>

            {expByCategory.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8ddd0] p-5">
                <p className="text-xs font-bold text-[#5a3e2b] uppercase tracking-wider mb-3">Pengeluaran per Kategori</p>
                <div className="space-y-2.5">
                  {expByCategory.map(({ cat, total }) => (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-xs text-[#5a3e2b] w-24 shrink-0">{cat}</span>
                      <div className="flex-1 bg-[#f0e8de] rounded-full h-1.5">
                        <div className="bg-[#7b1d1d] h-1.5 rounded-full transition-all"
                          style={{ width: `${periodExpTotal > 0 ? (total / periodExpTotal) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-[#1c1208] w-24 text-right shrink-0">{formatRupiah(total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {periodExpenses.length > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8ddd0] p-5">
                <p className="text-xs font-bold text-[#5a3e2b] uppercase tracking-wider mb-3">Detail Pengeluaran</p>
                <div className="space-y-2">
                  {periodExpenses.map((exp) => (
                    <div key={exp.id} className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#1c1208] truncate">{exp.description}</p>
                        <p className="text-[11px] text-[#8a7060]">{exp.category} · {formatDateShort(exp.date)}</p>
                      </div>
                      <span className="text-sm font-semibold text-[#1c1208] shrink-0">{formatRupiah(exp.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {periodExpenses.length === 0 && periodOrders.length === 0 && !loading && (
              <p className="text-center text-[#b8a898] py-8">Belum ada data untuk periode ini.</p>
            )}
          </div>
        )}

        {/* ── TAB: PENGELUARAN ────────────────────────────────────────────── */}
        {tab === "pengeluaran" && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-[#e8ddd0] p-5">
              <p className="text-xs font-bold text-[#7b1d1d] uppercase tracking-wider mb-4">Tambah Pengeluaran</p>
              <form onSubmit={handleAddExpense} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Keterangan</label>
                  <input value={expForm.description} onChange={(e) => setExpForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. Beli babi 5kg" required
                    className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-sm text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Jumlah (Rp)</label>
                    <input value={expForm.amount}
                      onChange={(e) => { const raw = e.target.value.replace(/\D/g, ""); setExpForm((p) => ({ ...p, amount: raw ? parseInt(raw).toLocaleString("id-ID") : "" })); }}
                      placeholder="0" required inputMode="numeric"
                      className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-sm text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Tanggal</label>
                    <input type="date" value={expForm.date} onChange={(e) => setExpForm((p) => ({ ...p, date: e.target.value }))} required
                      className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#5a3e2b] mb-2 uppercase tracking-wide">Kategori</label>
                  <div className="flex flex-wrap gap-2">
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <button key={cat} type="button" onClick={() => setExpForm((p) => ({ ...p, category: cat }))}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                          expForm.category === cat ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
                        }`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                {batches.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Batch (opsional)</label>
                    <select value={expForm.batch_id} onChange={(e) => setExpForm((p) => ({ ...p, batch_id: e.target.value }))}
                      className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition">
                      <option value="">— Tidak terikat batch —</option>
                      {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </div>
                )}
                <button type="submit" disabled={expLoading || !expForm.description.trim() || !expForm.amount}
                  className="w-full bg-[#7b1d1d] text-white font-bold py-3 rounded-xl hover:bg-[#6a1717] transition disabled:opacity-40 text-sm">
                  {expLoading ? "Menyimpan..." : "Tambah Pengeluaran"}
                </button>
              </form>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#8a7060] uppercase tracking-wider px-1">Riwayat Pengeluaran</p>
              {expenses.length === 0 && !loading && (
                <p className="text-center text-[#b8a898] py-8">Belum ada pengeluaran.</p>
              )}
              {expenses.map((exp) => (
                <div key={exp.id} className="bg-white rounded-xl border border-[#e8ddd0] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1c1208] truncate">{exp.description}</p>
                    <p className="text-[11px] text-[#8a7060] mt-0.5">{exp.category} · {formatDateShort(exp.date)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold text-[#1c1208]">{formatRupiah(exp.amount)}</span>
                    <button onClick={() => handleDeleteExpense(exp.id)}
                      className="text-[#b8a898] hover:text-red-500 transition text-lg leading-none">×</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB: BATCH PO ───────────────────────────────────────────────── */}
        {tab === "batch" && (
          <div className="space-y-5">
            {/* Create batch form */}
            <div className="bg-white rounded-2xl border border-[#e8ddd0] p-5">
              <p className="text-xs font-bold text-[#7b1d1d] uppercase tracking-wider mb-4">Buka Batch Baru</p>
              <form onSubmit={handleAddBatch} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Nama Batch</label>
                  <input value={batchForm.label} onChange={(e) => setBatchForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. Batch #1 — April 2026" required
                    className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-sm text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ["open_date", "PO Buka"],
                    ["close_date", "PO Tutup"],
                    ["delivery_date", "Tanggal Antar"],
                  ] as const).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">{label}</label>
                      <input type="date" value={batchForm[field]} onChange={(e) => setBatchForm((p) => ({ ...p, [field]: e.target.value }))} required
                        className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Catatan (opsional)</label>
                  <input value={batchForm.notes} onChange={(e) => setBatchForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="e.g. Minimal order 1 porsi"
                    className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-sm text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                </div>
                <button type="submit" disabled={batchLoading || !batchForm.label.trim()}
                  className="w-full bg-[#7b1d1d] text-white font-bold py-3 rounded-xl hover:bg-[#6a1717] transition disabled:opacity-40 text-sm">
                  {batchLoading ? "Menyimpan..." : "Buat Batch"}
                </button>
              </form>
            </div>

            {/* Batch history */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[#8a7060] uppercase tracking-wider px-1">History Batch</p>
              {batches.length === 0 && !loading && (
                <p className="text-center text-[#b8a898] py-8">Belum ada batch.</p>
              )}
              {batches.map((batch) => {
                const batchOrders = orders.filter((o) => o.batch_id === batch.id && o.status !== "cancelled");
                const batchCancelled = orders.filter((o) => o.batch_id === batch.id && o.status === "cancelled");
                const batchDelivered = orders.filter((o) => o.batch_id === batch.id && o.status === "delivered");
                const batchRevenue = batchOrders.reduce((s, o) => s + o.total, 0);
                const batchExp = expenses.filter((e) => e.batch_id === batch.id);
                const batchExpTotal = batchExp.reduce((s, e) => s + e.amount, 0);
                const batchProfit = batchRevenue - batchExpTotal;
                const isActive = isBatchActive(batch);
                const isUpcoming = isBatchUpcoming(batch);

                return (
                  <div key={batch.id} className={`bg-white rounded-2xl border p-5 ${isActive ? "border-[#7b1d1d] shadow-sm" : "border-[#e8ddd0]"}`}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-[#1c1208]">{batch.label}</p>
                          {isActive && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">AKTIF</span>}
                          {isUpcoming && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">AKAN DATANG</span>}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[#8a7060]">
                          <span>PO: {formatBatchDate(batch.open_date)} – {formatBatchDate(batch.close_date)}</span>
                          <span>Antar: {formatBatchDate(batch.delivery_date)}</span>
                        </div>
                        {batch.notes && <p className="text-xs text-[#a07850] italic mt-1">{batch.notes}</p>}
                      </div>
                      <button onClick={() => setDeletingBatch(deletingBatch === batch.id ? null : batch.id)}
                        className="text-[#b8a898] hover:text-red-500 transition text-lg leading-none shrink-0">×</button>
                    </div>

                    {deletingBatch === batch.id && (
                      <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
                        <p className="text-xs text-red-600 flex-1">Hapus batch ini?</p>
                        <button onClick={() => handleDeleteBatch(batch.id)}
                          className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg">Hapus</button>
                        <button onClick={() => setDeletingBatch(null)} className="text-xs text-[#8a7060]">Batal</button>
                      </div>
                    )}

                    {/* Stats grid */}
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {[
                        { label: "Pesanan", value: batchOrders.length },
                        { label: "Selesai", value: batchDelivered.length },
                        { label: "Batal", value: batchCancelled.length },
                        { label: "Pemasukan", value: formatRupiah(batchRevenue), small: true },
                      ].map((s) => (
                        <div key={s.label} className="bg-[#fdf8f2] rounded-xl p-2.5 text-center">
                          <p className="text-[9px] text-[#8a7060] uppercase tracking-wider font-semibold">{s.label}</p>
                          <p className={`font-bold text-[#1c1208] mt-0.5 ${s.small ? "text-xs" : "text-lg"}`}>{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* P&L */}
                    <div className="flex items-center justify-between border-t border-[#f0e8de] pt-3">
                      <div className="text-xs text-[#8a7060]">
                        Pengeluaran: <span className="font-semibold text-[#1c1208]">{formatRupiah(batchExpTotal)}</span>
                        {batchExp.length > 0 && <span className="ml-1">({batchExp.length} item)</span>}
                      </div>
                      <div className={`text-sm font-bold ${batchProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {batchProfit >= 0 ? "+" : ""}{formatRupiah(batchProfit)}
                        {batchRevenue > 0 && (
                          <span className="text-xs font-normal ml-1 opacity-70">
                            ({Math.round((batchProfit / batchRevenue) * 100)}%)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
