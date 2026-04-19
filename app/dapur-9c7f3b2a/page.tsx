"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  ClipboardList, BarChart2, Receipt, CalendarDays, ExternalLink, RefreshCw,
  MessageCircle, TrendingUp, TrendingDown, Clock, CheckCircle2, Wallet,
  Sun, Moon, Banknote, Landmark, FileText, XCircle, CheckCheck, ChevronDown,
  ChevronUp, Plus, Minus, Eye, EyeOff,
} from "lucide-react";
import { buildWAMessage, MENUS, ALA_CARTE, ONGKIR, type PaymentMethod } from "@/lib/order-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Portion = { options: Record<string, string>; notes: string };
type OrderItem = { menu_id: string; menu_name: string; qty: number; portions: Portion[]; subtotal: number };
type OrderStatus = "active" | "pending" | "confirmed" | "delivered" | "cancelled";
type OrderLog = { at: string; action: string; detail: string };
type Order = {
  id: string; created_at: string; name: string; nomor_wa: string;
  alamat: string; jam_antar: string; items: OrderItem[];
  notes: string; total: number; status: OrderStatus; cancel_reason: string;
  batch_id: string | null; payment_method: string; payment_proof_url: string | null;
  logs: OrderLog[];
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

// ─── Cash-due helpers ─────────────────────────────────────────────────────────

function getCashDue(order: { logs?: { action: string; detail: string }[] }): number {
  return (order.logs ?? [])
    .filter(l => l.action === "edited" && l.detail.includes("tunai saat antar"))
    .reduce((sum, l) => {
      const match = l.detail.match(/\+Rp\s?([\d.]+)/);
      return match ? sum + parseInt(match[1].replace(/\./g, "")) : sum;
    }, 0);
}

/** True when there are cash additions that haven't been confirmed yet */
function hasPendingCash(order: { logs?: { action: string; detail: string }[] }): boolean {
  const logs = order.logs ?? [];
  let lastAdditionIdx = -1;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].action === "edited" && logs[i].detail.includes("tunai saat antar")) {
      lastAdditionIdx = i;
      break;
    }
  }
  if (lastAdditionIdx === -1) return false;
  return !logs.slice(lastAdditionIdx + 1).some(l => l.action === "cash_confirmed");
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
function nameInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
const AVATAR_COLORS = [
  "bg-rose-400","bg-orange-400","bg-amber-400","bg-lime-500","bg-teal-500",
  "bg-cyan-500","bg-sky-500","bg-blue-500","bg-violet-500","bg-fuchsia-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ─── Component ────────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = "M@ntapjiwa00";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export default function DashboardPage() {
  // ── Auth gate ─────────────────────────────────────────────────────────────
  const [isAuthed, setIsAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [showPw, setShowPw] = useState(false);

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
  const [tab, setTab] = useState<"pesanan" | "keuangan" | "pengeluaran" | "batch" | "dashboard">("pesanan");
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

  const closeModal = useCallback(() => {
    setSelectedOrder(null);
    setCancelling(null);
    setCancelReason("");
    setEditingOrderItems(false);
    setEditOrderQty({});
  }, []);

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

  // Edit order
  const [editingOrderItems, setEditingOrderItems] = useState(false);
  const [editOrderQty, setEditOrderQty] = useState<Record<string, number>>({});
  const [editOrderLoading, setEditOrderLoading] = useState(false);

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
      <div className="min-h-screen bg-[#f2f2f7] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Brand mark */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-gray-900 rounded-2xl mb-5 shadow-lg">
              <span className="text-white text-xl font-black tracking-tighter">BQ</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Dapur</h1>
            <p className="text-sm text-gray-400 mt-1">Masukkan password untuk lanjut</p>
          </div>

          {/* Card */}
          <form onSubmit={handleLogin} className="bg-white rounded-3xl shadow-sm p-7 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"} value={pwInput}
                  onChange={(e) => { setPwInput(e.target.value); setPwError(""); }}
                  placeholder="••••••••••" disabled={isLocked} autoFocus
                  className="w-full bg-gray-50 rounded-xl px-4 py-3.5 pr-11 text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/10 transition disabled:opacity-40"
                />
                <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {pwError && (
              <div className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ${
                isLocked ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"
              }`}>
                <XCircle size={15} className="shrink-0 mt-0.5" />
                <span>
                  {isLocked
                    ? `Terkunci. Coba lagi dalam ${mins}:${String(secs).padStart(2,"0")}`
                    : pwError}
                </span>
              </div>
            )}

            <button type="submit" disabled={isLocked || !pwInput}
              className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 rounded-2xl transition disabled:opacity-30 text-sm">
              {isLocked ? `Terkunci (${mins}:${String(secs).padStart(2,"0")})` : "Masuk"}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">Babiqu · Admin Panel</p>
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

  async function updateStatus(orderId: string, status: OrderStatus, extra?: { cancel_reason?: string }, logDetail?: string) {
    const order = orders.find(o => o.id === orderId);
    const defaultDetail: Record<OrderStatus, string> = {
      active:    "Dipulihkan ke Menunggu",
      pending:   "Dipulihkan ke Menunggu",
      confirmed: "Pembayaran dikonfirmasi",
      delivered: "Pesanan selesai diantar",
      cancelled: extra?.cancel_reason ? `Dibatalkan: ${extra.cancel_reason}` : "Dibatalkan",
    };
    const newLog: OrderLog = { at: new Date().toISOString(), action: status, detail: logDetail ?? defaultDetail[status] };
    const updatedLogs = [...(order?.logs ?? []), newLog];
    await supabase.from("orders").update({ status, logs: updatedLogs, ...extra }).eq("id", orderId);
    setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status, logs: updatedLogs, ...(extra || {}) } : o));
    setSelectedOrder((prev) => prev?.id === orderId ? { ...prev, status, logs: updatedLogs, ...(extra || {}) } : prev);
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

  // ── Confirm cash payment for additions ───────────────────────────────────

  async function handleConfirmCash(order: Order) {
    const cashDue = getCashDue(order);
    const newLog: OrderLog = {
      at: new Date().toISOString(),
      action: "cash_confirmed",
      detail: `Kekurangan tunai ${formatRupiah(cashDue)} sudah diterima`,
    };
    const updatedLogs = [...(order.logs ?? []), newLog];
    await supabase.from("orders").update({ logs: updatedLogs }).eq("id", order.id);
    const updated = { ...order, logs: updatedLogs };
    setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
    setSelectedOrder(updated);
  }

  // ── Edit order items ─────────────────────────────────────────────────────

  function startEditOrder(order: Order) {
    const qty: Record<string, number> = {};
    order.items?.forEach(it => { qty[it.menu_id] = it.qty; });
    setEditOrderQty(qty);
    setEditingOrderItems(true);
  }

  async function handleSaveOrderItems(order: Order) {
    setEditOrderLoading(true);
    const allMenus = [...MENUS, ...ALA_CARTE];
    const newItems: OrderItem[] = allMenus
      .filter(m => (editOrderQty[m.id] ?? 0) > 0)
      .map(m => {
        const qty = editOrderQty[m.id];
        const existing = order.items?.find(it => it.menu_id === m.id);
        const portions: Portion[] = Array.from({ length: qty }, (_, i) =>
          existing?.portions?.[i] ?? { options: {}, notes: "" }
        );
        return { menu_id: m.id, menu_name: m.name, qty, portions, subtotal: m.price * qty };
      });

    const subtotal = newItems.reduce((s, it) => s + it.subtotal, 0);
    const newTotal = subtotal > 0 ? subtotal + ONGKIR : 0;
    const diff = newTotal - order.total;
    const isTransfer = order.payment_method !== "cash";

    // Rule: any addition after order placed = pay cash at delivery
    // Only revert to pending if total DECREASES on a transfer (overpayment needs resolution)
    const newStatus: OrderStatus = (diff < 0 && isTransfer && order.status === "confirmed")
      ? "pending"
      : order.status;

    // Build log entry
    let logDetail: string;
    if (diff > 0) {
      logDetail = `Item ditambah (+${formatRupiah(diff)}) — kekurangan bayar tunai saat antar`;
    } else if (diff < 0) {
      logDetail = `Item dikurangi (${formatRupiah(diff)}) — total baru ${formatRupiah(newTotal)}`;
    } else {
      logDetail = "Item diubah (total sama)";
    }

    const editLog: OrderLog = { at: new Date().toISOString(), action: "edited", detail: logDetail };
    let updatedLogs = [...(order.logs ?? []), editLog];
    if (newStatus !== order.status) {
      updatedLogs = [...updatedLogs, {
        at: new Date().toISOString(),
        action: newStatus,
        detail: `Status kembali ke Menunggu — ada kelebihan bayar ${formatRupiah(Math.abs(diff))}`,
      }];
    }

    await supabase.from("orders").update({
      items: newItems,
      total: newTotal,
      logs: updatedLogs,
      ...(newStatus !== order.status ? { status: newStatus } : {}),
    }).eq("id", order.id);

    const updated = { ...order, items: newItems, total: newTotal, status: newStatus, logs: updatedLogs };
    setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
    setSelectedOrder(updated);
    setEditingOrderItems(false);
    setEditOrderQty({});
    setEditOrderLoading(false);
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

  // ── Analytics / statistics derived data ──────────────────────────────────

  const analyticsOrders = orders; // all orders
  const anActive = analyticsOrders.filter(o => o.status !== "cancelled");
  const anDelivered = analyticsOrders.filter(o => o.status === "delivered");
  const anConfirmedOrDelivered = analyticsOrders.filter(o => o.status === "confirmed" || o.status === "delivered");
  const anCancelled = analyticsOrders.filter(o => o.status === "cancelled");

  const totalRevenue = anConfirmedOrDelivered.reduce((s, o) => s + o.total, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalProfit = totalRevenue - totalExpenses;
  const completionRate = anActive.length > 0 ? Math.round((anDelivered.length / anActive.length) * 100) : 0;
  const avgOrderValue = anActive.length > 0 ? Math.round(totalRevenue / anConfirmedOrDelivered.length || 0) : 0;

  // Top menus by qty — across all non-cancelled orders
  const menuQtyMap: Record<string, { name: string; qty: number }> = {};
  anActive.forEach(o => {
    o.items?.forEach(it => {
      if (!menuQtyMap[it.menu_id]) menuQtyMap[it.menu_id] = { name: it.menu_name, qty: 0 };
      menuQtyMap[it.menu_id].qty += it.qty;
    });
  });
  const topMenus = Object.values(menuQtyMap).sort((a, b) => b.qty - a.qty).slice(0, 6);
  const topMenusMaxQty = topMenus[0]?.qty || 1;

  // Payment method breakdown
  const paymentBreakdown = ["cash", "transfer_mandiri", "transfer_bca"].map(pm => {
    const pmOrders = anConfirmedOrDelivered.filter(o => o.payment_method === pm);
    return {
      method: pm,
      label: pm === "cash" ? "Tunai" : pm === "transfer_mandiri" ? "Mandiri" : "BCA",
      count: pmOrders.length,
      revenue: pmOrders.reduce((s, o) => s + o.total, 0),
    };
  }).filter(p => p.count > 0);

  // Jam antar breakdown
  const siangOrders = anActive.filter(o => o.jam_antar.includes("Siang"));
  const malamOrders = anActive.filter(o => !o.jam_antar.includes("Siang"));

  // Batch performance for chart
  const batchPerf = batches.map(b => {
    const bAll = orders.filter(o => o.batch_id === b.id);
    const bNonCancelled = bAll.filter(o => o.status !== "cancelled");
    const bDelivered = bAll.filter(o => o.status === "delivered");
    const bRevenue = bAll.filter(o => o.status === "confirmed" || o.status === "delivered").reduce((s, o) => s + o.total, 0);
    const bPortions = totalPortions(bNonCancelled);
    const rate = bNonCancelled.length > 0 ? Math.round((bDelivered.length / bNonCancelled.length) * 100) : 0;
    return { id: b.id, label: b.label.split(/[—–-]/)[0].trim(), revenue: bRevenue, portions: bPortions, deliveryRate: rate, orderCount: bNonCancelled.length };
  }).filter(b => b.orderCount > 0);
  const batchPerfMaxRevenue = Math.max(...batchPerf.map(b => b.revenue), 1);

  // ─────────────────────────────────────────────────────────────────────────

  const NAV = [
    { key: "pesanan",     label: "Pesanan",  Icon: ClipboardList },
    { key: "keuangan",    label: "Keuangan", Icon: BarChart2 },
    { key: "pengeluaran", label: "Biaya",    Icon: Receipt },
    { key: "batch",       label: "Batch",    Icon: CalendarDays },
    { key: "dashboard",   label: "Statistik", Icon: TrendingUp },
  ] as const;

  return (
    <div className="min-h-screen bg-[#f2f2f7] pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-5 pb-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-5 pt-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">Dapur</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {currentBatch ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  {currentBatch.label.split(/[—–-]/)[0].trim()}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Tidak ada batch aktif</span>
              )}
              {lastUpdated && (
                <span className="text-[10px] text-gray-300">· {lastUpdated.toLocaleTimeString("id-ID")}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center w-9 h-9 bg-white rounded-xl shadow-sm text-gray-500 hover:text-gray-800 transition"
              title="Buka Form">
              <ExternalLink size={15} />
            </a>
            <button onClick={fetchAll} disabled={loading}
              className="flex items-center justify-center w-9 h-9 bg-gray-900 text-white rounded-xl shadow-sm hover:bg-black transition disabled:opacity-40"
              title="Refresh">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Quick stats — 2×2 grid */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: "Menunggu",    value: todayPending.length,   big: true,  color: "text-gray-900" },
            { label: "Konfirmasi",  value: todayConfirmed.length, big: true,  color: "text-gray-900" },
            { label: "Selesai",     value: todayDelivered.length, big: true,  color: "text-green-600" },
            { label: "Omzet Batch", value: formatRupiah(currentBatchRevenue), big: false, color: "text-gray-900" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl shadow-sm px-4 py-4">
              <p className={`font-bold leading-none ${s.color} ${s.big ? "text-3xl" : "text-lg"}`}>{s.value}</p>
              <p className="text-xs text-gray-400 font-medium mt-2">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── TAB: PESANAN ────────────────────────────────────────────────── */}
        {tab === "pesanan" && (
          <div className="space-y-3">

            {/* Filter row */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500">
                <span className="font-bold text-gray-900">{displayedOrders.length}</span>
                <span className="ml-1.5">
                  {resolvedFilterBatchId !== "all" && currentBatch && filterBatchId === "auto"
                    ? currentBatch.label.split(/[—–-]/)[0].trim()
                    : resolvedFilterBatchId !== "all"
                    ? batches.find(b => b.id === resolvedFilterBatchId)?.label.split(/[—–-]/)[0].trim() ?? "pesanan"
                    : "pesanan"}
                </span>
              </p>
              <button
                onClick={() => {
                  setTmpBatch(filterBatchId);
                  setTmpStatus(filterStatus);
                  setTmpJam(filterJam);
                  setFilterModalOpen(true);
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                  activeFilterCount > 0
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 shadow-sm hover:bg-gray-50"
                }`}
              >
                <span>Filter</span>
                {activeFilterCount > 0 && (
                  <span className="bg-white/25 rounded-md px-1.5 text-[10px] font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Ringkasan Produksi */}
            {productionSummary.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <button onClick={() => { setShowSummary(v => !v); setSelectedProdMenuId(null); }}
                  className="w-full flex items-center justify-between px-4 py-3.5 border-b border-gray-100">
                  <p className="text-sm font-bold text-gray-900">Ringkasan Produksi</p>
                  {showSummary ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
                </button>
                {showSummary && (
                  <div>
                    {productionSummary.map((menu) => {
                      const isSelected = selectedProdMenuId === menu.menuId;
                      const ordersWithMenu = displayedOrders.filter(
                        o => o.status !== "cancelled" && o.items?.some(it => it.menu_id === menu.menuId)
                      );
                      return (
                        <div key={menu.menuId} className="border-b border-gray-50 last:border-b-0">
                          <button
                            onClick={() => setSelectedProdMenuId(isSelected ? null : menu.menuId)}
                            className={`w-full px-4 py-3 flex items-center justify-between transition ${
                              isSelected ? "bg-gray-50" : "hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ChevronDown size={13} className={`text-gray-300 transition-transform shrink-0 ${isSelected ? "rotate-180" : ""}`} />
                              <p className="text-sm text-gray-800 truncate">{menu.name}</p>
                            </div>
                            <span className="text-xs font-bold text-gray-900 bg-gray-100 px-2.5 py-0.5 rounded-lg shrink-0 ml-2">
                              {menu.qty}×
                            </span>
                          </button>

                          {isSelected && (
                            <div className="bg-gray-50 border-t border-gray-100 divide-y divide-gray-100">
                              {ordersWithMenu.map(o => {
                                const thisItem = o.items?.find(it => it.menu_id === menu.menuId);
                                return (
                                  <button
                                    key={o.id}
                                    onClick={() => setSelectedOrder(o)}
                                    className="w-full text-left px-5 py-3 hover:bg-gray-100 transition"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-gray-900 truncate">{o.name}</p>
                                        <p className="text-xs text-gray-400 truncate mt-0.5">{o.alamat}</p>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${
                                          o.jam_antar.includes("Siang") ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                                        }`}>{o.jam_antar.includes("Siang") ? "Siang" : "Malam"}</span>
                                        <p className="text-xs font-bold text-gray-900 mt-1">{thisItem?.qty}×</p>
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

            {loading && <p className="text-center text-gray-400 py-12 text-sm">Memuat...</p>}
            {!loading && displayedOrders.length === 0 && (
              <p className="text-center text-gray-400 py-12 text-sm">Tidak ada pesanan untuk filter ini.</p>
            )}

            {displayedOrders.map((order, idx) => {
              const prev = displayedOrders[idx - 1];
              const showDate = idx === 0 || new Date(order.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              const isCancelled = order.status === "cancelled";
              const isDelivered = order.status === "delivered";
              const isConfirmed = order.status === "confirmed";

              // status dot colour
              const dotColor = isCancelled ? "bg-red-400" : isDelivered ? "bg-green-500" : isConfirmed ? "bg-blue-500" : "bg-amber-400";
              const statusLabel = isCancelled ? "Batal" : isDelivered ? "Selesai" : isConfirmed ? "Konfirmasi" : "Menunggu";
              const statusColor = isCancelled ? "text-red-500" : isDelivered ? "text-green-600" : isConfirmed ? "text-blue-600" : "text-amber-600";

              return (
                <div key={order.id}>
                  {showDate && (
                    <p className="text-xs font-semibold text-gray-400 px-1 pt-4 pb-1.5">
                      {isToday(order.created_at) ? "Hari Ini" : new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" }).format(new Date(order.created_at))}
                    </p>
                  )}

                  <button onClick={() => setSelectedOrder(order)}
                    className={`w-full text-left bg-white rounded-2xl shadow-sm overflow-hidden transition-all active:scale-[0.99] ${
                      isCancelled ? "opacity-50" : ""
                    }`}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      {/* Avatar */}
                      <span className={`flex items-center justify-center w-10 h-10 rounded-full text-white text-xs font-bold shrink-0 ${avatarColor(order.name)}`}>
                        {nameInitials(order.name)}
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-gray-900 text-sm truncate">{order.name}</p>
                          <p className="text-xs font-bold text-gray-900 shrink-0">{formatRupiah(order.total)}</p>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-gray-400 truncate">
                            {order.items?.map((it) => `${it.qty}× ${it.menu_name.split(" ").slice(0,2).join(" ")}`).join(", ")}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                            <span className={`text-[11px] font-semibold ${statusColor}`}>{statusLabel}</span>
                          </div>
                        </div>
                        {isCancelled && order.cancel_reason && (
                          <p className="text-xs text-red-400 truncate mt-0.5">{order.cancel_reason}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-gray-400">
                            {order.jam_antar.includes("Siang") ? "Siang" : "Malam"}
                          </span>
                          <span className="text-gray-200">·</span>
                          <span className={`text-[10px] font-medium ${order.payment_method === "cash" ? "text-amber-600" : "text-green-600"}`}>
                            {order.payment_method === "cash" ? "Tunai" : order.payment_method === "transfer_mandiri" ? "Mandiri" : "BCA"}
                          </span>
                        </div>
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
              <p className="text-center text-gray-400 py-8 text-sm">Belum ada data keuangan per batch.</p>
            )}

            {batchKeuangan.map(({ batch, revenue, expTotal, profit, portionCount, pendingPortions, expItems }) => {
              const isActiveBatch = batch.id === currentBatch?.id;
              const expByCategory = EXPENSE_CATEGORIES.map(cat => ({
                cat, total: expItems.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0),
              })).filter(x => x.total > 0);

              return (
                <div key={batch.id} className={`bg-white rounded-xl border overflow-hidden shadow-sm ${isActiveBatch ? "border-[#7b1d1d]/30" : "border-gray-100"}`}>
                  {/* Batch header */}
                  <div className={`px-4 py-3 flex items-center justify-between border-b ${isActiveBatch ? "bg-[#7b1d1d] border-[#7b1d1d]" : "bg-gray-50 border-gray-100"}`}>
                    <div>
                      <p className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider ${isActiveBatch ? "text-red-200" : "text-gray-400"}`}>
                        {isActiveBatch && <CheckCircle2 size={11} />}{isActiveBatch ? "Aktif" : "Batch"}
                      </p>
                      <p className={`font-semibold text-sm mt-0.5 ${isActiveBatch ? "text-white" : "text-gray-900"}`}>{batch.label}</p>
                      <p className={`text-[11px] mt-0.5 ${isActiveBatch ? "text-red-200" : "text-gray-400"}`}>
                        Antar: {formatBatchDate(batch.delivery_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      {pendingPortions > 0 && (
                        <p className={`text-[10px] font-semibold mb-1 ${isActiveBatch ? "text-amber-200" : "text-amber-600"}`}>
                          {pendingPortions} porsi menunggu
                        </p>
                      )}
                      <p className={`text-xs ${isActiveBatch ? "text-red-200" : "text-gray-400"}`}>{portionCount} porsi konfirmasi</p>
                    </div>
                  </div>

                  {/* P&L */}
                  <div className="divide-y divide-gray-50">
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-gray-500">Pemasukan</p>
                      <p className="text-sm font-semibold text-gray-900">{formatRupiah(revenue)}</p>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-gray-500">Pengeluaran</p>
                      <p className="text-sm font-semibold text-gray-900">{formatRupiah(expTotal)}</p>
                    </div>
                    <div className={`flex items-center justify-between px-4 py-2.5 ${profit >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                      <p className="text-xs font-semibold text-gray-700">Keuntungan</p>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {profit >= 0 ? "+" : ""}{formatRupiah(profit)}
                        </p>
                        {revenue > 0 && (
                          <p className="text-[10px] text-gray-400">{Math.round((profit / revenue) * 100)}%</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expense breakdown */}
                  {expByCategory.length > 0 && (
                    <div className="px-4 py-3 border-t border-gray-50 space-y-1.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-2">Pengeluaran</p>
                      {expByCategory.map(({ cat, total }) => (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 w-20 shrink-0">{cat}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-1">
                            <div className="bg-[#7b1d1d] h-1 rounded-full" style={{ width: `${expTotal > 0 ? (total / expTotal) * 100 : 0}%` }} />
                          </div>
                          <span className="text-xs font-semibold text-gray-800 w-20 text-right shrink-0">{formatRupiah(total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Non-batch expenses */}
            {nonBatchExpTotal > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Pengeluaran Lainnya (Tanpa Batch)</p>
                <p className="text-sm font-bold text-gray-900">{formatRupiah(nonBatchExpTotal)}</p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: PENGELUARAN ────────────────────────────────────────────── */}
        {tab === "pengeluaran" && (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Tambah Pengeluaran</p>
              <form onSubmit={handleAddExpense} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider">Keterangan</label>
                  <input value={expForm.description} onChange={(e) => setExpForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. Beli babi 5kg" required
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                </div>
                <div className="grid grid-cols-2 gap-3 overflow-hidden">
                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider">Jumlah (Rp)</label>
                    <input value={expForm.amount}
                      onChange={(e) => { const raw = e.target.value.replace(/\D/g, ""); setExpForm((p) => ({ ...p, amount: raw ? parseInt(raw).toLocaleString("id-ID") : "" })); }}
                      placeholder="0" required inputMode="numeric"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider">Tanggal</label>
                    <input type="date" value={expForm.date} onChange={(e) => setExpForm((p) => ({ ...p, date: e.target.value }))} required
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">Kategori</label>
                  <div className="flex flex-wrap gap-2">
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <button key={cat} type="button" onClick={() => setExpForm((p) => ({ ...p, category: cat }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                          expForm.category === cat ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                        }`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                {batches.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider">Batch (opsional)</label>
                    <select value={expForm.batch_id} onChange={(e) => setExpForm((p) => ({ ...p, batch_id: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition">
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
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Riwayat Pengeluaran</p>
              {expenses.length === 0 && !loading && (
                <p className="text-center text-gray-400 py-8 text-sm">Belum ada pengeluaran.</p>
              )}
              {expenses.map((exp) => (
                <div key={exp.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{exp.description}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{exp.category} · {formatDateShort(exp.date)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold text-gray-900">{formatRupiah(exp.amount)}</span>
                    <button onClick={() => handleDeleteExpense(exp.id)}
                      className="text-gray-300 hover:text-red-500 transition text-lg leading-none">×</button>
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
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Buka Batch Baru</p>
              <form onSubmit={handleAddBatch} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wider">Nama Batch</label>
                  <input value={batchForm.label} onChange={(e) => setBatchForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. Batch #1 — April 2026" required
                    className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition" />
                </div>
                {/* Dates: full-width on mobile to avoid cramping */}
                <div className="grid grid-cols-2 gap-2 overflow-hidden">
                  {([["open_date", "PO Buka"], ["close_date", "PO Tutup"]] as const).map(([field, label]) => (
                    <div key={field} className="min-w-0">
                      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
                      <input type="date" value={batchForm[field]} onChange={(e) => setBatchForm((p) => ({ ...p, [field]: e.target.value }))} required
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Tanggal Antar</label>
                  <input type="date" value={batchForm.delivery_date} onChange={(e) => setBatchForm((p) => ({ ...p, delivery_date: e.target.value }))} required
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
                </div>
                <div className="grid grid-cols-2 gap-2 overflow-hidden">
                  <div className="min-w-0">
                    <label className="block text-[11px] text-gray-500 mb-1">Maks. Porsi</label>
                    <input value={batchForm.max_orders} onChange={(e) => setBatchForm((p) => ({ ...p, max_orders: e.target.value.replace(/\D/g, "") }))}
                      placeholder="Tak terbatas" inputMode="numeric"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-[11px] text-gray-500 mb-1">Catatan</label>
                    <input value={batchForm.notes} onChange={(e) => setBatchForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="opsional"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
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
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">History Batch</p>
              {batches.length === 0 && !loading && (
                <p className="text-center text-gray-400 py-8 text-sm">Belum ada batch.</p>
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
                  <div key={batch.id} className={`bg-white rounded-xl border shadow-sm p-5 ${isActive ? "border-[#7b1d1d]/25" : "border-gray-100"}`}>

                    {/* ── Edit form (inline, shown when editing) ── */}
                    {editingBatch === batch.id ? (
                      <form onSubmit={handleSaveBatch} className="space-y-3 mb-4">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Edit Batch</p>
                          <button type="button" onClick={() => setEditingBatch(null)}
                            className="text-xs text-gray-400 hover:text-gray-700 transition">Batal</button>
                        </div>
                        <div>
                          <label className="block text-[11px] text-gray-500 mb-1">Nama Batch</label>
                          <input value={editForm.label} onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))} required
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 overflow-hidden">
                          {([["open_date", "PO Buka"], ["close_date", "PO Tutup"]] as const).map(([field, label]) => (
                            <div key={field} className="min-w-0">
                              <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
                              <input type="date" value={editForm[field]} onChange={(e) => setEditForm((p) => ({ ...p, [field]: e.target.value }))} required
                                className="w-full border border-gray-200 rounded-lg px-2 py-2 text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
                            </div>
                          ))}
                        </div>
                        <div>
                          <label className="block text-[11px] text-gray-500 mb-1">Tanggal Antar</label>
                          <input type="date" value={editForm.delivery_date} onChange={(e) => setEditForm((p) => ({ ...p, delivery_date: e.target.value }))} required
                            className="w-full border border-gray-200 rounded-lg px-2 py-2 text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 overflow-hidden">
                          <div className="min-w-0">
                            <label className="block text-[11px] text-gray-500 mb-1">Maks. Porsi</label>
                            <input value={editForm.max_orders} onChange={(e) => setEditForm((p) => ({ ...p, max_orders: e.target.value.replace(/\D/g, "") }))}
                              placeholder="Tak terbatas" inputMode="numeric"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
                          </div>
                          <div className="min-w-0">
                            <label className="block text-[11px] text-gray-500 mb-1">Catatan</label>
                            <input value={editForm.notes} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
                              placeholder="opsional"
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition" />
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
                              <p className="font-semibold text-gray-900">{batch.label}</p>
                              {isActive && <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-md">Aktif</span>}
                              {isFull && <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-md">Penuh</span>}
                              {batch.is_closed && !isUpcoming && <span className="text-[10px] font-semibold bg-red-100 text-red-600 px-2 py-0.5 rounded-md">Tutup Manual</span>}
                              {isUpcoming && <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md">Akan Datang</span>}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-400">
                              <span>PO: {formatBatchDate(batch.open_date)} – {formatBatchDate(batch.close_date)}</span>
                              <span>Antar: {formatBatchDate(batch.delivery_date)}</span>
                              {batch.max_orders != null && (
                                <span className={`font-semibold ${isFull ? "text-orange-600" : "text-gray-400"}`}>
                                  Terisi: {portionCount}/{batch.max_orders} porsi
                                </span>
                              )}
                            </div>
                            {batch.notes && <p className="text-xs text-gray-400 italic mt-1">{batch.notes}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isBatchDateActive(batch) && (
                              <button onClick={() => handleToggleBatchClosed(batch)}
                                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${
                                  batch.is_closed
                                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                                    : "bg-red-100 text-red-600 hover:bg-red-200"
                                }`}>
                                {batch.is_closed ? "Buka PO" : "Tutup PO"}
                              </button>
                            )}
                            <button onClick={() => startEditBatch(batch)}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                              Edit
                            </button>
                            <button
                              onClick={() => canDelete && setDeletingBatch(deletingBatch === batch.id ? null : batch.id)}
                              disabled={!canDelete}
                              title={!canDelete ? `Tidak bisa dihapus — ada ${batchTotalOrders} pesanan` : "Hapus batch"}
                              className={`text-lg leading-none transition ${canDelete ? "text-gray-300 hover:text-red-500 cursor-pointer" : "text-gray-200 cursor-not-allowed"}`}>×</button>
                          </div>
                        </div>

                        {deletingBatch === batch.id && canDelete && (
                          <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
                            <p className="text-xs text-red-600 flex-1">Hapus batch ini?</p>
                            <button onClick={() => handleDeleteBatch(batch.id)}
                              className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg">Hapus</button>
                            <button onClick={() => setDeletingBatch(null)} className="text-xs text-gray-400">Batal</button>
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
                        <div key={s.label} className="bg-gray-50 rounded-lg p-2.5 text-center">
                          <p className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">{s.label}</p>
                          <p className={`font-bold text-gray-900 mt-0.5 ${s.small ? "text-xs" : "text-lg"}`}>{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* P&L */}
                    <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                      <div className="text-xs text-gray-400">
                        Pengeluaran: <span className="font-semibold text-gray-700">{formatRupiah(batchExpTotal)}</span>
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
                        <div className="border-t border-gray-100 pt-3 mt-1">
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
                                className="text-xs text-gray-400 hover:text-gray-700 transition">Batal</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeliverAllBatchId(batch.id)}
                              className="w-full text-xs font-semibold text-green-700 bg-green-50 border border-green-200 hover:bg-green-100 rounded-xl py-2 transition">
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

        {/* ── TAB: DASHBOARD ──────────────────────────────────────────────── */}
        {tab === "dashboard" && (
          <div className="space-y-4">

            {/* Overview stats — 2×2 */}
            <div className="grid grid-cols-2 gap-3">
              {([
                { label: "Pemasukan",     value: formatRupiah(totalRevenue),  borderColor: "border-l-emerald-500", numColor: "text-emerald-700", small: true },
                { label: "Keuntungan",    value: formatRupiah(totalProfit),   borderColor: totalProfit >= 0 ? "border-l-green-500" : "border-l-red-400", numColor: totalProfit >= 0 ? "text-green-700" : "text-red-600", small: true },
                { label: "Total Pesanan", value: anActive.length,             borderColor: "border-l-blue-400",   numColor: "text-blue-700",    small: false },
                { label: "Total Porsi",   value: totalPortions(anActive),     borderColor: "border-l-amber-400",  numColor: "text-amber-600",   small: false },
              ] as const).map((s) => (
                <div key={s.label} className={`bg-white rounded-xl border border-gray-100 border-l-4 ${s.borderColor} shadow-sm px-4 py-3.5`}>
                  <p className={`font-bold leading-none ${s.numColor} ${"small" in s ? "text-lg" : "text-3xl"}`}>{s.value}</p>
                  <p className="text-xs text-gray-400 font-medium mt-1.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Status breakdown */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Status Pesanan</p>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { label: "Menunggu",   value: orders.filter(o => o.status === "pending" || o.status === "active").length, color: "text-amber-600", bg: "bg-amber-50" },
                  { label: "Konfirmasi", value: orders.filter(o => o.status === "confirmed").length,                        color: "text-blue-600",  bg: "bg-blue-50" },
                  { label: "Selesai",    value: anDelivered.length,                                                          color: "text-green-700", bg: "bg-green-50" },
                  { label: "Batal",      value: anCancelled.length,                                                          color: "text-red-500",   bg: "bg-red-50" },
                ] as const).map(s => (
                  <div key={s.label} className={`${s.bg} rounded-lg p-2.5 text-center`}>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Simple progress bar — delivered / total non-cancelled */}
              {anActive.length > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>{anDelivered.length} selesai dari {anActive.length} pesanan valid</span>
                    <span className="font-semibold text-green-600">{completionRate}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-green-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${completionRate}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Jam Antar split */}
            {(siangOrders.length > 0 || malamOrders.length > 0) && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Distribusi Jam Antar</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-amber-50 rounded-lg p-3 text-center">
                    <Sun size={16} className="text-amber-400 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-amber-600">{siangOrders.length}</p>
                    <p className="text-[10px] text-amber-500 font-medium mt-0.5">Siang</p>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-3 text-center">
                    <Moon size={16} className="text-indigo-400 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-indigo-600">{malamOrders.length}</p>
                    <p className="text-[10px] text-indigo-500 font-medium mt-0.5">Malam</p>
                  </div>
                </div>
                {siangOrders.length + malamOrders.length > 0 && (
                  <div className="flex mt-2 rounded-full overflow-hidden h-1.5">
                    <div className="bg-amber-400 transition-all" style={{ width: `${Math.round(siangOrders.length / (siangOrders.length + malamOrders.length) * 100)}%` }} />
                    <div className="bg-indigo-400 flex-1" />
                  </div>
                )}
              </div>
            )}

            {/* Top menus */}
            {topMenus.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Menu Terlaris</p>
                </div>
                <div className="divide-y divide-gray-50 px-4">
                  {topMenus.map((m, idx) => (
                    <div key={m.name} className="py-3">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            idx === 0 ? "bg-amber-400 text-white" : idx === 1 ? "bg-gray-400 text-white" : idx === 2 ? "bg-orange-400 text-white" : "bg-gray-100 text-gray-500"
                          }`}>{idx + 1}</span>
                          <p className="text-sm text-gray-800 truncate">{m.name}</p>
                        </div>
                        <span className="text-sm font-bold text-[#7b1d1d] shrink-0">{m.qty}×</span>
                      </div>
                      <div className="ml-7 w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-[#7b1d1d] h-1.5 rounded-full transition-all"
                          style={{ width: `${Math.round((m.qty / topMenusMaxQty) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Batch performance */}
            {batchPerf.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Performa per Batch</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {batchPerf.map(b => (
                    <div key={b.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{b.label}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ${
                          b.deliveryRate >= 80 ? "bg-green-100 text-green-700" : b.deliveryRate >= 40 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
                        }`}>{b.deliveryRate}% selesai</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className="bg-[#7b1d1d] h-1.5 rounded-full"
                              style={{ width: `${Math.round((b.revenue / batchPerfMaxRevenue) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs font-bold text-gray-900 shrink-0">{formatRupiah(b.revenue)}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">{b.orderCount} pesanan · {b.portions} porsi</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment method breakdown */}
            {paymentBreakdown.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Metode Pembayaran</p>
                <div className="space-y-2.5">
                  {paymentBreakdown.map(p => (
                    <div key={p.method}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                            p.method === "cash" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                          }`}>{p.label}</span>
                          <span className="text-xs text-gray-400">{p.count} pesanan</span>
                        </div>
                        <span className="text-xs font-bold text-gray-900">{formatRupiah(p.revenue)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${p.method === "cash" ? "bg-amber-400" : "bg-green-500"}`}
                          style={{ width: `${anConfirmedOrDelivered.length > 0 ? Math.round((p.count / anConfirmedOrDelivered.length) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {orders.length === 0 && !loading && (
              <p className="text-center text-gray-400 py-12 text-sm">Belum ada data untuk ditampilkan.</p>
            )}
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
          <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
            {/* Top bar */}
            <div className="shrink-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
              <button onClick={closeModal}
                className="flex items-center gap-1.5 text-sm font-semibold text-[#7b1d1d] hover:text-[#5a1515] transition">
                ← Kembali
              </button>
              <span className="text-gray-200">|</span>
              <p className="font-semibold text-gray-900 truncate">{o.name}</p>
              <span className={`ml-auto shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded ${
                o.jam_antar.includes("Siang") ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
              }`}>{o.jam_antar.includes("Siang") ? "Siang" : "Malam"}</span>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-4 pt-5 pb-4 space-y-3">

                {/* Status banner */}
                {isCancelled && (
                  <div className="flex items-center justify-between bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-0.5">Pesanan Dibatalkan</p>
                      {o.cancel_reason && <p className="text-sm text-red-400">{o.cancel_reason}</p>}
                    </div>
                    <button onClick={() => handleRestore(o.id)}
                      className="shrink-0 text-sm font-bold text-white bg-green-500 hover:bg-green-600 px-4 py-2 rounded-lg transition ml-3">
                      Pulihkan
                    </button>
                  </div>
                )}
                {isDelivered && (
                  <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                    <p className="text-sm font-semibold text-green-700">✓ Pesanan sudah diantar</p>
                    <button onClick={() => handleRestore(o.id)}
                      className="shrink-0 text-sm text-gray-400 hover:text-gray-700 transition ml-3">Pulihkan</button>
                  </div>
                )}
                {isConfirmedOrder && (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                    <p className="text-sm font-semibold text-blue-700">✓ Pesanan dikonfirmasi</p>
                    <p className="text-xs text-blue-400 mt-0.5">
                      {o.payment_method === "cash" ? "Bayar tunai saat pengiriman" : "Transfer sudah dikonfirmasi"}
                    </p>
                  </div>
                )}

                {/* Cash due banner */}
                {(() => {
                  const cashDue = getCashDue(o);
                  const pending = hasPendingCash(o);
                  if (cashDue <= 0) return null;
                  return (
                    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                      pending ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
                    }`}>
                      <Banknote size={18} className={pending ? "text-amber-500 shrink-0" : "text-green-500 shrink-0"} />
                      <div>
                        <p className={`text-sm font-semibold ${pending ? "text-amber-700" : "text-green-700"}`}>
                          {pending ? `Kekurangan tunai: ${formatRupiah(cashDue)}` : `Tunai ${formatRupiah(cashDue)} ✓ sudah diterima`}
                        </p>
                        <p className={`text-xs mt-0.5 ${pending ? "text-amber-600" : "text-green-600"}`}>
                          {pending ? "Belum dikonfirmasi — konfirmasi dulu sebelum selesaikan" : "Dari penambahan item"}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* Customer info */}
                <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
                  <div className="px-4 py-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-0.5">Pelanggan</p>
                    <p className="font-semibold text-gray-900">{o.name}</p>
                    <a href={`https://wa.me/${o.nomor_wa.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-[#7b1d1d] hover:underline">{o.nomor_wa}</a>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-0.5">Alamat</p>
                    <p className="text-sm text-gray-800">{o.alamat}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-0.5">Waktu Antar</p>
                    <p className="text-sm text-gray-800">{o.jam_antar} · {formatDate(o.created_at)}</p>
                  </div>
                </div>

                {/* Items */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold px-4 pt-3 pb-2">Detail Pesanan</p>
                  <div className="divide-y divide-gray-50">
                    {o.items?.map((item, i) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex justify-between items-baseline gap-2 mb-1">
                          <p className="text-sm font-semibold text-gray-900">{item.qty}× {item.menu_name}</p>
                          <span className="text-sm font-semibold text-gray-600 shrink-0">{formatRupiah(item.subtotal)}</span>
                        </div>
                        {item.portions?.map((p, pi) => (
                          <p key={pi} className="text-xs text-gray-400 mt-0.5">
                            {item.qty > 1 && <span className="font-semibold text-gray-500">P{pi+1} </span>}
                            {Object.values(p.options).filter(Boolean).join(" · ")}
                            {p.notes?.trim() && <span className="text-gray-400 italic"> · {p.notes}</span>}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                  {o.notes?.trim() && (
                    <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
                      <p className="text-xs text-amber-700 italic flex items-center gap-1.5"><FileText size={12} /> {o.notes}</p>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 py-3 bg-gray-50 border-t border-gray-100">
                    <p className="text-sm font-semibold text-gray-600">Total</p>
                    <p className="text-xl font-bold text-[#7b1d1d]">{formatRupiah(o.total)}</p>
                  </div>
                  {/* Payment */}
                  <div className="px-4 py-3 border-t border-gray-100">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-2">Pembayaran</p>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${o.payment_method === "cash" ? "text-amber-700" : "text-green-700"}`}>
                      {o.payment_method === "cash"
                        ? <><Banknote size={15} /> Tunai</>
                        : o.payment_method === "transfer_mandiri"
                        ? <><Landmark size={15} /> Transfer Mandiri</>
                        : o.payment_method === "transfer_bca"
                        ? <><Landmark size={15} /> Transfer BCA</>
                        : o.payment_method}
                    </span>
                    {o.payment_proof_url && (
                      <button type="button" onClick={() => setProofLightbox(o.payment_proof_url!)} className="block w-full mt-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={o.payment_proof_url} alt="Bukti transfer"
                          className="w-full max-h-56 object-cover rounded-xl border border-gray-100 cursor-zoom-in" />
                        <p className="text-[10px] text-gray-400 mt-1 text-center">Tap untuk perbesar</p>
                      </button>
                    )}
                    {o.payment_method !== "cash" && !o.payment_proof_url && (
                      <p className="text-xs text-amber-600 mt-1">⚠ Bukti transfer belum diupload</p>
                    )}
                  </div>
                </div>

                {/* ── Order log ── */}
                {o.logs?.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold px-4 pt-3 pb-2">Riwayat</p>
                    <div className="divide-y divide-gray-50">
                      {[...o.logs].reverse().map((log, i) => (
                        <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                            log.action === "confirmed"      ? "bg-blue-400" :
                            log.action === "delivered"      ? "bg-green-500" :
                            log.action === "cancelled"      ? "bg-red-400" :
                            log.action === "edited"         ? "bg-amber-400" :
                            log.action === "cash_confirmed" ? "bg-emerald-400" :
                            "bg-gray-300"
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800">{log.detail}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(log.at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Edit order items ── */}
                {editingOrderItems ? (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Edit Pesanan</p>
                      <button onClick={() => { setEditingOrderItems(false); setEditOrderQty({}); }}
                        className="text-xs text-gray-400 hover:text-gray-700 transition">Batal</button>
                    </div>

                    {/* Paket */}
                    <div className="px-4 pt-3 pb-1">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Menu Paket</p>
                      <div className="space-y-2">
                        {MENUS.map(m => {
                          const qty = editOrderQty[m.id] ?? 0;
                          return (
                            <div key={m.id} className="flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate">{m.name}</p>
                                <p className="text-[10px] text-gray-400">{formatRupiah(m.price)}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button onClick={() => setEditOrderQty(p => ({ ...p, [m.id]: Math.max(0, (p[m.id] ?? 0) - 1) }))}
                                  className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 font-bold flex items-center justify-center hover:bg-gray-200 transition disabled:opacity-30"
                                  disabled={qty === 0}>
                                  <Minus size={12} />
                                </button>
                                <span className={`w-5 text-center text-sm font-bold ${qty > 0 ? "text-[#7b1d1d]" : "text-gray-300"}`}>{qty}</span>
                                <button onClick={() => setEditOrderQty(p => ({ ...p, [m.id]: (p[m.id] ?? 0) + 1 }))}
                                  className="w-7 h-7 rounded-full bg-[#7b1d1d] text-white font-bold flex items-center justify-center hover:bg-[#6a1717] transition">
                                  <Plus size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* À La Carte */}
                    <div className="px-4 pt-3 pb-3 border-t border-gray-100">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">À La Carte</p>
                      <div className="space-y-2">
                        {ALA_CARTE.map(m => {
                          const qty = editOrderQty[m.id] ?? 0;
                          return (
                            <div key={m.id} className="flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate">{m.name}</p>
                                <p className="text-[10px] text-gray-400">{formatRupiah(m.price)}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button onClick={() => setEditOrderQty(p => ({ ...p, [m.id]: Math.max(0, (p[m.id] ?? 0) - 1) }))}
                                  className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 font-bold flex items-center justify-center hover:bg-gray-200 transition disabled:opacity-30"
                                  disabled={qty === 0}>
                                  <Minus size={12} />
                                </button>
                                <span className={`w-5 text-center text-sm font-bold ${qty > 0 ? "text-[#7b1d1d]" : "text-gray-300"}`}>{qty}</span>
                                <button onClick={() => setEditOrderQty(p => ({ ...p, [m.id]: (p[m.id] ?? 0) + 1 }))}
                                  className="w-7 h-7 rounded-full bg-[#7b1d1d] text-white font-bold flex items-center justify-center hover:bg-[#6a1717] transition">
                                  <Plus size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* New total preview + payment warning */}
                    {(() => {
                      const allMenus = [...MENUS, ...ALA_CARTE];
                      const subtotal = allMenus.reduce((s, m) => s + m.price * (editOrderQty[m.id] ?? 0), 0);
                      const newTotal = subtotal > 0 ? subtotal + ONGKIR : 0;
                      const hasItems = subtotal > 0;
                      const diff = newTotal - o.total;
                      const totalChanged = diff !== 0;
                      const isTransfer = o.payment_method !== "cash";
                      return (
                        <div className="border-t border-gray-100">
                          {/* Payment note */}
                          {diff !== 0 && (
                            <div className={`px-4 py-2.5 flex items-start gap-2.5 ${diff > 0 ? "bg-amber-50" : "bg-blue-50"}`}>
                              <div className="text-xs leading-relaxed">
                                {diff > 0 ? (
                                  <p className="font-semibold text-amber-700">
                                    +{formatRupiah(diff)} — bayar tunai saat antar
                                  </p>
                                ) : (
                                  <>
                                    <p className="font-semibold text-blue-700">
                                      Total turun {formatRupiah(Math.abs(diff))}
                                    </p>
                                    {isTransfer && o.status === "confirmed" && (
                                      <p className="text-blue-600 mt-0.5">Status akan kembali ke "Menunggu"</p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="px-4 py-3 bg-gray-50 flex items-center justify-between gap-3">
                            <div className="text-xs text-gray-500">
                              {hasItems ? (
                                <div>
                                  <span className="font-bold text-gray-900">{formatRupiah(newTotal)}</span>
                                  {totalChanged && (
                                    <span className={`ml-1.5 font-semibold ${diff > 0 ? "text-amber-600" : "text-blue-600"}`}>
                                      ({diff > 0 ? "+" : ""}{formatRupiah(diff)})
                                    </span>
                                  )}
                                </div>
                              ) : <span className="text-amber-600">Belum ada item dipilih</span>}
                            </div>
                            <button
                              onClick={() => handleSaveOrderItems(o)}
                              disabled={editOrderLoading || !hasItems}
                              className="px-4 py-2 bg-[#7b1d1d] text-white text-xs font-bold rounded-lg hover:bg-[#6a1717] transition disabled:opacity-40">
                              {editOrderLoading ? "Menyimpan..." : "Simpan"}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}

                {/* Cancel reason input (shown inline when cancelling) */}
                {o.status === "active" && cancelling === o.id && (
                  <input autoFocus value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCancel(o.id); if (e.key === "Escape") { setCancelling(null); setCancelReason(""); } }}
                    placeholder="Tulis alasan pembatalan..."
                    className="w-full border border-red-200 rounded-xl px-4 py-3.5 text-sm focus:outline-none focus:border-red-400 bg-white"
                  />
                )}

              </div>
            </div>

            {/* Sticky bottom action bar */}
            {!isCancelled && (
              <div className="shrink-0 bg-white border-t border-gray-100 px-4 py-4 safe-area-pb">
                <div className="max-w-2xl mx-auto space-y-2">
                  {/* Edit Pesanan */}
                  {!editingOrderItems ? (
                    <button onClick={() => startEditOrder(o)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-semibold transition">
                      ✎ Edit Pesanan
                    </button>
                  ) : (
                    <div className="text-center text-xs text-gray-400 py-1">Scroll ke atas untuk edit item</div>
                  )}

                  {/* Kirim WA — always visible */}
                  <a href={buildOrderWAUrl(o)} target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-[#25D366] hover:bg-[#20ba5a] active:scale-[0.99] transition font-bold text-white text-sm">
                    <MessageCircle size={18} /> Kirim WA ke Pelanggan
                  </a>

                  {/* PENDING → Konfirmasi or Cancel */}
                  {isModalPending && (cancelling === o.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleCancel(o.id)} disabled={cancelLoading || !cancelReason.trim()}
                        className="flex-1 text-sm font-bold text-white bg-red-500 hover:bg-red-600 py-3.5 rounded-xl transition disabled:opacity-40">
                        {cancelLoading ? "Menyimpan..." : "Konfirmasi Batalkan"}
                      </button>
                      <button onClick={() => { setCancelling(null); setCancelReason(""); }}
                        className="px-5 py-3.5 text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl">Batal</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => handleConfirm(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] transition font-bold text-white text-base">
                        <span className="text-xl leading-none">✓</span> Konfirmasi Pesanan
                      </button>
                      <button onClick={() => setCancelling(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl bg-white border border-red-200 hover:border-red-300 hover:bg-red-50 active:scale-[0.99] transition font-semibold text-red-500 text-sm">
                        ✕ Batalkan
                      </button>
                    </>
                  ))}

                  {/* CONFIRMED → Selesaikan or Cancel */}
                  {isConfirmedOrder && (cancelling === o.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleCancel(o.id)} disabled={cancelLoading || !cancelReason.trim()}
                        className="flex-1 text-sm font-bold text-white bg-red-500 hover:bg-red-600 py-3.5 rounded-xl transition disabled:opacity-40">
                        {cancelLoading ? "Menyimpan..." : "Konfirmasi Batalkan"}
                      </button>
                      <button onClick={() => { setCancelling(null); setCancelReason(""); }}
                        className="px-5 py-3.5 text-sm font-semibold text-gray-500 bg-gray-100 rounded-xl">Batal</button>
                    </div>
                  ) : (
                    <>
                      {/* Gate: must confirm cash before delivering */}
                      {hasPendingCash(o) ? (
                        <button onClick={() => handleConfirmCash(o)}
                          className="w-full flex items-center justify-center gap-2.5 py-4 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.99] transition font-bold text-white text-base">
                          <Banknote size={20} /> Konfirmasi Kekurangan Bayar ({formatRupiah(getCashDue(o))})
                        </button>
                      ) : (
                        <button onClick={() => handleDeliver(o.id)}
                          className="w-full flex items-center justify-center gap-2.5 py-4 rounded-xl bg-green-500 hover:bg-green-600 active:scale-[0.99] transition font-bold text-white text-base">
                          <CheckCheck size={20} /> Selesaikan Pesanan
                        </button>
                      )}
                      <button onClick={() => setCancelling(o.id)}
                        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl bg-white border border-red-200 hover:border-red-300 hover:bg-red-50 active:scale-[0.99] transition font-semibold text-red-500 text-sm">
                        ✕ Batalkan
                      </button>
                    </>
                  ))}

                  {/* DELIVERED → no primary action, just info */}
                  {isDelivered && (
                    <p className="text-center text-xs text-gray-400">Pesanan sudah selesai diantar</p>
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
              <p className="font-semibold text-gray-900">Filter Pesanan</p>
              <button onClick={() => setFilterModalOpen(false)} className="text-gray-400 text-xl leading-none">×</button>
            </div>

            {/* Batch */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Batch</label>
              <select
                value={tmpBatch}
                onChange={e => setTmpBatch(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition"
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
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={tmpStatus}
                onChange={e => setTmpStatus(e.target.value as typeof tmpStatus)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition"
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
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Jam Antar</label>
              <select
                value={tmpJam}
                onChange={e => setTmpJam(e.target.value as typeof tmpJam)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition"
              >
                <option value="all">Semua Waktu</option>
                <option value="siang">Siang (11.00–13.00)</option>
                <option value="malam">Malam (17.00–19.00)</option>
              </select>
            </div>

            {/* Menu */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Menu</label>
              <select
                value={tmpMenu}
                onChange={e => setTmpMenu(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-gray-50 focus:outline-none focus:border-[#7b1d1d] transition"
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
                className="px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 hover:border-gray-300 transition"
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
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 safe-area-pb">
        <div className="max-w-2xl mx-auto flex items-stretch px-1 h-16">
          {NAV.map(({ key, label, Icon }) => {
            const isActive = tab === key;
            return (
              <button key={key} onClick={() => { setTab(key as typeof tab); closeModal(); }}
                className="relative flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors">
                {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-gray-900 rounded-full" />}
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.2 : 1.5}
                  className={`transition-colors ${isActive ? "text-gray-900" : "text-gray-300"}`}
                />
                <span className={`text-[10px] font-semibold tracking-wide transition-colors ${isActive ? "text-gray-900" : "text-gray-400"}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
