# Runbook

## 1. Commands

| command | what it does |
|---|---|
| `./run.sh all` / `.\run.ps1 all` / `run.bat all` | full pipeline: generate → validate → evaluate → reproducibility → tests |
| `./run.sh generate` / `.\run.ps1 generate` | build the dataset into `out/` (`PROFILE=full\|starter`, `SEED=20261022`) |
| `./run.sh validate` / `.\run.ps1 validate` | 21-check validation suite, writes `out/validation_summary.{json,md}` |
| `./run.sh evaluate` / `.\run.ps1 evaluate` | engine vs ground truth, writes `out/evaluation_report.{json,md}` |
| `./run.sh repro` / `.\run.ps1 repro` | two same-seed runs, SHA-256 diff, writes `out/reproducibility.json` |
| `./run.sh test` / `.\run.ps1 test` | `python -m unittest discover -s tests -v` |
| `./run.sh web` / `.\run.ps1 web` | build the React app into `web/dist` (npm install + tsc + vite) |
| `./run.sh serve` / `.\run.ps1 serve` / `run.bat serve` | TraceIQ API + built web app on `PORT` (default 3000) |
| `cd web && npm run dev` | Vite dev server on 5173 proxying `/api` to 3000 |

Equivalent direct commands:

```bash
python3 src/generate.py --profile full --seed 20261022 --out out --with-seed-sql
python3 src/validate.py --out out
python3 src/evaluate.py  --out out
python3 src/repro_check.py --profile full --seed 20261022 --out out
python3 src/app.py --out out --host 0.0.0.0 --port 3000
```

No third-party packages are required (Python 3.10+).

## 2. Workbench API (read-only)

| endpoint | returns |
|---|---|
| `GET /api/meta` | profile, seed, row counts, reference date, generator command, source declaration |
| `GET /api/overview` | KPI roll-up with denominators |
| `GET /api/exceptions?limit=` | labelled anomalies + gate violations + overdue CAPA + expired stock + unattributed critical defects |
| `GET /api/suppliers` | supplier scorecard with `decision` (`BLOCK_AND_AUDIT`, `ESCALATE_8D`, `CONDITIONAL_MONITOR`, `MONITOR`) |
| `GET /api/machines` | machine scorecard incl. suspected drift weeks |
| `GET /api/products` | product scorecard (scrap and defect rate) |
| `GET /api/capas?limit=` | CAPA queue with overdue days and gate status |
| `GET /api/capa-gate?capa_id=` | closure decision + open items for one CAPA |
| `GET /api/trace?defect_id=` | full trace: chain, exposure, containment, downstream, decision, CAPA |
| `GET /api/decision?defect_id=` | disposition/CAPA decision with inputs and rationale |
| `GET /api/sample-defect` | a defect id for demonstration |
| `GET /api/orders?q=` | order search by id, SKU or name |
| `GET /api/validation` / `GET /api/evaluation` | the generated reports |

The API never writes. There is no authentication because it serves a local
synthetic dataset — put it behind auth before exposing it.

## 3. Triage playbook: a customer complaint lands as `DEF-2026-000123`

1. **Trace** — `GET /api/trace?defect_id=DEF-2026-000123`.
   Read the chain defect → inspection → step → machine → order → lot → supplier.
   `chain_complete = false` means the record cannot be traced end to end; add it
   to the exception queue instead of guessing.
2. **Scope containment** — check `containment.open_orders` and
   `containment.qty_at_risk`; the API also lists lots from the same supplier and
   material received within ±30 days, and other orders on the same machine
   within ±3 days.
3. **Confirm the decision** — `decision.disposition` with its rule id
   (`R1`…`R7`) and rationale. `RETURN_TO_SUPPLIER` / `SCRAP` require a hold;
   `USE_AS_IS` requires a deviation record.
4. **Check the CAPA** — `capa` block: status, due date, and `closure_allowed`.
   A closed CAPA with `closure_allowed = 0` is a gate bypass: reopen, run the
   effectiveness inspection, then close.
5. **Supplier view** — `GET /api/suppliers`: if the decision is
   `ESCALATE_8D`/`BLOCK_AND_AUDIT`, raise an 8D and put new receipts on hold.
6. **Machine view** — `GET /api/machines`: `drift_weeks ≥ 2` moves the machine to
   `MAINTENANCE_REVIEW`; check the process parameters on the flagged weeks.

## 4. Reading the reports

* `out/validation_summary.md` — pass/fail per check. A failing check means the
  dataset is inconsistent; do not publish it. Checks that legitimately have
  labelled exceptions (BOM reconciliation, CAPA gate, expired-lot issue) compare
  the detected set against `ground_truth/anomalies.csv` and only pass on an exact
  match.
* `out/evaluation_report.md` — decision agreement, CAPA trigger agreement,
  closure-gate agreement, drift precision/recall, anomaly coverage, and the
  observed-vs-latent supplier rate error.
* `out/source_manifest.json` — seed, profile, row counts, per-file checksums,
  generator command, source/licence declaration.
* `out/reproducibility.json` — proof that a second same-seed run is identical.

## 5. Common tasks

**Change volumes** — edit `PROFILES` in `src/domain.py` (both profiles run the
same code). Keep `--seed` fixed to keep the dataset reproducible.

**Add a defect code** — append to `DEFECT_CATALOG` in `src/domain.py`
(code, name, category, severity, reworkable, supplier-prone, weight). Re-generate;
the catalogue drives both defects and decisions.

**Add an anomaly type** — inject it in `Generator.inject_anomalies`, register it
with `register_anomaly(...)`, add the detection rule to `Validation.detect_anomalies`,
and (if required) add the type to `REQUIRED_EDGE_CASES`.

**Tune thresholds** — `RATE_SCRAP_LIMIT`, `RATE_CAPA_LIMIT`,
`REPEAT_WINDOW_DAYS`, `REPEAT_COUNT`, `DRIFT_SCRAP_MULTIPLIER` in `src/domain.py`;
the machine-week drift rule lives in `analytics.machine_weeks`.

## 6. Troubleshooting

| symptom | cause / fix |
|---|---|
| `missing out/sqlite/traceability.db` | run `./run.sh generate` first |
| validator check A3 fails | artifacts changed after generation — regenerate instead of editing `out/` |
| validator check L3 fails | a CAPA closure bypass is unlabelled, or the labelled set drifted; inspect `ground_truth/anomalies.csv` |
| drift recall low | drift windows are latent; the engine only sees machine-week scrap. Widen the window or lower `RATE` thresholds deliberately and re-evaluate |
| UI shows `defect … not found` | ids are case-sensitive in the data but the API uppercases input; check the id exists in `out/csv/defect.csv` |
| tests slow | the suite builds a `starter` dataset twice (determinism test); the full profile takes ~15 s per run |
