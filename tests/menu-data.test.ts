import { describe, it, expect } from "vitest";
import { MENUS, ALA_CARTE } from "@/lib/order-utils";

// ─── MENUS integrity ──────────────────────────────────────────────────────────

describe("MENUS", () => {
  it("has 12 items", () => {
    expect(MENUS).toHaveLength(12);
  });

  it("each menu has required fields", () => {
    for (const m of MENUS) {
      expect(m.id, `${m.id} missing id`).toBeTruthy();
      expect(m.name, `${m.id} missing name`).toBeTruthy();
      expect(m.price, `${m.id} price must be > 0`).toBeGreaterThan(0);
      expect(m.includes.length, `${m.id} must have at least one include`).toBeGreaterThan(0);
      expect(Array.isArray(m.options)).toBe(true);
    }
  });

  it("all paket items have no options (options: [])", () => {
    for (const m of MENUS) {
      expect(m.options, `${m.id} should have no options`).toHaveLength(0);
    }
  });

  it("all ids are unique", () => {
    const ids = MENUS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains all original 8 menu variants", () => {
    const ids = MENUS.map((m) => m.id);
    expect(ids).toContain("signature-putih");
    expect(ids).toContain("signature-kecombrang");
    expect(ids).toContain("classic-putih");
    expect(ids).toContain("classic-kecombrang");
    expect(ids).toContain("sop-tulang-putih-andaliman");
    expect(ids).toContain("sop-tulang-kecombrang-andaliman");
    expect(ids).toContain("sop-tulang-putih-bawang-cuka");
    expect(ids).toContain("sop-tulang-kecombrang-bawang-cuka");
  });

  it("contains all 4 Pork Satay Set variants", () => {
    const ids = MENUS.map((m) => m.id);
    expect(ids).toContain("pork-satay-putih-bawang-cuka");
    expect(ids).toContain("pork-satay-kecombrang-bawang-cuka");
    expect(ids).toContain("pork-satay-putih-andaliman");
    expect(ids).toContain("pork-satay-kecombrang-andaliman");
  });

  it("paket prices match spec", () => {
    const prices: Record<string, number> = {
      "signature-putih":                    40000,
      "signature-kecombrang":               40000,
      "classic-putih":                      40000,
      "classic-kecombrang":                 40000,
      "sop-tulang-putih-andaliman":         25000,
      "sop-tulang-kecombrang-andaliman":    25000,
      "sop-tulang-putih-bawang-cuka":       25000,
      "sop-tulang-kecombrang-bawang-cuka":  25000,
      "pork-satay-putih-bawang-cuka":       40000,
      "pork-satay-kecombrang-bawang-cuka":  40000,
      "pork-satay-putih-andaliman":         40000,
      "pork-satay-kecombrang-andaliman":    40000,
    };
    for (const [id, price] of Object.entries(prices)) {
      const item = MENUS.find((m) => m.id === id);
      expect(item, `${id} not found`).toBeDefined();
      expect(item!.price, `${id} wrong price`).toBe(price);
    }
  });

  it("Pork Satay Set items are marked isNew", () => {
    const satayIds = [
      "pork-satay-putih-bawang-cuka",
      "pork-satay-kecombrang-bawang-cuka",
      "pork-satay-putih-andaliman",
      "pork-satay-kecombrang-andaliman",
    ];
    for (const id of satayIds) {
      const item = MENUS.find((m) => m.id === id);
      expect(item?.isNew, `${id} should be isNew`).toBe(true);
    }
  });
});

// ─── ALA_CARTE integrity ──────────────────────────────────────────────────────

describe("ALA_CARTE", () => {
  it("has 8 items", () => {
    expect(ALA_CARTE).toHaveLength(8);
  });

  it("each item has required fields", () => {
    for (const m of ALA_CARTE) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.price).toBeGreaterThan(0);
      expect(m.includes.length).toBeGreaterThan(0);
      expect(Array.isArray(m.options)).toBe(true);
    }
  });

  it("all à la carte items have no options (options: [])", () => {
    for (const m of ALA_CARTE) {
      expect(m.options, `${m.id} should have no options`).toHaveLength(0);
    }
  });

  it("no duplicate ids across MENUS + ALA_CARTE", () => {
    const allIds = [...MENUS, ...ALA_CARTE].map((m) => m.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("prices match spec", () => {
    const prices: Record<string, number> = {
      "alc-babi-andaliman":    35000,
      "alc-babi-bawang-cuka":  35000,
      "alc-nasi-putih":         5000,
      "alc-nasi-kecombrang":    8000,
      "alc-sambel-andaliman":   3000,
      "alc-sambel-bawang-cuka": 3000,
      "alc-sate-pork":          8000,
    };
    for (const [id, price] of Object.entries(prices)) {
      const item = ALA_CARTE.find((m) => m.id === id);
      expect(item, `${id} not found`).toBeDefined();
      expect(item!.price, `${id} wrong price`).toBe(price);
    }
  });

  it("alc-sate-pork is marked isNew", () => {
    const item = ALA_CARTE.find((m) => m.id === "alc-sate-pork");
    expect(item?.isNew).toBe(true);
  });
});
