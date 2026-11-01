# TraceIQ — Manufacturing Traceability & Quality Management

Trace a defect from the inspection that found it, through the process step and
machine that made it, the production order, the material lots it consumed and
the suppliers behind those lots — then record the containment and corrective
action, and prove that a CAPA cannot be closed before effectiveness is verified.

Everything is synthetic, deterministic and self-contained: Python standard
library only, no network calls, fixed seed `20261022`.

---

## 📌 Project & Reviewer Documentation

- 📖 **[Technical Reviewer Guide](docs/REVIEWER_GUIDE.md):** Detailed breakdown of the manufacturing problem, domain assumptions, architectural trade-offs, testing approach, and verifiable metrics.
- 🤖 **[AI Usage Disclosure & Prompt History](AI_USAGE.md):** Complete disclosure of AI tools used, prompt history, acceleration areas, review practices, and personal accountability.
- 📚 **[Data Dictionary](docs/DATA_DICTIONARY.md):** Schema definitions and domain entities.
- 📐 **[Schema & Cardinality](docs/SCHEMA.md):** Relational diagram and SQLite table constraints.
- 🛠️ **[Operational Runbook](docs/RUNBOOK.md):** Step-by-step triage playbooks and API endpoints.

---

## 🚀 Quick Start — Make It Run

### Prerequisites
- **Python 3.10+** (standard library only; no pip install needed)
- **Node.js 18+ & npm** (only needed if rebuilding the frontend)

### 1. Launch the Application (One-Click)

The React single-page application is pre-compiled into `web/dist`. Run the server using your preferred shell:

