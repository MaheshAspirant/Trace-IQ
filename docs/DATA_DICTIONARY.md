# Data dictionary

Conventions used below:
* **Type** — SQLite storage type. All timestamps are ISO-8601 text
  (`YYYY-MM-DD` for dates, `YYYY-MM-DD HH:MM:SS` for event timestamps) so that
  lexicographic order equals chronological order.
* **Req** — `Y` required, `N` nullable.
* **Derived** — recomputed from source records by `src/generate.py` and asserted
  by `src/validate.py`; never assigned independently.
* **Units** — `EA` (pieces) or `KG` (mass). Quantities are integers for `EA`
  products and 3-decimal floats for `KG` products.

---

## 1. product — finished goods, subassemblies, components, raw materials

| field | type | req | allowed values / units | uniqueness & validation |
|---|---|---|---|---|
| product_id | TEXT | Y | `SKU-\d{6}` | PK; immutable |
| name | TEXT | Y | free text | unique per revision in practice |
| family | TEXT | Y | Hydraulic Valve, Pump Assembly, Sensor Module, Gearbox, Actuator, Manifold | drives routing and complexity multiplier |
| product_type | TEXT | Y | finished_good, subassembly, component, raw_material | BOM only for finished_good/subassembly |
| uom | TEXT | Y | EA, KG | raw_material ⇒ KG |
| revision | TEXT | Y | `R01`..`R06` | GLOB `R[0-9][0-9]` |
| lifecycle_state | TEXT | Y | active, phase_out, obsolete | obsolete ⇒ effective_to set |
| rework_allowed | INTEGER | Y | 0, 1 | drives disposition R3 |
| scrap_tolerance_pct | REAL | Y | 0–10 % | 0 for raw materials |
| effective_from | DATE | Y | 2024-01-01 … 2025-06-24 | ≤ effective_to |
| effective_to | DATE | N | > effective_from | null = open ended |
| created_at | DATE | Y | ≤ effective_from | |

## 2. supplier

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| supplier_id | TEXT | Y | `SUP-\d{4}` | PK |
| name | TEXT | Y | free text | |
| supplier_type | TEXT | Y | raw_material, component, packaging, service | service suppliers receive no lots |
| country | TEXT | Y | ISO-3166 alpha-2 style | no personal data |
| risk_tier | TEXT | Y | A, B, C | latent multiplier 1.0 / 1.8 / 3.0 |
| qualification_state | TEXT | Y | approved, conditional, blocked | drives R2 and lot rejection |
| approved_on | DATE | Y | 2023-01-01 … | ≤ effective_from |
| lead_time_days | INTEGER | Y | 1–120 | |
| effective_from | DATE | Y | | |
| effective_to | DATE | N | > effective_from | |
| quality_contact_role | TEXT | Y | role only | no names/emails (PII-free) |

## 3. supplier_material — N:M bridge (supplier ↔ product, effective-dated)

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| supplier_material_id | TEXT | Y | `SM-\d{6}` | PK |
| supplier_id | TEXT | Y | → supplier | FK |
| product_id | TEXT | Y | → product | FK |
| qualification_state | TEXT | Y | approved, conditional, blocked | copied from supplier |
| unit_price_usd | REAL | Y | > 0 | |
| effective_from | DATE | Y | | unique (supplier, product, effective_from) |
| effective_to | DATE | N | > effective_from | |

## 4. bom_line — N:M bridge (product ↔ component)

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| bom_id | TEXT | Y | `BOM-\d{6}` | PK |
| product_id | TEXT | Y | → product | FK; must be finished_good or subassembly |
| component_product_id | TEXT | Y | → product | FK; ≠ product_id; no cycles (components are ordered by index) |
| qty_per_unit | REAL | Y | > 0 EA or KG | |
| uom | TEXT | Y | EA, KG | matches component uom |
| scrap_pct | REAL | Y | 0–5 % | |
| alternate_group | TEXT | N | `ALT-\d{5}` | groups interchangeable components |
| effective_from | DATE | Y | | unique (product, component, effective_from) |
| effective_to | DATE | N | > effective_from | |

