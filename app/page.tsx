"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { AlertCircle, Loader2, MessageCircle, Send, Lock, Target, CheckCircle2, Sun, Moon, Banknote, Landmark, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import ThemeToggle from "./theme-toggle";
import {
  MENUS, ALA_CARTE, BANK_INFO, ONGKIR, WA_NUMBER,
  formatRupiah, formatBatchDate,
  emptyPortion, calculateTotal, buildOrderItems,
  isFormComplete as checkFormComplete,
  type MenuOrder, type FormData, type PaymentMethod,
} from "@/lib/order-utils";

/** Normalise phone to +62… on blur */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return "+" + digits;
  if (digits.startsWith("0"))  return "+62" + digits.slice(1);
  if (digits.length >= 8)      return "+62" + digits;
  return raw;
}

async function compressImage(file: File, maxMB = 2): Promise<File> {
  const maxBytes = maxMB * 1024 * 1024;
  if (file.size <= maxBytes || typeof window === "undefined") return file;

  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const maxDim = 2048;
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);

      let quality = 0.85;
      const tryEncode = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size <= maxBytes || quality <= 0.1) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
            } else {
              quality = Math.max(0.1, quality - 0.1);
              tryEncode();
            }
          },
          "image/jpeg",
          quality
        );
      };
      tryEncode();
    };
    img.src = URL.createObjectURL(file);
  });
}

type Batch = {
  id: string;
  label: string;
  open_date: string;
  close_date: string;
  delivery_date: string;
  notes: string;
  is_closed: boolean;
  max_orders: number | null;
};

type SuccessData = {
  name: string;
  jam_antar: string;
  total: number;
  items: { name: string; qty: number; price: number }[];
  paymentMethod: PaymentMethod;
};

