"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { ClipboardList, BarChart2, Receipt, CalendarDays, ExternalLink, RefreshCw, MessageCircle } from "lucide-react";
import { buildWAMessage, MENUS, ALA_CARTE, ONGKIR, type PaymentMethod } from "@/lib/order-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Portion = { options: Record<string, string>; notes: string };
type OrderItem = { menu_id: string; menu_name: string; qty: number; portions: Portion[]; subtotal: number };
type OrderStatus = "active" | "pending" | "confirmed" | "delivered" | "cancelled";
type Order = {
  id: string; created_at: string; name: string; nomor_wa: string;
  alamat: string; jam_antar: string; items: OrderItem[];
  notes: string; total: number; status: OrderStatus; cancel_reason: string;
  batch_id: string | null; payment_method: string; payment_proof_url: string | null;
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

function formatBatchDate(d: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d + "T00:00:00"));
}
function isBatchDateActive(b: Batch) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  return b.open_date <= today && b.close_date >= today;
}
function isBatchActive(b: Batch, portionCount: number) {
  return isBatchDateActive(b) && !b.is_closed && (b.max_orders == null || portionCount < b.max_orders);
}
function isBatchFull(b: Batch, portionCount: number) {
  return b.max_orders != null && portionCount >= b.max_orders;
}
function totalPortions(orderList: Order[]) {
  return orderList.reduce((sum, o) => sum + (o.items?.reduce((s, it) => s + it.qty, 0) ?? 0), 0);
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
function isToday(iso: string) { return new Date(iso).toDateString() === new Date().toDateString(); }

// ─── Component ────────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = "iniL@hB!bi";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export default function DashboardPage() {
  // ── Auth gate ─────────────────────────────────────────────────────────────
  const [isAuthed, setIsAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    // Check session auth
    if (sessionStorage.getItem("dapur_auth") === "1") { setIsAuthed(true); return; }
    // Restore lockout state
    const lu = Number(sessionStorage.getItem("dapur_locked_until") || 0);
    const att = Number(sessionStorage.getItem("dapur_attempts") || 0);
    if (lu > Date.now()) setLockedUntil(lu);
    setAttempts(att);
  }, []);

  // Countdown ticker
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= lockedUntil) { setLockedUntil(null); setAttempts(0); clearInterval(id); }
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (lockedUntil && Date.now() < lockedUntil) return;
    if (pwInput === ADMIN_PASSWORD) {
      sessionStorage.setItem("dapur_auth", "1");
      sessionStorage.removeItem("dapur_attempts");
      sessionStorage.removeItem("dapur_locked_until");
      setIsAuthed(true);
    } else {
      const newAtt = attempts + 1;
      setAttempts(newAtt);
      sessionStorage.setItem("dapur_attempts", String(newAtt));
      if (newAtt >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_MS;
        setLockedUntil(until);
        sessionStorage.setItem("dapur_locked_until", String(until));
        setPwError(`Terlalu banyak percobaan. Coba lagi dalam 15 menit.`);
      } else {
        setPwError(`Password salah. ${MAX_ATTEMPTS - newAtt} percobaan tersisa.`);
      }
      setPwInput("");
    }
  }

  // ── All dashboard hooks (must come before any early return) ─────────────────
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
  const [proofLightbox, setProofLightbox] = useState<string | null>(null);

  const closeModal = useCallback(() => { setSelectedOrder(null); setCancelling(null); setCancelReason(""); }, []);

  // Lock background scroll when modal is open
  useEffect(() => {
    if (selectedOrder) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [selectedOrder]);

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
  const [editingBatch, setEditingBatch] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: "", open_date: "", close_date: "", delivery_date: "", notes: "", max_orders: "" });
  const [editLoading, setEditLoading] = useState(false);

  // Filters
  const [filterBatchId, setFilterBatchId] = useState<string>("auto");
  const [filterStatus, setFilterStatus] = useState<"all" | OrderStatus>("all");
  const [filterJam, setFilterJam] = useState<"all" | "siang" | "malam">("all");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Temp state for modal (applied on confirm)
  const [tmpBatch, setTmpBatch] = useState<string>("auto");
  const [tmpStatus, setTmpStatus] = useState<"all" | OrderStatus>("all");
  const [tmpJam, setTmpJam] = useState<"all" | "siang" | "malam">("all");
  const [filterMenu, setFilterMenu] = useState<string>("all");
  const [tmpMenu, setTmpMenu] = useState<string>("all");

  // Production summary drill-down
  const [selectedProdMenuId, setSelectedProdMenuId] = useState<string | null>(null);

  // Deliver-all batch confirmation
  const [deliverAllBatchId, setDeliverAllBatchId] = useState<string | null>(null);
  const [deliverAllLoading, setDeliverAllLoading] = useState(false);

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

  useEffect(() => { if (isAuthed) fetchAll(); }, [fetchAll, isAuthed]);

  // ── Auth gate render ──────────────────────────────────────────────────────
  if (!isAuthed) {
    const isLocked = lockedUntil !== null && Date.now() < lockedUntil;
    const remaining = isLocked ? Math.ceil((lockedUntil! - Date.now()) / 1000) : 0;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return (
      <div className="min-h-screen bg-[#fdf8f2] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#7b1d1d] font-semibold mb-1">Babiqu</p>
            <h1 className="text-2xl font-bold text-[#1c1208]">Dapur Dashboard</h1>
            <p className="text-sm text-[#b8a898] mt-1">Masukkan password untuk melanjutkan</p>
          </div>
          <form onSubmit={handleLogin} className="bg-white rounded-2xl border border-[#e8ddd0] p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#5a3e2b] mb-2 uppercase tracking-wide">Password</label>
              <input
                type="password" value={pwInput} onChange={(e) => { setPwInput(e.target.value); setPwError(""); }}
                placeholder="••••••••••" disabled={isLocked} autoFocus
                className="w-full border border-[#d9cfc5] rounded-xl px-4 py-3 text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition disabled:opacity-50"
              />
            </div>
            {pwError && (
              <div className={`text-sm rounded-xl px-4 py-3 ${isLocked ? "bg-red-50 border border-red-200 text-red-600" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
                {isLocked ? `🔒 ${pwError} (${mins}:${String(secs).padStart(2,"0")})` : `⚠️ ${pwError}`}
              </div>
            )}
            <button type="submit" disabled={isLocked || !pwInput}
              className="w-full bg-[#7b1d1d] text-white font-bold py-3 rounded-xl hover:bg-[#6a1717] transition disabled:opacity-40">
              {isLocked ? `Terkunci (${mins}:${String(secs).padStart(2,"0")})` : "Masuk"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── WA message builder for admin ─────────────────────────────────────────

  function buildOrderWAUrl(order: Order): string {
    // Reconstruct orders/alcOrders maps from order items
    const ordersMap: Record<string, import("@/lib/order-utils").MenuOrder> = {};
    const alcOrdersMap: Record<string, import("@/lib/order-utils").MenuOrder> = {};

    // Init all to 0
    MENUS.forEach(m => { ordersMap[m.id] = { qty: 0, portions: [], sameForAll: true }; });
    ALA_CARTE.forEach(m => { alcOrdersMap[m.id] = { qty: 0, portions: [], sameForAll: true }; });

    // Fill from order items
    order.items?.forEach(item => {
      if (ordersMap[item.menu_id] !== undefined) {
        ordersMap[item.menu_id] = { qty: item.qty, portions: item.portions || [], sameForAll: true };
      } else if (alcOrdersMap[item.menu_id] !== undefined) {
        alcOrdersMap[item.menu_id] = { qty: item.qty, portions: item.portions || [], sameForAll: true };
      } else {
        // Unknown menu — put in alc bucket so it doesn't get lost
        alcOrdersMap[item.menu_id] = { qty: item.qty, portions: item.portions || [], sameForAll: true };
      }
    });

    const msg = buildWAMessage({
      form: {
        name: order.name,
        nomor_wa: order.nomor_wa,
        alamat: order.alamat,
        jam_antar: order.jam_antar,
        catatan: order.notes,
      },
      orders: ordersMap,
      alcOrders: alcOrdersMap,
      total: order.total,
      paymentMethod: order.payment_method as PaymentMethod,
      proofUrl: order.payment_proof_url ?? undefined,
    });

    const cleaned = order.nomor_wa.replace(/\D/g, "");
    return `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`;
  }

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
    setCancelLoading(false);
    closeModal();
  }

  async function handleDeliver(orderId: string) {
    await updateStatus(orderId, "delivered");
    closeModal();
  }

  async function handleConfirm(orderId: string) {
    await updateStatus(orderId, "confirmed");
    closeModal();
  }

  async function handleRestore(orderId: string) {
    await updateStatus(orderId, "pending", { cancel_reason: "" });
  }

  // ── Deliver all in batch ──────────────────────────────────────────────────
  async function handleDeliverAll(batchId: string) {
    setDeliverAllLoading(true);
    // Get all non-cancelled orders in this batch that are not already delivered
    const toDeliver = orders.filter(
      o => o.batch_id === batchId && o.status !== "cancelled" && o.status !== "delivered"
    );
    if (toDeliver.length > 0) {
      const ids = toDeliver.map(o => o.id);
      await supabase.from("orders").update({ status: "delivered" }).in("id", ids);
      setOrders(prev =>
        prev.map(o => ids.includes(o.id) ? { ...o, status: "delivered" } : o)
      );
    }
    setDeliverAllLoading(false);
    setDeliverAllBatchId(null);
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

  function startEditBatch(batch: Batch) {
    setEditingBatch(batch.id);
    setDeletingBatch(null);
    setEditForm({
      label: batch.label,
      open_date: batch.open_date,
      close_date: batch.close_date,
      delivery_date: batch.delivery_date,
      notes: batch.notes ?? "",
      max_orders: batch.max_orders != null ? String(batch.max_orders) : "",
    });
  }

  async function handleSaveBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!editingBatch || !editForm.label.trim()) return;
    setEditLoading(true);
    const max = editForm.max_orders ? parseInt(editForm.max_orders) : null;
    await supabase.from("batches").update({
      label: editForm.label.trim(),
      open_date: editForm.open_date,
      close_date: editForm.close_date,
      delivery_date: editForm.delivery_date,
      notes: editForm.notes.trim(),
      max_orders: max,
    }).eq("id", editingBatch);
    setBatches((prev) => prev.map((b) => b.id === editingBatch
      ? { ...b, label: editForm.label.trim(), open_date: editForm.open_date, close_date: editForm.close_date, delivery_date: editForm.delivery_date, notes: editForm.notes.trim(), max_orders: max }
      : b
    ));
    setEditingBatch(null);
    setEditLoading(false);
  }

  async function handleDeleteExpense(id: string) {
    await supabase.from("expenses").delete().eq("id", id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const isPending = (s: OrderStatus) => s === "active" || s === "pending";

  // Current open batch — capacity counted in portions
  const currentBatch = batches.find(b => {
    const nonCancelled = orders.filter(o => o.batch_id === b.id && o.status !== "cancelled");
    return isBatchActive(b, totalPortions(nonCancelled));
  });

  // Quick stats — based on current/active batch or today
  const statsOrders = currentBatch
    ? orders.filter(o => o.batch_id === currentBatch.id)
    : orders.filter(o => isToday(o.created_at));
  const todayPending   = statsOrders.filter(o => isPending(o.status));
  const todayConfirmed = statsOrders.filter(o => o.status === "confirmed");
  const todayDelivered = statsOrders.filter(o => o.status === "delivered");
  const currentBatchRevenue = statsOrders
    .filter(o => o.status === "confirmed" || o.status === "delivered")
    .reduce((s, o) => s + o.total, 0);

  // Resolved batch for filter ("auto" → active batch or "all")
  const resolvedFilterBatchId = filterBatchId === "auto" ? (currentBatch?.id ?? "all") : filterBatchId;

  // Filter active count for badge
  const activeFilterCount =
    (filterBatchId !== "auto" ? 1 : 0) +
    (filterStatus !== "all" ? 1 : 0) +
    (filterJam !== "all" ? 1 : 0) +
    (filterMenu !== "all" ? 1 : 0);

  // Displayed orders
  const displayedOrders = orders.filter(order => {
    if (resolvedFilterBatchId !== "all" && order.batch_id !== resolvedFilterBatchId) return false;
    if (filterStatus !== "all") {
      const match = filterStatus === "pending" ? isPending(order.status) : order.status === filterStatus;
      if (!match) return false;
    }
    if (filterJam === "siang" && !order.jam_antar.includes("Siang")) return false;
    if (filterJam === "malam" && order.jam_antar.includes("Siang")) return false;
    if (filterMenu !== "all" && !order.items?.some(it => it.menu_id === filterMenu)) return false;
    return true;
  });

  // Production summary — derived from currently displayed (filtered) orders, non-cancelled
  const productionSummary = (() => {
    const map: Record<string, { name: string; qty: number; menuId: string }> = {};
    displayedOrders.filter(o => o.status !== "cancelled").forEach(order => {
      order.items?.forEach(item => {
        if (!map[item.menu_id]) map[item.menu_id] = { name: item.menu_name, qty: 0, menuId: item.menu_id };
        map[item.menu_id].qty += item.qty;
      });
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  })();

  // Keuangan — grouped by batch
  const batchKeuangan = batches.map(batch => {
    const bOrders = orders.filter(o => o.batch_id === batch.id);
    const bConfirmed = bOrders.filter(o => o.status === "confirmed" || o.status === "delivered");
    const bExps = expenses.filter(e => e.batch_id === batch.id);
    const revenue = bConfirmed.reduce((s, o) => s + o.total, 0);
    const expTotal = bExps.reduce((s, e) => s + e.amount, 0);
    return {
      batch,
      revenue,
      expTotal,
      profit: revenue - expTotal,
      portionCount: totalPortions(bConfirmed),
      pendingPortions: totalPortions(bOrders.filter(o => isPending(o.status))),
      expItems: bExps,
    };
  }).filter(b => orders.some(o => o.batch_id === b.batch.id) || b.expTotal > 0);

  const nonBatchExps = expenses.filter(e => !e.batch_id);
  const nonBatchExpTotal = nonBatchExps.reduce((s, e) => s + e.amount, 0);

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
            { label: "Menunggu",     value: todayPending.length,    color: "text-amber-600" },
            { label: "Konfirmasi",   value: todayConfirmed.length,  color: "text-blue-600" },
            { label: "Selesai",      value: todayDelivered.length,  color: "text-green-700" },
            { label: "Omzet Batch",  value: formatRupiah(currentBatchRevenue), color: "text-[#7b1d1d]", small: true },
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

            {/* Filter button */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#8a7060]">
                {displayedOrders.length} pesanan
                {resolvedFilterBatchId !== "all" && currentBatch && filterBatchId === "auto"
                  ? ` · ${currentBatch.label.split(/[—–-]/)[0].trim()}`
                  : resolvedFilterBatchId !== "all"
                  ? ` · ${batches.find(b => b.id === resolvedFilterBatchId)?.label.split(/[—–-]/)[0].trim() ?? ""}`
                  : " · Semua batch"}
              </p>
              <button
                onClick={() => {
                  setTmpBatch(filterBatchId);
                  setTmpStatus(filterStatus);
                  setTmpJam(filterJam);
                  setFilterModalOpen(true);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                  activeFilterCount > 0
                    ? "bg-[#7b1d1d] text-white border-[#7b1d1d]"
                    : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
                }`}
              >
                <span>⚙ Filter</span>
                {activeFilterCount > 0 && (
                  <span className="bg-white text-[#7b1d1d] rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Ringkasan Produksi */}
            {productionSummary.length > 0 && (
              <div className="bg-white rounded-xl border border-[#e8ddd0] overflow-hidden">
                <button onClick={() => { setShowSummary(v => !v); setSelectedProdMenuId(null); }}
                  className="w-full flex items-center justify-between px-4 py-3">
                  <p className="text-xs font-bold text-[#7b1d1d] uppercase tracking-wider">
                    Ringkasan Produksi
                  </p>
                  <span className="text-[#a07850] text-sm">{showSummary ? "−" : "+"}</span>
                </button>
                {showSummary && (
                  <div className="border-t border-[#f0e8de]">
                    {productionSummary.map((menu) => {
                      const isSelected = selectedProdMenuId === menu.menuId;
                      // Orders that contain this menu item
                      const ordersWithMenu = displayedOrders.filter(
                        o => o.status !== "cancelled" && o.items?.some(it => it.menu_id === menu.menuId)
                      );
                      return (
                        <div key={menu.menuId}>
                          {/* Menu row — tap to toggle drill-down */}
                          <button
                            onClick={() => setSelectedProdMenuId(isSelected ? null : menu.menuId)}
                            className={`w-full px-4 py-3 flex items-center justify-between transition ${
                              isSelected ? "bg-[#fdf5f0]" : "hover:bg-[#fdf8f2]"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`text-[9px] transition ${isSelected ? "rotate-90" : ""} text-[#a07850]`}>▶</span>
                              <p className="text-sm text-[#1c1208] truncate">{menu.name}</p>
                            </div>
                            <span className="text-sm font-bold bg-[#7b1d1d] text-white px-2.5 py-0.5 rounded-full shrink-0 ml-2">
                              {menu.qty}×
                            </span>
                          </button>

                          {/* Drill-down: list of who ordered this */}
                          {isSelected && (
                            <div className="bg-[#fdf5f0] border-t border-[#f0e8de] divide-y divide-[#f0e8de]">
                              {ordersWithMenu.map(o => {
                                const thisItem = o.items?.find(it => it.menu_id === menu.menuId);
                                return (
                                  <button
                                    key={o.id}
                                    onClick={() => setSelectedOrder(o)}
                                    className="w-full text-left px-5 py-2.5 hover:bg-[#fdeee6] transition"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-[#1c1208] truncate">{o.name}</p>
                                        <p className="text-xs text-[#8a7060] truncate">{o.alamat}</p>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                          o.jam_antar.includes("Siang") ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                                        }`}>{o.jam_antar.includes("Siang") ? "Siang" : "Malam"}</span>
                                        <p className="text-xs font-bold text-[#7b1d1d] mt-0.5">{thisItem?.qty}×</p>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {loading && <p className="text-center text-[#8a7060] py-12">Memuat...</p>}
            {!loading && displayedOrders.length === 0 && (
              <p className="text-center text-[#b8a898] py-12">
                Tidak ada pesanan untuk filter ini.
              </p>
            )}

            {displayedOrders.map((order, idx) => {
              const prev = displayedOrders[idx - 1];
              const showDate = idx === 0 || new Date(order.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              const isCancelled = order.status === "cancelled";
              const isDelivered = order.status === "delivered";
              const isConfirmed = order.status === "confirmed";
              const isOrderPending = isPending(order.status);

              return (
                <div key={order.id}>
                  {showDate && (
                    <p className="text-xs font-semibold text-[#8a7060] uppercase tracking-wider px-1 pt-2 pb-1">
                      {isToday(order.created_at) ? "Hari Ini" : new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" }).format(new Date(order.created_at))}
                    </p>
                  )}

                  <button onClick={() => setSelectedOrder(order)}
                    className={`w-full text-left bg-white rounded-xl border px-4 py-3 transition-all active:scale-[0.99] ${
                      isCancelled ? "border-red-200 opacity-60" :
                      isDelivered ? "border-green-200 bg-green-50/20" :
                      isConfirmed ? "border-blue-200 bg-blue-50/10" :
                      "border-[#e8ddd0] hover:border-[#c8b8a8]"
                    }`}>
                    {/* Status badge row */}
                    {(isCancelled || isDelivered || isConfirmed) && (
                      <div className="flex items-center gap-2 mb-2">
                        {isCancelled && <>
                          <span className="text-[10px] font-bold bg-red-100 text-red-500 px-2 py-0.5 rounded-full">BATAL</span>
                          {order.cancel_reason && <span className="text-xs text-red-400 truncate">{order.cancel_reason}</span>}
                        </>}
                        {isDelivered && <span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full">SELESAI</span>}
                        {isConfirmed && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">KONFIRMASI ✓</span>}
                      </div>
                    )}
                    {isOrderPending && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">MENUNGGU</span>
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
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          order.payment_method === "cash" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                        }`}>
                          {order.payment_method === "cash" ? "TUNAI" : order.payment_method === "transfer_mandiri" ? "MANDIRI" : "BCA"}
                        </span>
                        <span className="font-bold text-[#7b1d1d] text-sm">{formatRupiah(order.total)}</span>
                      </div>
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
            {batchKeuangan.length === 0 && !loading && (
              <p className="text-center text-[#b8a898] py-8">Belum ada data keuangan per batch.</p>
            )}

            {batchKeuangan.map(({ batch, revenue, expTotal, profit, portionCount, pendingPortions, expItems }) => {
              const isActiveBatch = batch.id === currentBatch?.id;
              const expByCategory = EXPENSE_CATEGORIES.map(cat => ({
                cat, total: expItems.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0),
              })).filter(x => x.total > 0);

              return (
                <div key={batch.id} className={`bg-white rounded-2xl border overflow-hidden ${isActiveBatch ? "border-[#7b1d1d]" : "border-[#e8ddd0]"}`}>
                  {/* Batch header */}
                  <div className={`px-4 py-3 flex items-center justify-between ${isActiveBatch ? "bg-[#7b1d1d]" : "bg-[#fdf8f2]"}`}>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wider ${isActiveBatch ? "text-red-200" : "text-[#8a7060]"}`}>
                        {isActiveBatch ? "● AKTIF" : "Batch"}
                      </p>
                      <p className={`font-bold text-sm ${isActiveBatch ? "text-white" : "text-[#1c1208]"}`}>{batch.label}</p>
                      <p className={`text-[11px] ${isActiveBatch ? "text-red-200" : "text-[#8a7060]"}`}>
                        Antar: {formatBatchDate(batch.delivery_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      {pendingPortions > 0 && (
                        <p className={`text-[10px] font-bold mb-1 ${isActiveBatch ? "text-amber-200" : "text-amber-600"}`}>
                          {pendingPortions} porsi menunggu
                        </p>
                      )}
                      <p className={`text-xs ${isActiveBatch ? "text-red-200" : "text-[#8a7060]"}`}>{portionCount} porsi konfirmasi</p>
                    </div>
                  </div>

                  {/* P&L */}
                  <div className="divide-y divide-[#f0e8de]">
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-[#8a7060]">Pemasukan</p>
                      <p className="text-sm font-bold text-[#1c1208]">{formatRupiah(revenue)}</p>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-[#8a7060]">Pengeluaran</p>
                      <p className="text-sm font-bold text-[#1c1208]">{formatRupiah(expTotal)}</p>
                    </div>
                    <div className={`flex items-center justify-between px-4 py-2.5 ${profit >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                      <p className="text-xs font-bold text-[#5a3e2b]">Keuntungan</p>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {profit >= 0 ? "+" : ""}{formatRupiah(profit)}
                        </p>
                        {revenue > 0 && (
                          <p className="text-[10px] text-[#8a7060]">{Math.round((profit / revenue) * 100)}%</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expense breakdown */}
                  {expByCategory.length > 0 && (
                    <div className="px-4 py-3 border-t border-[#f0e8de] space-y-1.5">
                      <p className="text-[10px] text-[#8a7060] uppercase tracking-wider font-semibold mb-2">Pengeluaran</p>
                      {expByCategory.map(({ cat, total }) => (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="text-xs text-[#5a3e2b] w-20 shrink-0">{cat}</span>
                          <div className="flex-1 bg-[#f0e8de] rounded-full h-1">
                            <div className="bg-[#7b1d1d] h-1 rounded-full" style={{ width: `${expTotal > 0 ? (total / expTotal) * 100 : 0}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-[#1c1208] w-20 text-right shrink-0">{formatRupiah(total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Non-batch expenses */}
            {nonBatchExpTotal > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8ddd0] p-4">
                <p className="text-xs font-bold text-[#5a3e2b] uppercase tracking-wider mb-2">Pengeluaran Lainnya (Tanpa Batch)</p>
                <p className="text-sm font-bold text-[#1c1208]">{formatRupiah(nonBatchExpTotal)}</p>
              </div>
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
                    <label className="block text-[11px] text-[#8a7060] mb-1">Maks. Porsi</label>
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
                const portionCount = totalPortions(batchOrders);
                const isActive = isBatchActive(batch, portionCount);
                const isFull = isBatchFull(batch, portionCount);
                const isUpcoming = isBatchUpcoming(batch);

                return (
                  <div key={batch.id} className={`bg-white rounded-2xl border p-5 ${isActive ? "border-[#7b1d1d] shadow-sm" : "border-[#e8ddd0]"}`}>

                    {/* ── Edit form (inline, shown when editing) ── */}
                    {editingBatch === batch.id ? (
                      <form onSubmit={handleSaveBatch} className="space-y-3 mb-4">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-bold text-[#7b1d1d] uppercase tracking-wider">Edit Batch</p>
                          <button type="button" onClick={() => setEditingBatch(null)}
                            className="text-xs text-[#8a7060] hover:text-[#1c1208] transition">Batal</button>
                        </div>
                        <div>
                          <label className="block text-[11px] text-[#8a7060] mb-1">Nama Batch</label>
                          <input value={editForm.label} onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))} required
                            className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 overflow-hidden">
                          {([["open_date", "PO Buka"], ["close_date", "PO Tutup"]] as const).map(([field, label]) => (
                            <div key={field} className="min-w-0">
                              <label className="block text-[11px] text-[#8a7060] mb-1">{label}</label>
                              <input type="date" value={editForm[field]} onChange={(e) => setEditForm((p) => ({ ...p, [field]: e.target.value }))} required
                                className="w-full border border-[#d9cfc5] rounded-lg px-2 py-2 text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                            </div>
                          ))}
                        </div>
                        <div>
                          <label className="block text-[11px] text-[#8a7060] mb-1">Tanggal Antar</label>
                          <input type="date" value={editForm.delivery_date} onChange={(e) => setEditForm((p) => ({ ...p, delivery_date: e.target.value }))} required
                            className="w-full border border-[#d9cfc5] rounded-lg px-2 py-2 text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 overflow-hidden">
                          <div className="min-w-0">
                            <label className="block text-[11px] text-[#8a7060] mb-1">Maks. Porsi</label>
                            <input value={editForm.max_orders} onChange={(e) => setEditForm((p) => ({ ...p, max_orders: e.target.value.replace(/\D/g, "") }))}
                              placeholder="Tak terbatas" inputMode="numeric"
                              className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2 text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                          </div>
                          <div className="min-w-0">
                            <label className="block text-[11px] text-[#8a7060] mb-1">Catatan</label>
                            <input value={editForm.notes} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                              placeholder="opsional"
                              className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2 text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition" />
                          </div>
                        </div>
                        <button type="submit" disabled={editLoading || !editForm.label.trim()}
                          className="w-full bg-[#7b1d1d] text-white font-bold py-2.5 rounded-xl hover:bg-[#6a1717] transition disabled:opacity-40 text-sm">
                          {editLoading ? "Menyimpan..." : "Simpan Perubahan"}
                        </button>
                      </form>
                    ) : (
                      <>
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
                                  Terisi: {portionCount}/{batch.max_orders} porsi
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
                            <button onClick={() => startEditBatch(batch)}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#f0e8de] text-[#5a3e2b] hover:bg-[#e8ddd0] transition">
                              Edit
                            </button>
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
                      </>
                    )}

                    {/* Stats grid */}
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {[
                        { label: "Porsi", value: portionCount },
                        { label: "Selesai", value: totalPortions(batchDelivered) },
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

                    {/* Selesai Semua — only show if there are non-cancelled, non-delivered orders */}
                    {(() => {
                      const toDeliver = orders.filter(
                        o => o.batch_id === batch.id && o.status !== "cancelled" && o.status !== "delivered"
                      );
                      if (toDeliver.length === 0) return null;
                      const toDeliverPortions = totalPortions(toDeliver);
                      const isConfirming = deliverAllBatchId === batch.id;
                      return (
                        <div className="border-t border-[#f0e8de] pt-3 mt-1">
                          {isConfirming ? (
                            <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                              <p className="text-xs text-green-700 flex-1">
                                Set {toDeliver.length} pesanan ({toDeliverPortions} porsi) jadi Selesai?
                              </p>
                              <button
                                onClick={() => handleDeliverAll(batch.id)}
                                disabled={deliverAllLoading}
                                className="text-xs font-bold text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition">
                                {deliverAllLoading ? "..." : "Ya, Selesai"}
                              </button>
                              <button onClick={() => setDeliverAllBatchId(null)}
                                className="text-xs text-[#8a7060] hover:text-[#1c1208] transition">Batal</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeliverAllBatchId(batch.id)}
                              className="w-full text-xs font-bold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 rounded-xl py-2 transition">
                              ✓ Selesai Semua ({toDeliverPortions} porsi)
                            </button>
                          )}
                        </div>
                      );
                    })()}
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
        const isConfirmedOrder = o.status === "confirmed";
        const isModalPending = isPending(o.status);
        return (
          <div className="fixed inset-0 z-[60] bg-[#fdf8f2] flex flex-col">
            {/* Top bar */}
            <div className="shrink-0 bg-white border-b border-[#e8ddd0] px-4 py-3 flex items-center gap-3">
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

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-4 pt-5 pb-4 space-y-4">

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
                      className="shrink-0 text-sm text-[#8a7060] hover:text-[#1c1208] transition ml-3">Pulihkan</button>
                  </div>
                )}
                {isConfirmedOrder && (
                  <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
                    <p className="text-sm font-bold text-blue-700">✓ Pesanan dikonfirmasi</p>
                    <p className="text-xs text-blue-500 mt-0.5">
                      {o.payment_method === "cash" ? "Bayar tunai saat pengiriman" : "Transfer sudah dikonfirmasi"}
                    </p>
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
                  {/* Payment */}
                  <div className="px-4 py-3 border-t border-[#f0e8de]">
                    <p className="text-[10px] text-[#8a7060] uppercase tracking-widest font-semibold mb-2">Pembayaran</p>
                    <span className={`text-sm font-bold ${o.payment_method === "cash" ? "text-amber-700" : "text-green-700"}`}>
                      {o.payment_method === "cash" ? "💵 Tunai"
                        : o.payment_method === "transfer_mandiri" ? "🏦 Transfer Mandiri"
                        : o.payment_method === "transfer_bca" ? "🏦 Transfer BCA"
                        : o.payment_method}
                    </span>
                    {o.payment_proof_url && (
                      <button type="button" onClick={() => setProofLightbox(o.payment_proof_url!)} className="block w-full mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={o.payment_proof_url} alt="Bukti transfer"
                          className="w-full max-h-56 object-cover rounded-xl border border-[#e8ddd0] cursor-zoom-in" />
                        <p className="text-[10px] text-[#8a7060] mt-1 text-center">Tap untuk perbesar</p>
                      </button>
                    )}
                    {o.payment_method !== "cash" && !o.payment_proof_url && (
                      <p className="text-xs text-amber-600 mt-1">⚠ Bukti transfer belum diupload</p>
                    )}
                  </div>
                </div>

                {/* Cancel reason input (shown inline when cancelling) */}
                {o.status === "active" && cancelling === o.id && (
                  <input autoFocus value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCancel(o.id); if (e.key === "Escape") { setCancelling(null); setCancelReason(""); } }}
                    placeholder="Tulis alasan pembatalan..."
                    className="w-full border border-red-200 rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-red-400 bg-white"
                  />
                )}

              </div>
            </div>

            {/* Sticky bottom action bar */}
            {!isCancelled && (
              <div className="shrink-0 bg-white border-t border-[#e8ddd0] px-4 py-4 safe-area-pb">
                <div className="max-w-2xl mx-auto space-y-2">
                  {/* Kirim WA — always visible */}
                  <a href={buildOrderWAUrl(o)} target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl bg-[#25D366] hover:bg-[#20ba5a] active:scale-[0.99] transition font-bold text-white text-sm">
                    <MessageCircle size={18} /> Kirim WA ke Pelanggan
                  </a>

                  {/* PENDING → Konfirmasi or Cancel */}
                  {isModalPending && (cancelling === o.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleCancel(o.id)} disabled={cancelLoading || !cancelReason.trim()}
                        className="flex-1 text-sm font-bold text-white bg-red-500 hover:bg-red-600 py-3.5 rounded-2xl transition disabled:opacity-40">
                        {cancelLoading ? "Menyimpan..." : "Konfirmasi Batalkan"}
                      </button>
                      <button onClick={() => { setCancelling(null); setCancelReason(""); }}
                        className="px-5 py-3.5 text-sm font-semibold text-[#8a7060] bg-[#f0e8de] rounded-2xl">Batal</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => handleConfirm(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] transition font-bold text-white text-base">
                        <span className="text-xl leading-none">✓</span> Konfirmasi Pesanan
                      </button>
                      <button onClick={() => setCancelling(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-2xl bg-white border-2 border-red-200 hover:border-red-300 hover:bg-red-50 active:scale-[0.99] transition font-bold text-red-500 text-sm">
                        ✕ Batalkan
                      </button>
                    </>
                  ))}

                  {/* CONFIRMED → Selesaikan or Cancel */}
                  {isConfirmedOrder && (cancelling === o.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleCancel(o.id)} disabled={cancelLoading || !cancelReason.trim()}
                        className="flex-1 text-sm font-bold text-white bg-red-500 hover:bg-red-600 py-3.5 rounded-2xl transition disabled:opacity-40">
                        {cancelLoading ? "Menyimpan..." : "Konfirmasi Batalkan"}
                      </button>
                      <button onClick={() => { setCancelling(null); setCancelReason(""); }}
                        className="px-5 py-3.5 text-sm font-semibold text-[#8a7060] bg-[#f0e8de] rounded-2xl">Batal</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => handleDeliver(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl bg-green-500 hover:bg-green-600 active:scale-[0.99] transition font-bold text-white text-base">
                        <span className="text-xl leading-none">✓</span> Selesaikan Pesanan
                      </button>
                      <button onClick={() => setCancelling(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-2xl bg-white border-2 border-red-200 hover:border-red-300 hover:bg-red-50 active:scale-[0.99] transition font-bold text-red-500 text-sm">
                        ✕ Batalkan
                      </button>
                    </>
                  ))}

                  {/* DELIVERED → no primary action, just info */}
                  {isDelivered && (
                    <p className="text-center text-xs text-[#b8a898]">Pesanan sudah selesai diantar</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Filter Modal (bottom sheet) ─────────────────────────────────── */}
      {filterModalOpen && (
        <div className="fixed inset-0 z-[65] flex flex-col justify-end">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setFilterModalOpen(false)} />
          {/* Sheet */}
          <div className="relative bg-white rounded-t-2xl px-4 pt-4 pb-8 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="font-bold text-[#1c1208]">Filter Pesanan</p>
              <button onClick={() => setFilterModalOpen(false)} className="text-[#8a7060] text-xl leading-none">×</button>
            </div>

            {/* Batch */}
            <div>
              <label className="block text-xs font-bold text-[#5a3e2b] uppercase tracking-wider mb-1.5">Batch</label>
              <select
                value={tmpBatch}
                onChange={e => setTmpBatch(e.target.value)}
                className="w-full border border-[#d9cfc5] rounded-xl px-3 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition"
              >
                <option value="auto">
                  {currentBatch ? `● ${currentBatch.label} (aktif)` : "Batch Aktif (tidak ada)"}
                </option>
                <option value="all">Semua Batch</option>
                {batches.filter(b => b.id !== currentBatch?.id).map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-bold text-[#5a3e2b] uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={tmpStatus}
                onChange={e => setTmpStatus(e.target.value as typeof tmpStatus)}
                className="w-full border border-[#d9cfc5] rounded-xl px-3 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition"
              >
                <option value="all">Semua Status</option>
                <option value="pending">Menunggu</option>
                <option value="confirmed">Konfirmasi</option>
                <option value="delivered">Selesai</option>
                <option value="cancelled">Batal</option>
              </select>
            </div>

            {/* Jam Antar */}
            <div>
              <label className="block text-xs font-bold text-[#5a3e2b] uppercase tracking-wider mb-1.5">Jam Antar</label>
              <select
                value={tmpJam}
                onChange={e => setTmpJam(e.target.value as typeof tmpJam)}
                className="w-full border border-[#d9cfc5] rounded-xl px-3 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition"
              >
                <option value="all">Semua Waktu</option>
                <option value="siang">☀️ Siang (11.00–13.00)</option>
                <option value="malam">🌙 Malam (17.00–19.00)</option>
              </select>
            </div>

            {/* Menu */}
            <div>
              <label className="block text-xs font-bold text-[#5a3e2b] uppercase tracking-wider mb-1.5">Menu</label>
              <select
                value={tmpMenu}
                onChange={e => setTmpMenu(e.target.value)}
                className="w-full border border-[#d9cfc5] rounded-xl px-3 py-2.5 text-sm text-[#1c1208] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] transition"
              >
                <option value="all">Semua Menu</option>
                <optgroup label="Paket">
                  {MENUS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
                <optgroup label="À La Carte">
                  {ALA_CARTE.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
              </select>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setTmpBatch("auto"); setTmpStatus("all"); setTmpJam("all"); setTmpMenu("all"); }}
                className="px-4 py-3 rounded-xl border border-[#d9cfc5] text-sm text-[#8a7060] hover:border-[#7b1d1d] transition"
              >Reset</button>
              <button
                onClick={() => {
                  setFilterBatchId(tmpBatch);
                  setFilterStatus(tmpStatus);
                  setFilterJam(tmpJam);
                  setFilterMenu(tmpMenu);
                  setFilterModalOpen(false);
                }}
                className="flex-1 py-3 rounded-xl bg-[#7b1d1d] text-white font-bold text-sm hover:bg-[#6a1717] transition"
              >Terapkan Filter</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Proof image lightbox ────────────────────────────────────────── */}
      {proofLightbox && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setProofLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proofLightbox} alt="Bukti transfer"
            className="max-w-full max-h-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setProofLightbox(null)}
            className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl font-bold transition">×</button>
        </div>
      )}

      {/* ── Bottom Nav Dock ─────────────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-[#e8ddd0] safe-area-pb">
        <div className="max-w-2xl mx-auto flex">
          {NAV.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => { setTab(key as typeof tab); closeModal(); }}
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
