// Optional discovery pass using public job APIs. Runs only when keys are present as environment variables.
//   ADZUNA_APP_ID + ADZUNA_APP_KEY  (free at https://developer.adzuna.com/)
//   REED_API_KEY                    (free at https://www.reed.co.uk/developers)
// Adds anything that looks like a 2027 graduate scheme in finance/consulting and is not already listed.

import { readFile, writeFile } from "node:fs/promises";
import { mergeInto } from "./merge.mjs";

const DATA = new URL("../data/schemes.json", import.meta.url);
const META = new URL("../data/meta.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);

const QUERIES = [
  "graduate scheme 2027 finance", "graduate programme 2027 banking", "graduate analyst programme 2027",
  "graduate scheme consulting 2027", "graduate scheme investment", "graduate programme audit 2027",
  "graduate economist", "graduate scheme insurance 2027", "graduate trainee accountant 2027", "graduate scheme actuarial", "startup graduate programme", "graduate scheme scale-up commercial"
];
const MUST = /\bgraduate\b/i;
const YEAR = /\b2027\b|\bsept(?:ember)? 2027\b/i;
const FIN = /\b(finance|financial|bank|banking|invest|consult|econom|audit|tax|actuar|insur|asset|wealth|trading|markets|treasury|accountan|risk|fintech|payments|private equity|m&a|deal|start-?up|scale-?up|venture|founder)/i;
const JUNK = /\b(intern|internship|placement|apprentice|summer|spring week|insight|senior|manager|experienced|lecturer|nurse|teacher|engineer(?!ing finance)|software|developer)\b/i;

function guessSector(t) {
  t = t.toLowerCase();
  if (/investment bank|m&a|corporate finance|capital markets/.test(t)) return "investment-banking";
  if (/trading|markets|quant/.test(t)) return "markets-trading";
  if (/asset management|fund|portfolio/.test(t)) return "asset-management";
  if (/private equity|venture/.test(t)) return "private-equity-vc";
  if (/wealth/.test(t)) return "wealth-management";
  if (/econom/.test(t)) return "economics-consulting";
  if (/strategy consult/.test(t)) return "strategy-consulting";
  if (/consult/.test(t)) return "management-tech-consulting";
  if (/audit|tax|accountan|acca|aca|cima/.test(t)) return "accounting-audit-tax";
  if (/actuar|insur|underwrit/.test(t)) return "insurance-actuarial";
  if (/start-?up|scale-?up|venture|founder/.test(t)) return "startups-venture";
  if (/fintech|payment/.test(t)) return "fintech-payments";
  if (/bank/.test(t)) return "retail-commercial-banking";
  return "accounting-audit-tax";
}

async function adzuna() {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  const out = [];
  for (const q of QUERIES) {
    for (let page = 1; page <= 3; page++) {
      const url = `https://api.adzuna.com/v1/api/jobs/gb/search/${page}?app_id=${id}&app_key=${key}&results_per_page=50&what=${encodeURIComponent(q)}&max_days_old=3&content-type=application/json`;
      const res = await fetch(url); if (!res.ok) break;
      const j = await res.json();
      for (const r of j.results || []) {
        const title = r.title || "", desc = r.description || "";
        if (!MUST.test(title) || JUNK.test(title) || !FIN.test(title + " " + desc)) continue;
        out.push({ employer: r.company?.display_name || "Unknown employer", programme: title.replace(/<[^>]+>/g, ""), sector: guessSector(title + " " + desc), stream: "Various", locations: [r.location?.area?.slice(-1)[0] || r.location?.display_name || "UK"], start: YEAR.test(title + desc) ? "2027" : "2027 (check)", opens: null, deadline: null, status: "open", status_evidence: `Listed on Adzuna ${TODAY} (job id ${r.id}).`, url: r.redirect_url, apply_url: null, degree_req: null, salary: r.salary_min ? `£${Math.round(r.salary_min).toLocaleString("en-GB")}` : null, notes: desc.replace(/<[^>]+>/g, "").slice(0, 220), source_urls: ["https://www.adzuna.co.uk/"], checked_at: TODAY });
      }
      if ((j.results || []).length < 50) break;
    }
  }
  return out;
}

async function reed() {
  const key = process.env.REED_API_KEY;
  if (!key) return [];
  const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
  const out = [];
  for (const q of QUERIES) {
    const url = `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(q)}&graduate=true&postedByRecruitmentAgency=false&resultsToTake=100`;
    const res = await fetch(url, { headers: { authorization: auth } }); if (!res.ok) continue;
    const j = await res.json();
    for (const r of j.results || []) {
      const title = r.jobTitle || "", desc = r.jobDescription || "";
      if (!MUST.test(title) || JUNK.test(title) || !FIN.test(title + " " + desc)) continue;
      out.push({ employer: r.employerName || "Unknown employer", programme: title, sector: guessSector(title + " " + desc), stream: "Various", locations: [r.locationName || "UK"], start: YEAR.test(title + desc) ? "2027" : "2027 (check)", opens: null, deadline: r.expirationDate ? r.expirationDate.split("/").reverse().join("-") : null, status: "open", status_evidence: `Listed on Reed ${TODAY} (job ${r.jobId}).`, url: r.jobUrl, apply_url: null, degree_req: null, salary: r.minimumSalary ? `£${Math.round(r.minimumSalary).toLocaleString("en-GB")}` : null, notes: desc.replace(/<[^>]+>/g, "").slice(0, 220), source_urls: ["https://www.reed.co.uk/"], checked_at: TODAY });
    }
  }
  return out;
}

async function main() {
  const found = [...(await adzuna()), ...(await reed())];
  const existing = JSON.parse(await readFile(DATA, "utf8"));
  const r = found.length ? mergeInto(existing, found) : { added: 0, updated: 0, skipped: 0 };
  existing.sort((a, b) => a.employer.localeCompare(b.employer) || a.programme.localeCompare(b.programme));
  await writeFile(DATA, JSON.stringify(existing, null, 2) + "\n");
  let meta = {}; try { meta = JSON.parse(await readFile(META, "utf8")); } catch {}
  meta.last_discover = { date: TODAY, sources: { adzuna: !!process.env.ADZUNA_APP_ID, reed: !!process.env.REED_API_KEY }, candidates: found.length, ...r };
  await writeFile(META, JSON.stringify(meta, null, 2) + "\n");
  console.log(`Discovery: ${found.length} candidates, +${r.added} new, ${r.updated} merged, ${r.skipped} skipped. Keys: adzuna=${!!process.env.ADZUNA_APP_ID} reed=${!!process.env.REED_API_KEY}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
