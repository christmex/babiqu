"use client";

import { useState } from "react";
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
      "🍖 *PESANAN BABIQU*",
      "━━━━━━━━━━━━━━━━━━━━",
      `👤 Nama: ${form.name}`,
      `📱 No. WA: ${form.nomor_wa}`,
      `📍 Alamat: ${form.alamat}`,
      `🕐 Jam Antar: ${form.jam_antar}`,
      "",
      "📋 *DETAIL PESANAN:*",
    ];

    for (const menu of activeOrders) {
      const m = MENUS.find((x) => x.id === menu.id)!;
      const ord = orders[menu.id];
      lines.push(`\n• ${m.name} (${ord.qty}x)`);
      ord.portions.forEach((portion, i) => {
        const label = ord.qty > 1 ? `  Porsi ${i + 1}` : " ";
        for (const opt of m.options) {
          lines.push(`${label} - ${opt.label}: ${portion[opt.key]}`);
        }
      });
      lines.push(`  Subtotal: ${formatRupiah(m.price * ord.qty)}`);
    }

    lines.push("", "━━━━━━━━━━━━━━━━━━━━");
    lines.push(`💰 *TOTAL: ${formatRupiah(total)}*`);
    if (form.notes.trim()) {
      lines.push("", `📝 Catatan: ${form.notes}`);
    }

    return encodeURIComponent(lines.join("\n"));
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
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
      {/* Header */}
      <header className="bg-[#7b1d1d] text-white py-10 px-4 text-center">
        <p className="text-[11px] tracking-[0.35em] uppercase text-red-200 mb-2">
          Signature Roast Pork
        </p>
        <h1 className="text-4xl font-bold tracking-wide">BABIQU</h1>
        <p className="text-red-200 text-sm mt-2 tracking-wide">
          Pesan langsung · Antar ke rumah
        </p>
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
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-[#5a3e2b] mb-1 tracking-wide uppercase">
                {label}
              </label>
              <input
                type={type}
                value={form[key as keyof FormData]}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, [key]: e.target.value }))
                }
                placeholder={placeholder}
                className="w-full border border-[#d9cfc5] rounded-lg px-4 py-2.5 text-[15px] text-[#1c1208] placeholder-[#b8a898] bg-[#fdf8f2] focus:outline-none focus:border-[#7b1d1d] focus:ring-1 focus:ring-[#7b1d1d] transition"
              />
            </div>
          ))}
        </section>

        {/* Menu */}
        <section className="space-y-4">
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
                          {menu.options.map((opt) => (
                            <div key={opt.key}>
                              <p className="text-xs font-semibold text-[#5a3e2b] mb-1.5 tracking-wide uppercase">
                                {opt.label}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {opt.choices.map((choice) => (
                                  <button
                                    key={choice}
                                    onClick={() => setOption(menu.id, portionIdx, opt.key, choice)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                                      portion[opt.key] === choice
                                        ? "bg-[#7b1d1d] text-white border-[#7b1d1d]"
                                        : "bg-white text-[#5a3e2b] border-[#d9cfc5] hover:border-[#7b1d1d]"
                                    }`}
                                  >
                                    {choice}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
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

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || total === 0}
            className="w-full bg-[#7b1d1d] hover:bg-[#6a1717] disabled:bg-[#c4a89a] text-white font-bold py-4 rounded-xl tracking-wide text-[15px] transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
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
        © 2025 Babiqu · Signature Roast Pork
      </footer>
    </div>
  );
}
