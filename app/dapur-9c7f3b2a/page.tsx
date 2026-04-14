"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ClipboardList, BarChart2, Receipt, CalendarDays, ExternalLink, RefreshCw } from "lucide-react";

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
  is_closed: boolean; max_orders: number | null;
};

const EXPENSE_CATEGORIES = ["Bahan Baku", "Operasional", "Kemasan", "Transportasi", "Lainnya"];
const PERIOD_LABELS = { today: "Hari Ini", week: "7 Hari", month: "30 Hari", all: "Semua" } as const;
type Period = keyof typeof PERIOD_LABELS;

function formatBatchDate(d: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d + "T00:00:00"));
}
function isBatchDateActive(b: Batch) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  return b.open_date <= today && b.close_date >= today;
}
function isBatchActive(b: Batch, orderCount: number) {
  return isBatchDateActive(b) && !b.is_closed && (b.max_orders == null || orderCount < b.max_orders);
}
function isBatchFull(b: Batch, orderCount: number) {
  return b.max_orders != null && orderCount >= b.max_orders;
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

  // Order detail modal
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showSummary, setShowSummary] = useState(true);

  const closeModal = useCallback(() => { setSelectedOrder(null); setCancelling(null); setCancelReason(""); }, []);

  // Expense form
  const [expForm, setExpForm] = useState({
    description: "", amount: "", category: "Bahan Baku",
    date: new Date().toISOString().slice(0, 10), batch_id: "",
  });
  const [expLoading, setExpLoading] = useState(false);

  // Batch form
  const todayIso = new Date().toISOString().slice(0, 10);
  const [batchForm, setBatchForm] = useState({
    label: "", open_date: todayIso, close_date: todayIso, delivery_date: todayIso, notes: "", max_orders: "",
  });
  const [batchLoading, setBatchLoading] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);

  // Filters
  const [orderFilter, setOrderFilter] = useState<"today" | "all">("today");
  const [jamFilter, setJamFilter] = useState<"all" | "siang" | "malam">("all");
  const [period, setPeriod] = useState<Period>("today");

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
    setSelectedOrder((prev) => prev?.id === orderId ? { ...prev, status, ...(extra || {}) } : prev);
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
    const max = batchForm.max_orders ? parseInt(batchForm.max_orders) : null;
    const { data } = await supabase.from("batches").insert({
      label: batchForm.label.trim(),
      open_date: batchForm.open_date,
      close_date: batchForm.close_date,
      delivery_date: batchForm.delivery_date,
      notes: batchForm.notes.trim(),
      max_orders: max,
    }).select().single();
    if (data) setBatches((prev) => [data, ...prev]);
    setBatchForm({ label: "", open_date: todayIso, close_date: todayIso, delivery_date: todayIso, notes: "", max_orders: "" });
    setBatchLoading(false);
  }

  async function handleToggleBatchClosed(batch: Batch) {
    const newVal = !batch.is_closed;
    await supabase.from("batches").update({ is_closed: newVal }).eq("id", batch.id);
    setBatches((prev) => prev.map((b) => b.id === batch.id ? { ...b, is_closed: newVal } : b));
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

  const periodOrders = orders.filter((o) => isInPeriod(o.created_at, period) && o.status !== "cancelled");
  const periodExpenses = expenses.filter((e) => isInPeriod(e.date, period));
  const periodRevenue = periodOrders.reduce((s, o) => s + o.total, 0);
  const periodExpTotal = periodExpenses.reduce((s, e) => s + e.amount, 0);
  const periodProfit = periodRevenue - periodExpTotal;

  // Hari Ini: sort Siang → Malam; Semua: keep reverse-chron from server
  const baseOrders = orderFilter === "today"
    ? [...todayOrders].sort((a, b) => {
        const sa = a.jam_antar.includes("Siang") ? 0 : 1;
        const sb = b.jam_antar.includes("Siang") ? 0 : 1;
        return sa - sb || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      })
    : orders;
  const displayedOrders = jamFilter === "all" ? baseOrders
    : baseOrders.filter((o) => jamFilter === "siang" ? o.jam_antar.includes("Siang") : !o.jam_antar.includes("Siang"));

  // Production summary — today's non-cancelled orders grouped by menu
  const productionSummary = (() => {
    const map: Record<string, { name: string; portions: Array<{ opts: string; notes: string }> }> = {};
    todayOrders.filter(o => o.status !== "cancelled").forEach(order => {
      order.items?.forEach(item => {
        if (!map[item.menu_id]) map[item.menu_id] = { name: item.menu_name, portions: [] };
        item.portions?.forEach(p => map[item.menu_id].portions.push({
          opts: Object.values(p.options).filter(Boolean).join(" · "),
          notes: p.notes?.trim() || "",
        }));
      });
    });
    return Object.values(map);
  })();

  // Current open batch (for labeling filters)
  const currentBatch = batches.find(b => isBatchActive(b, orders.filter(o => o.batch_id === b.id && o.status !== "cancelled").length));
  const poFilterLabel = currentBatch ? currentBatch.label.split(/[—–-]/)[0].trim() : "PO Ini";

  const expByCategory = EXPENSE_CATEGORIES.map((cat) => ({
    cat, total: periodExpenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter((x) => x.total > 0);

  // ─────────────────────────────────────────────────────────────────────────

  const NAV = [
    { key: "pesanan",     label: "Pesanan",     Icon: ClipboardList },
    { key: "keuangan",    label: "Keuangan",    Icon: BarChart2 },
    { key: "pengeluaran", label: "Pengeluaran", Icon: Receipt },
    { key: "batch",       label: "Batch PO",    Icon: CalendarDays },
  ] as const;

  return (
    <div className="min-h-screen bg-[#fdf8f2] pb-20">
      <div className="max-w-2xl mx-auto px-4 pt-5 pb-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#7b1d1d] font-semibold">Babiqu</p>
            <h1 className="text-xl font-bold text-[#1c1208] leading-tight">Dapur Dashboard</h1>
            {lastUpdated && (
              <p className="text-[10px] text-[#b8a898]">Update: {lastUpdated.toLocaleTimeString("id-ID")}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a href="/" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#d9cfc5] text-[#7b1d1d] text-xs font-semibold rounded-xl hover:border-[#7b1d1d] transition">
              <ExternalLink size={13} /> Form
            </a>
            <button onClick={fetchAll} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#7b1d1d] text-white text-xs font-semibold rounded-xl hover:bg-[#6a1717] transition disabled:opacity-50">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              {loading ? "..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Quick stats — 2×2 on mobile, 4 col on wider */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          {[
            { label: "Aktif",        value: todayActive.length, color: "text-[#1c1208]" },
            { label: "Selesai",      value: todayDelivered.length, color: "text-green-700" },
            { label: "Batal",        value: todayOrders.filter((o) => o.status === "cancelled").length, color: "text-red-500" },
            { label: "Omzet Hari Ini", value: formatRupiah(todayDelivered.reduce((s,o)=>s+o.total,0)+todayActive.reduce((s,o)=>s+o.total,0)), color: "text-[#7b1d1d]", small: true },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-[#e8ddd0] px-3 py-2.5">
              <p className="text-[9px] text-[#8a7060] uppercase tracking-widest font-semibold leading-tight">{s.label}</p>
              <p className={`font-bold mt-0.5 ${s.color} ${s.small ? "text-sm" : "text-2xl"}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── TAB: PESANAN ────────────────────────────────────────────────── */}
        {tab === "pesanan" && (
          <div className="space-y-3">

            {/* Filters: two segmented controls */}
            <div className="flex gap-2">
              {/* Date range */}
              <div className="flex bg-[#f0e8de] rounded-xl p-0.5 gap-0.5 flex-1">
                {(["today", "all"] as const).map((f) => (
                  <button key={f} onClick={() => setOrderFilter(f)}
                    className={`flex-1 py-1.5 rounded-[10px] text-xs font-semibold transition ${
                      orderFilter === f ? "bg-white text-[#7b1d1d] shadow-sm" : "text-[#8a7060]"
                    }`}>
                    {f === "today" ? `${poFilterLabel} (${todayOrders.length})` : `Semua (${orders.length})`}
                  </button>
                ))}
              </div>
              {/* Time of day */}
              <div className="flex bg-[#f0e8de] rounded-xl p-0.5 gap-0.5">
                {([["all", "🕐"], ["siang", "☀️"], ["malam", "🌙"]] as const).map(([f, icon]) => (
                  <button key={f} onClick={() => setJamFilter(f)}
                    title={f === "all" ? "Semua waktu" : f === "siang" ? "Siang" : "Malam"}
                    className={`w-9 py-1.5 rounded-[10px] text-sm transition ${
                      jamFilter === f ? "bg-white shadow-sm" : "opacity-50"
                    }`}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Ringkasan Produksi */}
            {productionSummary.length > 0 && (
              <div className="bg-white rounded-xl border border-[#e8ddd0] overflow-hidden">
                <button onClick={() => setShowSummary(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3">
                  <p className="text-xs font-bold text-[#7b1d1d] uppercase tracking-wider">
                    Ringkasan Produksi
                  </p>
                  <span className="text-[#a07850] text-sm">{showSummary ? "−" : "+"}</span>
                </button>
                {showSummary && (
                  <div className="border-t border-[#f0e8de] divide-y divide-[#f0e8de]">
                    {productionSummary.map((menu) => (
                      <div key={menu.name} className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-sm font-bold text-[#1c1208]">{menu.name}</p>
                          <span className="text-[10px] font-bold bg-[#7b1d1d] text-white px-2 py-0.5 rounded-full">
                            {menu.portions.length} porsi
                          </span>
                        </div>
                        <div className="space-y-1">
                          {menu.portions.map((p, pi) => (
                            <div key={pi} className="flex items-baseline gap-2">
                              <span className="text-[10px] font-bold text-[#a07850] w-6 shrink-0">P{pi + 1}</span>
                              <span className="text-xs text-[#5a3e2b]">{p.opts}</span>
                              {p.notes && <span className="text-xs text-[#a07850] italic">· {p.notes}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {loading && <p className="text-center text-[#8a7060] py-12">Memuat...</p>}
            {!loading && displayedOrders.length === 0 && (
              <p className="text-center text-[#b8a898] py-12">
                {jamFilter !== "all"
                  ? `Tidak ada pesanan ${jamFilter === "siang" ? "Siang" : "Malam"} untuk filter ini.`
                  : orderFilter === "today" ? "Belum ada pesanan hari ini." : "Belum ada pesanan."}
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

                  <button onClick={() => setSelectedOrder(order)}
                    className={`w-full text-left bg-white rounded-xl border px-4 py-3 transition-all active:scale-[0.99] ${
                      isCancelled ? "border-red-200" : isDelivered ? "border-green-200 bg-green-50/20" : "border-[#e8ddd0] hover:border-[#c8b8a8]"
                    }`}>
                    {/* Status banner */}
                    {isCancelled && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold bg-red-100 text-red-500 px-2 py-0.5 rounded-full">BATAL</span>
                        {order.cancel_reason && <span className="text-xs text-red-400 truncate">{order.cancel_reason}</span>}
                      </div>
                    )}
                    {isDelivered && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full">SELESAI</span>
                      </div>
                    )}

                    {/* Top: name + badge + time */}
                    <div className={`flex items-center justify-between gap-2 ${isCancelled ? "opacity-50" : ""}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-bold text-[#1c1208] text-sm truncate">{order.name}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          order.jam_antar.includes("Siang") ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                        }`}>{order.jam_antar.includes("Siang") ? "Siang" : "Malam"}</span>
                      </div>
                      <p className="text-[10px] text-[#b8a898] shrink-0">{formatDate(order.created_at)}</p>
                    </div>

                    {/* Summary row */}
                    <div className={`flex items-center justify-between mt-1 ${isCancelled ? "opacity-50" : ""}`}>
                      <p className="text-xs text-[#8a7060] truncate">
                        {order.items?.map((it) => `${it.qty}× ${it.menu_name.split(" ").slice(0,2).join(" ")}`).join(", ")}
                      </p>
                      <span className="font-bold text-[#7b1d1d] text-sm shrink-0 ml-2">{formatRupiah(order.total)}</span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TAB: KEUANGAN ───────────────────────────────────────────────── */}
        {tab === "keuangan" && (
          <div className="space-y-4">
            {/* Period segmented control */}
            <div className="flex bg-[#f0e8de] rounded-xl p-0.5 gap-0.5">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`flex-1 py-1.5 rounded-[10px] text-xs font-semibold transition ${
                    period === p ? "bg-white text-[#7b1d1d] shadow-sm" : "text-[#8a7060]"
                  }`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>

            {/* P&L summary card */}
            <div className="bg-white rounded-2xl border border-[#e8ddd0] divide-y divide-[#f0e8de]">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold">Pemasukan</p>
                  <p className="text-lg font-bold text-[#1c1208] mt-0.5">{formatRupiah(periodRevenue)}</p>
                </div>
                <p className="text-xs text-[#8a7060]">{periodOrders.length} pesanan</p>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold">Pengeluaran</p>
                  <p className="text-lg font-bold text-[#1c1208] mt-0.5">{formatRupiah(periodExpTotal)}</p>
                </div>
                <p className="text-xs text-[#8a7060]">{periodExpenses.length} item</p>
              </div>
              <div className={`flex items-center justify-between px-4 py-3 rounded-b-2xl ${periodProfit >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                <div>
                  <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold">Keuntungan</p>
                  <p className={`text-lg font-bold mt-0.5 ${periodProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {formatRupiah(periodProfit)}
                  </p>
                </div>
                <p className={`text-xs font-bold ${periodProfit >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {periodRevenue > 0 ? `${Math.round((periodProfit / periodRevenue) * 100)}%` : "—"}
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
                <div className="grid grid-cols-2 gap-3 overflow-hidden">
                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Jumlah (Rp)</label>
                    <input value={expForm.amount}
                      onChange={(e) => { const raw = e.target.value.replace(/\D/g, ""); setExpForm((p) => ({ ...p, amount: raw ? parseInt(raw).toLocaleString("id-ID") : "" })); }}
                      placeholder="0" required inputMode="numeric"
                      className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2.5 text-sm text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 uppercase tracking-wide">Tanggal</label>
                    <input type="date" value={expForm.date} onChange={(e) => setExpForm((p) => ({ ...p, date: e.target.value }))} required
                      className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
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
                {/* Dates: full-width on mobile to avoid cramping */}
                <div className="grid grid-cols-2 gap-2 overflow-hidden">
                  {([["open_date", "PO Buka"], ["close_date", "PO Tutup"]] as const).map(([field, label]) => (
                    <div key={field} className="min-w-0">
                      <label className="block text-[11px] text-[#8a7060] mb-1">{label}</label>
                      <input type="date" value={batchForm[field]} onChange={(e) => setBatchForm((p) => ({ ...p, [field]: e.target.value }))} required
                        className="w-full border border-[#d9cfc5] rounded-lg px-2 py-2 text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-[11px] text-[#8a7060] mb-1">Tanggal Antar</label>
                  <input type="date" value={batchForm.delivery_date} onChange={(e) => setBatchForm((p) => ({ ...p, delivery_date: e.target.value }))} required
                    className="w-full border border-[#d9cfc5] rounded-lg px-2 py-2 text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                </div>
                <div className="grid grid-cols-2 gap-2 overflow-hidden">
                  <div className="min-w-0">
                    <label className="block text-[11px] text-[#8a7060] mb-1">Maks. Pesanan</label>
                    <input value={batchForm.max_orders} onChange={(e) => setBatchForm((p) => ({ ...p, max_orders: e.target.value.replace(/\D/g, "") }))}
                      placeholder="Tak terbatas" inputMode="numeric"
                      className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2 text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-[11px] text-[#8a7060] mb-1">Catatan</label>
                    <input value={batchForm.notes} onChange={(e) => setBatchForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="opsional"
                      className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2 text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                  </div>
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
                const batchTotalOrders = orders.filter((o) => o.batch_id === batch.id).length;
                const canDelete = batchTotalOrders === 0;
                const batchRevenue = batchOrders.reduce((s, o) => s + o.total, 0);
                const batchExp = expenses.filter((e) => e.batch_id === batch.id);
                const batchExpTotal = batchExp.reduce((s, e) => s + e.amount, 0);
                const batchProfit = batchRevenue - batchExpTotal;
                const orderCount = batchOrders.length;
                const isActive = isBatchActive(batch, orderCount);
                const isFull = isBatchFull(batch, orderCount);
                const isUpcoming = isBatchUpcoming(batch);

                return (
                  <div key={batch.id} className={`bg-white rounded-2xl border p-5 ${isActive ? "border-[#7b1d1d] shadow-sm" : "border-[#e8ddd0]"}`}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2 mb-1">
                          <p className="font-bold text-[#1c1208]">{batch.label}</p>
                          {isActive && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">AKTIF</span>}
                          {isFull && <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">PENUH</span>}
                          {batch.is_closed && !isUpcoming && <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">TUTUP MANUAL</span>}
                          {isUpcoming && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">AKAN DATANG</span>}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[#8a7060]">
                          <span>PO: {formatBatchDate(batch.open_date)} – {formatBatchDate(batch.close_date)}</span>
                          <span>Antar: {formatBatchDate(batch.delivery_date)}</span>
                          {batch.max_orders != null && (
                            <span className={`font-semibold ${isFull ? "text-orange-600" : "text-[#8a7060]"}`}>
                              Kuota: {orderCount}/{batch.max_orders}
                            </span>
                          )}
                        </div>
                        {batch.notes && <p className="text-xs text-[#a07850] italic mt-1">{batch.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isBatchDateActive(batch) && (
                          <button onClick={() => handleToggleBatchClosed(batch)}
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition ${
                              batch.is_closed
                                ? "bg-green-100 text-green-700 hover:bg-green-200"
                                : "bg-red-100 text-red-600 hover:bg-red-200"
                            }`}>
                            {batch.is_closed ? "Buka PO" : "Tutup PO"}
                          </button>
                        )}
                        <button
                          onClick={() => canDelete && setDeletingBatch(deletingBatch === batch.id ? null : batch.id)}
                          disabled={!canDelete}
                          title={!canDelete ? `Tidak bisa dihapus — ada ${batchTotalOrders} pesanan` : "Hapus batch"}
                          className={`text-lg leading-none transition ${canDelete ? "text-[#b8a898] hover:text-red-500 cursor-pointer" : "text-[#d9cfc5] cursor-not-allowed"}`}>×</button>
                      </div>
                    </div>

                    {deletingBatch === batch.id && canDelete && (
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

      {/* ── Order Detail — full-page overlay ───────────────────────────── */}
      {selectedOrder && (() => {
        const o = selectedOrder;
        const isCancelled = o.status === "cancelled";
        const isDelivered = o.status === "delivered";
        return (
          <div className="fixed inset-0 z-50 bg-[#fdf8f2] overflow-y-auto pb-6">
            {/* Top bar */}
            <div className="sticky top-0 z-10 bg-white border-b border-[#e8ddd0] px-4 py-3 flex items-center gap-3">
              <button onClick={closeModal}
                className="flex items-center gap-1.5 text-sm font-semibold text-[#7b1d1d] hover:text-[#5a1515] transition">
                ← Kembali
              </button>
              <span className="text-[#d9cfc5]">|</span>
              <p className="font-bold text-[#1c1208] truncate">{o.name}</p>
              <span className={`ml-auto shrink-0 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                o.jam_antar.includes("Siang") ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
              }`}>{o.jam_antar.includes("Siang") ? "Siang" : "Malam"}</span>
            </div>

            <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">

              {/* Status banner */}
              {isCancelled && (
                <div className="flex items-center justify-between bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                  <div>
                    <p className="text-xs font-bold text-red-500 uppercase tracking-wide mb-0.5">Pesanan Dibatalkan</p>
                    {o.cancel_reason && <p className="text-sm text-red-400">{o.cancel_reason}</p>}
                  </div>
                  <button onClick={() => handleRestore(o.id)}
                    className="shrink-0 text-sm font-bold text-white bg-green-500 hover:bg-green-600 px-4 py-2 rounded-xl transition ml-3">
                    Pulihkan
                  </button>
                </div>
              )}
              {isDelivered && (
                <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
                  <p className="text-sm font-bold text-green-700">✓ Pesanan sudah diantar</p>
                  <button onClick={() => handleRestore(o.id)}
                    className="shrink-0 text-sm text-[#8a7060] hover:text-[#1c1208] transition ml-3">Batalkan</button>
                </div>
              )}

              {/* Customer info */}
              <div className="bg-white rounded-2xl border border-[#e8ddd0] divide-y divide-[#f0e8de]">
                <div className="px-4 py-3">
                  <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold mb-0.5">Pelanggan</p>
                  <p className="font-bold text-[#1c1208]">{o.name}</p>
                  <a href={`https://wa.me/${o.nomor_wa.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-[#7b1d1d] hover:underline font-medium">{o.nomor_wa}</a>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold mb-0.5">Alamat</p>
                  <p className="text-sm text-[#1c1208]">{o.alamat}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold mb-0.5">Waktu Antar</p>
                  <p className="text-sm text-[#1c1208]">{o.jam_antar} · {formatDate(o.created_at)}</p>
                </div>
              </div>

              {/* Items */}
              <div className="bg-white rounded-2xl border border-[#e8ddd0] overflow-hidden">
                <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold px-4 pt-3 pb-2">Detail Pesanan</p>
                <div className="divide-y divide-[#f0e8de]">
                  {o.items?.map((item, i) => (
                    <div key={i} className="px-4 py-3">
                      <div className="flex justify-between items-baseline gap-2 mb-1">
                        <p className="text-sm font-bold text-[#1c1208]">{item.qty}× {item.menu_name}</p>
                        <span className="text-sm font-semibold text-[#5a3e2b] shrink-0">{formatRupiah(item.subtotal)}</span>
                      </div>
                      {item.portions?.map((p, pi) => (
                        <p key={pi} className="text-xs text-[#8a7060] mt-0.5">
                          {item.qty > 1 && <span className="font-semibold text-[#a07850]">P{pi+1} </span>}
                          {Object.values(p.options).filter(Boolean).join(" · ")}
                          {p.notes?.trim() && <span className="text-[#a07850] italic"> · {p.notes}</span>}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                {o.notes?.trim() && (
                  <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                    <p className="text-xs text-[#a07850] italic">📝 {o.notes}</p>
                  </div>
                )}
                <div className="flex justify-between items-center px-4 py-3 bg-[#fdf8f2] border-t border-[#f0e8de]">
                  <p className="text-sm font-semibold text-[#5a3e2b]">Total</p>
                  <p className="text-xl font-bold text-[#7b1d1d]">{formatRupiah(o.total)}</p>
                </div>
              </div>

              {/* Actions */}
              {o.status === "active" && (
                <div className="space-y-2">
                  {cancelling === o.id ? (
                    <>
                      <input autoFocus value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleCancel(o.id); if (e.key === "Escape") { setCancelling(null); setCancelReason(""); } }}
                        placeholder="Tulis alasan pembatalan..."
                        className="w-full border border-red-200 rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-red-400 bg-white"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleCancel(o.id)} disabled={cancelLoading || !cancelReason.trim()}
                          className="flex-1 text-sm font-bold text-white bg-red-500 hover:bg-red-600 py-3.5 rounded-2xl transition disabled:opacity-40">
                          {cancelLoading ? "Menyimpan..." : "Konfirmasi Batalkan"}
                        </button>
                        <button onClick={() => { setCancelling(null); setCancelReason(""); }}
                          className="px-5 py-3.5 text-sm font-semibold text-[#8a7060] bg-white border border-[#e8ddd0] rounded-2xl">Batal</button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <button onClick={() => handleDeliver(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-green-500 hover:bg-green-600 active:scale-[0.99] transition font-bold text-white text-base">
                        <span className="text-xl leading-none">✓</span> Selesaikan Pesanan
                      </button>
                      <button onClick={() => setCancelling(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-white border-2 border-red-200 hover:border-red-300 hover:bg-red-50 active:scale-[0.99] transition font-bold text-red-500 text-base">
                        <span className="text-xl leading-none">✕</span> Batalkan Pesanan
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        );
      })()}

      {/* ── Bottom Nav Dock ─────────────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-[#e8ddd0] safe-area-pb">
        <div className="max-w-2xl mx-auto flex">
          {NAV.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setTab(key as typeof tab)}
              className={`relative flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
                tab === key ? "text-[#7b1d1d]" : "text-[#a09080] hover:text-[#5a3e2b]"
              }`}>
              <Icon size={20} strokeWidth={tab === key ? 2.2 : 1.6} />
              <span className={`text-[10px] font-semibold tracking-wide ${tab === key ? "text-[#7b1d1d]" : "text-[#a09080]"}`}>
                {label}
              </span>
              {tab === key && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#7b1d1d] rounded-full" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
