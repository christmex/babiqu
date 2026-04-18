import { describe, it, expect } from "vitest";
import {
  formatRupiah,
  emptyPortion,
  makeDefaultOrders,
  calculateTotal,
  isOrderComplete,
  buildOrderItems,
  buildWAMessage,
  isFormComplete,
  validateWA,
  MENUS,
  ALA_CARTE,
  ONGKIR,
  type MenuOrder,
  type FormData,
} from "@/lib/order-utils";

// ─── formatRupiah ─────────────────────────────────────────────────────────────

describe("formatRupiah", () => {
  it("formats 40000 as IDR", () => {
    expect(formatRupiah(40000)).toContain("40.000");
  });

  it("formats 0", () => {
    expect(formatRupiah(0)).toContain("0");
  });

  it("formats 5000", () => {
    expect(formatRupiah(5000)).toContain("5.000");
  });
});

// ─── validateWA ───────────────────────────────────────────────────────────────

describe("validateWA", () => {
  it("accepts valid Indonesian mobile number", () => {
    expect(validateWA("08123456789")).toBe(true);
    expect(validateWA("+6281234567890")).toBe(true);
  });

  it("rejects too-short numbers", () => {
    expect(validateWA("0812")).toBe(false);
  });

  it("rejects too-long numbers", () => {
    expect(validateWA("08123456789012345")).toBe(false);
  });

  it("strips non-digit chars before checking length", () => {
    expect(validateWA("0812-345-6789")).toBe(true);
  });
});

// ─── emptyPortion ─────────────────────────────────────────────────────────────

describe("emptyPortion", () => {
  it("creates empty options for signature-putih (no options)", () => {
    const p = emptyPortion("signature-putih");
    expect(p.notes).toBe("");
    expect(p.options).toEqual({});
  });

  it("creates empty options for sop-tulang-putih-andaliman (no options)", () => {
    const p = emptyPortion("sop-tulang-putih-andaliman");
    expect(p.options).toEqual({});
    expect(p.notes).toBe("");
  });

  it("creates empty options object for à la carte items (no options)", () => {
    const p = emptyPortion("alc-babi-andaliman");
    expect(p.options).toEqual({});
    expect(p.notes).toBe("");
  });

  it("creates empty options object for alc-nasi-putih (no options)", () => {
    const p = emptyPortion("alc-nasi-putih");
    expect(p.options).toEqual({});
  });

  it("throws for unknown menu id", () => {
    expect(() => emptyPortion("tidak-ada")).toThrow("Unknown menu id");
  });
});

// ─── calculateTotal ───────────────────────────────────────────────────────────

describe("calculateTotal", () => {
  it("returns 0 when nothing ordered", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    expect(calculateTotal(orders, alcOrders)).toBe(0);
  });

  it("calculates paket-only total + ONGKIR", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["signature-putih"] = {
      qty: 2,
      sameForAll: true,
      portions: [emptyPortion("signature-putih"), emptyPortion("signature-putih")],
    };
    // 2 × 40000 + ONGKIR
    expect(calculateTotal(orders, alcOrders)).toBe(2 * 40000 + ONGKIR);
  });

  it("calculates à la carte-only total + ONGKIR", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    alcOrders["alc-babi-andaliman"] = {
      qty: 1,
      sameForAll: true,
      portions: [emptyPortion("alc-babi-andaliman")],
    };
    expect(calculateTotal(orders, alcOrders)).toBe(35000 + ONGKIR);
  });

  it("calculates mixed paket + à la carte total + ONGKIR", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    alcOrders["alc-nasi-putih"] = { qty: 2, sameForAll: true, portions: [emptyPortion("alc-nasi-putih"), emptyPortion("alc-nasi-putih")] };
    // 40000 + 2×5000 + ONGKIR = 55000
    expect(calculateTotal(orders, alcOrders)).toBe(40000 + 2 * 5000 + ONGKIR);
  });
});

// ─── isOrderComplete ──────────────────────────────────────────────────────────

describe("isOrderComplete", () => {
  it("returns true for paket item with no options (always complete)", () => {
    const menu = MENUS.find((m) => m.id === "signature-putih")!;
    const ord: MenuOrder = { qty: 1, sameForAll: true, portions: [emptyPortion("signature-putih")] };
    expect(isOrderComplete(menu, ord)).toBe(true);
  });

  it("returns true for à la carte item with no options", () => {
    const menu = ALA_CARTE.find((m) => m.id === "alc-babi-andaliman")!;
    const ord: MenuOrder = { qty: 1, sameForAll: true, portions: [emptyPortion("alc-babi-andaliman")] };
    expect(isOrderComplete(menu, ord)).toBe(true);
  });

  it("returns true for sop tulang variant (no options)", () => {
    const menu = MENUS.find((m) => m.id === "sop-tulang-kecombrang-bawang-cuka")!;
    const ord: MenuOrder = { qty: 2, sameForAll: true, portions: [emptyPortion("sop-tulang-kecombrang-bawang-cuka"), emptyPortion("sop-tulang-kecombrang-bawang-cuka")] };
    expect(isOrderComplete(menu, ord)).toBe(true);
  });
});

// ─── buildOrderItems ──────────────────────────────────────────────────────────

