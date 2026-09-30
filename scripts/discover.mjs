// Daily discovery pass. Finds graduate schemes that are not in data/schemes.json yet.
// Source 1 (no key needed): LinkedIn's public job search pages.
// Source 2 and 3 (optional, only when keys are set as repository secrets):
//   ADZUNA_APP_ID + ADZUNA_APP_KEY  (free at https://developer.adzuna.com/)
//   REED_API_KEY                    (free at https://www.reed.co.uk/developers)
// New finds are added with status "open" and status_source "listing"; the verifier and the daily Claude pass then check them.

import { readFile, writeFile } from "node:fs/promises";
import { mergeInto, findSimilar } from "./merge.mjs";

const DATA = new URL("../data/schemes.json", import.meta.url);
const META = new URL("../data/meta.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [search words, sector to file the result under when the title gives no better clue]
const QUERIES = [
  ["graduate programme 2027 investment banking", "investment-banking"],
  ["2027 full time analyst london", "investment-banking"],
  ["graduate programme 2027 markets trading", "markets-trading"],
  ["graduate scheme 2027 bank", "retail-commercial-banking"],
  ["graduate programme 2027 asset management", "asset-management"],
  ["graduate programme 2027 wealth management", "wealth-management"],
  ["graduate scheme 2027 finance", "accounting-audit-tax"],
  ["graduate 2027 audit", "accounting-audit-tax"],
  ["graduate 2027 tax", "accounting-audit-tax"],
  ["graduate consultant 2027", "management-tech-consulting"],
  ["strategy consulting graduate 2027", "strategy-consulting"],
  ["graduate economist 2027", "economics-consulting"],
  ["graduate actuarial 2027", "insurance-actuarial"],
  ["graduate scheme 2027 insurance", "insurance-actuarial"],
  ["graduate programme 2027 fintech", "fintech-payments"],
  ["graduate programme 2027 private equity", "private-equity-vc"],
  ["graduate programme 2027 start-up", "startups-venture"],
  ["graduate scheme 2027 cardiff", "accounting-audit-tax"],
  ["graduate scheme 2027 bristol finance", "accounting-audit-tax"]
];
const GRAD = /\b(graduate|grad|new analyst|analyst program(?:me)?|full[- ]time analyst|trainee|associate consultant|business analyst)\b/i;
const YEAR = /\b2027\b/;
const JUNK = /\b(intern|internship|placement|apprentice|apprenticeship|summer|spring|insight|off[- ]cycle|industrial|senior|manager|director|lecturer|teacher|nurse|phd|postdoc|recruitment consultant|software engineer|developer|mechanical|civil engineer|electrical)\b/i;
const FIN = /\b(financ\w*|bank\w*|invest\w*|consult\w*|econom\w*|audit\w*|tax\w*|actuar\w*|insur\w*|asset|wealth|trading|markets|treasury|accountan\w*|risk|fintech|payments|private equity|m&a|deals?|analyst|commercial|strategy|business|advisory|capital|pensions?|underwrit\w*|credit|ventures?)\b/i;

function guessSector(t, fallback) {
  t = t.toLowerCase();
  if (/investment bank|m&a|corporate finance|capital markets|ib analyst/.test(t)) return "investment-banking";
  if (/trading|sales and trading|markets|quant/.test(t)) return "markets-trading";
  if (/asset management|investment management|fund|portfolio/.test(t)) return "asset-management";
  if (/private equity|venture capital/.test(t)) return "private-equity-vc";
  if (/wealth|private bank/.test(t)) return "wealth-management";
  if (/econom/.test(t)) return "economics-consulting";
  if (/strategy consult/.test(t)) return "strategy-consulting";
  if (/actuar|insur|underwrit|pension/.test(t)) return "insurance-actuarial";
  if (/audit|tax|accountan|\baca\b|acca|cima|assurance/.test(t)) return "accounting-audit-tax";
  if (/consult|advisory/.test(t)) return "management-tech-consulting";
  if (/start-?up|scale-?up|founder/.test(t)) return "startups-venture";
  if (/fintech|payment/.test(t)) return "fintech-payments";
  return fallback;
}
const decode = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function linkedin() {
  const out = []; let blocked = false, pages = 0;
  for (const [q, sector] of QUERIES) {
    if (blocked) break;
    for (const start of [0, 10, 20, 30, 40]) {
      const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}&location=United%20Kingdom&start=${start}`;
      let res;
      try { res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-GB,en;q=0.9" }, signal: AbortSignal.timeout(20000) }); } catch { break; }
      if (res.status === 429 || res.status === 999 || res.status === 403) { blocked = true; break; }
      if (!res.ok) break;
      const html = await res.text(); pages++;
      const cards = html.split(/<li[ >]/).slice(1);
      for (const c of cards) {
        const title = decode((c.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
        const company = decode((c.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/) || [])[1]);
        const loc = decode((c.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
        const href = ((c.match(/base-card__full-link[^>]*href="([^"]+)"/) || [])[1] || "").replace(/&amp;/g, "&").split("?")[0];
        if (!title || !company || !href) continue;
        if (!GRAD.test(title) || !YEAR.test(title) || JUNK.test(title) || !FIN.test(title + " " + company + " " + q)) continue;
        out.push({ employer: company, programme: title, sector: guessSector(title, sector), stream: "Various", locations: [loc.split(",")[0] || "UK"], start: "2027", opens: null, deadline: null, status: "open", status_evidence: `Listed on LinkedIn, seen ${TODAY}. Employer page not checked yet.`, url: href.replace("://uk.linkedin.com", "://www.linkedin.com"), apply_url: null, degree_req: null, salary: null, notes: "", source_urls: ["https://www.linkedin.com/jobs/"], checked_at: TODAY });
      }
      if (cards.length < 10) break;
      await sleep(1500);
    }
  }
  return { out, blocked, pages };
}

async function adzuna() {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  const out = [];
  for (const [q, sector] of QUERIES) {
    for (let page = 1; page <= 2; page++) {
      const url = `https://api.adzuna.com/v1/api/jobs/gb/search/${page}?app_id=${id}&app_key=${key}&results_per_page=50&what=${encodeURIComponent(q)}&max_days_old=7&content-type=application/json`;
      const res = await fetch(url).catch(() => null); if (!res || !res.ok) break;
      const j = await res.json();
      for (const r of j.results || []) {
        const title = decode(r.title), desc = decode(r.description);
        if (!GRAD.test(title) || JUNK.test(title) || !YEAR.test(title + " " + desc) || !FIN.test(title + " " + desc)) continue;
        out.push({ employer: r.company?.display_name || "Unknown employer", programme: title, sector: guessSector(title + " " + desc, sector), stream: "Various", locations: [r.location?.area?.slice(-1)[0] || "UK"], start: "2027", opens: null, deadline: null, status: "open", status_evidence: `Listed on Adzuna, seen ${TODAY}. Employer page not checked yet.`, url: r.redirect_url, apply_url: null, degree_req: null, salary: r.salary_min ? `£${Math.round(r.salary_min).toLocaleString("en-GB")}` : null, notes: desc.slice(0, 220), source_urls: ["https://www.adzuna.co.uk/"], checked_at: TODAY });
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
  for (const [q, sector] of QUERIES) {
    const url = `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(q)}&graduate=true&postedByRecruitmentAgency=false&resultsToTake=100`;
    const res = await fetch(url, { headers: { authorization: auth } }).catch(() => null); if (!res || !res.ok) continue;
    const j = await res.json();
    for (const r of j.results || []) {
      const title = r.jobTitle || "", desc = decode(r.jobDescription);
      if (!GRAD.test(title) || JUNK.test(title) || !YEAR.test(title + " " + desc) || !FIN.test(title + " " + desc)) continue;
      out.push({ employer: r.employerName || "Unknown employer", programme: title, sector: guessSector(title + " " + desc, sector), stream: "Various", locations: [r.locationName || "UK"], start: "2027", opens: null, deadline: r.expirationDate ? r.expirationDate.split("/").reverse().join("-") : null, status: "open", status_evidence: `Listed on Reed, seen ${TODAY}. Employer page not checked yet.`, url: r.jobUrl, apply_url: null, degree_req: null, salary: r.minimumSalary ? `£${Math.round(r.minimumSalary).toLocaleString("en-GB")}` : null, notes: desc.slice(0, 220), source_urls: ["https://www.reed.co.uk/"], checked_at: TODAY });
    }
  }
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const li = await linkedin();
  const found = [...li.out, ...(await adzuna()), ...(await reed())];
  const existing = JSON.parse(await readFile(DATA, "utf8"));
  // Keep only listings we do not already have under a similar name; one per employer + programme.
  const fresh = []; const seen = new Set();
  for (const r of found) {
    const k = (r.employer + "|" + r.programme).toLowerCase();
    if (seen.has(k) || existing.some((e) => e.url === r.url) || findSimilar(existing, r) || findSimilar(fresh, r, 0.7)) continue;
    seen.add(k); fresh.push(r);
  }
  console.log(`Discovery: LinkedIn pages read ${li.pages}${li.blocked ? " (then blocked)" : ""}, ${found.length} matching listings, ${fresh.length} not yet listed.`);
  for (const r of fresh) console.log(`  + ${r.employer} | ${r.programme} [${r.sector}]`);
  if (dry) return;
  const res = fresh.length ? mergeInto(existing, fresh) : { added: 0, updated: 0, skipped: 0 };
  const urls = new Set(fresh.map((f) => f.url));
  for (const e of existing) if (urls.has(e.url) && e.added_at === TODAY) e.status_source = "listing";
  existing.sort((a, b) => a.employer.localeCompare(b.employer) || a.programme.localeCompare(b.programme));
  await writeFile(DATA, JSON.stringify(existing, null, 2) + "\n");
  let meta = {}; try { meta = JSON.parse(await readFile(META, "utf8")); } catch {}
  meta.last_discover = { date: TODAY, sources: { linkedin: li.blocked ? "blocked" : true, adzuna: !!process.env.ADZUNA_APP_ID, reed: !!process.env.REED_API_KEY }, candidates: found.length, ...res };
  await writeFile(META, JSON.stringify(meta, null, 2) + "\n");
}
main().catch((e) => { console.error(e); process.exit(0); });
