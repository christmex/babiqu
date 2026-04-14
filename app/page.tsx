"use client";

import { useState } from "react";
import Image from "next/image";
import { AlertCircle, MessageCircle, Loader2 } from "lucide-react";
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

type MenuOrder = {
  qty: number;
  // one options object per portion, so 2x means 2 independent sets of choices
  portions: Record<string, string>[];
};

type FormData = {
  name: string;
  nomor_wa: string;
  alamat: string;
  jam_antar: string;
  notes: string;
};

const WA_NUMBER = "6285280221998";

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

  const emptyPortion = (menuId: string) =>
    Object.fromEntries(MENUS.find((m) => m.id === menuId)!.options.map((o) => [o.key, ""]));

  const [orders, setOrders] = useState<Record<string, MenuOrder>>(() =>
    Object.fromEntries(MENUS.map((m) => [m.id, { qty: 0, portions: [] }]))
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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
          if (!orders[menu.id].portions[i][opt.key]) {
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
      return { ...prev, [menuId]: { qty: next, portions } };
    });
  };

  const setOption = (menuId: string, portionIndex: number, key: string, value: string) => {
    setOrders((prev) => {
      const portions = prev[menuId].portions.map((p, i) =>
        i === portionIndex ? { ...p, [key]: value } : p
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
    activeOrders.every((menu) =>
      orders[menu.id].portions.every((portion) =>
        MENUS.find((m) => m.id === menu.id)!.options.every((opt) => portion[opt.key] !== "")
      )
    );

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
          if (!portion[opt.key]) {
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
          lines.push(`  ${opt.label}: ${portion[opt.key]}`);
        }
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
    });

    if (dbError) {
      setError("Gagal menyimpan pesanan. Coba lagi.");
      setLoading(false);
      return;
    }

    window.open(`https://wa.me/${WA_NUMBER}?text=${buildWAMessage()}`, "_blank");
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#fdf8f2]">
      {/* Hero image */}
      <header className="relative text-white text-center overflow-hidden">
        <div className="relative h-[400px] sm:h-[480px] w-full">
          <Image
            src="/hero.jpg"
            alt="Babiqu Signature Roast Pork"
            fill
            className="object-cover object-[center_65%]"
            priority
          />
          {/* Dark gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a0a05]/85 via-[#1a0a05]/30 to-transparent" />
        </div>
        {/* Text on top of image */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-8 px-4">
          <p className="text-[11px] tracking-[0.35em] uppercase text-red-200 mb-2">
            Signature Roast Pork
          </p>
          <h1 className="text-4xl font-bold tracking-wide drop-shadow-lg">BABIQU</h1>
          <p className="text-white/80 text-sm mt-2 tracking-wide drop-shadow">
            Pesan langsung · Antar ke rumah
          </p>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">

        {/* Customer Info */}
        <section className="bg-white rounded-2xl shadow-sm border border-[#e8ddd0] p-6 space-y-4">
          <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-[#7b1d1d]">
            Informasi Pemesan
          </h2>
          {[
            { key: "name", label: "Nama Lengkap", placeholder: "e.g. Budi Santoso", type: "text" },
            { key: "nomor_wa", label: "Nomor WhatsApp", placeholder: "e.g. 08123456789", type: "tel" },
            { key: "alamat", label: "Alamat Pengiriman", placeholder: "Jl. Sudirman No. 12, Jakarta", type: "text" },
            { key: "jam_antar", label: "Jam Antar", placeholder: "e.g. 12:00 WIB", type: "text" },
          ].map(({ key, label, placeholder, type }) => {
            const err = fieldError(key as keyof FormData);
            return (
              <div key={key}>
                <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 tracking-wide uppercase">
                  {label}
                </label>
                <input
                  data-field={key}
                  type={type}
                  inputMode={key === "nomor_wa" ? "tel" : undefined}
                  value={form[key as keyof FormData]}
                  onChange={(e) =>
                    key === "nomor_wa"
                      ? handleWaInput(e.target.value)
                      : setForm((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  onBlur={() => touch(key)}
                  placeholder={placeholder}
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
                      <span className="w-6 text-center font-bold text-[#1c1208]">
                        {ord.qty}
                      </span>
                      <button
                        onClick={() => setQty(menu.id, 1)}
                        className="w-8 h-8 rounded-full bg-[#7b1d1d] text-white font-bold text-lg flex items-center justify-center hover:bg-[#6a1717] transition"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Options per portion (shown when qty > 0) */}
                  {isActive && (
                    <div className="mt-4 pt-4 border-t border-[#f0e8de] space-y-4">
                      {ord.portions.map((portion, portionIdx) => (
                        <div key={portionIdx} className={ord.qty > 1 ? "space-y-2" : "space-y-2"}>
                          {ord.qty > 1 && (
                            <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-[#a07850]">
                              Porsi {portionIdx + 1}
                            </p>
                          )}
                          {menu.options.map((opt) => {
                            const optErr = submitted && !portion[opt.key];
                            return (
                              <div key={opt.key} data-option={`${menu.id}-${portionIdx}-${opt.key}`}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <p className={`text-xs font-semibold tracking-wide uppercase ${optErr ? "text-red-500" : "text-[#5a3e2b]"}`}>
                                    {opt.label}
                                  </p>
                                  {optErr && (
                                    <span className="text-[10px] text-red-500 font-medium flex items-center gap-0.5">
                                      <AlertCircle className="w-3 h-3" /> Wajib dipilih
                                    </span>
                                  )}
                                </div>
                                <div className={`flex flex-wrap gap-2 p-2 rounded-lg transition ${optErr ? "bg-red-50 ring-1 ring-red-300" : ""}`}>
                                  {opt.choices.map((choice) => (
                                    <button
                                      key={choice}
                                      onClick={() => setOption(menu.id, portionIdx, opt.key, choice)}
                                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                                        portion[opt.key] === choice
                                          ? "bg-[#7b1d1d] text-white border-[#7b1d1d]"
                                          : optErr
                                          ? "bg-white text-red-600 border-red-300 hover:border-red-500"
                                          : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
                                      }`}
                                    >
                                      {choice}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          {portionIdx < ord.portions.length - 1 && (
                            <div className="border-b border-dashed border-[#e8ddd0] pt-2" />
                          )}
                        </div>
                      ))}

                      {/* Subtotal per menu */}
                      <div className="flex justify-end pt-1">
                        <span className="text-sm text-[#7b1d1d] font-semibold">
                          Subtotal: {formatRupiah(subtotal)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Notes */}
        <section className="bg-white rounded-2xl shadow-sm border border-[#e8ddd0] p-6">
          <label className="block text-xs font-semibold text-[#5a3e2b] mb-2 tracking-wide uppercase">
            Catatan (opsional)
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Permintaan khusus, alergi, dll..."
            rows={3}
            className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-[15px] text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition resize-none"
          />
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
                          <p key={i} className="text-xs text-[#8a7060] mt-0.5">
                            {ord.qty > 1 ? `Porsi ${i + 1}: ` : ""}
                            {MENUS.find((m) => m.id === menu.id)!.options
                              .map((opt) => portion[opt.key] || "—")
                              .join(" · ")}
                          </p>
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