describe("buildOrderItems", () => {
  it("returns empty array when nothing ordered", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    expect(buildOrderItems(orders, alcOrders)).toHaveLength(0);
  });

  it("includes paket items", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    const items = buildOrderItems(orders, alcOrders);
    expect(items).toHaveLength(1);
    expect(items[0].menu_id).toBe("classic-putih");
    expect(items[0].subtotal).toBe(40000);
  });

  it("includes à la carte items", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    alcOrders["alc-babi-andaliman"] = { qty: 2, sameForAll: true, portions: [emptyPortion("alc-babi-andaliman"), emptyPortion("alc-babi-andaliman")] };
    const items = buildOrderItems(orders, alcOrders);
    expect(items).toHaveLength(1);
    expect(items[0].menu_id).toBe("alc-babi-andaliman");
    expect(items[0].subtotal).toBe(70000); // 2 × 35000
  });

  it("includes mixed items in order (paket first, then à la carte)", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["sop-tulang-putih-andaliman"] = { qty: 1, sameForAll: true, portions: [emptyPortion("sop-tulang-putih-andaliman")] };
    alcOrders["alc-sambel-andaliman"] = { qty: 1, sameForAll: true, portions: [emptyPortion("alc-sambel-andaliman")] };
    const items = buildOrderItems(orders, alcOrders);
    expect(items).toHaveLength(2);
    expect(items[0].menu_id).toBe("sop-tulang-putih-andaliman");
    expect(items[1].menu_id).toBe("alc-sambel-andaliman");
  });
});

// ─── isFormComplete ───────────────────────────────────────────────────────────

const validForm: FormData = {
  name: "Budi",
  nomor_wa: "08123456789",
  alamat: "Jl. Sudirman 1",
  jam_antar: "11.00 - 13.00 (Siang)",
  notes: "",
};

describe("isFormComplete", () => {
  it("returns false when no items ordered", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    expect(isFormComplete(validForm, orders, alcOrders, "cash", null)).toBe(false);
  });

  it("returns false when name is empty", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    expect(isFormComplete({ ...validForm, name: "" }, orders, alcOrders, "cash", null)).toBe(false);
  });

  it("returns false when WA number is invalid", () => {
    const orders = makeDefaultOrders(MENUS);
    orders["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    expect(isFormComplete({ ...validForm, nomor_wa: "123" }, orders, alcOrders, "cash", null)).toBe(false);
  });

  it("returns true for valid paket order with cash", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    expect(isFormComplete(validForm, orders, alcOrders, "cash", null)).toBe(true);
  });

  it("returns true for à la carte-only order (no paket)", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    alcOrders["alc-babi-andaliman"] = { qty: 1, sameForAll: true, portions: [emptyPortion("alc-babi-andaliman")] };
    expect(isFormComplete(validForm, orders, alcOrders, "cash", null)).toBe(true);
  });

  it("returns false when transfer selected but no proof file", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    expect(isFormComplete(validForm, orders, alcOrders, "transfer_mandiri", null)).toBe(false);
  });

  it("returns true when transfer + proof file provided", () => {
    const orders = makeDefaultOrders(MENUS);
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    orders["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    const fakeFile = new File(["x"], "bukti.jpg", { type: "image/jpeg" });
    expect(isFormComplete(validForm, orders, alcOrders, "transfer_mandiri", fakeFile)).toBe(true);
  });
});

// ─── buildWAMessage ───────────────────────────────────────────────────────────

describe("buildWAMessage", () => {
  const baseOrders = () => {
    const o = makeDefaultOrders(MENUS);
    o["classic-putih"] = { qty: 1, sameForAll: true, portions: [emptyPortion("classic-putih")] };
    return o;
  };

  it("includes greeting with customer name", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "cash",
    });
    expect(msg).toContain("Halo Budi");
    expect(msg).toContain("sudah kami terima");
  });

  it("includes customer info", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "cash",
    });
    expect(msg).toContain("Budi");
    expect(msg).toContain("08123456789");
    expect(msg).toContain("Jl. Sudirman 1");
  });

  it("includes paket item details", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "cash",
    });
    expect(msg).toContain("Classic Roast (Nasi Putih)");
    expect(msg).toContain("Menu Paket");
  });

  it("includes ongkir line", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "cash",
    });
    expect(msg).toContain("Ongkos Kirim");
  });

  it("includes à la carte section when ordered", () => {
    const alcOrders = makeDefaultOrders(ALA_CARTE);
    alcOrders["alc-babi-andaliman"] = { qty: 2, sameForAll: true, portions: [emptyPortion("alc-babi-andaliman"), emptyPortion("alc-babi-andaliman")] };
    const msg = buildWAMessage({
      form: validForm,
      orders: makeDefaultOrders(MENUS),
      alcOrders,
      total: 75000,
      paymentMethod: "cash",
    });
    expect(msg).toContain("À La Carte");
    expect(msg).toContain("Babi Panggang Merah (Sambel Andaliman)");
    expect(msg).toContain("2x");
  });

  it("does NOT include À La Carte section when none ordered", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "cash",
    });
    expect(msg).not.toContain("À La Carte");
  });

  it("shows cash payment info", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "cash",
    });
    expect(msg).toContain("Tunai");
    expect(msg).not.toContain("Mandiri");
    expect(msg).not.toContain("BCA");
  });

  it("shows Mandiri transfer info", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "transfer_mandiri",
    });
    expect(msg).toContain("Mandiri");
    expect(msg).toContain("1090021894001");
  });

  it("includes proof URL when provided", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 45000,
      paymentMethod: "transfer_bca",
      proofUrl: "https://storage.example.com/bukti.jpg",
    });
    expect(msg).toContain("https://storage.example.com/bukti.jpg");
  });

  it("includes total in message", () => {
    const msg = buildWAMessage({
      form: validForm,
      orders: baseOrders(),
      alcOrders: makeDefaultOrders(ALA_CARTE),
      total: 75000,
      paymentMethod: "cash",
    });
    expect(msg).toContain("75.000");
  });
});