## 5. machine

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| machine_id | TEXT | Y | `MAC-\d{3}` | PK |
| name | TEXT | Y | plant/line/type code | |
| plant | TEXT | Y | PLANT-01..03 | |
| line | TEXT | Y | L1, L2 | |
| machine_type | TEXT | Y | cnc, press, weld, assembly, oven, leak_test, packaging, test | routing requires the type |
| commissioned_on | DATE | Y | 2017–2024 | ≤ last_maintenance_on |
| last_maintenance_on | DATE | Y | 2026 | |
| status | TEXT | Y | running, idle, maintenance, down | |
| design_uph | REAL | Y | > 0 | |

## 6. inspection_plan

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| plan_id | TEXT | Y | `IP-\d{4}` | PK |
| product_id | TEXT | Y | → product | FK |
| inspection_type | TEXT | Y | incoming, in_process, final | one plan per product/type/effective date |
| sample_size | INTEGER | Y | 1–500 | |
| aql_level | REAL | Y | 0.65, 1.0, 1.5, 2.5 | |
| acceptance_qty | INTEGER | Y | ≥ 0 | = round(sample_size × 1.5%) |
| rejection_qty | INTEGER | Y | > acceptance_qty | |
| criteria | TEXT | Y | checklist text | |
| effective_from / effective_to | DATE | Y/N | | effective_to > effective_from |

## 7. material_lot

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| lot_id | TEXT | Y | `LOT-SUP-\d{4}-\d{4}-\d{6}` | PK; sequence per supplier and receipt year |
| supplier_id | TEXT | Y | → supplier | FK |
| material_product_id | TEXT | Y | → product (raw/component) | FK |
| supplier_material_id | TEXT | Y | → supplier_material | FK; pair must match supplier + product |
| received_date | DATE | Y | 2025-07-01 … 2026-09-10 | < expiry_date; < first consumption |
| received_qty | REAL | Y | > 0 EA/KG | sized to the demand chunk + 35% cover |
| uom | TEXT | Y | EA, KG | |
| expiry_date | DATE | Y | > received_date | shelf life ≥ 365 days |
| coa_pass | INTEGER | Y | 0, 1 | certificate of analysis |
| certificate_ref | TEXT | Y | `COA-SUP-nnnn-nnnnn` | |
| **status** | TEXT | Y | quarantine, released, partially_consumed, consumed, rejected, expired | **derived** (see schema notes) |
| **consumed_qty** | REAL | Y | ≥ 0 | **derived** = Σ order_consumption.qty_consumed |
| **remaining_qty** | REAL | Y | ≥ 0 | **derived** = received_qty − consumed_qty |
| created_at | DATE | Y | = received_date | |

## 8. production_order

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| order_id | TEXT | Y | `WO-2026-\d{6}` | PK |
| product_id | TEXT | Y | → product | FK (finished_good or subassembly) |
| plant / line | TEXT | Y | PLANT-0x / L1,L2 | |
| planned_qty | INTEGER | Y | 50–2000, step 5 | |
| actual_qty | INTEGER | N | 93–103% of planned | null for planned/released/cancelled |
| **scrap_qty** | INTEGER | Y | ≥ 0 | **derived** = Σ step scrap + final-inspection scrap units |
| **good_qty** | INTEGER | Y | ≥ 0 | **derived** = actual_qty − scrap_qty |
| planned_start / planned_end | DATE | Y | 2026-01-05 … 2026-10-31 | planned_end > planned_start |
| actual_start / actual_end | TIMESTAMP | N | | actual_end > actual_start; required for completed/closed |
| status | TEXT | Y | planned, released, in_progress, completed, closed, cancelled | lifecycle in schema notes |
| priority | TEXT | Y | standard, expedite, hold | |
| rework_of_order_id | TEXT | N | → production_order | FK; same product; ≠ order_id |
| planner_code | TEXT | Y | `PLN-01..08` | |
| created_at | DATE | Y | before actual_start | |

