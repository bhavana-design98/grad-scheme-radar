// Merge new research files into data/schemes.json without duplicating entries.
// Usage: node scripts/merge.mjs file1.json [file2.json ...]
// Each input is a JSON array in the research schema. Existing entries keep their id, added_at and any
// verified status; new entries get an id and added_at = today.

import { readFile, writeFile } from "node:fs/promises";

const DATA = new URL("../data/schemes.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const STATUSES = new Set(["open", "closed", "opens-soon", "unknown"]);

export function slug(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }
const CITY = /\b(london|glasgow|edinburgh|manchester|birmingham|leeds|bristol|cardiff|dublin|belfast|newcastle|nottingham|reading|chester|bournemouth|sheffield|liverpool|milton keynes|multiple|nationwide|various|september|sept|autumn|intake|full time|fulltime)\b/g;
export function norm(s) { return String(s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\b(the|ltd|plc|llp|uk|limited|group|20\d\d|programme|program|scheme|graduate|and|&)\b/g, " ").replace(CITY, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
function normUrl(u) { try { const x = new URL(u); x.hash = ""; x.search = ""; return (x.host + x.pathname).replace(/\/$/, "").toLowerCase(); } catch { return String(u || "").toLowerCase(); } }

export function clean(r) {
  const out = {
    employer: String(r.employer || "").trim(),
    programme: String(r.programme || "").trim(),
    sector: String(r.sector || "").trim(),
    stream: r.stream ? String(r.stream).trim() : "Various",
    locations: Array.isArray(r.locations) ? r.locations.map((l) => String(l).trim()).filter(Boolean) : (r.locations ? [String(r.locations)] : []),
    start: r.start ? String(r.start) : "2027",
    opens: r.opens || null,
    deadline: r.deadline || null,
    status: STATUSES.has(r.status) ? r.status : "unknown",
    status_evidence: r.status_evidence || "",
    url: String(r.url || "").trim(),
    apply_url: r.apply_url && r.apply_url !== r.url ? String(r.apply_url).trim() : null,
    degree_req: r.degree_req || null,
    salary: r.salary || null,
    notes: r.notes || "",
    source_urls: Array.isArray(r.source_urls) ? r.source_urls : [],
    checked_at: r.checked_at || TODAY,
    status_source: r.status_evidence ? "hand" : "unverified"
  };
  if (out.deadline && /^\d{4}-\d{2}-\d{2}/.test(out.deadline) && out.deadline.slice(0, 10) < TODAY && out.status === "open") out.status = "closed";
  return out;
}

function isJunk(r) {
  const t = `${r.programme} ${r.notes}`.toLowerCase();
  if (!r.employer || !r.url || !/^https?:\/\//.test(r.url)) return true;
  if (/\b(internship|intern\b|summer analyst|spring week|spring insight|insight (day|week|programme)|placement year|industrial placement|apprenticeship|school leaver|off-cycle)\b/.test(r.programme.toLowerCase()) && !/graduate/.test(r.programme.toLowerCase())) return true;
  return false;
}

export function mergeInto(existing, incoming) {
  // URL matching only counts when the URL is unique to one programme; hub pages shared by several programmes never match.
  const byKey = new Map(); const byUrl = new Map();
  const noteUrl = (u, e) => { const k = normUrl(u); if (!k) return; byUrl.set(k, byUrl.has(k) && byUrl.get(k) !== e ? "SHARED" : e); };
  for (const e of existing) { byKey.set(`${norm(e.employer)}|${norm(e.programme)}`, e); noteUrl(e.url, e); if (e.apply_url) noteUrl(e.apply_url, e); }
  let added = 0, updated = 0, skipped = 0;
  for (const raw of incoming) {
    const r = clean(raw);
    if (isJunk(r)) { skipped++; continue; }
    const key = `${norm(r.employer)}|${norm(r.programme)}`;
    const urlHit = byUrl.get(normUrl(r.apply_url || r.url));
    // A URL match only counts as the same programme when employer and programme name agree (so shared apply portals never collapse different streams).
    const hit = byKey.get(key) || (urlHit && urlHit !== "SHARED" && norm(urlHit.employer) === norm(r.employer) && norm(urlHit.programme) === norm(r.programme) ? urlHit : null);
    if (hit) {
      // Fill gaps, take a newer deadline/status if the research is more recent than the last verification.
      for (const f of ["deadline", "opens", "degree_req", "salary", "apply_url"]) if (!hit[f] && r[f]) hit[f] = r[f];
      if (!hit.notes && r.notes) hit.notes = r.notes;
      if ((r.checked_at || "") >= (hit.checked_at || "") && hit.status_source !== "hand") { hit.status = r.status; hit.status_evidence = r.status_evidence || hit.status_evidence; hit.checked_at = r.checked_at; }
      hit.source_urls = [...new Set([...(hit.source_urls || []), ...r.source_urls])].slice(0, 6);
      updated++;
    } else {
      let id = `${slug(r.employer)}--${slug(r.programme)}`; let n = 2; const ids = new Set(existing.map((e) => e.id));
      while (ids.has(id)) id = `${slug(r.employer)}--${slug(r.programme)}-${n++}`;
      const e = { id, ...r, added_at: TODAY };
      existing.push(e); byKey.set(key, e); noteUrl(e.url, e); if (e.apply_url) noteUrl(e.apply_url, e); added++;
    }
  }
  return { added, updated, skipped };
}

async function main() {
  const files = process.argv.slice(2);
  let existing = [];
  try { existing = JSON.parse(await readFile(DATA, "utf8")); } catch {}
  let totals = { added: 0, updated: 0, skipped: 0 };
  for (const f of files) {
    let arr;
    try { const txt = await readFile(f, "utf8"); const j = JSON.parse(txt.replace(/^﻿/, "")); arr = Array.isArray(j) ? j : j.schemes || j.entries || []; }
    catch (e) { console.error(`Skipping ${f}: ${e.message}`); continue; }
    const r = mergeInto(existing, arr);
    console.log(`${f}: +${r.added} added, ${r.updated} merged, ${r.skipped} skipped`);
    totals = { added: totals.added + r.added, updated: totals.updated + r.updated, skipped: totals.skipped + r.skipped };
  }
  existing.sort((a, b) => a.employer.localeCompare(b.employer) || a.programme.localeCompare(b.programme));
  await writeFile(DATA, JSON.stringify(existing, null, 2) + "\n");
  console.log(`Total ${existing.length} schemes.`, totals);
}

if (process.argv[1] && /merge\.mjs$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });

// Fuzzy lookup used by discovery: is there already a record for this employer with a similar programme name?
const toks = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
function jaccard(a, b) { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }
const empKey = (e) => norm(e).replace(/^j p /, "jp ").replace(/^jpmorganchase/, "jp").replace(/^jpmorgan/, "jp").split(" ")[0];
export function findSimilar(existing, r, threshold = 0.5) {
  let best = null, score = 0;
  for (const e of existing) {
    if (empKey(e.employer) !== empKey(r.employer)) continue;
    const s = Math.max(jaccard(e.programme, r.programme), jaccard(e.programme + " " + (e.stream || ""), r.programme));
    if (s > score) { score = s; best = e; }
  }
  return score >= threshold ? best : null;
}
