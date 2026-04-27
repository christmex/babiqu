// ─── Constants ────────────────────────────────────────────────────────────────

export const WA_NUMBER = "6285280221998";

export const BANK_INFO = {
  transfer_mandiri: { bank: "Bank Mandiri", account: "1090021894001", name: "KORNELIUS SOPHIANO T" },
  transfer_bca:     { bank: "Bank BCA",     account: "8210598261",    name: "KORNELIUS SOPHIANO T" },
} as const;

export type PaymentMethod = "cash" | "transfer_mandiri" | "transfer_bca";

export const ONGKIR = 5000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Portion = {
  options: Record<string, string>;
  notes: string;
};

export type MenuOrder = {
  qty: number;
  portions: Portion[];
  sameForAll: boolean;
};

export type MenuDef = {
  id: string;
  name: string;
  price: number;
  includes: string[];
  options: { key: string; label: string; choices: string[] }[];
  isNew?: boolean;
};

// ─── Menu data ────────────────────────────────────────────────────────────────

export const MENUS: MenuDef[] = [
  {
    id: "signature-putih",
    name: "Signature Andaliman (Nasi Putih)",
    price: 40000,
    includes: ["Babi Panggang Merah", "Sop Sayur Asin", "Sambel Andaliman", "Nasi Putih"],
    options: [],
  },
  {
    id: "signature-kecombrang",
    name: "Signature Andaliman (Nasi Kecombrang)",
    price: 40000,
    includes: ["Babi Panggang Merah", "Sop Sayur Asin", "Sambel Andaliman", "Nasi Kecombrang"],
    options: [],
  },
  {
    id: "classic-putih",
    name: "Classic Roast (Nasi Putih)",
    price: 40000,
    includes: ["Babi Panggang Merah", "Sop Sayur Asin", "Sambel Bawang Cuka", "Nasi Putih"],
    options: [],
  },
  {
    id: "classic-kecombrang",
    name: "Classic Roast (Nasi Kecombrang)",
    price: 40000,
    includes: ["Babi Panggang Merah", "Sop Sayur Asin", "Sambel Bawang Cuka", "Nasi Kecombrang"],
    options: [],
  },
  {
    id: "sop-tulang-putih-andaliman",
    name: "Sop Tulang Set (Nasi Putih + Sambel Andaliman)",
    price: 25000,
    includes: ["Sop Tulang", "Nasi Putih", "Sambel Andaliman"],
    options: [],
  },
  {
    id: "sop-tulang-kecombrang-andaliman",
    name: "Sop Tulang Set (Nasi Kecombrang + Sambel Andaliman)",
    price: 25000,
    includes: ["Sop Tulang", "Nasi Kecombrang", "Sambel Andaliman"],
    options: [],
  },
  {
    id: "sop-tulang-putih-bawang-cuka",
    name: "Sop Tulang Set (Nasi Putih + Sambel Bawang Cuka)",
    price: 25000,
    includes: ["Sop Tulang", "Nasi Putih", "Sambel Bawang Cuka"],
    options: [],
  },
  {
    id: "sop-tulang-kecombrang-bawang-cuka",
    name: "Sop Tulang Set (Nasi Kecombrang + Sambel Bawang Cuka)",
    price: 25000,
    includes: ["Sop Tulang", "Nasi Kecombrang", "Sambel Bawang Cuka"],
    options: [],
  },
  {
    id: "pork-satay-putih-bawang-cuka",
    name: "Pork Satay Set (Nasi Putih + Sambel Bawang Cuka)",
    price: 40000,
    includes: ["Sate Babi", "Nasi Putih", "Sambel Bawang Cuka"],
    options: [],
    isNew: true,
  },
  {
    id: "pork-satay-kecombrang-bawang-cuka",
    name: "Pork Satay Set (Nasi Kecombrang + Sambel Bawang Cuka)",
    price: 40000,
    includes: ["Sate Babi", "Nasi Kecombrang", "Sambel Bawang Cuka"],
    options: [],
    isNew: true,
  },
  {
    id: "pork-satay-putih-andaliman",
    name: "Pork Satay Set (Nasi Putih + Sambel Andaliman)",
    price: 40000,
    includes: ["Sate Babi", "Nasi Putih", "Sambel Andaliman"],
    options: [],
    isNew: true,
  },
  {
    id: "pork-satay-kecombrang-andaliman",
    name: "Pork Satay Set (Nasi Kecombrang + Sambel Andaliman)",
    price: 40000,
    includes: ["Sate Babi", "Nasi Kecombrang", "Sambel Andaliman"],
    options: [],
    isNew: true,
  },
];