```bash
# Windows (PowerShell)
.\run.ps1 serve

# Windows (Command Prompt)
run.bat serve

# macOS / Linux (Bash)
./run.sh serve
```
Open your browser at **[http://localhost:3000](http://localhost:3000)**.

### 2. Verify Key Behaviors (End-to-End Suite)

To regenerate data, execute the 21-check validation suite, evaluate against ground truth, and run all unit tests:

```bash
# Windows (PowerShell)
.\run.ps1 all

# Windows (Command Prompt)
run.bat all

# macOS / Linux (Bash)
./run.sh all
```

Expected output:
- **Validation:** `21 passed / 0 failed (21 total)`
- **Evaluation:** `disposition_agreement: 1.0 (100%)`, `capa_agreement: 0.995`, `capa_gate: 1.0 (100%)`
- **Unit Tests:** `Ran 8 tests ... OK`

---

---

## 1. What is in the box

| path | contents |
|---|---|
| `src/domain.py` | identifier formats, volumes, latent parameters, the decision/rule tables |
| `src/generate.py` | deterministic generator (master data → transactions → derived values → labelled anomalies) |
| `src/schema.sql` | SQLite DDL: 17 tables, FKs, CHECK constraints, indexes, 3 views |
| `src/validate.py` | 21-check validation suite → `out/validation_summary.{json,md}` |
| `src/trace.py` | trace engine, disposition/CAPA engine, closure gate, decision audit |
| `src/analytics.py` | read-only metric queries (defect rate, scrap rate, scorecards, exceptions) |
| `src/evaluate.py` | engine-vs-ground-truth evaluation → `out/evaluation_report.{json,md}` |
| `src/app.py` | stdlib HTTP server: security headers, SPA fallback and JSON API routing |
| `src/api.py` | API v2: dashboard, listings, details, trace graph, analytics, gated CAPA actions |
| `src/ops.py` | writable action layer (`out/ops.db`): CAPA/defect overrides and append-only audit log |
| `web/` | React 18 + TypeScript + Vite + Tailwind CSS + Recharts + Lucide application |
| `src/web/` | original single-file workbench (kept for reference, superseded by `web/`) |
| `src/repro_check.py` | regenerates twice with the same seed and diffs checksums |
| `tests/test_pipeline.py` | end-to-end tests (volumes, validation, reproducibility, decisions, gate) |
| `out/` | dataset (CSV, JSON, SQLite, seed.sql), reports, reproducibility proof |
| `ground_truth/` (inside `out/`) | labels and expected decisions — never joined into input data |
| `docs/` | data dictionary, schema/cardinality notes, runbook |

## 2. Web application (TraceIQ 2.0)

A React 18 + TypeScript single-page application, built with Vite and styled with
Tailwind CSS, Recharts and Lucide. The Python server in `src/app.py` serves the
compiled bundle and the JSON API, so there is one process and one origin.

```bash
# macOS / Linux
./run.sh web                     # npm install + tsc + vite build -> web/dist
./run.sh serve                   # http://localhost:3000

# Windows
.\run.ps1 web                    # npm install + tsc + vite build -> web/dist
.\run.ps1 serve                  # http://localhost:3000

(cd web && npm run dev)          # optional: Vite dev server proxying /api to :3000
```

Screens: Overview, Products & BOM, Suppliers, Material Lots, Production Orders,
Machines & Processes, Inspections, Defect Management, Traceability Explorer,
Corrective Actions, Analytics & Reports, Data Quality & Exceptions, Settings.
The shell provides a collapsible navy sidebar, breadcrumbs, global search (⌘K),
derived notifications, and a responsive mobile layout.

Reusable primitives live in `web/src/components`: KPI cards, sortable and
paginated data tables, filter bars, status badges, modals, confirmation dialogs,
detail drawers, tabs, progress bars, empty/loading/error states and toasts.

### API v2 and the action layer

The generated dataset stays immutable: validation, reproducibility and the
CLI pipeline are unchanged. User actions are stored separately in
`out/ops.db` and merged over the generated rows at read time.

| endpoint | purpose |
|---|---|
| `GET /api/dashboard` | KPI cards, monthly trend, top defect dimensions, alerts |
| `GET /api/products`, `/api/products/{id}` | listing + BOM, plans, quality |
| `GET /api/suppliers`, `/api/suppliers/{id}` | scorecards, incoming trend, attributed defects |
| `GET /api/lots`, `/api/orders`, `/api/machines`, `/api/inspections` | paginated, filterable listings |
| `GET /api/lots/{id}`, `/api/orders/{id}`, `/api/machines/{id}`, `/api/inspections/{id}` | detail with lineage |
| `GET /api/defects/{id}` | trace, decision, CAPA, allowed actions, activity |
| `GET /api/trace-graph?defect_id=` | nodes, edges and stages for the explorer |
| `GET /api/analytics`, `/api/exceptions`, `/api/search` | analytics, exception queue, global search |
| `POST /api/capas/{id}/actions` | start, contain, submit, verify, close, reopen, cancel, assign, note |
| `POST /api/defects/{id}/actions` | contain, rework, scrap, close |
| `PUT /api/settings`, `POST /api/settings/clear-history` | preferences and action-history reset |

CAPA closure is enforced server-side: `close` returns HTTP 409 unless a passing
verification inspection is linked after containment and before closure. The UI
surfaces the gate checklist and the failure reason rather than hiding it.

## 3. Dataset at a glance

| entity | rows | | entity | rows |
|---|---:|---|---|---:|
| Product | 200 | | ProcessStep | ≈24,000 |
| Supplier | 50 | | OrderConsumption | ≈19,000 |
| BOM line | ≈720 | | InspectionResult | 20,000 |
| MaterialLot | 2,000 | | Defect | ≈4,600 |
| ProductionOrder | 5,000 | | CorrectiveAction | ≈900 |

* Fixed seed **20261022**, reference date **2026-10-22**, dataset year 2026.
* `PROFILE=starter` runs the *same* generator at 20 SKUs / 8 suppliers / 60 lots /
  120 orders / 400 inspections for fast tests.
* Every state change is an explicit event row (`order_event`, `lot_event`,
  `capa_event`); derived values (lot balances, order scrap, inspection counts,
  CAPA status) are recomputed and asserted by the validator.

## 3. Workflow and rules

Master data first (Product → BOM → Supplier → MaterialLot), then transactions
(ProductionOrder → ProcessStep → OrderConsumption → InspectionResult → Defect →
CorrectiveAction). Identifiers are immutable and deterministic:

`SKU-000001`, `SUP-0001`, `LOT-SUP-0001-2026-000001`, `WO-2026-000001`,
`INSP-2026-000001-001` (order-scoped) / `INSP-SUP-0001-2026-000001-001`
(lot-scoped), `DEF-2026-000001`, `CAPA-2026-000001`, `BOM-000001`,
`IP-0001`, `MAC-001`, `CONS-2026-000001`, `ANOM-0001`.

### Disposition (first match wins)

| rule | condition | outcome |
|---|---|---|
| R1 | defect qty > inspected qty (data quality) | quarantine + data review |
| R2 | supplier-attributed and supplier is blocked | return to supplier |
| R3 | severity critical | scrap unless the product allows rework |
| R4 | inspection defect rate ≥ 5% | rework |
| R5 | supplier-attributed and ≥ 3 supplier defects in 90 days | return to supplier |
| R6 | severity major | rework |
| R7 | otherwise | use-as-is with deviation record |

### CAPA trigger

`C1` critical defect on a failed inspection · `C2` defect rate ≥ 10% ·
`C3` major supplier-attributed defect with a repeat-supplier pattern ·
`C4` major defect on a machine inside a suspected drift window.

### CAPA closure gate

A CAPA may only be `closed` when a **verification inspection exists, passed, and
happened after containment**, with `verified_at ≥ opened_at` and
`closed_at ≥ verified_at`. The gate is a business rule (`v_capa_gate`,
`domain.capa_gate`), not a table constraint: a bypassed gate stays visible in
history instead of being silently blocked.

## 4. Labelled edge cases (ground truth)

All anomalies are injected after the clean baseline and recorded in
`out/csv/anomaly_register.csv` + `out/ground_truth/anomalies.csv`. Records whose
very existence would corrupt the core schema (dangling foreign keys, impossible
arithmetic) are kept in a separate **quarantine feed** under
`out/csv/quarantine/` so that primary-key and foreign-key integrity of the main
tables survives.

| issue_type | where | detection rule |
|---|---|---|
| `DEFECT_LOT_NOT_FOUND` | quarantine defect feed | `defect.lot_id` → `material_lot.lot_id` missing |
| `BOM_MATERIAL_NOT_CONSUMED` | main `order_consumption` (missing rows) | completed order vs BOM line reconciliation |
| `CAPA_CLOSED_BEFORE_VERIFICATION` | main `capa` | closure gate fails (`NO_VERIFICATION`, `CLOSED_BEFORE_VERIFICATION`) |
| `DEFECT_COUNT_EXCEEDS_INSPECTED_QTY` | quarantine inspection feed | `defect_count > inspected_qty` |
| `TRACE_CHAIN_BREAK` | quarantine defect feed + main orders | defect step belongs to another order; completed order with no material issue |
| `EXPIRED_LOT_CONSUMED` | main `material_lot` expiry dates | `consumed_at ≥ expiry_date` |
| `DUPLICATE_CONSUMPTION` | quarantine consumption feed | same order+lot+BOM+step issued twice |

## 5. Measurable outputs (and their denominators)

| metric | definition |
|---|---|
| defect rate | Σ `defect.qty` ÷ Σ `inspection_result.inspected_qty` (inspection-level denominator; never inspection count) |
| DPPM | defect rate × 1,000,000 |
| first pass yield | passing inspections ÷ all inspections |
| scrap rate | Σ `production_order.scrap_qty` ÷ Σ `actual_qty` |
| supplier incoming rate | incoming defect units ÷ incoming inspected units, per supplier |
| machine scrap / defect rate | step scrap ÷ step input; in-process defect units ÷ in-process inspected units |
| trace completeness | defects linked to an order **and** (a lot or a machine) ÷ all defects |
| CAPA closure / on-time | closed ÷ total; closed on or before `due_at` ÷ closed |
| drift detection | machine-weeks flagged (scrap rate ≥ 2× the machine median, ≥ 0.5%, ≥ 200 units) vs labelled windows |

## 6. Validation and evaluation outputs

**Latest full-profile run** (seed 20261022): validation 21/21 checks; disposition
agreement 100% over 4,678 defects; CAPA trigger agreement 99.5%; closure-gate
agreement 100% over 901 CAPAs; drift detection precision 0.44 / recall 0.65 at
machine-week level (an honest proxy, see limitations); observed-vs-latent supplier
rate MAE 0.024 with r = 0.91; two same-seed runs byte-identical across 46/46
files. Portfolio defect rate 0.40% (4,015 DPPM) over 2.1M inspected units.

* `out/validation_summary.md` — 21 checks: file/schema integrity, PK/FK/business
  keys, ID formats, enum domains, date ordering, lot balance, step/order
  arithmetic, inspection aggregates, issue timing, order/lot/CAPA lifecycle,
  event-chain monotonicity, ground-truth separation, anomaly-rule recall, volume
  targets, checksum integrity.
* `out/evaluation_report.md` — decision agreement, CAPA trigger and closure-gate
  agreement, drift precision/recall at machine-week level, anomaly coverage,
  observed-vs-latent supplier rate error.
* `out/reproducibility.json` — two same-seed runs, row counts and SHA-256 per
  file.

The engine in `src/trace.py` re-derives decisions **from persisted rows only**
(it never reads `ground_truth/`), so agreement measures whether the stored data
still contains every input the rule needs.

## 7. Reproducibility

```bash
python3 src/generate.py --profile full --seed 20261022 --out out --with-seed-sql
python3 src/repro_check.py --profile full --seed 20261022 --out out
```

The generator uses a single `random.Random(seed)` stream, fixed iteration order,
zero-padded counters, stable column order and deterministic float formatting, so
CSV/JSON/SQLite outputs are byte-identical between runs. `source_manifest.json`
records row counts, SHA-256 checksums, the generator command and the seed.

## 8. Provenance and lawful use

No external data is downloaded, scraped or redistributed. The dataset is fully
synthetic and released as CC0-1.0 within this project. Identifier conventions
are *inspired by* common GS1/ISA-95 shop-floor naming only; no rows, schemas or
tables were copied from any third-party dataset. `out/source_manifest.json`
records this source declaration alongside the generation parameters.

## 9. Design notes and limitations

* **Concession release**: material issue is planned before the incoming
  inspection outcome is recorded; a lot that fails inspection but was already
  issued stays in production as a concession release, while a lot that is
  rejected is never issued (`rejected ⇒ 0 consumption` is asserted).
* **Inbound cover**: each lot is sized to the demand it must cover plus a 35%
  buffer, so a rejected lot cannot starve the line. Validation asserts exactly
  zero material shortfalls.
* **Drift is a proxy**: the engine infers drift from machine-week scrap rates;
  ground truth uses the latent drift window. The gap is measured and reported
  rather than hidden.
* **No personal data**: roles (`OP-`, `QC-`, `PLN-`, `QA-`) are codes, never
  identities.
* The API is read-only; there is no authentication because it serves a local
  synthetic dataset. Do not expose it publicly without adding auth.