## 9. process_step

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| step_id | TEXT | Y | `PS-2026-\d{6}-\d{2}` | PK; unique (order_id, sequence_no) |
| order_id | TEXT | Y | → production_order | FK |
| sequence_no | INTEGER | Y | 1–12 | |
| step_name | TEXT | Y | routing step | |
| machine_id | TEXT | Y | → machine | FK; machine type must match routing |
| planned_duration_min | REAL | Y | > 0 min | |
| actual_duration_min | REAL | Y | > 0 min | 0.9–1.15× planned, +8% during drift |
| started_at / ended_at | TIMESTAMP | Y | | ended_at > started_at |
| operator_code | TEXT | Y | `OP-nnn` | no personal data |
| temperature_c / pressure_bar / speed_uph | REAL | Y | process parameters | elevated during drift |
| input_qty | INTEGER | Y | ≥ 0 | = previous output (or actual_qty at step 1) |
| output_qty | INTEGER | Y | ≥ 0 | |
| scrap_qty | INTEGER | Y | ≥ 0 | input_qty = output_qty + scrap_qty |
| status | TEXT | Y | pending, started, completed | |

## 10. order_consumption — N:M bridge (order ↔ lot), the traceability join

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| consumption_id | TEXT | Y | `CONS-2026-\d{6}` | PK |
| order_id | TEXT | Y | → production_order | FK |
| lot_id | TEXT | Y | → material_lot | FK; lot received ≤ consumed_at < expiry |
| bom_id | TEXT | Y | → bom_line | FK; component must belong to the order's product BOM |
| step_id | TEXT | Y | → process_step | FK; step must belong to the same order |
| qty_consumed | REAL | Y | > 0 EA/KG | Σ per lot ≤ received_qty |
| uom | TEXT | Y | EA, KG | |
| consumed_at | TIMESTAMP | Y | | ≥ received_date |

## 11. inspection_result

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| inspection_id | TEXT | Y | `INSP-<order>\|\<lot>-NNN` | PK |
| plan_id | TEXT | Y | → inspection_plan | FK; plan product/type must match |
| inspection_type | TEXT | Y | incoming, in_process, final | incoming ⇒ lot_id set; others ⇒ order_id set |
| order_id / lot_id / step_id / machine_id | TEXT | N | → respective tables | FK; step must belong to order; machine from step |
| inspected_qty | INTEGER | Y | > 0 units | denominator for every defect rate |
| sampled_qty | INTEGER | Y | 1..inspected_qty | |
| measured_value / spec_min / spec_max | REAL | N | key characteristic | spec_max > spec_min |
| acceptance_qty / rejection_qty | INTEGER | Y | from plan | rejection_qty > acceptance_qty |
| **defect_count** | INTEGER | Y | ≥ 0 | **derived** = Σ defect.qty; ≤ inspected_qty |
| **defect_rate** | REAL | Y | 0–1 | **derived** = defect_count ÷ inspected_qty |
| **result** | TEXT | Y | pass, conditional, fail, pending | **derived**: fail if count > acceptance; conditional if 0 < count ≤ acceptance |
| inspected_at | TIMESTAMP | Y | ≤ reference date | |
| inspector_code | TEXT | Y | `QC-nn` | |

## 12. defect

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| defect_id | TEXT | Y | `DEF-2026-\d{6}` | PK |
| inspection_id | TEXT | Y | → inspection_result | FK |
| order_id / lot_id / step_id / machine_id | TEXT | N | → respective tables | FK; lot = implicated material lot |
| defect_code | TEXT | Y | 17-code catalogue (e.g. `FUN-LEAK`) | |
| defect_name | TEXT | Y | catalogue text | |
| category | TEXT | Y | dimensional, material, assembly, functional, cosmetic, documentation | maps to root cause |
| severity | TEXT | Y | minor, major, critical | drives R3/C1 |
| qty | INTEGER | Y | > 0 defective units | Σ ≤ inspected_qty (quarantine feed holds violations) |
| supplier_responsibility | INTEGER | Y | 0, 1 | 1 only when a supplier lot is implicated |
| detection_method | TEXT | Y | visual, gauge, functional_test, certificate_review | |
| detected_at | TIMESTAMP | Y | = inspection.inspected_at | |
| **status** | TEXT | Y | open, contained, rework, scrap, closed | **derived** from the disposition code |

