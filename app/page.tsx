"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { AlertCircle, MessageCircle, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

const MENUS = [
  {
    id: "signature-andaliman",
    name: "Signature Andaliman Pork Set",
    price: 40000,
    includes: ["Babi Panggang Merah", "Sambal Andaliman", "Sup Sayur Asin"],
    options: [
      {
        key: "nasi",
        label: "Pilihan Nasi",
        choices: ["Nasi Kecombrang", "Nasi Putih"],
      },
    ],
  },
  {
    id: "classic-roast",
    name: "Classic Roast Pork Set",
    price: 40000,
    includes: ["Babi Panggang Merah", "Sambal Bawang Cuka", "Sup Sayur Asin"],
    options: [
      {
        key: "nasi",
        label: "Pilihan Nasi",
        choices: ["Nasi Kecombrang", "Nasi Putih"],
      },
    ],
  },
  {
    id: "sayur-asin-simple",
    name: "Sayur Asin Simple Set",
    price: 25000,
    includes: ["Sup Sayur Asin + Tulang Babi"],
    options: [
      {
        key: "nasi",
        label: "Pilihan Nasi",
        choices: ["Nasi Putih", "Nasi Kecombrang"],
      },
      {
        key: "sambal",
        label: "Pilihan Sambal",
        choices: ["Sambal Andaliman", "Sambal Bawang Cuka"],
      },
    ],
  },
];

type Portion = {
  options: Record<string, string>;
  notes: string;
};

type MenuOrder = {
  qty: number;
  portions: Portion[];
  sameForAll: boolean;
};

type FormData = {
  name: string;
  nomor_wa: string;
  alamat: string;
  jam_antar: string;
  notes: string;
};

const WA_NUMBER = "6285280221998";

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

function formatBatchDate(dateStr: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(dateStr + "T00:00:00")
  );
}

