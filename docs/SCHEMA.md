# Schema, relationships and lifecycle

DDL: [`src/schema.sql`](../src/schema.sql) (also copied to `out/schema.sql`).
17 tables, 3 views, every relationship has a declared foreign key enforced by
`PRAGMA foreign_keys = ON`.

## 1. Relationship map (cardinality)

```
product 1 ──< bom_line >── 1 product          (N:M, effective-dated, no cycles)
product 1 ──< supplier_material >── 1 supplier (N:M, effective-dated)
supplier 1 ──< material_lot >── 1 product      (lot of a purchasable material)
supplier_material 1 ──< material_lot           (approved source of the lot)

product 1 ──< production_order                  (1:N; a rework order points at its parent)
production_order 1 ──< process_step            (1:N, unique (order, sequence))
machine 1 ──< process_step                     (1:N, machine of that step)

production_order N ──< order_consumption >── N material_lot   (N:M bridge)
bom_line 1 ──< order_consumption               (which BOM line was issued)
process_step 1 ──< order_consumption           (where it was issued)

product 1 ──< inspection_plan                  (1:N: incoming / in_process / final)
inspection_plan 1 ──< inspection_result        (1:N)
production_order 0..1 ──< inspection_result    (order-scoped inspections)
material_lot 0..1 ──< inspection_result        (incoming inspection)
process_step 0..1 ──< inspection_result        (in-process inspection)
machine 0..1 ──< inspection_result             (machine that produced the inspected units)

inspection_result 1 ──< defect                 (1:N; a failing inspection can raise 1–3 defect events)
production_order 0..1 ──< defect
material_lot 0..1 ──< defect                   (implicated lot: the upstream join)
process_step 0..1 ──< defect
machine 0..1 ──< defect

defect 1 ──1 capa                              (UNIQUE defect_id)
capa 0..1 ──1 inspection_result                (verification inspection, FK)

production_order 1 ──< order_event             (append-only state history)
material_lot 1 ──< lot_event
capa 1 ──< capa_event
```

Optional relationships (nullable FKs): `production_order.rework_of_order_id`,
`inspection_result.order_id | lot_id | step_id | machine_id`,
`defect.lot_id | step_id | machine_id`, `capa.verification_inspection_id`,
`bom_line.alternate_group`.

Effective dating (temporal validity): `product`, `supplier`,
`supplier_material`, `bom_line`, `inspection_plan` carry
`effective_from`/`effective_to`; `effective_to IS NULL` means still valid.

## 2. Bridge tables

| bridge | sides | extra columns | why |
|---|---|---|---|
| `bom_line` | product ↔ component product | qty_per_unit, uom, scrap_pct, alternate_group | a BOM line is a *dated, quantified* edge, not a plain link |
| `order_consumption` | production_order ↔ material_lot | bom_id, step_id, qty_consumed, consumed_at | the traceability edge: which lot, which BOM line, issued at which step |
| `supplier_material` | supplier ↔ product | qualification_state, unit_price_usd | approved sourcing, effective-dated |
| `anomaly_register` | issue ↔ any record | issue_type, record_id | polymorphic by design, validated by detection rules |

## 3. Lifecycles

**Production order**
`planned → released → in_progress → completed → closed`, plus `planned → cancelled`.
`release` requires actual_start; `in_progress` requires ≥ 1 process step and no
final inspection; `completed/closed` require steps + a final inspection + actual
dates; `cancelled` has no steps, no consumption, no inspections.

**Material lot**
`quarantine → released → partially_consumed → consumed`, with branches
`quarantine → rejected` (failed incoming inspection, never issued) and
`released → expired` (shelf life elapsed with stock on hand). A lot that failed
incoming inspection *after* being issued is a documented **concession release**
and is not rejected — asserted: `rejected ⇒ 0 consumption rows`.

**Inspection result**
`pending → pass | conditional | fail`, derived from `defect_count` vs
`acceptance_qty`.

**CAPA**
`open → in_progress → pending_verification → verified → closed`.
`closed` requires a verification inspection that passed after containment and
`closed_at ≥ verified_at`; enforcement lives in `v_capa_gate` and
`domain.capa_gate`, with deliberate bypasses recorded as labelled anomalies.

Every transition is written to the matching event table with `from_state`,
`to_state`, `occurred_at`, `actor_code`; timestamps are non-decreasing and each
event's `from_state` equals the previous event's `to_state` (validated, check L4).

## 4. Derived values (recomputed, never invented)

| value | derivation |
|---|---|
| `inspection_result.defect_count` | Σ `defect.qty` for that inspection |
| `inspection_result.defect_rate` | `defect_count / inspected_qty` |
| `inspection_result.result` | `fail` if count > acceptance, `conditional` if 0 < count ≤ acceptance, else `pass` |
| `material_lot.consumed_qty` | Σ `order_consumption.qty_consumed` |
| `material_lot.remaining_qty` | `received_qty − consumed_qty` |
| `material_lot.status` | rejected → consumed → partially_consumed → expired → released → quarantine (first match) |
| `production_order.scrap_qty` | Σ step scrap + final-inspection scrap units |
| `production_order.good_qty` | `actual_qty − scrap_qty` |
| `defect.status` | disposition code mapped through `domain.DISPOSITION_STATUS` |
| `capa.status` / `effectiveness_score` | lifecycle above; score = 1 − after-rate ÷ before-rate |
| supplier/machine/product KPI | SQL in `src/analytics.py` (explicit denominators) |

`validate.py` recomputes all of the above and fails if any stored value differs.

## 5. Views

| view | purpose |
|---|---|
| `v_inspection_context` | inspection + order + step + machine + lot + supplier in one validated join path |
| `v_lot_balance` | stored vs recomputed consumption and remaining quantity, plus consumption count |
| `v_capa_gate` | `closure_allowed` and `gate_reason` (`NO_VERIFICATION`, `CLOSED_BEFORE_VERIFICATION`, `VERIFIED_BEFORE_OPEN`, `VERIFICATION_NOT_PASSED`, `VERIFIED_BEFORE_CONTAINMENT`) |

## 6. Integrity rules enforced by the database

* PK on every table; `UNIQUE` on `(order_id, sequence_no)`,
  `(product_id, component_product_id, effective_from)`,
  `(product_id, inspection_type, effective_from)`,
  `(supplier_id, product_id, effective_from)`, `capa.defect_id`.
* FK on all 30 relationships (see `tests/` and validator check K2).
* CHECK constraints: enum domains, positive quantities, `qty_per_unit > 0`,
  `bom component ≠ product`, `expiry_date > received_date`,
  `input_qty = output_qty + scrap_qty`, `defect_count ≤ inspected_qty`,
  `due_at > opened_at`, `revision GLOB 'R[0-9][0-9]'`.
* Deliberately **not** a table constraint: the CAPA closure gate (a bypass must
  remain visible in history) and the lot balance equation (float equality is
  reconciled with tolerance instead).
