# Validation summary

- Checks: **21 passed / 0 failed** (21 total)
- Profile: `full` · seed `20261022` · reference date `2026-10-22`

| table | rows |
|---|---:|
| product | 200 |
| supplier | 50 |
| supplier_material | 179 |
| bom_line | 723 |
| machine | 30 |
| inspection_plan | 600 |
| material_lot | 2000 |
| production_order | 5000 |
| process_step | 23918 |
| order_consumption | 25705 |
| inspection_result | 20000 |
| defect | 4678 |
| capa | 901 |
| order_event | 22618 |
| lot_event | 6954 |
| capa_event | 2484 |
| anomaly_register | 53 |

## Checks

| id | category | check | status | expected | actual |
|---|---|---|---|---|---|
| A1 | artefacts | Required output files exist | PASS | 44 required files | all present |
| A2 | artefacts | SQLite schema matches documented columns | PASS | column lists identical | identical |
| K1 | keys | Primary keys are unique and present | PASS | 0 duplicates / 0 empty | clean |
| K2 | keys | Foreign keys resolve for every relationship | PASS | 30 relationships | all resolved |
| K3 | keys | Business/natural keys are unique | PASS | 0 duplicates | clean |
| K4 | nomenclature | Identifiers follow the documented formats | PASS | SKU/SUP/LOT/WO/INSP/DEF/CAPA patterns | conformant |
| E1 | domains | Categorical values stay inside allowed domains | PASS | documented enum sets | conformant |
| D1 | dates | Date ordering and reference-window rules hold | PASS | 0 violations | clean |
| R1 | reconciliation | Lot balances reconcile exactly | PASS | received = consumed + remaining; no over-consumption | balanced |
| R2 | reconciliation | Step and order quantities reconcile | PASS | input=output+scrap; good+scrap=actual; scrap=step+final scrap | reconciled |
| R3 | reconciliation | Inspection defect counts and rates derive from defect events | PASS | derived values consistent for every inspection | consistent |
| R4 | dates | Material is issued only after receipt and inside shelf life (aside from labelled exceptions) | PASS | 0 unlabelled timing violations | lots with post-expiry consumption: 7 (labelled 7) |
| L1 | lifecycle | Order state is consistent with its child records | PASS | 0 inconsistencies | consistent |
| L2 | lifecycle | Lot status derives from consumption and inspection | PASS | 0 inconsistencies | consistent |
| L3 | lifecycle | CAPA closure requires verification (labelled bypasses only) | PASS | 6 labelled bypasses | 6 detected |
| L4 | lifecycle | State-change events form a monotonic, connected history | PASS | 0 broken chains | consistent |
| G1 | ground_truth | Ground truth is physically separated from input features | PASS | no label columns in csv/ | 6 ground_truth files kept outside csv/ |
| G2 | anomalies | Detection rules reproduce every labelled anomaly exactly | PASS | 53 labelled anomalies | {"BOM_MATERIAL_NOT_CONSUMED": {"detected": 12, "extra": [], "labelled": 12, "matched": 12, "missed": []}, "CAPA_CLOSED_BEFORE_VERIFICATION": {"detected": 6, "extra": [], "labelled": 6, "matched": 6, "missed": []}, "DEFECT_COUNT_EXCEEDS_INSPECTED_QTY": {"detected": 6, "extra": [], "labelled": 6, "matched": 6, "missed": []}, "DEFECT_LOT_NOT_FOUND": {"detected": 8, "extra": [], "labelled": 8, "matched": 8, "missed": []}, "DUPLICATE_CONSUMPTION": {"detected": 5, "extra": [], "labelled": 5, "matched": 5, "missed": []}, "EXPIRED_LOT_CONSUMED": {"detected": 7, "extra": [], "labelled": 7, "matched": 7, "missed": []}, "TRACE_CHAIN_BREAK": {"detected": 9, "extra": [], "labelled": 9, "matched": 9, "missed": []}} |
| G3 | anomalies | All required edge cases are present and labelled | PASS | 5 required issue types | 7 types present |
| A3 | reproducibility | Manifest checksums match the exported files | PASS | 47 files | all match |
| A4 | artefacts | Requested full volumes are produced exactly | PASS | {"product": 200, "supplier": 50, "material_lot": 2000, "production_order": 5000, "inspection_result": 20000} | exact |

## Labelled anomaly coverage

| issue_type | labelled | detected | matched |
|---|---:|---:|---:|
| BOM_MATERIAL_NOT_CONSUMED | 12 | 12 | 12 |
| CAPA_CLOSED_BEFORE_VERIFICATION | 6 | 6 | 6 |
| DEFECT_COUNT_EXCEEDS_INSPECTED_QTY | 6 | 6 | 6 |
| DEFECT_LOT_NOT_FOUND | 8 | 8 | 8 |
| DUPLICATE_CONSUMPTION | 5 | 5 | 5 |
| EXPIRED_LOT_CONSUMED | 7 | 7 | 7 |
| TRACE_CHAIN_BREAK | 9 | 9 | 9 |
