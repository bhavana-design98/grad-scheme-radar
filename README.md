# Graduate Scheme Radar

A daily-refreshed list of UK graduate schemes in banking, finance and consulting for the 2027 intake.

- `index.html` – the site (static, reads `data/schemes.json` and `data/meta.json`).
- `data/schemes.json` – every scheme we know about, with status and evidence.
- `scripts/verify.mjs` – opens every employer page and re-checks whether applications are open. Runs daily via GitHub Actions.
- `scripts/discover.mjs` – optional discovery via Adzuna / Reed APIs when keys are set as repository secrets.
- `scripts/merge.mjs` – merges research JSON files into the data without duplicates.

Run locally: `node scripts/verify.mjs`
