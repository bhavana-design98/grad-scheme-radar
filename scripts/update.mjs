// Update one scheme by id from the command line. Used by the daily Claude routine after it reads an employer page.
// Usage: node scripts/update.mjs <id> status=open deadline=2026-11-15 opens=2026-10-01 evidence="Page says apply now" apply_url=https://... salary="£50,000" notes="..."
// Any field of the record may be set. Empty value clears it (deadline=). Always stamps checked_at=today and status_source=verified.

import { readFile, writeFile } from "node:fs/promises";
const DATA = new URL("../data/schemes.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const [id, ...pairs] = process.argv.slice(2);
if (!id || !pairs.length) { console.error("usage: node scripts/update.mjs <id> field=value ..."); process.exit(1); }
const schemes = JSON.parse(await readFile(DATA, "utf8"));
const r = schemes.find((s) => s.id === id);
if (!r) { console.error(`No scheme with id ${id}`); process.exit(1); }
const alias = { evidence: "status_evidence", location: "locations" };
for (const p of pairs) {
  const i = p.indexOf("="); if (i < 0) continue;
  let k = p.slice(0, i), v = p.slice(i + 1); k = alias[k] || k;
  if (k === "locations") v = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (k === "status" && !["open", "closed", "opens-soon", "unknown"].includes(v)) { console.error(`bad status ${v}`); process.exit(1); }
  r[k] = v === "" ? null : v;
}
r.checked_at = TODAY; r.status_source = "verified"; r.verify = { ...(r.verify || {}), failures: 0, http_failures: 0, note: "checked by Claude " + TODAY };
await writeFile(DATA, JSON.stringify(schemes, null, 2) + "\n");
console.log(`${r.employer} — ${r.programme}: status=${r.status} deadline=${r.deadline} opens=${r.opens}`);