## 13. capa (corrective / preventive action)

| field | type | req | allowed / units | validation |
|---|---|---|---|---|
| capa_id | TEXT | Y | `CAPA-2026-\d{6}` | PK |
| defect_id | TEXT | Y | → defect | FK, UNIQUE (one CAPA per defect) |
| root_cause_category | TEXT | Y | supplier_material, process_parameter, machine_calibration, operator_error, design, handling, documentation | derived from defect category |
| containment_action | TEXT | Y | free text | |
| containment_completed_at | TIMESTAMP | N | ≥ opened_at | required before verification |
| corrective_action / preventive_action | TEXT | Y | free text | |
| owner_role | TEXT | Y | Quality/Process/Supplier Quality Engineer, Maintenance Lead | role only |
| opened_at / due_at | TIMESTAMP | Y | | due_at > opened_at |
| verification_inspection_id | TEXT | N | → inspection_result | FK; must be a later passing inspection |
| verified_at | TIMESTAMP | N | ≥ opened_at | |
| closed_at | TIMESTAMP | N | ≥ verified_at for a legal closure | gate enforced in `v_capa_gate` |
| status | TEXT | Y | open, in_progress, pending_verification, verified, closed, cancelled | |
| effectiveness_score | REAL | N | 0–1 | 1 − after_rate ÷ before_rate |

## 14. Event history (append-only)

`order_event`, `lot_event`, `capa_event` share one shape:

| field | type | req | allowed | validation |
|---|---|---|---|---|
| event_id | TEXT | Y | `EVT-ORD\|LOT\|CAPA-\d{6}` | PK |
| order_id / lot_id / capa_id | TEXT | Y | → parent | FK |
| event_type | TEXT | Y | order_created, released, started, completed, closed, cancelled / lot_received, incoming_inspection, issued_to_production, depleted, expired / capa_opened, containment_completed, verification_inspection_passed, capa_closed | |
| from_state | TEXT | N | previous lifecycle state | null only for the first event |
| to_state | TEXT | Y | lifecycle state | must equal the next event's from_state |
| occurred_at | TIMESTAMP | Y | | non-decreasing per entity |
| actor_code | TEXT | Y | `PLN-*`, `OP-*`, `QC-*`, `QA-*`, `WH-01`, `PLN-SYS` | no personal data |
| note | TEXT | N | free text | |

## 15. anomaly_register — the labelled issue register

| field | type | req | allowed | validation |
|---|---|---|---|---|
| anomaly_id | TEXT | Y | `ANOM-\d{4}` | PK |
| issue_type | TEXT | Y | 7 documented types | must exist in `ground_truth/anomalies.csv` |
| source_file | TEXT | Y | relative path | points at the file holding the anomaly |
| table_name | TEXT | Y | entity name | |
| record_id | TEXT | Y | PK of the affected record | detection rules must find exactly these |
| field_name | TEXT | Y | affected column | |
| expected_label | TEXT | Y | e.g. `INVALID_REFERENCE`, `CLOSURE_BLOCKED` | |
| detection_rule | TEXT | Y | e.g. `FK_CHECK:defect.lot_id->material_lot.lot_id` | |
| severity | TEXT | Y | low, medium, high, critical | |
| injected_value | TEXT | N | the offending value | |
| note | TEXT | N | human explanation | |

`anomaly_register` is a **label** table: it is the only table allowed to carry a
label column and is never joined into input features.
