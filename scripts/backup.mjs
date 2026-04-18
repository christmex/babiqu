/**
 * Babiqu — Database & Storage Backup
 *
 * Exports:
 *   - orders, batches, expenses → JSON files
 *   - payment-proofs bucket    → downloaded image files
 *
 * Output folder: backup/YYYY-MM-DD_HH-mm/
 *
 * Usage: node scripts/backup.mjs
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";

// ─── Read .env.local ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

if (!fs.existsSync(envPath)) {
  console.error("❌  .env.local not found at", envPath);
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ts = timestamp();
  const outDir = path.join(__dirname, "..", "backup", ts);
  const imagesDir = path.join(outDir, "payment-proofs");
  fs.mkdirSync(imagesDir, { recursive: true });

  console.log(`\n📦  Babiqu Backup — ${ts}`);
  console.log(`📁  Output: backup/${ts}/\n`);

  // ── Tables ──────────────────────────────────────────────────────────────────

  const tables = ["orders", "batches", "expenses"];
  const summary = {};

  for (const table of tables) {
    process.stdout.write(`  ⬇  Fetching ${table}... `);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .limit(10000);

    if (error) {
      console.log(`❌  ${error.message}`);
      continue;
    }

    writeJson(path.join(outDir, `${table}.json`), data);
    summary[table] = data.length;
    console.log(`✓  ${data.length} rows`);
  }

  // ── Storage ─────────────────────────────────────────────────────────────────

  process.stdout.write(`  ⬇  Listing payment-proofs bucket... `);
  const { data: files, error: listErr } = await supabase.storage
    .from("payment-proofs")
    .list("", { limit: 1000, offset: 0 });

  if (listErr) {
    console.log(`❌  ${listErr.message}`);
  } else {
    console.log(`✓  ${files.length} files`);

    let downloaded = 0;
    let failed = 0;

    for (const file of files) {
      if (!file.name) continue;
      const { data: urlData } = supabase.storage
        .from("payment-proofs")
        .getPublicUrl(file.name);

      const destPath = path.join(imagesDir, file.name);
      try {
        await downloadFile(urlData.publicUrl, destPath);
        downloaded++;
        process.stdout.write(`\r  ⬇  Downloading images... ${downloaded}/${files.length}`);
      } catch {
        failed++;
      }
    }

    console.log(`\n  ✓  Downloaded: ${downloaded}  |  Failed: ${failed}`);
    summary["payment-proofs"] = `${downloaded} images`;
  }

  // ── Manifest ─────────────────────────────────────────────────────────────────

  const manifest = {
    backup_at: new Date().toISOString(),
    supabase_url: SUPABASE_URL,
    summary,
  };
  writeJson(path.join(outDir, "manifest.json"), manifest);

  // ── Done ──────────────────────────────────────────────────────────────────────

  console.log("\n✅  Backup selesai!");
  console.log(`\n   📊  Summary:`);
  for (const [k, v] of Object.entries(summary)) {
    console.log(`      ${k}: ${v}`);
  }
  console.log(`\n   📁  Tersimpan di: backup/${ts}/\n`);
}

main().catch((err) => {
  console.error("\n❌  Backup gagal:", err.message);
  process.exit(1);
});
