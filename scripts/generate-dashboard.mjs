import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, "../.env.local"), "utf-8")
    .split("\n").filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function rp(n) {
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

const { data: orders } = await sb.from("orders").select("*").order("created_at", { ascending: true });
const { data: expenses } = await sb.from("expenses").select("*");
const { data: batches } = await sb.from("batches").select("*");

const activeRaw  = orders.filter(o => o.status === "active");
const delivered  = orders.filter(o => o.status === "delivered");
const cancelled  = orders.filter(o => o.status === "cancelled");

// ── Merge logic ───────────────────────────────────────────────────────────────
// 1. Merge Calvin Phangnesia's duplicate orders (same person, same address)
// 2. Leo & Si Kawan are the same person — merged for KPI/all-orders counts,
//    but each slot still appears separately in siang/malam delivery tables.

const siKawan = activeRaw.find(o => o.name === "Si Kawan");
const leo      = activeRaw.find(o => o.name === "Leo");

// ── active: fully merged (for KPI + all-orders table) ────────────────────────
const mergedMap = new Map();
for (const o of activeRaw) {
  if (o.name === "Leo") continue; // merged into Si Kawan below

  const key = o.name === "Calvin Phangnesia" ? "Calvin Phangnesia" : o.id;
  if (mergedMap.has(key)) {
    const existing = mergedMap.get(key);
    existing.items = [...existing.items, ...o.items];
    existing.total += o.total;
    existing._merged = true;
  } else {
    mergedMap.set(key, { ...o, items: [...o.items] });
  }
}
if (leo && siKawan && mergedMap.has(siKawan.id)) {
  const sk = mergedMap.get(siKawan.id);
  sk.items = [...sk.items, ...leo.items];
  sk.total += leo.total;
  // If they ordered different slots, note both; otherwise keep original
  sk.jam_antar = sk.jam_antar !== leo.jam_antar
    ? `${sk.jam_antar} + ${leo.jam_antar}`
    : sk.jam_antar;
  sk.name = "Si Kawan (+ Leo)";
  sk._merged = true;
}
const active = Array.from(mergedMap.values());

// ── activeDelivery: for siang/malam delivery tables ──────────────────────────
// Leo renamed → "Si Kawan (+ Leo)" with Si Kawan's alamat so each slot shows up
// Calvin rows merged per slot (same address, split only if different jam_antar)
const calvinRows = activeRaw.filter(o => o.name === "Calvin Phangnesia");
const calvinSlotsAdded = new Set();
const activeDelivery = [];

for (const o of activeRaw) {
  if (o.name === "Leo") {
    // Keep in their own slot, but use Si Kawan's identity & address
    activeDelivery.push({
      ...o,
      name:   "Si Kawan (+ Leo)",
      alamat: siKawan?.alamat || o.alamat,
    });
    continue;
  }
  if (o.name === "Si Kawan") {
    activeDelivery.push({ ...o, name: "Si Kawan (+ Leo)" });
    continue;
  }
  if (o.name === "Calvin Phangnesia") {
    if (!calvinSlotsAdded.has(o.jam_antar)) {
      // Merge all Calvin rows for this slot into one delivery entry
      const sameSlot = calvinRows.filter(c => c.jam_antar === o.jam_antar);
      activeDelivery.push({
        ...sameSlot[0],
        items: sameSlot.flatMap(c => c.items),
        total: sameSlot.reduce((s, c) => s + c.total, 0),
      });
      calvinSlotsAdded.add(o.jam_antar);
    }
    continue;
  }
  activeDelivery.push(o);
}

// ── Name overrides ────────────────────────────────────────────────────────────
const NAME_OVERRIDES = {
  "Si kawan 2": "Mama Leo",
  "Si kawan 3": "Oliv",
};
function applyNameOverride(o) {
  const overridden = NAME_OVERRIDES[o.name];
  return overridden ? { ...o, name: overridden } : o;
}
const activeDeliveryFinal = activeDelivery.map(applyNameOverride);
const activeFinal = active.map(applyNameOverride);

const totalRevenue  = [...active, ...delivered].reduce((s, o) => s + o.total, 0);
const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
const profit        = totalRevenue - totalExpenses;

// Menu tally
const menuCount = {}, menuRev = {};
active.forEach(o => o.items.forEach(item => {
  menuCount[item.menu_name] = (menuCount[item.menu_name] || 0) + item.qty;
  menuRev[item.menu_name]   = (menuRev[item.menu_name]   || 0) + item.subtotal;
}));

// Nasi tally
const nasiCount = {};
active.forEach(o => o.items.forEach(item => item.portions.forEach(p => {
  Object.values(p.options).forEach(v => {
    if (v && v.toLowerCase().includes("nasi"))
      nasiCount[v] = (nasiCount[v] || 0) + 1;
  });
})));

// Sambal tally
const sambalCount = {};
active.forEach(o => o.items.forEach(item => {
  // included sambals
  if (item.menu_id === "signature-andaliman")
    sambalCount["Sambal Andaliman"] = (sambalCount["Sambal Andaliman"] || 0) + item.qty;
  if (item.menu_id === "classic-roast")
    sambalCount["Sambal Bawang Cuka"] = (sambalCount["Sambal Bawang Cuka"] || 0) + item.qty;
  // option-based
  item.portions.forEach(p => {
    ["sambal","cabe","sambel"].forEach(key => {
      const v = p.options[key];
      if (v) sambalCount[v] = (sambalCount[v] || 0) + 1;
    });
  });
}));

// Sup/kuah — Sup Sayur Asin & Kuah Biasa adalah hal yang sama
let kuahTotal = 0, sopCount = 0;
active.forEach(o => o.items.forEach(item => {
  if (["signature-andaliman","classic-roast","sayur-asin-simple","alc-babi-panggang-kuah"].includes(item.menu_id))
    kuahTotal += item.qty;
  if (item.menu_id === "alc-sop-tulang") sopCount += item.qty;
}));

const babiTotal = (menuCount["Signature Andaliman Pork Set"] || 0)
  + (menuCount["Classic Roast Pork Set"] || 0)
  + (menuCount["Babi Panggang Aja"] || 0)
  + (menuCount["Babi Panggang + Kuah + Sambel"] || 0);

// Payment (use activeFinal for display-correct names)
const pmCount = {};
activeFinal.forEach(o => { pmCount[o.payment_method] = (pmCount[o.payment_method] || 0) + 1; });
const unconfirmed = activeFinal.filter(o => o.payment_method !== "cash");

// Jam antar — use activeDeliveryFinal so Si Kawan + Leo each appear in their slot
const siang = activeDeliveryFinal.filter(o => o.jam_antar.includes("Siang"));
const malam = activeDeliveryFinal.filter(o => o.jam_antar.includes("Malam"));

// Batch info
const batch = batches?.[0];

// ── Helper: order row
function orderRow(o, i) {
  const jamIcon = o.jam_antar.includes("Siang") ? "☀️" : "🌙";
  const payIcon = o.payment_method === "cash" ? "💵 Tunai"
    : o.payment_method === "transfer_mandiri" ? "🏦 Mandiri" : "🏦 BCA";
  const items = o.items.map(it => `${it.qty}× ${it.menu_name}`).join(", ");
  const statusBadge = o.status === "delivered"
    ? `<span class="badge badge-green">Selesai</span>`
    : o.status === "cancelled"
    ? `<span class="badge badge-red">Batal</span>`
    : `<span class="badge badge-yellow">Active</span>`;
  return `
    <tr>
      <td class="num">${i + 1}</td>
      <td><strong>${o.name}</strong></td>
      <td class="small">${jamIcon} ${o.jam_antar.includes("Siang") ? "Siang" : "Malam"}</td>
      <td class="small">${payIcon}</td>
      <td class="small addr">${o.alamat}</td>
      <td class="small">${items}</td>
      <td class="right"><strong>${rp(o.total)}</strong></td>
      <td>${statusBadge}</td>
    </tr>`;
}

const now = new Intl.DateTimeFormat("id-ID", {
  day: "numeric", month: "long", year: "numeric",
  hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
}).format(new Date());

const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Babiqu — Dashboard Batch ${batch?.label || "1"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, serif; background: #fdf8f2; color: #1c1208; font-size: 14px; }
  h1 { font-size: 28px; font-weight: bold; letter-spacing: 0.05em; }
  h2 { font-size: 13px; font-weight: bold; letter-spacing: 0.2em; text-transform: uppercase; color: #7b1d1d; margin-bottom: 14px; }
  h3 { font-size: 12px; font-weight: bold; letter-spacing: 0.15em; text-transform: uppercase; color: #5a3e2b; margin-bottom: 10px; }

  .page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 60px; }
  .header { text-align: center; margin-bottom: 36px; }
  .header p { color: #8a7060; font-size: 13px; margin-top: 6px; }
  .meta { font-size: 11px; color: #b8a898; margin-top: 4px; }

  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
  .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 28px; }

  .card { background: #fff; border: 1px solid #e8ddd0; border-radius: 16px; padding: 20px; }
  .card.red { border-color: #7b1d1d; background: #7b1d1d; color: #fff; }
  .card.red h2 { color: #f9c8c8; }
  .card.red .big { color: #fff; }
  .card.red .sub { color: #f9c8c8; }

  .big { font-size: 30px; font-weight: bold; color: #1c1208; line-height: 1.1; margin-top: 6px; }
  .big.green { color: #15803d; }
  .big.red-text { color: #b91c1c; }
  .sub { font-size: 12px; color: #8a7060; margin-top: 4px; }

  .section { margin-bottom: 32px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase;
       color: #8a7060; padding: 8px 10px; border-bottom: 2px solid #e8ddd0; }
  td { padding: 9px 10px; border-bottom: 1px solid #f0e8de; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fdf5f0; }
  td.num { color: #b8a898; width: 32px; }
  td.right { text-align: right; white-space: nowrap; }
  td.small { font-size: 12px; }
  td.addr { max-width: 200px; color: #5a3e2b; }

  .badge { display: inline-block; font-size: 10px; font-weight: bold; padding: 2px 8px;
           border-radius: 999px; letter-spacing: 0.05em; }
  .badge-yellow { background: #fef9c3; color: #854d0e; }
  .badge-green  { background: #dcfce7; color: #15803d; }
  .badge-red    { background: #fee2e2; color: #991b1b; }

  .prod-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .prod-item { display: flex; justify-content: space-between; align-items: center;
               padding: 10px 0; border-bottom: 1px solid #f0e8de; }
  .prod-item:last-child { border-bottom: none; }
  .prod-label { font-size: 13px; color: #5a3e2b; }
  .prod-val { font-size: 20px; font-weight: bold; color: #7b1d1d; }

  .divider { border: none; border-top: 1px solid #e8ddd0; margin: 28px 0; }
  .tag { display: inline-block; font-size: 11px; font-weight: bold; padding: 3px 10px;
         border-radius: 999px; margin-right: 4px; }
  .tag-siang { background: #fef9c3; color: #854d0e; }
  .tag-malam { background: #ede9fe; color: #5b21b6; }

  @media print {
    body { background: white; }
    .page { padding: 20px; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <p style="font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#7b1d1d;font-weight:bold;margin-bottom:6px">Babiqu · Signature Roast Pork</p>
    <h1>Dashboard Rekap</h1>
    <p>${batch?.label || "Batch 1"} &nbsp;·&nbsp; Pengiriman ${batch ? new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"long",year:"numeric"}).format(new Date(batch.delivery_date+"T00:00:00")) : "-"}</p>
    <p class="meta">Digenerate: ${now}</p>
  </div>

  <!-- KPI -->
  <div class="grid-4">
    <div class="card red">
      <h2>Total Pesanan</h2>
      <div class="big">${active.length}</div>
      <div class="sub">${delivered.length} selesai · ${cancelled.length} batal</div>
    </div>
    <div class="card">
      <h2>Total Pemasukan</h2>
      <div class="big">${rp(totalRevenue)}</div>
      <div class="sub">${active.length + delivered.length} order dikonfirmasi</div>
    </div>
    <div class="card">
      <h2>Pengeluaran</h2>
      <div class="big red-text">${rp(totalExpenses)}</div>
      <div class="sub">${expenses.length} item pengeluaran</div>
    </div>
    <div class="card">
      <h2>Estimasi Profit</h2>
      <div class="big green">${rp(profit)}</div>
      <div class="sub">${totalRevenue > 0 ? Math.round(profit / totalRevenue * 100) : 0}% margin</div>
    </div>
  </div>

  <!-- Jam Antar & Payment -->
  <div class="grid-3">
    <div class="card">
      <h2>Jam Antar</h2>
      <div style="display:flex;gap:20px;margin-top:8px">
        <div>
          <div class="big">${siang.length}</div>
          <div class="sub">☀️ Siang (11–13)</div>
        </div>
        <div>
          <div class="big">${malam.length}</div>
          <div class="sub">🌙 Malam (17–19)</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Metode Pembayaran</h2>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
        <div class="prod-item" style="padding:6px 0">
          <span class="prod-label">💵 Tunai</span>
          <span class="prod-val" style="font-size:18px">${pmCount["cash"] || 0} order</span>
        </div>
        <div class="prod-item" style="padding:6px 0">
          <span class="prod-label">🏦 Transfer BCA</span>
          <span class="prod-val" style="font-size:18px">${pmCount["transfer_bca"] || 0} order</span>
        </div>
        <div class="prod-item" style="padding:6px 0;border-bottom:none">
          <span class="prod-label">🏦 Transfer Mandiri</span>
          <span class="prod-val" style="font-size:18px">${pmCount["transfer_mandiri"] || 0} order</span>
        </div>
      </div>
    </div>
    <div class="card" style="border-color:${unconfirmed.length > 0 ? '#f97316':'#e8ddd0'}">
      <h2>Transfer Belum Konfirmasi</h2>
      <div class="big ${unconfirmed.length > 0 ? 'red-text' : 'green'}">${unconfirmed.length} order</div>
      <div class="sub">${rp(unconfirmed.reduce((s,o)=>s+o.total,0))} belum masuk</div>
    </div>
  </div>

  <hr class="divider" />

  <!-- Produksi -->
  <div class="section">
    <h2>🍳 Rekap Produksi</h2>
    <div class="grid-2">
      <div class="card">
        <h3>Bahan Utama</h3>
        <div class="prod-item">
          <span class="prod-label">🥩 Babi Panggang (total)</span>
          <span class="prod-val">${babiTotal} porsi</span>
        </div>
        <div class="prod-item">
          <span class="prod-label">🍲 Kuah / Sayur Asin</span>
          <span class="prod-val">${kuahTotal} porsi</span>
        </div>
        <div class="prod-item">
          <span class="prod-label">🦴 Sop Tulang</span>
          <span class="prod-val">${sopCount} porsi</span>
        </div>
      </div>
      <div class="card">
        <h3>Nasi & Sambal</h3>
        ${Object.entries(nasiCount).map(([k,v])=>`
        <div class="prod-item">
          <span class="prod-label">🍚 ${k}</span>
          <span class="prod-val">${v} porsi</span>
        </div>`).join("")}
        ${Object.entries(sambalCount).map(([k,v])=>`
        <div class="prod-item">
          <span class="prod-label">🌶️ ${k}</span>
          <span class="prod-val">${v} porsi</span>
        </div>`).join("")}
      </div>
    </div>

    <!-- Menu breakdown -->
    <div class="card" style="margin-top:14px">
      <h3>Breakdown per Menu</h3>
      <table>
        <thead><tr><th>Menu</th><th style="text-align:right">Qty</th><th style="text-align:right">Revenue</th></tr></thead>
        <tbody>
          ${Object.entries(menuCount).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
          <tr>
            <td>${k}</td>
            <td class="right">${v}×</td>
            <td class="right">${rp(menuRev[k])}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <hr class="divider" />

  <!-- Transfer unconfirmed -->
  ${unconfirmed.length > 0 ? `
  <div class="section">
    <h2>⚠️ Transfer Belum Dikonfirmasi (${unconfirmed.length} order)</h2>
    <div class="card" style="border-color:#f97316">
      <table>
        <thead><tr><th>#</th><th>Nama</th><th>Bank</th><th>No. WA</th><th class="right">Jumlah</th></tr></thead>
        <tbody>
          ${unconfirmed.map((o,i)=>`
          <tr>
            <td class="num">${i+1}</td>
            <td><strong>${o.name}</strong></td>
            <td>${o.payment_method === "transfer_mandiri" ? "🏦 Mandiri" : "🏦 BCA"}</td>
            <td class="small">${o.nomor_wa}</td>
            <td class="right"><strong>${rp(o.total)}</strong></td>
          </tr>`).join("")}
          <tr style="background:#fff8f0">
            <td colspan="4" style="text-align:right;font-weight:bold;color:#7b1d1d">TOTAL</td>
            <td class="right" style="font-weight:bold;color:#7b1d1d">${rp(unconfirmed.reduce((s,o)=>s+o.total,0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <hr class="divider" />` : ""}

  <!-- Siang orders -->
  <div class="section">
    <h2>☀️ Pengiriman Siang — ${siang.length} order</h2>
    <div class="card">
      <table>
        <thead><tr><th>#</th><th>Nama</th><th>Pembayaran</th><th>Alamat</th><th>Pesanan</th><th class="right">Total</th><th>Status</th></tr></thead>
        <tbody>${siang.map((o,i) => orderRow(o,i)).join("")}</tbody>
      </table>
    </div>
  </div>

  <!-- Malam orders -->
  <div class="section">
    <h2>🌙 Pengiriman Malam — ${malam.length} order</h2>
    <div class="card">
      <table>
        <thead><tr><th>#</th><th>Nama</th><th>Pembayaran</th><th>Alamat</th><th>Pesanan</th><th class="right">Total</th><th>Status</th></tr></thead>
        <tbody>${malam.map((o,i) => orderRow(o,i)).join("")}</tbody>
      </table>
    </div>
  </div>

  <hr class="divider" />

  <!-- All orders -->
  <div class="section">
    <h2>📋 Semua Active Orders (${activeFinal.length})</h2>
    <div class="card">
      <table>
        <thead><tr><th>#</th><th>Nama</th><th>Jam</th><th>Bayar</th><th>Alamat</th><th>Pesanan</th><th class="right">Total</th><th>Status</th></tr></thead>
        <tbody>${activeFinal.map((o,i) => orderRow(o,i)).join("")}</tbody>
        <tfoot>
          <tr style="background:#fdf5f0">
            <td colspan="6" style="text-align:right;font-weight:bold;color:#7b1d1d">TOTAL</td>
            <td class="right" style="font-weight:bold;color:#7b1d1d">${rp(activeFinal.reduce((s,o)=>s+o.total,0))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <p style="text-align:center;color:#b8a898;font-size:11px;margin-top:40px">© 2026 Babiqu · Generated ${now}</p>
</div>
</body>
</html>`;

const outPath = path.join(__dirname, "../backup/dashboard-batch1.html");
fs.writeFileSync(outPath, html, "utf-8");
console.log("✅ Dashboard saved:", outPath);
