// Daily verifier: opens every scheme's employer page and works out whether applications are still open.
// No dependencies. Run with: node scripts/verify.mjs
// Writes data/schemes.json (updated statuses) and data/meta.json (run summary).

import { readFile, writeFile } from "node:fs/promises";

const DATA = new URL("../data/schemes.json", import.meta.url);
const META = new URL("../data/meta.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 GraduateSchemeRadar/1.0";
const CONCURRENCY = 6;
const TIMEOUT_MS = 25000;

const CLOSED = [
  /applications?\s+(?:are|is|have|has)?\s*(?:now\s+)?closed/i,
  /no longer accepting applications/i,
  /not currently accepting applications/i,
  /(?:this|the) (?:programme|program|role|position|vacancy|opportunity|job) (?:is|has) (?:now )?(?:closed|expired|been filled|no longer available|been removed)/i,
  /job (?:is )?no longer available/i,
  /this job has expired/i,
  /(?:vacancy|advert|posting) has (?:now )?(?:closed|expired)/i,
  /applications for (?:the )?20\d\d (?:intake |programme |program |cohort )?(?:are|have|is|has) (?:now )?closed/i,
  /closed for 20\d\d/i,
  /deadline has (?:now )?passed/i,
  /registration (?:is|has) (?:now )?closed/i,
  /check back (?:in|next|later)/i,
  /recruitment for this programme has (?:now )?ended/i,
  /we are not currently recruiting/i,
  /page not found|404 not found|this page doesn.?t exist|page you requested could not be found/i
];
const OPEN_STRONG = [
  /apply now/i, /applications? (?:are|is) (?:now )?open/i, /applications open/i, /apply today/i, /start your application/i,
  /submit your application/i, /apply here/i, /begin (?:your )?application/i, /open for applications/i, /now accepting applications/i
];
const OPEN_WEAK = [/applications? close(?:s|d)? (?:on )?d/i, /closing date/i, /application deadline/i, /register your interest/i];
const OPEN = [...OPEN_STRONG, ...OPEN_WEAK];
const GRAD_2027 = (t) => /graduate|analyst program|new analyst|full[- ]time program/i.test(t) && /2027/.test(t);
const HAND_DAYS = 10;
function handProtected(r) {
  if (r.status_source !== "hand" || r.status === "unknown" || !r.checked_at) return false;
  return (Date.now() - new Date(r.checked_at)) / 86400000 <= HAND_DAYS;
}
const NOT_YET = [
  /applications? (?:will )?open(?:s|ing)? (?:in|on|from) /i, /opening soon/i, /coming soon/i, /register (?:your )?interest/i, /not yet open/i
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-GB,en;q=0.9" }, redirect: "follow", signal: ctrl.signal });
    const html = await res.text();
    return { status: res.status, url: res.url, html };
  } finally { clearTimeout(t); }
}

function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function findFirst(patterns, text) {
  for (const p of patterns) { const m = text.match(p); if (m) return m[0]; }
  return null;
}

function snippet(text, phrase) {
  const i = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) return phrase;
  return text.slice(Math.max(0, i - 60), Math.min(text.length, i + phrase.length + 60)).trim();
}

function deadlinePassed(deadline) {
  return deadline && /^\d{4}-\d{2}-\d{2}/.test(deadline) && deadline.slice(0, 10) < TODAY;
}