function formatRupiah(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export default function OrderPage() {
  const [form, setForm] = useState<FormData>({
    name: "",
    nomor_wa: "",
    alamat: "",
    jam_antar: "",
    notes: "",
  });

  const emptyPortion = (menuId: string): Portion => ({
    options: Object.fromEntries(MENUS.find((m) => m.id === menuId)!.options.map((o) => [o.key, ""])),
    notes: "",
  });

  const [orders, setOrders] = useState<Record<string, MenuOrder>>(() =>
    Object.fromEntries(MENUS.map((m) => [m.id, { qty: 0, portions: [], sameForAll: true }]))
  );

  const [activeBatch, setActiveBatch] = useState<Batch | null | undefined>(undefined);
  const [nextBatch, setNextBatch] = useState<Batch | null>(null);
  const [batchOrderCount, setBatchOrderCount] = useState(0);
  const [batchClosedFull, setBatchClosedFull] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qtyEditing, setQtyEditing] = useState<string | null>(null);
  const [expandedPortions, setExpandedPortions] = useState<Record<string, number | null>>({});
  const [addingNote, setAddingNote] = useState<{ menuId: string; text: string; selected: number[] } | null>(null);
  const [editingNote, setEditingNote] = useState<{ menuId: string; portionIndex: number; text: string } | null>(null);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function fetchBatch() {
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
      const { data: active } = await supabase
        .from("batches").select("*")
        .lte("open_date", today).gte("close_date", today)
        .order("open_date", { ascending: false }).limit(1).maybeSingle();

      if (active) {
        // Count non-cancelled orders in this batch to check quota
        const { count } = await supabase
          .from("orders").select("*", { count: "exact", head: true })
          .eq("batch_id", active.id).neq("status", "cancelled");
        const cnt = count ?? 0;
        setBatchOrderCount(cnt);
        // If manually closed or quota full → treat as no active batch
        const isFull = active.max_orders != null && cnt >= active.max_orders;
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
    // only allow digits, +, -, spaces — strip everything else
    const cleaned = raw.replace(/[^\d+\-\s]/g, "");
    setForm((prev) => ({ ...prev, nomor_wa: cleaned }));
  };

  const scrollToFirstError = () => {
    const formFields: (keyof FormData)[] = ["name", "nomor_wa", "alamat", "jam_antar"];
    for (const field of formFields) {
      if (!form[field].trim()) {
        document.querySelector(`[data-field="${field}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    if (activeOrders.length === 0) {
      document.querySelector("[data-section='menu']")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    for (const menu of activeOrders) {
      const menuDef = MENUS.find((m) => m.id === menu.id)!;
      for (let i = 0; i < orders[menu.id].portions.length; i++) {
        for (const opt of menuDef.options) {
          if (!orders[menu.id].portions[i].options[opt.key]) {
            document.querySelector(`[data-option="${menu.id}-${i}-${opt.key}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
        }
      }
    }
  };

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
        // add new empty portions
        for (let i = current.qty; i < next; i++) {
          portions.push(emptyPortion(menuId));
        }
      } else {
        portions = portions.slice(0, next);
      }
      return { ...prev, [menuId]: { ...prev[menuId], qty: next, portions } };
    });
  };

  const applyToAll = (menuId: string, sourceIndex: number) => {
    setOrders((prev) => {
      const source = prev[menuId].portions[sourceIndex];
      const portions = prev[menuId].portions.map(() => ({
        options: { ...source.options },
        notes: source.notes,
      }));
      return { ...prev, [menuId]: { ...prev[menuId], portions } };
    });
  };

  const toggleSameForAll = (menuId: string, value: boolean) => {
    setOrders((prev) => {
      const current = prev[menuId];
      if (value && current.portions.length > 0) {
        // switching to same-for-all: sync all portions to match portion[0]
        const source = current.portions[0];
        const portions = current.portions.map((p) => ({ options: { ...source.options }, notes: p.notes }));
        return { ...prev, [menuId]: { ...current, sameForAll: true, portions } };
      }
      return { ...prev, [menuId]: { ...current, sameForAll: value } };
    });
    setExpandedPortions((prev) => ({ ...prev, [menuId]: value ? null : 0 }));
  };

  const setOption = (menuId: string, portionIndex: number, key: string, value: string) => {
    setOrders((prev) => {
      const portions = prev[menuId].portions.map((p, i) =>
        i === portionIndex ? { ...p, options: { ...p.options, [key]: value } } : p
      );
      return { ...prev, [menuId]: { ...prev[menuId], portions } };
    });
  };

  const deletePortion = (menuId: string, portionIndex: number) => {
    setOrders((prev) => {
      const portions = prev[menuId].portions.filter((_, i) => i !== portionIndex);
      return { ...prev, [menuId]: { ...prev[menuId], qty: portions.length, portions } };
    });
  };

  const setPortionNotes = (menuId: string, portionIndex: number, value: string) => {
    setOrders((prev) => {
      const portions = prev[menuId].portions.map((p, i) =>
        i === portionIndex ? { ...p, notes: value } : p
      );
      return { ...prev, [menuId]: { ...prev[menuId], portions } };
    });
  };

  const total = MENUS.reduce((sum, menu) => {
    return sum + menu.price * orders[menu.id].qty;
  }, 0);

  const activeOrders = MENUS.filter((m) => orders[m.id].qty > 0);

  const waDigits = form.nomor_wa.replace(/\D/g, "");
  const isFormComplete =
    form.name.trim() !== "" &&
    waDigits.length >= 9 && waDigits.length <= 15 &&
    form.alamat.trim() !== "" &&
    form.jam_antar.trim() !== "" &&
    activeOrders.length > 0 &&
    activeOrders.every((menu) => {
      const ord = orders[menu.id];
      const toCheck = ord.sameForAll ? [ord.portions[0]] : ord.portions;
      return toCheck?.every((portion) =>
        MENUS.find((m) => m.id === menu.id)!.options.every((opt) => portion?.options[opt.key] !== "")
      ) ?? false;
    });

  const validate = () => {
    if (!form.name.trim()) return "Nama harus diisi";
    if (!form.nomor_wa.trim()) return "Nomor WA harus diisi";
    if (!form.alamat.trim()) return "Alamat harus diisi";
    if (!form.jam_antar.trim()) return "Jam antar harus diisi";
    if (activeOrders.length === 0) return "Pilih minimal 1 menu";
    for (const menu of activeOrders) {
      const menuDef = MENUS.find((m) => m.id === menu.id)!;
      orders[menu.id].portions.forEach((portion, i) => {
        for (const opt of menuDef.options) {
          if (!portion.options[opt.key]) {
            return `Pilih ${opt.label} untuk ${menu.name} Porsi ${i + 1}`;
          }
        }
      });
    }
    return "";
  };

  const buildWAMessage = () => {
    const lines = [
      "*PESANAN BABIQU*",
      "--------------------",
      `Nama       : ${form.name}`,
      `No. WA     : ${form.nomor_wa}`,
      `Alamat     : ${form.alamat}`,
      `Jam Antar  : ${form.jam_antar}`,
      "",
      "*DETAIL PESANAN*",
      "--------------------",
    ];

    for (const menu of activeOrders) {
      const m = MENUS.find((x) => x.id === menu.id)!;
      const ord = orders[menu.id];
      lines.push(`${ord.qty}x ${m.name}`);
      ord.portions.forEach((portion, i) => {
        if (ord.qty > 1) lines.push(`  [ Porsi ${i + 1} ]`);
        for (const opt of m.options) {
          lines.push(`  ${opt.label}: ${portion.options[opt.key]}`);
        }
        if (portion.notes.trim()) lines.push(`  Catatan: ${portion.notes.trim()}`);
      });
      lines.push(`  Subtotal: ${formatRupiah(m.price * ord.qty)}`);
      lines.push("");
    }

    lines.push("--------------------");
    lines.push(`*TOTAL: ${formatRupiah(total)}*`);
    if (form.notes.trim()) {
      lines.push("", `Catatan: ${form.notes}`);
    }

    return encodeURIComponent(lines.join("\n"));
  };

  const handleSubmit = async () => {
    if (!isFormComplete) {
      setSubmitted(true);
      scrollToFirstError();
      return;
    }
    setError("");
    setLoading(true);

    // Open the window NOW — synchronously inside the click handler.
    // Safari blocks window.open() called after any await (treats it as
    // a programmatic popup, not a user gesture). We open a blank tab
    // immediately, then redirect it once the DB write succeeds.
    const waWindow = window.open("", "_blank");

    const items = activeOrders.map((menu) => ({
      menu_id: menu.id,
      menu_name: menu.name,
      qty: orders[menu.id].qty,
      portions: orders[menu.id].portions,
      subtotal: menu.price * orders[menu.id].qty,
    }));

    const { error: dbError } = await supabase.from("orders").insert({
      name: form.name,
      nomor_wa: form.nomor_wa,
      alamat: form.alamat,
      jam_antar: form.jam_antar,
      items,
      notes: form.notes,
      total,
      batch_id: activeBatch?.id ?? null,
    });

    if (dbError) {
      setError("Gagal menyimpan pesanan. Coba lagi.");
      setLoading(false);
      waWindow?.close();
      return;
    }

    const waUrl = `https://wa.me/${WA_NUMBER}?text=${buildWAMessage()}`;
    if (waWindow) {
      waWindow.location.href = waUrl;
    } else {
      // Fallback: if popup was still blocked, navigate current tab
      window.location.href = waUrl;
    }
    setLoading(false);
  };

  // ── Hero (shared) ──────────────────────────────────────────────────────────
  const hero = (
    <header className="relative text-white text-center overflow-hidden">
      <div className="relative h-[400px] sm:h-[480px] w-full">
        <Image src="/hero.jpg" alt="Babiqu Signature Roast Pork" fill className="object-cover object-[center_65%]" priority />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a0a05]/85 via-[#1a0a05]/30 to-transparent" />
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-8 px-4">
        <p className="text-[11px] tracking-[0.35em] uppercase text-red-200 mb-2">Signature Roast Pork</p>
        <h1 className="text-4xl font-bold tracking-wide drop-shadow-lg">BABIQU</h1>
        <p className="text-white/80 text-sm mt-2 tracking-wide drop-shadow">Pesan langsung · Antar ke rumah</p>
      </div>
    </header>
  );

  // ── Batch loading ───────────────────────────────────────────────────────────
  if (activeBatch === undefined) {
    return (
      <div className="min-h-screen bg-[#fdf8f2]">
        {hero}
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#7b1d1d] border-t-transparent rounded-full animate-spin" />
        </div>
        <footer className="text-center py-8 text-xs text-[#b8a898]">© 2026 Babiqu · Signature Roast Pork</footer>
      </div>
    );
  }

  // ── PO Closed ───────────────────────────────────────────────────────────────
  if (activeBatch === null) {
    return (
      <div className="min-h-screen bg-[#fdf8f2]">
        {hero}
        <main className="max-w-xl mx-auto px-4 py-10">
          <div className="bg-white rounded-2xl border border-[#e8ddd0] shadow-sm p-8 text-center">
            <p className="text-3xl mb-3">{batchClosedFull ? "🎯" : "🔒"}</p>
            <h2 className="text-xl font-bold text-[#1c1208] mb-2">
              {batchClosedFull ? "Kuota Penuh!" : "PO Sedang Tutup"}
            </h2>
            <p className="text-sm text-[#8a7060] leading-relaxed mb-5">
              {batchClosedFull
                ? "Pesanan untuk batch ini sudah mencapai batas kuota.\nPantau terus untuk batch berikutnya!"
                : "Pemesanan untuk batch ini sudah ditutup.\nPantau terus untuk batch berikutnya!"}
            </p>
            {nextBatch ? (
              <div className="bg-[#fdf8f2] rounded-xl border border-[#e8ddd0] p-4 text-left">
                <p className="text-xs font-bold text-[#7b1d1d] uppercase tracking-wider mb-2">Batch Berikutnya</p>
                <p className="font-semibold text-[#1c1208]">{nextBatch.label}</p>
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-[#5a3e2b]">
                    <span className="font-semibold">PO Buka:</span> {formatBatchDate(nextBatch.open_date)}
                  </p>
                  <p className="text-xs text-[#5a3e2b]">
                    <span className="font-semibold">PO Tutup:</span> {formatBatchDate(nextBatch.close_date)}
                  </p>
                  <p className="text-xs text-[#5a3e2b]">
                    <span className="font-semibold">Pengiriman:</span> {formatBatchDate(nextBatch.delivery_date)}
                  </p>
                </div>
                {nextBatch.notes && <p className="text-xs text-[#8a7060] italic mt-2">{nextBatch.notes}</p>}
              </div>
            ) : (
              <p className="text-xs text-[#b8a898]">Info batch berikutnya akan segera diumumkan.</p>
            )}
          </div>
        </main>
        <footer className="text-center py-8 text-xs text-[#b8a898]">© 2026 Babiqu · Signature Roast Pork</footer>
      </div>
    );
  }

  // ── PO Open ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#fdf8f2]">
      {hero}

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">

        {/* PO Info Banner */}
        <div className="bg-[#7b1d1d] text-white rounded-2xl px-5 py-4">
          <p className="text-[11px] tracking-[0.2em] uppercase font-bold text-red-200 mb-1">{activeBatch.label}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/90">
            <span>PO tutup: <span className="font-semibold text-white">{formatBatchDate(activeBatch.close_date)}</span></span>
            <span>Antar: <span className="font-semibold text-white">{formatBatchDate(activeBatch.delivery_date)}</span></span>
            {activeBatch.max_orders != null && (
              <span>Sisa kuota: <span className="font-semibold text-white">{Math.max(0, activeBatch.max_orders - batchOrderCount)}/{activeBatch.max_orders}</span></span>
            )}
          </div>
          {activeBatch.notes && <p className="text-xs text-red-200 mt-1.5 italic">{activeBatch.notes}</p>}
        </div>

        {/* Customer Info */}
        <section className="bg-white rounded-2xl shadow-sm border border-[#e8ddd0] p-6 space-y-4">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#7b1d1d]">
            Informasi Pemesan
          </h2>
          {(["name", "nomor_wa", "alamat"] as const).map((key) => {
            const meta = {
              name:      { label: "Nama Lengkap",       placeholder: "e.g. Budi Santoso",        type: "text" },
              nomor_wa:  { label: "Nomor WhatsApp",      placeholder: "e.g. 08123456789",         type: "tel"  },
              alamat:    { label: "Alamat Pengiriman",   placeholder: "Jl. Sudirman No. 12, ...", type: "text" },
            }[key];
            const err = fieldError(key);
            return (
              <div key={key}>
                <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 tracking-wide uppercase">
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
                  onBlur={() => touch(key)}
                  placeholder={meta.placeholder}
                  className={`w-full border rounded-lg px-4 py-2.5 text-[15px] text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none transition ${
                    err
                      ? "border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-400"
                      : "border-[#d9cfc5] focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d]"
                  }`}
                />
                {err && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" /> {err}
                  </p>
                )}
              </div>
            );
          })}

          {/* Jam Antar — dropdown */}
          {(() => {
            const err = fieldError("jam_antar");
            return (
              <div>
                <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 tracking-wide uppercase">
                  Jam Antar
                </label>
                <select
                  data-field="jam_antar"
                  value={form.jam_antar}
                  onChange={(e) => setForm((prev) => ({ ...prev, jam_antar: e.target.value }))}
                  onBlur={() => touch("jam_antar")}
                  className={`w-full border rounded-lg px-4 py-2.5 text-[15px] bg-[#fdf8f2] focus:outline-none transition appearance-none cursor-pointer ${
                    err
                      ? "border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-400 text-[#1c1208]"
                      : form.jam_antar
                      ? "border-[#d9cfc5] focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] text-[#1c1208]"
                      : "border-[#d9cfc5] focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] text-[#b8a898]"
                  }`}
                >
                  <option value="" disabled>Pilih jam pengiriman</option>
                  <option value="11.00 - 13.00 (Siang)">11.00 - 13.00 (Siang)</option>
                  <option value="17.00 - 19.00 (Malam)">17.00 - 19.00 (Malam)</option>
                </select>
                {err && (
                  <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" /> {err}
                  </p>
                )}
              </div>
            );
          })()}
        </section>

        {/* Menu */}
        <section className="space-y-4" data-section="menu">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#7b1d1d] px-1">
            Pilih Menu
          </h2>

          {MENUS.map((menu) => {
            const ord = orders[menu.id];
            const subtotal = menu.price * ord.qty;
            const isActive = ord.qty > 0;

            return (
              <div
                key={menu.id}
                className={`bg-white rounded-2xl border shadow-sm transition-all ${
                  isActive
                    ? "border-[#7b1d1d] shadow-[0_0_0_1px_#7b1d1d20]"
                    : "border-[#e8ddd0]"
                }`}
              >
                <div className="p-5">
                  {/* Menu header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-[#1c1208] leading-snug">
                        {menu.name}
                      </h3>
                      <p className="text-xs text-[#8a7060] mt-1">
                        {menu.includes.join(" · ")}
                      </p>
                      <p className="text-sm font-semibold text-[#7b1d1d] mt-2">
                        {formatRupiah(menu.price)}
                      </p>
                    </div>

                    {/* Qty control */}
                    <div className="flex items-center gap-2 shrink-0 mt-1">
                      <button
                        onClick={() => setQty(menu.id, -1)}
                        className="w-8 h-8 rounded-full border border-[#d9cfc5] text-[#5a3e2b] font-bold text-lg flex items-center justify-center hover:bg-[#f5ede4] transition disabled:opacity-30"
                        disabled={ord.qty === 0}
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
                          className="w-10 text-center font-bold text-[#1c1208] border border-[#7b1d1d] rounded-lg text-sm focus:outline-none py-0.5"
                        />
                      ) : (
                        <button
                          onClick={() => setQtyEditing(menu.id)}
                          title="Ketuk untuk ubah jumlah"
                          className="w-8 text-center font-bold text-[#1c1208] hover:text-[#7b1d1d] hover:underline transition"
                        >
                          {ord.qty}
                        </button>
                      )}
                      <button
                        onClick={() => setQty(menu.id, 1)}
                        className="w-8 h-8 rounded-full bg-[#7b1d1d] text-white font-bold text-lg flex items-center justify-center hover:bg-[#6a1717] transition"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Options (shown when qty > 0) */}
                  {isActive && (
                    <div className="mt-4 pt-4 border-t border-[#f0e8de] space-y-3">

                      {/* Same-for-all toggle (only when qty > 1) */}
                      {ord.qty > 1 && (
                        <div className="flex items-center justify-between bg-[#fdf8f2] rounded-lg px-3 py-2">
                          <span className="text-xs font-semibold text-[#5a3e2b]">Semua porsi sama?</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleSameForAll(menu.id, true)}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${ord.sameForAll ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"}`}
                            >Ya, sama</button>
                            <button
                              onClick={() => toggleSameForAll(menu.id, false)}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${!ord.sameForAll ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"}`}
                            >Beda-beda</button>
                          </div>
                        </div>
                      )}

                      {/* SAME FOR ALL: show one form */}
                      {ord.sameForAll && ord.portions[0] && (() => {
                        const portion = ord.portions[0];
                        return (
                          <div className="space-y-2">
                            {menu.options.map((opt) => {
                              const optErr = submitted && !portion.options[opt.key];
                              return (
                                <div key={opt.key} data-option={`${menu.id}-0-${opt.key}`}>
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <p className={`text-xs font-semibold tracking-wide uppercase ${optErr ? "text-red-500" : "text-[#5a3e2b]"}`}>{opt.label}</p>
                                    {optErr && <span className="text-[10px] text-red-500 flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> Wajib dipilih</span>}
                                  </div>
                                  <div className={`flex flex-wrap gap-2 p-2 rounded-lg transition ${optErr ? "bg-red-50 ring-1 ring-red-300" : ""}`}>
                                    {opt.choices.map((choice) => (
                                      <button key={choice}
                                        onClick={() => {
                                          // apply to all portions at once
                                          setOrders((prev) => {
                                            const portions = prev[menu.id].portions.map((p) => ({ ...p, options: { ...p.options, [opt.key]: choice } }));
                                            return { ...prev, [menu.id]: { ...prev[menu.id], portions } };
                                          });
                                        }}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${portion.options[opt.key] === choice ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : optErr ? "bg-white text-red-600 border-red-300 hover:border-red-500" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"}`}
                                      >{choice}</button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                            {/* Per-portion notes — inline add panel */}
                            <div className="border-t border-dashed border-[#e8ddd0] pt-2 space-y-2">
                              {/* Existing notes chips */}
                              {ord.portions.some((p) => p.notes.trim()) && (
                                <div className="space-y-1">
                                  {ord.portions.map((p, idx) =>
                                    p.notes.trim() ? (
                                      <div key={idx} className="flex items-center gap-2 bg-[#f5ede4] rounded-lg px-3 py-1.5">
                                        <span className="text-[11px] font-bold text-[#a07850] shrink-0">P{idx + 1}</span>
                                        {editingNote?.menuId === menu.id && editingNote.portionIndex === idx ? (
                                          <input
                                            autoFocus
                                            type="text"
                                            value={editingNote.text}
                                            onChange={(e) => setEditingNote((prev) => prev ? { ...prev, text: e.target.value } : null)}
                                            onBlur={() => {
                                              if (editingNote.text.trim()) setPortionNotes(menu.id, idx, editingNote.text.trim());
                                              else setPortionNotes(menu.id, idx, "");
                                              setEditingNote(null);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                              if (e.key === "Escape") { setPortionNotes(menu.id, idx, p.notes); setEditingNote(null); }
                                            }}
                                            className="flex-1 text-xs text-[#1c1208] bg-transparent border-b border-[#a07850] focus:outline-none focus:border-[#7b1d1d] min-w-0"
                                          />
                                        ) : (
                                          <span
                                            onClick={() => setEditingNote({ menuId: menu.id, portionIndex: idx, text: p.notes })}
                                            className="text-xs text-[#1c1208] flex-1 cursor-text hover:text-[#7b1d1d] transition"
                                          >{p.notes}</span>
                                        )}
                                        <button onClick={() => setPortionNotes(menu.id, idx, "")} className="text-[#a07850] hover:text-red-500 transition text-sm leading-none">×</button>
                                      </div>
                                    ) : null
                                  )}
                                </div>
                              )}

                              {/* Add note button / inline form */}
                              {addingNote?.menuId === menu.id ? (
                                <div className="bg-[#fdf8f2] border border-[#d9cfc5] rounded-xl p-3 space-y-2">
                                  <p className="text-[11px] font-semibold text-[#5a3e2b] uppercase tracking-wide">Pilih porsi:</p>
                                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                                    {ord.portions.map((_, idx) => {
                                      const sel = addingNote.selected.includes(idx);
                                      return (
                                        <button
                                          key={idx}
                                          onClick={() => setAddingNote((prev) => prev ? ({
                                            ...prev,
                                            selected: sel ? prev.selected.filter((i) => i !== idx) : [...prev.selected, idx]
                                          }) : null)}
                                          className={`px-2.5 py-1 rounded-full text-xs font-bold border transition ${sel ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"}`}
                                        >P{idx + 1}</button>
                                      );
                                    })}
                                    <button
                                      onClick={() => setAddingNote((prev) => prev ? ({ ...prev, selected: ord.portions.map((_, i) => i) }) : null)}
                                      className="px-2.5 py-1 rounded-full text-xs font-medium border border-[#d9cfc5] text-[#5a3e2b] hover:border-[#7b1d1d] transition"
                                    >Semua</button>
                                  </div>
                                  <input
                                    type="text"
                                    autoFocus
                                    value={addingNote.text}
                                    onChange={(e) => setAddingNote((prev) => prev ? ({ ...prev, text: e.target.value }) : null)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && addingNote.text.trim() && addingNote.selected.length > 0) {
                                        addingNote.selected.forEach((idx) => setPortionNotes(menu.id, idx, addingNote.text.trim()));
                                        setAddingNote(null);
                                      }
                                      if (e.key === "Escape") setAddingNote(null);
                                    }}
                                    placeholder="Tulis catatan..."
                                    className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2 text-xs text-[#1c1208] placeholder-[#b8a898] bg-white focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        if (addingNote.text.trim() && addingNote.selected.length > 0) {
                                          addingNote.selected.forEach((idx) => setPortionNotes(menu.id, idx, addingNote.text.trim()));
                                          setAddingNote(null);
                                        }
                                      }}
                                      disabled={!addingNote.text.trim() || addingNote.selected.length === 0}
                                      className="flex-1 text-white text-xs font-semibold py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed bg-[#7b1d1d] hover:bg-[#6a1717] disabled:hover:bg-[#7b1d1d]"
                                    >Tambah Catatan</button>
                                    <button
                                      onClick={() => setAddingNote(null)}
                                      className="px-4 text-xs text-[#8a7060] hover:text-[#1c1208] transition"
                                    >Batal</button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setAddingNote({ menuId: menu.id, text: "", selected: [] })}
                                  className="text-xs text-[#7b1d1d] hover:underline font-medium"
                                >
                                  + Tambah catatan per porsi
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* DIFFERENT: accordion per portion */}
                      {!ord.sameForAll && ord.portions.map((portion, portionIdx) => {
                        const isOpen = expandedPortions[menu.id] === portionIdx;
                        const isConfigured = menu.options.every((opt) => portion.options[opt.key]);
                        return (
                          <div key={portionIdx} className="border border-[#e8ddd0] rounded-xl overflow-hidden">
                            {/* Accordion header */}
                            <button
                              onClick={() => setExpandedPortions((prev) => ({ ...prev, [menu.id]: isOpen ? null : portionIdx }))}
                              className="w-full flex items-center justify-between px-4 py-2.5 bg-[#fdf8f2] hover:bg-[#f5ede4] transition text-left"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-[#a07850] uppercase tracking-wide">Porsi {portionIdx + 1}</span>
                                {isConfigured && (
                                  <span className="text-[10px] text-[#8a7060]">
                                    {menu.options.map((opt) => portion.options[opt.key]).join(" · ")}
                                    {portion.notes && ` · ${portion.notes.slice(0, 20)}${portion.notes.length > 20 ? "…" : ""}`}
                                  </span>
                                )}
                                {submitted && !isConfigured && (
                                  <span className="text-[10px] text-red-500 flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> Belum lengkap</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); deletePortion(menu.id, portionIdx); }}
                                  className="text-red-400 hover:text-red-600 transition p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <span className="text-[#a07850] text-lg leading-none">{isOpen ? "−" : "+"}</span>
                              </div>
                            </button>

                            {/* Accordion body */}
                            {isOpen && (
                              <div className="px-4 py-3 space-y-2 border-t border-[#f0e8de]">
                                {menu.options.map((opt) => {
                                  const optErr = submitted && !portion.options[opt.key];
                                  return (
                                    <div key={opt.key} data-option={`${menu.id}-${portionIdx}-${opt.key}`}>
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <p className={`text-xs font-semibold tracking-wide uppercase ${optErr ? "text-red-500" : "text-[#5a3e2b]"}`}>{opt.label}</p>
                                        {optErr && <span className="text-[10px] text-red-500 flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> Wajib dipilih</span>}
                                      </div>
                                      <div className={`flex flex-wrap gap-2 p-2 rounded-lg transition ${optErr ? "bg-red-50 ring-1 ring-red-300" : ""}`}>
                                        {opt.choices.map((choice) => (
                                          <button key={choice}
                                            onClick={() => setOption(menu.id, portionIdx, opt.key, choice)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${portion.options[opt.key] === choice ? "bg-[#7b1d1d] text-white border-[#7b1d1d]" : optErr ? "bg-white text-red-600 border-red-300 hover:border-red-500" : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"}`}
                                          >{choice}</button>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                                <textarea
                                  value={portion.notes}
                                  onChange={(e) => setPortionNotes(menu.id, portionIdx, e.target.value)}
                                  placeholder={`Catatan porsi ${portionIdx + 1} (opsional)...`}
                                  rows={2}
                                  className="w-full border border-[#d9cfc5] rounded-lg px-3 py-2 text-xs text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition resize-none"
                                />
                                {ord.qty > 1 && (
                                  <button
                                    onClick={() => applyToAll(menu.id, portionIdx)}
                                    className="text-[11px] text-[#7b1d1d] hover:underline font-medium"
                                  >
                                    Salin pengaturan ini ke semua porsi lain
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Subtotal */}
                      <div className="flex justify-end pt-1">
                        <span className="text-sm text-[#7b1d1d] font-semibold">Subtotal: {formatRupiah(subtotal)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Order Summary */}
        {activeOrders.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-[#e8ddd0] p-6">
            <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#7b1d1d] mb-4">
              Ringkasan Pesanan
            </h2>
            <div className="space-y-3">
              {activeOrders.map((menu) => {
                const ord = orders[menu.id];
                return (
                  <div key={menu.id}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-[#1c1208] text-sm">{menu.name}</p>
                        {ord.portions.map((portion, i) => (
                          <div key={i} className="mt-0.5">
                            <p className="text-xs text-[#8a7060]">
                              {ord.qty > 1 ? `Porsi ${i + 1}: ` : ""}
                              {MENUS.find((m) => m.id === menu.id)!.options
                                .map((opt) => portion.options[opt.key] || "—")
                                .join(" · ")}
                            </p>
                            {portion.notes.trim() && (
                              <p className="text-xs text-[#a07850] italic ml-1">↳ {portion.notes.trim()}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-[#8a7060]">{ord.qty}x {formatRupiah(menu.price)}</p>
                        <p className="text-sm font-semibold text-[#7b1d1d]">
                          {formatRupiah(menu.price * ord.qty)}
                        </p>
                      </div>
                    </div>
                    {activeOrders.indexOf(menu) < activeOrders.length - 1 && (
                      <div className="border-b border-[#f0e8de] mt-3" />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Total & CTA */}
        <section className="bg-white rounded-2xl shadow-sm border border-[#e8ddd0] p-6">
          <div className="flex items-center justify-between mb-5">
            <span className="text-sm font-semibold text-[#5a3e2b] tracking-wide uppercase">
              Total Pesanan
            </span>
            <span className="text-2xl font-bold text-[#7b1d1d]">
              {formatRupiah(total)}
            </span>
          </div>

          {submitted && activeOrders.length === 0 && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> Pilih minimal 1 menu dulu ya
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`w-full text-white font-bold py-4 rounded-xl tracking-wide text-[15px] transition flex items-center justify-center gap-2 ${
              isFormComplete
                ? "bg-[#7b1d1d] hover:bg-[#6a1717] cursor-pointer"
                : "bg-[#c4a89a] cursor-not-allowed"
            }`}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <MessageCircle className="w-5 h-5" />
                Pesan via WhatsApp
              </>
            )}
          </button>
          <p className="text-center text-xs text-[#b8a898] mt-3">
            Pesanan akan dikirim ke WhatsApp kami untuk konfirmasi
          </p>
        </section>
      </main>

      <footer className="text-center py-8 text-xs text-[#b8a898]">
        © 2026 Babiqu · Signature Roast Pork
      </footer>
    </div>
  );
}