export const ALA_CARTE: MenuDef[] = [
  {
    id: "alc-babi-andaliman",
    name: "Babi Panggang Merah (Sambel Andaliman)",
    price: 35000,
    includes: ["Babi Panggang Merah", "Sambel Andaliman"],
    options: [],
  },
  {
    id: "alc-babi-bawang-cuka",
    name: "Babi Panggang Merah (Sambel Bawang Cuka)",
    price: 35000,
    includes: ["Babi Panggang Merah", "Sambel Bawang Cuka"],
    options: [],
  },
  {
    id: "alc-nasi-putih",
    name: "Nasi Putih",
    price: 5000,
    includes: ["Nasi Putih"],
    options: [],
  },
  {
    id: "alc-nasi-kecombrang",
    name: "Nasi Kecombrang",
    price: 8000,
    includes: ["Nasi Kecombrang"],
    options: [],
  },
  {
    id: "alc-sop-tulang",
    name: "Sop Tulang",
    price: 20000,
    includes: ["Sop Tulang"],
    options: [],
  },
  {
    id: "alc-sambel-andaliman",
    name: "Tambahan Sambel Andaliman",
    price: 3000,
    includes: ["Sambel Andaliman"],
    options: [],
  },
  {
    id: "alc-sambel-bawang-cuka",
    name: "Tambahan Sambel Bawang Cuka",
    price: 3000,
    includes: ["Sambel Bawang Cuka"],
    options: [],
  },
  {
    id: "alc-sate-pork",
    name: "Sate Babi (1 tusuk)",
    price: 8000,
    includes: ["Sate Babi"],
    options: [],
    isNew: true,
  },
];

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function formatBatchDate(dateStr: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(dateStr + "T00:00:00"));
}

// ─── Order logic ──────────────────────────────────────────────────────────────

/** Create an empty portion for a given menu/alc-carte item id */
export function emptyPortion(menuId: string): Portion {
  const allMenus = [...MENUS, ...ALA_CARTE];
  const menu = allMenus.find((m) => m.id === menuId);
  if (!menu) throw new Error(`Unknown menu id: ${menuId}`);
  return {
    options: Object.fromEntries(menu.options.map((o) => [o.key, ""])),
    notes: "",
  };
}

/** Default zero-qty order state for all menus */
export function makeDefaultOrders(menus: MenuDef[]): Record<string, MenuOrder> {
  return Object.fromEntries(menus.map((m) => [m.id, { qty: 0, portions: [], sameForAll: true }]));
}

/** Calculate grand total across paket + à la carte, adding ONGKIR when items exist */
export function calculateTotal(
  orders: Record<string, MenuOrder>,
  alcOrders: Record<string, MenuOrder>,
): number {
  const paketTotal = MENUS.reduce((sum, m) => sum + m.price * (orders[m.id]?.qty ?? 0), 0);
  const alcTotal = ALA_CARTE.reduce((sum, m) => sum + m.price * (alcOrders[m.id]?.qty ?? 0), 0);
  const subtotal = paketTotal + alcTotal;
  return subtotal > 0 ? subtotal + ONGKIR : 0;
}

/** Check if a menu order has all required options filled */
export function isOrderComplete(menu: MenuDef, ord: MenuOrder): boolean {
  if (menu.options.length === 0) return true;
  const toCheck = ord.sameForAll ? [ord.portions[0]] : ord.portions;
  return (toCheck ?? []).every((portion) =>
    menu.options.every((opt) => !!portion?.options[opt.key])
  );
}

/** Build flat items array for DB insert */
export function buildOrderItems(
  orders: Record<string, MenuOrder>,
  alcOrders: Record<string, MenuOrder>,
) {
  const activeOrders = MENUS.filter((m) => (orders[m.id]?.qty ?? 0) > 0);
  const activeAlcOrders = ALA_CARTE.filter((m) => (alcOrders[m.id]?.qty ?? 0) > 0);
  return [
    ...activeOrders.map((menu) => ({
      menu_id: menu.id,
      menu_name: menu.name,
      qty: orders[menu.id].qty,
      portions: orders[menu.id].portions,
      subtotal: menu.price * orders[menu.id].qty,
    })),
    ...activeAlcOrders.map((menu) => ({
      menu_id: menu.id,
      menu_name: menu.name,
      qty: alcOrders[menu.id].qty,
      portions: alcOrders[menu.id].portions,
      subtotal: menu.price * alcOrders[menu.id].qty,
    })),
  ];
}