export async function verifyOne(r) {
  const out = { ...r, checked_at: TODAY };
  const prev = r.status;
  const url = r.apply_url && /^https?:/.test(r.apply_url) ? r.apply_url : r.url;
  out.verify = { ...(r.verify || {}), last_attempt: TODAY };

  if (deadlinePassed(r.deadline) && r.status !== "closed") {
    out.status = "closed"; out.status_source = "deadline";
    out.status_evidence = `Deadline ${r.deadline} has passed.`;
    out.verify.failures = 0;
    return out;
  }

  let res;
  try { res = await fetchText(url); }
  catch (e) {
    out.verify.failures = (r.verify?.failures || 0) + 1;
    out.verify.last_error = String(e.message || e).slice(0, 120);
    // A network blip never flips a status; three consecutive failures downgrades an "open" to "unknown".
    if (out.verify.failures >= 3 && r.status === "open") { out.status = "unknown"; out.status_source = "unreachable"; out.status_evidence = `Employer page could not be reached for ${out.verify.failures} days in a row.`; }
    return out;
  }
  out.verify.http = res.status; out.verify.failures = 0; delete out.verify.last_error;

  if (res.status === 404 || res.status === 410) {
    // A recently hand-checked scheme needs the page to be gone two days running before it is closed (some sites send 404 to scripts).
    out.verify.gone = (r.verify?.gone || 0) + 1;
    if (!handProtected(r) || out.verify.gone >= 2 || r.status !== "open") {
      out.status = "closed"; out.status_source = "http";
      out.status_evidence = `Employer page returns ${res.status} (removed).`;
    } else out.verify.note = `HTTP ${res.status} once; will close if still gone tomorrow`;
    return out;
  }
  out.verify.gone = 0;
  if (res.status >= 400) {
    // 403/429/5xx: bot-blocking or outage. Keep the previous status, flag it.
    out.verify.note = `HTTP ${res.status}`;
    if (r.status === "open" && (r.verify?.http_failures || 0) + 1 >= 3) { out.status = "unknown"; out.status_source = "blocked"; out.status_evidence = `Employer page returns HTTP ${res.status}; cannot verify automatically.`; }
    out.verify.http_failures = (r.verify?.http_failures || 0) + 1;
    return out;
  }
  out.verify.http_failures = 0;

  const text = toText(res.html);
  out.verify.chars = text.length;
  if (text.length < 400) {
    // JavaScript-rendered page: nothing to read. Keep status, mark unverifiable.
    out.verify.note = "js-rendered";
    return out;
  }

  const closedHit = findFirst(CLOSED, text);
  const openHit = findFirst(OPEN, text);
  const notYetHit = findFirst(NOT_YET, text);

  if (closedHit && !openHit && (!handProtected(r) || r.status !== "closed" && CLOSED.slice(0, 12).some((p) => p.test(closedHit)))) {
    out.status = "closed"; out.status_source = "auto";
    out.status_evidence = `Employer page says: "${snippet(text, closedHit)}"`;
  } else if (closedHit && openHit) {
    // Both signals: usually a hub page listing several programmes. Never flip on ambiguous text; just flag it.
    out.verify.note = `ambiguous closed:"${closedHit}" open:"${openHit}"`;
  } else if (openHit) {
    const strong = findFirst(OPEN_STRONG, text);
    if (r.status !== "open" && strong && GRAD_2027(text) && !handProtected(r)) {
      out.status = "open"; out.status_source = "auto";
      out.status_evidence = `Employer page says: "${snippet(text, strong)}"`;
    } else if (r.status === "open") {
      out.status_source = r.status_source === "hand" ? "hand" : "auto";
    } else {
      out.verify.note = `open wording ("${openHit}") but ${!strong ? "weak" : !GRAD_2027(text) ? "no 2027 graduate mention" : "hand-checked recently"}; status kept`;
    }
  } else if (notYetHit) {
    if (r.status !== "open" && r.status !== "opens-soon" && !handProtected(r)) { out.status = "opens-soon"; out.status_source = "auto"; out.status_evidence = `Employer page says: "${snippet(text, notYetHit)}"`; }
  } else {
    out.verify.note = "no open/closed wording found";
  }
  if (out.status !== prev) out.status_changed_at = TODAY;
  return out;
}

async function pool(items, n, fn) {
  const results = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { results[k] = await fn(items[k], k); } catch (e) { results[k] = { ...items[k], verify: { ...(items[k].verify || {}), last_error: String(e).slice(0, 120) } }; } await sleep(150); }
  }));
  return results;
}

async function main() {
  const schemes = JSON.parse(await readFile(DATA, "utf8"));
  console.log(`Verifying ${schemes.length} schemes…`);
  const started = Date.now();
  const updated = await pool(schemes, CONCURRENCY, async (r, k) => {
    const v = await verifyOne(r);
    if (v.status !== r.status) console.log(`  ${r.employer} — ${r.programme}: ${r.status} -> ${v.status} (${v.status_source})`);
    if ((k + 1) % 25 === 0) console.log(`  …${k + 1}/${schemes.length}`);
    return v;
  });
  const counts = updated.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
  const changed = updated.filter((r, i) => r.status !== schemes[i].status).length;
  await writeFile(DATA, JSON.stringify(updated, null, 2) + "\n");
  let meta = {};
  try { meta = JSON.parse(await readFile(META, "utf8")); } catch {}
  meta = { ...meta, last_run: new Date().toISOString(), last_verify: { date: TODAY, total: updated.length, changed, counts, seconds: Math.round((Date.now() - started) / 1000) } };
  await writeFile(META, JSON.stringify(meta, null, 2) + "\n");
  console.log(`Done in ${meta.last_verify.seconds}s. ${changed} status changes. Counts:`, counts);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) main().catch((e) => { console.error(e); process.exit(1); });
