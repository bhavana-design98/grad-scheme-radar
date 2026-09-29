// Apply a batch of hand-verified updates to data/schemes.json.
// Usage: node scripts/apply-updates.mjs updates.json
// updates.json: [{ "id": "...", "status": "open", "deadline": "2026-10-31", "opens": null, "apply_url": "...", "salary": "...", "evidence": "..." }, ...]
// Only fields present (and not undefined) are changed. Stamps checked_at and status_source=verified.

import { readFile, writeFile } from "node:fs/promises";
const DATA = new URL("../data/schemes.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const FIELDS = ["status", "deadline", "opens", "apply_url", "salary", "degree_req", "notes", "locations", "programme", "url"];
const file = process.argv[2];
if (!file) { console.error("usage: node scripts/apply-updates.mjs updates.json"); process.exit(1); }
const updates = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const schemes = JSON.parse(await readFile(DATA, "utf8"));
const byId = new Map(schemes.map((s) => [s.id, s]));
let applied = 0, changed = 0, missing = [];
for (const u of updates) {
  const r = byId.get(u.id);
  if (!r) { missing.push(u.id); continue; }
  const before = r.status;
  if (u.status && !["open", "closed", "opens-soon", "unknown"].includes(u.status)) continue;
  for (const f of FIELDS) if (u[f] !== undefined && u[f] !== null && u[f] !== "") r[f] = u[f];
  if (u.deadline === null && u.status === "closed") { /* keep old deadline for the record */ }
  if (u.evidence) r.status_evidence = u.evidence;
  if (r.deadline && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) && r.deadline < TODAY && r.status === "open") r.status = "closed";
  r.checked_at = TODAY; r.status_source = "verified";
  r.verify = { ...(r.verify || {}), failures: 0, http_failures: 0, note: "checked by hand " + TODAY };
  if (r.status !== before) { r.status_changed_at = TODAY; changed++; }
  applied++;
}
await writeFile(DATA, JSON.stringify(schemes, null, 2) + "\n");
console.log(`Applied ${applied} updates, ${changed} status changes.${missing.length ? " Missing ids: " + missing.join(", ") : ""}`);