export default function OrderPage() {
  const [form, setForm] = useState<FormData>({
    name: "",
    nomor_wa: "",
    alamat: "",
    jam_antar: "",
    notes: "",
  });

  const [orders, setOrders] = useState<Record<string, MenuOrder>>(() =>
    Object.fromEntries(MENUS.map((m) => [m.id, { qty: 0, portions: [], sameForAll: true }]))
  );

  const [alcOrders, setAlcOrders] = useState<Record<string, MenuOrder>>(() =>
    Object.fromEntries(ALA_CARTE.map((m) => [m.id, { qty: 0, portions: [], sameForAll: true }]))
  );

  const [activeBatch, setActiveBatch] = useState<Batch | null | undefined>(undefined);
  const [nextBatch, setNextBatch] = useState<Batch | null>(null);
  const [batchOrderCount, setBatchOrderCount] = useState(0);
  const [batchClosedFull, setBatchClosedFull] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qtyEditing, setQtyEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [orderSuccess, setOrderSuccess] = useState<SuccessData | null>(null);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofLightbox, setProofLightbox] = useState(false);

  useEffect(() => {
    async function fetchBatch() {
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
      const { data: active } = await supabase
        .from("batches").select("*")
        .lte("open_date", today).gte("close_date", today)
        .order("open_date", { ascending: false }).limit(1).maybeSingle();

      if (active) {
        // Count total portions (sum of item qty) instead of order count
        const { data: batchOrders } = await supabase
          .from("orders").select("items")
          .eq("batch_id", active.id).neq("status", "cancelled");
        const portionCount = (batchOrders ?? []).reduce((sum: number, o: { items: { qty: number }[] | null }) =>
          sum + (o.items ?? []).reduce((s, it) => s + it.qty, 0), 0);
        setBatchOrderCount(portionCount);
        const isFull = active.max_orders != null && portionCount >= active.max_orders;
        if (active.is_closed || isFull) {
          setActiveBatch(null);
          setBatchClosedFull(isFull && !active.is_closed);
          const { data: next } = await supabase
            .from("batches").select("*")
            .gt("open_date", today)
            .order("open_date", { ascending: true }).limit(1).maybeSingle();
          setNextBatch(next ?? null);
        } else {
          setActiveBatch(active);
        }
      } else {
        setActiveBatch(null);
        const { data: next } = await supabase
          .from("batches").select("*")
          .gt("open_date", today)
          .order("open_date", { ascending: true }).limit(1).maybeSingle();
        setNextBatch(next ?? null);
      }
    }
    fetchBatch();
  }, []);

  const touch = (key: string) => setTouched((prev) => ({ ...prev, [key]: true }));

  const fieldError = (key: keyof FormData) => {
    if (!(submitted || touched[key])) return "";
    if (!form[key].trim()) return "Wajib diisi";
    if (key === "nomor_wa") {
      const digits = form.nomor_wa.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15) return "Nomor HP tidak valid";
    }
    return "";
  };

  const handleWaInput = (raw: string) => {
    // Allow digits, +, -, spaces while typing
    const cleaned = raw.replace(/[^\d+\-\s]/g, "");
    setForm((prev) => ({ ...prev, nomor_wa: cleaned }));
  };

  const handleWaBlur = () => {
    touch("nomor_wa");
    const normalized = normalizePhone(form.nomor_wa);
    if (normalized !== form.nomor_wa) {
      setForm((prev) => ({ ...prev, nomor_wa: normalized }));
    }
  };

  const scrollToFirstError = () => {
    const formFields: (keyof FormData)[] = ["name", "nomor_wa", "alamat", "jam_antar"];
    for (const field of formFields) {
      if (!form[field].trim()) {
        document.querySelector(`[data-field="${field}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    if (activeOrders.length === 0 && activeAlcOrders.length === 0) {
      document.querySelector("[data-section='menu']")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // ── Paket qty helpers ──────────────────────────────────────────────────────
  const setQty = (menuId: string, delta: number) => {
    setOrders((prev) => {
      const current = prev[menuId];
      const next = Math.max(0, current.qty + delta);
      const portions =
        delta > 0
          ? [...current.portions, emptyPortion(menuId)]
          : current.portions.slice(0, next);
      return { ...prev, [menuId]: { ...prev[menuId], qty: next, portions } };
    });
  };

  const setQtyDirect = (menuId: string, value: number) => {
    const next = Math.max(0, Math.min(99, value));
    setOrders((prev) => {
      const current = prev[menuId];
      let portions = [...current.portions];
      if (next > current.qty) {
        for (let i = current.qty; i < next; i++) portions.push(emptyPortion(menuId));
      } else {
        portions = portions.slice(0, next);
      }
      return { ...prev, [menuId]: { ...prev[menuId], qty: next, portions } };
    });
  };

  // ── À la carte qty helpers ─────────────────────────────────────────────────
  const setAlcQty = (menuId: string, delta: number) => {
    setAlcOrders((prev) => {
      const current = prev[menuId];
      const next = Math.max(0, current.qty + delta);
      const portions = delta > 0
        ? [...current.portions, emptyPortion(menuId)]
        : current.portions.slice(0, next);
      return { ...prev, [menuId]: { ...current, qty: next, portions } };
    });
  };

  const resetForm = () => {
    setForm({ name: "", nomor_wa: "", alamat: "", jam_antar: "", notes: "" });
    setOrders(Object.fromEntries(MENUS.map((m) => [m.id, { qty: 0, portions: [], sameForAll: true }])));
    setAlcOrders(Object.fromEntries(ALA_CARTE.map((m) => [m.id, { qty: 0, portions: [], sameForAll: true }])));
    setPaymentMethod("cash");
    setProofFile(null);
    setProofPreview(null);
    setProofLightbox(false);
    setError("");
    setSubmitted(false);
    setTouched({});
    setOrderSuccess(null);
  };

  const total = calculateTotal(orders, alcOrders);

  const activeOrders = MENUS.filter((m) => orders[m.id].qty > 0);
  const activeAlcOrders = ALA_CARTE.filter((m) => alcOrders[m.id].qty > 0);

  const isTransfer = paymentMethod !== "cash";
  const hasAnyOrder = activeOrders.length > 0 || activeAlcOrders.length > 0;
  const isFormComplete = checkFormComplete(form, orders, alcOrders, paymentMethod, proofFile);

  const handleSubmit = async () => {
    if (!isFormComplete) {
      setSubmitted(true);
      scrollToFirstError();
      return;
    }
    setError("");
    setLoading(true);

    // Duplicate detection
    if (activeBatch) {
      const { data: existingOrders } = await supabase
        .from("orders")
        .select("id, nomor_wa")
        .eq("batch_id", activeBatch.id)
        .in("status", ["active", "delivered"]);

      const normalizedInput = form.nomor_wa.replace(/\D/g, "");
      const isDuplicate = existingOrders?.some((o: { id: string; nomor_wa: string }) =>
        o.nomor_wa.replace(/\D/g, "").endsWith(normalizedInput.slice(-9)) ||
        normalizedInput.endsWith(o.nomor_wa.replace(/\D/g, "").slice(-9))
      );

      if (isDuplicate) {
        setError("Nomor WA ini sudah memiliki pesanan aktif di batch ini. Hubungi kami jika ingin mengubah pesanan.");
        setLoading(false);
        return;
      }
    }

    // Upload proof of payment
    let proofUrl: string | null = null;
    if (isTransfer && proofFile) {
      const ext = proofFile.name.split(".").pop() ?? "jpg";
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("payment-proofs")
        .upload(filename, proofFile, { contentType: proofFile.type });
      if (uploadError) {
        setError("Gagal upload bukti transfer. Coba lagi.");
        setLoading(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("payment-proofs").getPublicUrl(filename);
      proofUrl = urlData.publicUrl;
    }

    const items = buildOrderItems(orders, alcOrders);

    const res = await fetch("/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        nomor_wa: form.nomor_wa,
        alamat: form.alamat,
        jam_antar: form.jam_antar,
        items,
        notes: form.notes,
        total,
        batch_id: activeBatch?.id ?? null,
        payment_method: paymentMethod,
        payment_proof_url: proofUrl,
      }),
    });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Terlalu banyak percobaan. Tunggu sebentar.");
      setLoading(false);
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Gagal menyimpan pesanan. Coba lagi.");
      setLoading(false);
      return;
    }

    const successItems = [
      ...MENUS.filter(m => orders[m.id].qty > 0).map(m => ({ name: m.name, qty: orders[m.id].qty, price: m.price })),
      ...ALA_CARTE.filter(m => alcOrders[m.id].qty > 0).map(m => ({ name: m.name, qty: alcOrders[m.id].qty, price: m.price })),
    ];
    setOrderSuccess({ name: form.name, jam_antar: form.jam_antar, total, items: successItems, paymentMethod });
    setLoading(false);
  };

  // ── Hero ───────────────────────────────────────────────────────────────────
  const hero = (
    <header className="relative text-white text-center overflow-hidden">
      <div className="relative h-[380px] sm:h-[460px] w-full">
        <Image src="/hero.jpg" alt="Babiqu Signature Roast Pork" fill className="object-cover object-[center_65%]" priority />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-10 px-4">
        <p className="text-[10px] tracking-[0.4em] uppercase text-white/60 mb-2 font-medium">Signature Roast Pork</p>
        <h1 className="text-5xl font-black tracking-widest drop-shadow-lg">BABIQU</h1>
        <p className="text-sm text-white/70 tracking-wider mt-2">Pesan langsung · Antar ke rumah</p>
      </div>
    </header>
  );

  // ── Batch loading ──────────────────────────────────────────────────────────
  if (activeBatch === undefined) {
    return (
      <div className="min-h-screen bg-[#f2f2f7] dark:bg-[#0a0a0a]">
        <ThemeToggle floating />
        {hero}
        <div className="flex items-center justify-center py-24">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        </div>
        <footer className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">© 2026 Babiqu · Signature Roast Pork</footer>
      </div>
    );
  }

  // ── PO Closed ──────────────────────────────────────────────────────────────
  if (activeBatch === null) {
    return (
      <div className="min-h-screen bg-[#f2f2f7] dark:bg-[#0a0a0a]">
        <ThemeToggle floating />
        {hero}
        <main className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-8 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 bg-gray-100 dark:bg-white/10">
              {batchClosedFull ? <Target size={28} className="text-gray-500 dark:text-gray-400" /> : <Lock size={28} className="text-gray-500 dark:text-gray-400" />}
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {batchClosedFull ? "Kuota Penuh!" : nextBatch ? "PO Belum Dibuka" : "PO Sudah Ditutup"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
              {batchClosedFull
                ? "Pesanan untuk batch ini sudah mencapai batas kuota. Pantau terus untuk batch berikutnya!"
                : nextBatch
                ? "Pemesanan akan dibuka di batch berikutnya. Catat tanggalnya!"
                : "Pemesanan sudah ditutup. Pantau terus untuk batch berikutnya!"}
            </p>
            {nextBatch ? (
              <div className="bg-gray-50 dark:bg-[#2c2c2e] rounded-xl p-4 text-left">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Batch Berikutnya</p>
                <p className="font-bold text-gray-900 dark:text-white mb-3">{nextBatch.label}</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500 dark:text-gray-400">PO Buka</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatBatchDate(nextBatch.open_date)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500 dark:text-gray-400">PO Tutup</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatBatchDate(nextBatch.close_date)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Pengiriman</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatBatchDate(nextBatch.delivery_date)}</span>
                  </div>
                </div>
                {nextBatch.notes && <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-3">{nextBatch.notes}</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500">Info batch berikutnya akan segera diumumkan.</p>
            )}
          </div>
        </main>
        <footer className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">© 2026 Babiqu · Signature Roast Pork</footer>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (orderSuccess) {
    return (
      <div className="min-h-screen bg-[#f2f2f7] dark:bg-[#0a0a0a]">
        <ThemeToggle floating />
        {hero}
        <main className="max-w-lg mx-auto px-4 py-8 space-y-4">
          {/* Confirmation card */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-8 text-center">
            <div className="w-16 h-16 bg-green-50 dark:bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 size={32} className="text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Pesanan Diterima!</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              Tim kami akan segera menghubungi kamu via WhatsApp untuk konfirmasi pesanan.
            </p>
          </div>

          {/* Order summary card */}
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-5">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4">Detail Pesanan</p>

            <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100 dark:border-white/[0.08]">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{orderSuccess.name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{orderSuccess.jam_antar}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${
                orderSuccess.paymentMethod === "cash"
                  ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600"
              }`}>
                {orderSuccess.paymentMethod === "cash" ? "TUNAI" : orderSuccess.paymentMethod === "transfer_mandiri" ? "MANDIRI" : "BCA"}
              </span>
            </div>

            <div className="space-y-2.5">
              {orderSuccess.items.map((it) => (
                <div key={it.name} className="flex items-center justify-between gap-2">
                  <p className="text-sm text-gray-700 dark:text-gray-300">{it.qty}× {it.name}</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white shrink-0">{formatRupiah(it.price * it.qty)}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/[0.08] space-y-2">
              <div className="flex justify-between text-sm text-gray-400 dark:text-gray-500">
                <span>Ongkos Kirim</span>
                <span>{formatRupiah(ONGKIR)}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-white/[0.08]">
                <span className="text-base font-bold text-gray-900 dark:text-white">Total</span>
                <span className="text-xl font-bold text-[#7b1d1d]">{formatRupiah(orderSuccess.total)}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <button
            onClick={resetForm}
            className="w-full bg-gray-900 dark:bg-white dark:bg-[#1c1c1e] dark:text-gray-900 hover:bg-black text-white font-bold py-4 rounded-2xl text-sm tracking-wide transition"
          >
            Kembali &amp; Pesan Lagi
          </button>
        </main>
        <footer className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">© 2026 Babiqu · Signature Roast Pork</footer>
      </div>
    );
  }

  // ── PO Open ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f2f2f7] dark:bg-[#0a0a0a]">
      <ThemeToggle floating />
      {hero}

      <main className="max-w-lg mx-auto px-4 py-8 space-y-5">

        {/* PO Info Banner */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <p className="text-xs font-semibold text-green-600 dark:text-emerald-400 uppercase tracking-wider">PO Dibuka</p>
          </div>
          <p className="text-base font-bold text-gray-900 dark:text-white mb-3">{activeBatch.label}</p>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">PO Tutup</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatBatchDate(activeBatch.close_date)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">Pengiriman</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatBatchDate(activeBatch.delivery_date)}</span>
            </div>
            {activeBatch.max_orders != null && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500 dark:text-gray-400">Sisa Kuota</span>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{Math.max(0, activeBatch.max_orders - batchOrderCount)}/{activeBatch.max_orders} porsi</span>
              </div>
            )}
          </div>
          {activeBatch.notes && <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 italic">{activeBatch.notes}</p>}
        </div>

        {/* Customer Info */}
        <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-5 space-y-4">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Informasi Pemesan</h2>

          {(["name", "nomor_wa", "alamat"] as const).map((key) => {
            const meta = {
              name:      { label: "Nama Lengkap",       placeholder: "e.g. Budi Santoso",        type: "text" },
              nomor_wa:  { label: "Nomor WhatsApp",      placeholder: "e.g. 08123456789",         type: "tel"  },
              alamat:    { label: "Alamat Pengiriman",   placeholder: "Jl. Sudirman No. 12, ...", type: "text" },
            }[key];
            const err = fieldError(key);
            return (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {meta.label}
                </label>
                <input
                  data-field={key}
                  type={meta.type}
                  inputMode={key === "nomor_wa" ? "tel" : undefined}
                  value={form[key]}
                  onChange={(e) =>
                    key === "nomor_wa"
                      ? handleWaInput(e.target.value)
                      : setForm((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  onBlur={key === "nomor_wa" ? handleWaBlur : () => touch(key)}
                  placeholder={meta.placeholder}
                  className={`w-full bg-gray-50 dark:bg-[#2c2c2e] rounded-xl px-4 py-3.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition ${
                    err
                      ? "ring-2 ring-red-300"
                      : "focus:ring-gray-900/10"
                  }`}
                />
                {err && (
                  <p className="text-red-500 dark:text-red-400 text-xs mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" /> {err}
                  </p>
                )}
              </div>
            );
          })}

          {/* Jam Antar */}
          {(() => {
            const err = fieldError("jam_antar");
            const options = [
              { value: "11.00 - 13.00 (Siang)", label: "Siang", sub: "11.00 – 13.00", Icon: Sun },
              { value: "17.00 - 19.00 (Malam)", label: "Malam", sub: "17.00 – 19.00", Icon: Moon },
            ];
            return (
              <div data-field="jam_antar">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Jam Antar
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {options.map((opt) => (
                    <button key={opt.value} type="button"
                      onClick={() => { setForm((prev) => ({ ...prev, jam_antar: opt.value })); touch("jam_antar"); }}
                      className={`flex flex-col items-center gap-2 py-5 rounded-2xl border-2 font-medium transition active:scale-[0.98] ${
                        form.jam_antar === opt.value
                          ? "border-gray-900 dark:border-white bg-gray-900 dark:bg-white dark:bg-[#1c1c1e] dark:text-gray-900 text-white"
                          : err
                          ? "border-red-200 dark:border-red-500/30 bg-white dark:bg-[#1c1c1e] text-gray-400 dark:text-gray-500"
                          : "border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] text-gray-500 dark:text-gray-400 hover:border-gray-300"
                      }`}>
                      <opt.Icon size={20} />
                      <span className="text-sm font-semibold">{opt.label}</span>
                      <span className="text-xs opacity-60">{opt.sub}</span>
                    </button>
                  ))}
                </div>
                {err && (
                  <p className="text-red-500 dark:text-red-400 text-xs mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" /> {err}
                  </p>
                )}
              </div>
            );
          })()}

        </section>

        {/* Menu Paket */}
        <section className="space-y-3" data-section="menu">
          <div className="px-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Menu Paket</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Pilih menu dan jumlah porsi</p>
          </div>

          {MENUS.map((menu) => {
            const ord = orders[menu.id];
            const isActive = ord.qty > 0;

            return (
              <div
                key={menu.id}
                className={`bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] transition-all ${
                  isActive ? "ring-2 ring-gray-900" : ""
                }`}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-snug">{menu.name}</h3>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">{menu.includes.join(" · ")}</p>
                      <p className="text-base font-bold text-gray-900 dark:text-white mt-2">{formatRupiah(menu.price)}</p>
                    </div>

                    {/* Qty stepper */}
                    <div className="flex items-center gap-3 shrink-0 mt-1">
                      <button
                        onClick={() => setQty(menu.id, -1)}
                        disabled={ord.qty === 0}
                        className="w-9 h-9 rounded-full bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 font-bold text-xl flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/10 transition disabled:opacity-25"
                      >
                        −
                      </button>
                      {qtyEditing === menu.id ? (
                        <input
                          type="number"
                          min={0}
                          max={99}
                          autoFocus
                          defaultValue={ord.qty}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setQtyDirect(menu.id, val);
                            setQtyEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setQtyEditing(null);
                          }}
                          className="w-10 text-center font-bold text-gray-900 dark:text-white border border-gray-900 dark:border-white rounded-lg text-sm focus:outline-none py-0.5"
                        />
                      ) : (
                        <button
                          onClick={() => setQtyEditing(menu.id)}
                          title="Ketuk untuk ubah jumlah"
                          className="w-8 text-center font-bold text-gray-900 dark:text-white hover:text-gray-600 transition"
                        >
                          {ord.qty}
                        </button>
                      )}
                      <button
                        onClick={() => setQty(menu.id, 1)}
                        className="w-9 h-9 rounded-full bg-gray-900 dark:bg-white dark:bg-[#1c1c1e] dark:text-gray-900 text-white font-bold text-xl flex items-center justify-center hover:bg-black transition"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Subtotal row when active */}
                  {isActive && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/[0.08] flex justify-end">
                      <span className="text-xs font-semibold text-[#7b1d1d]">
                        Subtotal: {formatRupiah(menu.price * ord.qty)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* À La Carte */}
        <section className="space-y-3">
          <div className="px-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">À La Carte</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Bisa dipesan tanpa menu paket</p>
          </div>

          {ALA_CARTE.map((menu) => {
            const ord = alcOrders[menu.id];
            const isActive = ord.qty > 0;
            return (
              <div key={menu.id}
                className={`bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] transition-all ${
                  isActive ? "ring-2 ring-gray-900" : ""
                }`}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-snug">{menu.name}</h3>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">{menu.includes.join(" · ")}</p>
                      <p className="text-base font-bold text-gray-900 dark:text-white mt-2">{formatRupiah(menu.price)}</p>
                    </div>
                    {/* Qty stepper */}
                    <div className="flex items-center gap-3 shrink-0 mt-1">
                      <button
                        onClick={() => setAlcQty(menu.id, -1)}
                        disabled={ord.qty === 0}
                        className="w-9 h-9 rounded-full bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 font-bold text-xl flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/10 transition disabled:opacity-25"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-bold text-gray-900 dark:text-white">{ord.qty}</span>
                      <button
                        onClick={() => setAlcQty(menu.id, 1)}
                        className="w-9 h-9 rounded-full bg-gray-900 dark:bg-white dark:bg-[#1c1c1e] dark:text-gray-900 text-white font-bold text-xl flex items-center justify-center hover:bg-black transition"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {isActive && (
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/[0.08] flex justify-end">
                      <span className="text-xs font-semibold text-[#7b1d1d]">
                        Subtotal: {formatRupiah(menu.price * ord.qty)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Order Summary */}
        {hasAnyOrder && (
          <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-5">
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">Ringkasan</h2>
            <div className="space-y-3">
              {activeOrders.map((menu, idx) => {
                const ord = orders[menu.id];
                const isLast = idx === activeOrders.length - 1 && activeAlcOrders.length === 0;
                return (
                  <div key={menu.id}>
                    <div className="flex justify-between items-center gap-2">
                      <p className="text-sm text-gray-700 dark:text-gray-300">{menu.name}</p>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400 dark:text-gray-500">{ord.qty}× {formatRupiah(menu.price)}</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{formatRupiah(menu.price * ord.qty)}</p>
                      </div>
                    </div>
                    {!isLast && <div className="border-b border-gray-100 dark:border-white/[0.08] mt-3" />}
                  </div>
                );
              })}
              {activeAlcOrders.map((menu, idx) => {
                const ord = alcOrders[menu.id];
                const isLast = idx === activeAlcOrders.length - 1;
                return (
                  <div key={menu.id}>
                    <div className="flex justify-between items-center gap-2">
                      <p className="text-sm text-gray-700 dark:text-gray-300">{menu.name}</p>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400 dark:text-gray-500">{ord.qty}× {formatRupiah(menu.price)}</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{formatRupiah(menu.price * ord.qty)}</p>
                      </div>
                    </div>
                    {!isLast && <div className="border-b border-gray-100 dark:border-white/[0.08] mt-3" />}
                  </div>
                );
              })}

              {/* Ongkir + Total */}
              <div className="border-t border-gray-100 dark:border-white/[0.08] pt-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-400 dark:text-gray-500">Ongkos Kirim</span>
                  <span className="text-sm text-gray-400 dark:text-gray-500">{formatRupiah(ONGKIR)}</span>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-white/[0.08]">
                  <span className="text-base font-bold text-gray-900 dark:text-white">Total</span>
                  <span className="text-xl font-bold text-[#7b1d1d]">{formatRupiah(total)}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Catatan (global) */}
        <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-5">
          <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">
            Catatan <span className="text-sm font-normal text-gray-400 dark:text-gray-500">(Opsional)</span>
          </h2>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Ada permintaan khusus atau info tambahan?"
            rows={2}
            className="w-full bg-gray-50 dark:bg-[#2c2c2e] rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-900/10 transition resize-none"
          />
        </section>

        {/* Payment Method */}
        <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm dark:border dark:border-white/[0.08] p-5">
          <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">Metode Pembayaran</h2>

          <div className="flex gap-2 mb-5">
            {([
              ["cash",             Banknote,  "Tunai"],
              ["transfer_mandiri", Landmark,  "Mandiri"],
              ["transfer_bca",     Landmark,  "BCA"],
            ] as [PaymentMethod, React.ElementType, string][]).map(([val, Icon, label]) => (
              <button key={val} type="button" onClick={() => { setPaymentMethod(val); setProofFile(null); setProofPreview(null); }}
                className={`flex-1 flex flex-col items-center gap-1.5 py-3.5 rounded-xl text-xs font-semibold transition ${
                  paymentMethod === val
                    ? "bg-gray-900 dark:bg-white dark:bg-[#1c1c1e] dark:text-gray-900 text-white"
                    : "bg-gray-50 dark:bg-[#2c2c2e] text-gray-500 dark:text-gray-400 hover:bg-gray-100"
                }`}>
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>

          {/* Bank account info */}
          {isTransfer && (
            <div className="bg-gray-50 dark:bg-[#2c2c2e] rounded-xl p-4 mb-4">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Rekening {BANK_INFO[paymentMethod as keyof typeof BANK_INFO].bank}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white tracking-wider">
                {BANK_INFO[paymentMethod as keyof typeof BANK_INFO].account}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">a/n {BANK_INFO[paymentMethod as keyof typeof BANK_INFO].name}</p>
              <button type="button"
                onClick={() => navigator.clipboard.writeText(BANK_INFO[paymentMethod as keyof typeof BANK_INFO].account)}
                className="mt-3 text-xs font-semibold text-gray-900 dark:text-white bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-white/10 transition">
                Salin Nomor
              </button>
            </div>
          )}

          {/* Proof upload */}
          {isTransfer && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Bukti Transfer <span className="text-red-500 dark:text-red-400">*</span>
              </p>
              {proofPreview ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={proofPreview} alt="Bukti transfer"
                    onClick={() => setProofLightbox(true)}
                    className="w-full max-h-48 object-cover rounded-xl border border-gray-100 dark:border-white/[0.08] cursor-zoom-in" />
                  <button type="button" onClick={() => { setProofFile(null); setProofPreview(null); }}
                    className="absolute top-2 right-2 bg-white/90 text-gray-500 dark:text-gray-400 hover:text-red-500 rounded-full w-7 h-7 flex items-center justify-center shadow-sm transition"><X size={14} /></button>
                  <span className="absolute bottom-2 left-2 text-[10px] bg-black/40 text-white rounded px-1.5 py-0.5">Tap untuk perbesar</span>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl py-7 cursor-pointer hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-white/10 transition">
                  <Banknote size={22} className="text-gray-400 dark:text-gray-500" />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Upload Bukti Transfer</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">JPG, PNG, HEIC · Auto-compress ke maks 2MB</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const compressed = await compressImage(file);
                      setProofFile(compressed);
                      setProofPreview(URL.createObjectURL(compressed));
                    }} />
                </label>
              )}
              {submitted && isTransfer && !proofFile && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Upload bukti transfer dulu ya</p>
              )}
            </div>
          )}

          {paymentMethod === "cash" && (
            <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl px-4 py-3">
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"><Banknote size={16} /> Pembayaran tunai dilakukan saat pesanan diterima.</p>
            </div>
          )}
        </section>

        {/* Error + Submit CTA */}
        <section className="space-y-3">
          {error && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl p-4 space-y-2">
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
              {error.includes("Hubungi kami") && (
                <a
                  href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Halo Babiqu, saya ingin mengubah/menanyakan pesanan saya di batch ini. Nomor WA saya: " + form.nomor_wa)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-xl transition"
                >
                  <MessageCircle className="w-4 h-4" />
                  Hubungi Kami via WhatsApp
                </a>
              )}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!isFormComplete || loading}
            className={`w-full font-bold py-4 rounded-2xl text-sm tracking-wide transition flex items-center justify-center gap-2 ${
              isFormComplete
                ? "bg-gray-900 hover:bg-black text-white"
                : "bg-gray-200 dark:bg-white/10 text-gray-400 dark:text-gray-500 cursor-not-allowed"
            }`}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                Kirim Pesanan
              </>
            )}
          </button>
          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            Pesanan kamu akan langsung kami proses. Tim kami akan menghubungi via WA.
          </p>
        </section>

      </main>

      <footer className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">
        © 2026 Babiqu · Signature Roast Pork
      </footer>

      {/* Floating WA help button */}
      <a
        href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Halo Babiqu, saya butuh bantuan dengan pesanan saya.")}`}
        target="_blank" rel="noopener noreferrer"
        className="fixed bottom-6 right-4 z-50 bg-[#25D366] hover:bg-[#20ba5a] text-white rounded-full shadow-lg flex items-center gap-2 px-4 py-3 text-sm font-semibold transition active:scale-95"
      >
        <MessageCircle className="w-4 h-4 shrink-0" />
        Bantuan
      </a>

      {/* Proof image lightbox */}
      {proofLightbox && proofPreview && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setProofLightbox(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proofPreview} alt="Bukti transfer"
            className="max-w-full max-h-full object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setProofLightbox(false)}
            className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl font-bold transition">×</button>
        </div>
      )}
    </div>
  );
}