// ─── WA message builder ───────────────────────────────────────────────────────

export type WAMessageParams = {
  form: { name: string; nomor_wa: string; alamat: string; jam_antar: string; catatan?: string; notes?: string };
  orders: Record<string, MenuOrder>;
  alcOrders: Record<string, MenuOrder>;
  total: number;
  paymentMethod: PaymentMethod;
  proofUrl?: string;
};

export function buildWAMessage(params: WAMessageParams): string {
  const { form, orders, alcOrders, total, paymentMethod, proofUrl } = params;
  const catatan = (form.catatan ?? form.notes ?? "").trim();

  const activeOrders = MENUS.filter((m) => (orders[m.id]?.qty ?? 0) > 0);
  const activeAlcOrders = ALA_CARTE.filter((m) => (alcOrders[m.id]?.qty ?? 0) > 0);

  const lines = [
    `Halo ${form.name}! Pesanan kamu sudah kami terima 🎉`,
    "",
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

  if (activeOrders.length > 0) {
    lines.push("*Menu Paket*");
    for (const menu of activeOrders) {
      const ord = orders[menu.id];
      lines.push(`${ord.qty}x ${menu.name}`);
      ord.portions.forEach((portion, i) => {
        if (ord.qty > 1) lines.push(`  [ Porsi ${i + 1} ]`);
        for (const opt of menu.options) {
          lines.push(`  ${opt.label}: ${portion.options[opt.key]}`);
        }
        if (portion.notes.trim()) lines.push(`  Catatan: ${portion.notes.trim()}`);
      });
      lines.push(`  Subtotal: ${formatRupiah(menu.price * ord.qty)}`);
      lines.push("");
    }
  }

  if (activeAlcOrders.length > 0) {
    lines.push("*À La Carte*");
    for (const menu of activeAlcOrders) {
      const ord = alcOrders[menu.id];
      lines.push(`${ord.qty}x ${menu.name}`);
      if (menu.options.length > 0) {
        ord.portions.forEach((portion, i) => {
          if (ord.qty > 1) lines.push(`  [ Porsi ${i + 1} ]`);
          for (const opt of menu.options) {
            lines.push(`  ${opt.label}: ${portion.options[opt.key]}`);
          }
        });
      }
      lines.push(`  Subtotal: ${formatRupiah(menu.price * ord.qty)}`);
      lines.push("");
    }
  }

  lines.push("--------------------");
  lines.push(`Ongkos Kirim: ${formatRupiah(ONGKIR)}`);
  lines.push(`*TOTAL: ${formatRupiah(total)}*`);
  if (catatan) lines.push("", `Catatan: ${catatan}`);

  lines.push("", "*PEMBAYARAN*", "--------------------");
  if (paymentMethod === "cash") {
    lines.push("Metode : Tunai (bayar saat diterima)");
  } else {
    const bank = BANK_INFO[paymentMethod];
    lines.push(`Metode : Transfer ${bank.bank}`);
    lines.push(`Rek    : ${bank.account} a/n ${bank.name}`);
    if (proofUrl) lines.push(`Bukti  : ${proofUrl}`);
  }

  return lines.join("\n");
}

// ─── Form validation ──────────────────────────────────────────────────────────

export type FormData = {
  name: string;
  nomor_wa: string;
  alamat: string;
  jam_antar: string;
  notes: string;
};

export function validateWA(nomor: string): boolean {
  const digits = nomor.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export function isFormComplete(
  form: FormData,
  orders: Record<string, MenuOrder>,
  alcOrders: Record<string, MenuOrder>,
  paymentMethod: PaymentMethod,
  proofFile: File | null,
): boolean {
  if (!form.name.trim()) return false;
  if (!validateWA(form.nomor_wa)) return false;
  if (!form.alamat.trim()) return false;
  if (!form.jam_antar.trim()) return false;

  const activeOrders = MENUS.filter((m) => (orders[m.id]?.qty ?? 0) > 0);
  const activeAlcOrders = ALA_CARTE.filter((m) => (alcOrders[m.id]?.qty ?? 0) > 0);
  if (activeOrders.length === 0 && activeAlcOrders.length === 0) return false;

  if (!activeOrders.every((m) => isOrderComplete(m, orders[m.id]))) return false;
  if (!activeAlcOrders.every((m) => isOrderComplete(m, alcOrders[m.id]))) return false;

  if (paymentMethod !== "cash" && !proofFile) return false;

  return true;
}
