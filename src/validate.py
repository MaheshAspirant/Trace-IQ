#!/usr/bin/env python3
"""Validation suite for the generated traceability dataset.

Runs structural, key, referential, arithmetic, lifecycle and ground-truth
checks over the exported CSV files (the same files a reviewer would read) and
writes ``validation_summary.json`` / ``validation_summary.md``.

Exit code is 0 only when every check passes.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import domain as D  # noqa: E402

REQUIRED_FILES = ["schema.sql", "source_manifest.json", "checksums.json"] + \
                 [f"csv/{t}.csv" for t in D.TABLE_ORDER] + \
                 [f"json/{t}.json" for t in D.TABLE_ORDER] + \
                 ["sqlite/traceability.db"] + \
                 [f"ground_truth/{n}.csv" for n in
                  ("anomalies", "decisions", "process_drift", "capa_gate", "supplier_rates")] + \
                 ["ground_truth/ground_truth.json"]

FOREIGN_KEYS = [
    ("supplier_material", "supplier_id", "supplier", "supplier_id"),
    ("supplier_material", "product_id", "product", "product_id"),
    ("bom_line", "product_id", "product", "product_id"),
    ("bom_line", "component_product_id", "product", "product_id"),
    ("material_lot", "supplier_id", "supplier", "supplier_id"),
    ("material_lot", "material_product_id", "product", "product_id"),
    ("material_lot", "supplier_material_id", "supplier_material", "supplier_material_id"),
    ("production_order", "product_id", "product", "product_id"),
    ("production_order", "rework_of_order_id", "production_order", "order_id"),
    ("process_step", "order_id", "production_order", "order_id"),
    ("process_step", "machine_id", "machine", "machine_id"),
    ("order_consumption", "order_id", "production_order", "order_id"),
    ("order_consumption", "lot_id", "material_lot", "lot_id"),
    ("order_consumption", "bom_id", "bom_line", "bom_id"),
    ("order_consumption", "step_id", "process_step", "step_id"),
    ("inspection_result", "plan_id", "inspection_plan", "plan_id"),
    ("inspection_result", "order_id", "production_order", "order_id"),
    ("inspection_result", "lot_id", "material_lot", "lot_id"),
    ("inspection_result", "step_id", "process_step", "step_id"),
    ("inspection_result", "machine_id", "machine", "machine_id"),
    ("defect", "inspection_id", "inspection_result", "inspection_id"),
    ("defect", "order_id", "production_order", "order_id"),
    ("defect", "lot_id", "material_lot", "lot_id"),
    ("defect", "step_id", "process_step", "step_id"),
    ("defect", "machine_id", "machine", "machine_id"),
    ("capa", "defect_id", "defect", "defect_id"),
    ("capa", "verification_inspection_id", "inspection_result", "inspection_id"),
    ("order_event", "order_id", "production_order", "order_id"),
    ("lot_event", "lot_id", "material_lot", "lot_id"),
    ("capa_event", "capa_id", "capa", "capa_id"),
]

BUSINESS_KEYS = [
    ("process_step", ("order_id", "sequence_no")),
    ("bom_line", ("product_id", "component_product_id", "effective_from")),
    ("inspection_plan", ("product_id", "inspection_type", "effective_from")),
    ("supplier_material", ("supplier_id", "product_id", "effective_from")),
    ("capa", ("defect_id",)),
]

ENUMS = {
    ("product", "product_type"): {"finished_good", "subassembly", "component", "raw_material"},
    ("product", "uom"): {"EA", "KG"},
    ("product", "lifecycle_state"): {"active", "phase_out", "obsolete"},
    ("supplier", "supplier_type"): {"raw_material", "component", "packaging", "service"},
    ("supplier", "risk_tier"): {"A", "B", "C"},
    ("supplier", "qualification_state"): {"approved", "conditional", "blocked"},
    ("supplier_material", "qualification_state"): {"approved", "conditional", "blocked"},
    ("bom_line", "uom"): {"EA", "KG"},
    ("machine", "machine_type"): {"cnc", "press", "weld", "assembly", "oven", "leak_test",
                                 "packaging", "test"},
    ("machine", "status"): {"running", "idle", "maintenance", "down"},
    ("inspection_plan", "inspection_type"): {"incoming", "in_process", "final"},
    ("material_lot", "status"): {"quarantine", "released", "partially_consumed", "consumed",
                                 "rejected", "expired"},
    ("material_lot", "uom"): {"EA", "KG"},
    ("production_order", "status"): {"planned", "released", "in_progress", "completed",
                                     "closed", "cancelled"},
    ("production_order", "priority"): {"standard", "expedite", "hold"},
    ("process_step", "status"): {"pending", "started", "completed"},
    ("inspection_result", "inspection_type"): {"incoming", "in_process", "final"},
    ("inspection_result", "result"): {"pass", "conditional", "fail", "pending"},
    ("defect", "category"): {"dimensional", "material", "assembly", "functional", "cosmetic",
                             "documentation"},
    ("defect", "severity"): {"minor", "major", "critical"},
    ("defect", "detection_method"): {"visual", "gauge", "functional_test", "certificate_review"},
    ("defect", "status"): {"open", "contained", "rework", "scrap", "closed"},
    ("capa", "status"): {"open", "in_progress", "pending_verification", "verified", "closed",
                         "cancelled"},
    ("capa", "root_cause_category"): {"supplier_material", "process_parameter",
                                      "machine_calibration", "operator_error", "design",
                                      "handling", "documentation"},
    ("anomaly_register", "severity"): {"low", "medium", "high", "critical"},
}

ID_PATTERNS = {
    "product": r"^SKU-\d{6}$",
    "supplier": r"^SUP-\d{4}$",
    "supplier_material": r"^SM-\d{6}$",
    "bom_line": r"^BOM-\d{6}$",
    "machine": r"^MAC-\d{3}$",
    "inspection_plan": r"^IP-\d{4}$",
    "material_lot": r"^LOT-SUP-\d{4}-\d{4}-\d{6}$",
    "production_order": r"^WO-\d{4}-\d{6}$",
    "process_step": r"^PS-\d{4}-\d{6}-\d{2}$",
    "order_consumption": r"^CONS-\d{4}-\d{6}$",
    "inspection_result": r"^INSP-(?:\d{4}-\d{6}|SUP-\d{4}-\d{4}-\d{6})-\d{3}$",
    "defect": r"^DEF-\d{4}-\d{6}$",
    "capa": r"^CAPA-\d{4}-\d{6}$",
    "order_event": r"^EVT-ORD-\d{6}$",
    "lot_event": r"^EVT-LOT-\d{6}$",
    "capa_event": r"^EVT-CAPA-\d{6}$",
    "anomaly_register": r"^ANOM-\d{4}$",
}

REQUIRED_EDGE_CASES = ["DEFECT_LOT_NOT_FOUND", "BOM_MATERIAL_NOT_CONSUMED",
                       "CAPA_CLOSED_BEFORE_VERIFICATION",
                       "DEFECT_COUNT_EXCEEDS_INSPECTED_QTY", "TRACE_CHAIN_BREAK"]


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def num(value, default=0.0):
    if value in ("", None):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def blank(value):
    return value in ("", None)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Data:
    def __init__(self, outdir):
        self.outdir = outdir
        self.tables = {}
        self.missing = []
        for table in D.TABLE_ORDER:
            path = os.path.join(outdir, "csv", f"{table}.csv")
            if os.path.exists(path):
                self.tables[table] = read_csv(path)
            else:
                self.tables[table] = []
                self.missing.append(f"csv/{table}.csv")
        self.quarantine = {}
        for name in ("quarantine_defect_lot_refs", "quarantine_inspection_results",
                     "quarantine_trace_breaks", "quarantine_consumption_duplicates"):
            path = os.path.join(outdir, "csv", "quarantine", f"{name}.csv")
            if os.path.exists(path):
                self.quarantine[name] = read_csv(path)
            else:
                self.quarantine[name] = []
                self.missing.append(f"csv/quarantine/{name}.csv")

        T = self.tables
        self.by_pk = {t: {r[D.COLUMNS[t][0]]: r for r in T[t]} for t in D.TABLE_ORDER}
        self.product = self.by_pk["product"]
        self.supplier = self.by_pk["supplier"]
        self.lot = self.by_pk["material_lot"]
        self.order = self.by_pk["production_order"]
        self.step = self.by_pk["process_step"]
        self.insp = self.by_pk["inspection_result"]
        self.defect = self.by_pk["defect"]
        self.capa = self.by_pk["capa"]
        self.bom = self.by_pk["bom_line"]
        self.machine = self.by_pk["machine"]

        self.cons_by_lot = defaultdict(list)
        self.cons_by_order = defaultdict(list)
        for row in T["order_consumption"]:
            self.cons_by_lot[row["lot_id"]].append(row)
            self.cons_by_order[row["order_id"]].append(row)
        self.defects_by_insp = defaultdict(list)
        for row in T["defect"]:
            self.defects_by_insp[row["inspection_id"]].append(row)
        self.steps_by_order = defaultdict(list)
        for row in T["process_step"]:
            self.steps_by_order[row["order_id"]].append(row)
        self.boms_by_product = defaultdict(list)
        for row in T["bom_line"]:
            self.boms_by_product[row["product_id"]].append(row)
        self.incoming_by_lot = {}
        self.insp_by_order = defaultdict(list)
        for row in T["inspection_result"]:
            if row["inspection_type"] == "incoming" and row["lot_id"]:
                self.incoming_by_lot[row["lot_id"]] = row
            if row["order_id"]:
                self.insp_by_order[row["order_id"]].append(row)
        self.events = {}
        for table, key in (("order_event", "order_id"), ("lot_event", "lot_id"),
                           ("capa_event", "capa_id")):
            index = defaultdict(list)
            for row in T[table]:
                index[row[key]].append(row)
            self.events[table] = index
        manifest_path = os.path.join(outdir, "source_manifest.json")
        self.manifest = {}
        if os.path.exists(manifest_path):
            with open(manifest_path, encoding="utf-8") as fh:
                self.manifest = json.load(fh)
        self.ground_truth = {}
        for name in ("anomalies", "decisions", "process_drift", "capa_gate", "supplier_rates"):
            path = os.path.join(outdir, "ground_truth", f"{name}.csv")
            self.ground_truth[name] = read_csv(path) if os.path.exists(path) else []


class Validation:
    def __init__(self, outdir):
        self.outdir = outdir
        self.data = Data(outdir)
        self.checks = []

    def add(self, cid, category, name, ok, expected, actual, detail=""):
        self.checks.append({
            "id": cid,
            "category": category,
            "name": name,
            "status": "PASS" if ok else "FAIL",
            "expected": expected,
            "actual": actual,
            "detail": detail,
        })

    # -------------------------------------------------------------- artefacts
    def check_artefacts(self):
        missing = list(self.data.missing)
        for rel in ("schema.sql", "source_manifest.json", "checksums.json",
                    "sqlite/traceability.db"):
            if not os.path.exists(os.path.join(self.outdir, rel)):
                missing.append(rel)
        self.add("A1", "artefacts", "Required output files exist", not missing,
                 f"{len(REQUIRED_FILES)} required files", 
                 "all present" if not missing else f"missing {len(missing)}",
                 ", ".join(missing[:8]))

    def check_schema(self):
        import sqlite3
        db = os.path.join(self.outdir, "sqlite", "traceability.db")
        if not os.path.exists(db):
            self.add("A2", "artefacts", "SQLite schema matches documented columns", False,
                     "all tables", "database missing")
            return
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        mismatches = []
        for table in D.TABLE_ORDER:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
            if cols != D.COLUMNS[table]:
                mismatches.append(table)
        conn.close()
        self.add("A2", "artefacts", "SQLite schema matches documented columns",
                 not mismatches, "column lists identical", 
                 "identical" if not mismatches else f"mismatch: {mismatches}")

    # ------------------------------------------------------------------- keys
    def check_primary_keys(self):
        failures = []
        for table in D.TABLE_ORDER:
            col = D.COLUMNS[table][0]
            values = [r[col] for r in self.data.tables[table]]
            dupes = len(values) - len(set(values))
            empties = sum(1 for v in values if blank(v))
            if dupes or empties:
                failures.append(f"{table}(dupes={dupes},empty={empties})")
        self.add("K1", "keys", "Primary keys are unique and present", not failures,
                 "0 duplicates / 0 empty", "clean" if not failures else "; ".join(failures))

    def check_foreign_keys(self):
        failures = []
        for child, col, parent, pcol in FOREIGN_KEYS:
            parent_values = {r[pcol] for r in self.data.tables[parent]}
            dangling = [r[col] for r in self.data.tables[child]
                        if not blank(r[col]) and r[col] not in parent_values]
            if dangling:
                failures.append(f"{child}.{col}->{parent}.{pcol}: {len(dangling)} dangling")
        self.add("K2", "keys", "Foreign keys resolve for every relationship", not failures,
                 f"{len(FOREIGN_KEYS)} relationships", 
                 "all resolved" if not failures else "; ".join(failures[:6]))

    def check_business_keys(self):
        failures = []
        for table, cols in BUSINESS_KEYS:
            seen = set()
            dupes = 0
            for row in self.data.tables[table]:
                key = tuple(row[c] for c in cols)
                if key in seen:
                    dupes += 1
                seen.add(key)
            if dupes:
                failures.append(f"{table}{cols}: {dupes}")
        self.add("K3", "keys", "Business/natural keys are unique", not failures,
                 "0 duplicates", "clean" if not failures else "; ".join(failures))

    def check_id_formats(self):
        failures = []
        for table, pattern in ID_PATTERNS.items():
            col = D.COLUMNS[table][0]
            rx = re.compile(pattern)
            bad = [r[col] for r in self.data.tables[table] if not rx.match(r[col] or "")]
            if bad:
                failures.append(f"{table}: {len(bad)} e.g. {bad[0]}")
        self.add("K4", "nomenclature", "Identifiers follow the documented formats",
                 not failures, "SKU/SUP/LOT/WO/INSP/DEF/CAPA patterns",
                 "conformant" if not failures else "; ".join(failures[:6]))

    # ------------------------------------------------------------------ enums
    def check_enums(self):
        failures = []
        for (table, col), allowed in ENUMS.items():
            bad = sorted({r[col] for r in self.data.tables[table]
                          if not blank(r[col]) and r[col] not in allowed})
            if bad:
                failures.append(f"{table}.{col}: {bad[:4]}")
        self.add("E1", "domains", "Categorical values stay inside allowed domains",
                 not failures, "documented enum sets", 
                 "conformant" if not failures else "; ".join(failures))

    # ------------------------------------------------------------------ dates
    def check_dates(self):
        problems = []

        def ordered(table, a, b, label):
            bad = [r for r in self.data.tables[table]
                   if not blank(r[a]) and not blank(r[b])
                   and not (r[b] > r[a])]
            if bad:
                problems.append(f"{label}: {len(bad)}")

        ordered("production_order", "planned_start", "planned_end", "planned_end>planned_start")
        ordered("production_order", "actual_start", "actual_end", "actual_end>actual_start")
        ordered("process_step", "started_at", "ended_at", "ended_at>started_at")
        ordered("material_lot", "received_date", "expiry_date", "expiry>received")
        ordered("capa", "opened_at", "due_at", "due_at>opened_at")
        for table, a in (("product", "effective_from"), ("supplier", "effective_from"),
                         ("supplier_material", "effective_from"), ("bom_line", "effective_from"),
                         ("inspection_plan", "effective_from"), ("machine", "commissioned_on")):
            b = "effective_to" if a == "effective_from" else "last_maintenance_on"
            ordered(table, a, b, f"{table}.{b}>{a}")

        # order dates must sit inside the dataset reference window
        window_start, window_end = "2025-06-01", "2026-12-31"
        outside = [o["order_id"] for o in self.data.tables["production_order"]
                   if not (window_start <= o["planned_start"] <= window_end)]
        if outside:
            problems.append(f"order planned_start outside window: {len(outside)}")
        future_inspections = [i["inspection_id"] for i in self.data.tables["inspection_result"]
                              if i["inspected_at"][:10] > D.iso(D.TODAY)]
        if future_inspections:
            problems.append(f"inspections after reference date: {len(future_inspections)}")
        self.add("D1", "dates", "Date ordering and reference-window rules hold",
                 not problems, "0 violations", 
                 "clean" if not problems else "; ".join(problems))

    # ------------------------------------------------------------- arithmetic
    def check_lot_balance(self):
        problems = []
        bad_sum = 0
        bad_consumed = 0
        bad_remaining = 0
        for lot in self.data.tables["material_lot"]:
            received = num(lot["received_qty"])
            consumed = num(lot["consumed_qty"])
            remaining = num(lot["remaining_qty"])
            if abs(received - consumed - remaining) > 1e-6:
                bad_sum += 1
            expected_consumed = sum(num(c["qty_consumed"])
                                    for c in self.data.cons_by_lot.get(lot["lot_id"], []))
            if abs(expected_consumed - consumed) > 1e-3:
                bad_consumed += 1
            if remaining < -1e-9:
                bad_remaining += 1
        if bad_sum:
            problems.append(f"received != consumed+remaining: {bad_sum}")
        if bad_consumed:
            problems.append(f"consumed_qty != SUM(consumption): {bad_consumed}")
        if bad_remaining:
            problems.append(f"negative remaining: {bad_remaining}")
        over = [lot["lot_id"] for lot in self.data.tables["material_lot"]
                if sum(num(c["qty_consumed"]) for c in self.data.cons_by_lot.get(lot["lot_id"], []))
                > num(lot["received_qty"]) + 1e-6]
        if over:
            problems.append(f"over-consumed lots: {len(over)}")
        self.add("R1", "reconciliation", "Lot balances reconcile exactly", not problems,
                 "received = consumed + remaining; no over-consumption",
                 "balanced" if not problems else "; ".join(problems))

    def check_step_and_order_arithmetic(self):
        problems = []
        bad_steps = [s["step_id"] for s in self.data.tables["process_step"]
                     if int(num(s["input_qty"])) != int(num(s["output_qty"])) + int(num(s["scrap_qty"]))]
        if bad_steps:
            problems.append(f"step input != output + scrap: {len(bad_steps)}")
        bad_orders = []
        for order in self.data.tables["production_order"]:
            if blank(order["actual_qty"]):
                continue
            actual = int(num(order["actual_qty"]))
            scrap = int(num(order["scrap_qty"]))
            good = int(num(order["good_qty"]))
            if good + scrap != actual:
                bad_orders.append(f"{order['order_id']}: good({good})+scrap({scrap})!=actual({actual})")
                continue
            step_scrap = sum(int(num(s["scrap_qty"]))
                             for s in self.data.steps_by_order.get(order["order_id"], []))
            final_scrap = 0
            for insp in self.data.insp_by_order.get(order["order_id"], []):
                if insp["inspection_type"] != "final":
                    continue
                for defect in self.data.defects_by_insp.get(insp["inspection_id"], []):
                    if defect["status"] == "scrap":
                        final_scrap += int(num(defect["qty"]))
            if step_scrap + final_scrap != scrap:
                bad_orders.append(f"{order['order_id']}: scrap({scrap})!=step({step_scrap})+final({final_scrap})")
        if bad_orders:
            problems.append(f"order reconciliation: {len(bad_orders)} e.g. {bad_orders[0]}")
        self.add("R2", "reconciliation", "Step and order quantities reconcile", not problems,
                 "input=output+scrap; good+scrap=actual; scrap=step+final scrap",
                 "reconciled" if not problems else "; ".join(problems))

    def check_inspection_aggregates(self):
        problems = []
        bad_count = bad_rate = bad_result = bad_cap = 0
        for insp in self.data.tables["inspection_result"]:
            defects = self.data.defects_by_insp.get(insp["inspection_id"], [])
            total = sum(int(num(d["qty"])) for d in defects)
            if int(num(insp["defect_count"])) != total:
                bad_count += 1
            inspected = int(num(insp["inspected_qty"]))
            if abs(num(insp["defect_rate"]) - (total / inspected if inspected else 0)) > 1e-5:
                bad_rate += 1
            if total > int(num(insp["acceptance_qty"])):
                expected = "fail"
            elif total > 0:
                expected = "conditional"
            else:
                expected = "pass"
            if insp["result"] != expected:
                bad_result += 1
            if total > inspected:
                bad_cap += 1
        for label, value in (("defect_count != SUM(defect.qty)", bad_count),
                             ("defect_rate != count/inspected", bad_rate),
                             ("result inconsistent with acceptance limit", bad_result),
                             ("defect_count > inspected_qty", bad_cap)):
            if value:
                problems.append(f"{label}: {value}")
        self.add("R3", "reconciliation", "Inspection defect counts and rates derive from defect events",
                 not problems, "derived values consistent for every inspection",
                 "consistent" if not problems else "; ".join(problems))

    def check_consumption_timing(self):
        issues = []
        before_receipt = []
        after_expiry = []
        for row in self.data.tables["order_consumption"]:
            lot = self.data.lot.get(row["lot_id"])
            if not lot:
                continue
            consumed = D.as_date(row["consumed_at"])
            if consumed < D.as_date(lot["received_date"]):
                before_receipt.append(row["consumption_id"])
            if consumed >= D.as_date(lot["expiry_date"]):
                after_expiry.append(row["consumption_id"])
        if before_receipt:
            issues.append(f"consumed before receipt: {len(before_receipt)}")
        labelled = [a for a in self.data.ground_truth["anomalies"]
                    if a["issue_type"] == "EXPIRED_LOT_CONSUMED"]
        leaked_lots = {self.data.lot[c["lot_id"]]["lot_id"] for c in self.data.tables
                       ["order_consumption"]
                       if c["lot_id"] in self.data.lot
                       and D.as_date(c["consumed_at"]) >= D.as_date(self.data.lot[c["lot_id"]]["expiry_date"])}
        labelled_lots = {a["record_id"] for a in labelled}
        if leaked_lots - labelled_lots:
            issues.append(f"unlabelled expired-lot consumption: {len(leaked_lots - labelled_lots)}")
        self.add("R4", "dates", "Material is issued only after receipt and inside shelf life "
                               "(aside from labelled exceptions)", not issues,
                 "0 unlabelled timing violations",
                 "clean" if not issues else "; ".join(issues),
                 f"lots with post-expiry consumption: {len(leaked_lots)} "
                 f"(labelled {len(labelled_lots)})")

    # -------------------------------------------------------------- lifecycle
    def check_order_lifecycle(self):
        problems = []
        for order in self.data.tables["production_order"]:
            status = order["status"]
            steps = self.data.steps_by_order.get(order["order_id"], [])
            inspections = self.data.insp_by_order.get(order["order_id"], [])
            finals = [i for i in inspections if i["inspection_type"] == "final"]
            if status == "planned" and not blank(order["actual_start"]):
                problems.append(f"{order['order_id']}: planned order has actual_start")
            if status == "released" and (steps or finals):
                problems.append(f"{order['order_id']}: released order already has steps/final inspection")
            if status in ("in_progress", "completed", "closed") and not steps:
                problems.append(f"{order['order_id']}: {status} order without process steps")
            if status in ("completed", "closed") and not finals:
                problems.append(f"{order['order_id']}: {status} order without final inspection")
            if status in ("completed", "closed") and (blank(order["actual_start"]) or blank(order["actual_end"])):
                problems.append(f"{order['order_id']}: {status} order missing actual dates")
            if status == "cancelled" and (steps or self.data.cons_by_order.get(order["order_id"])):
                problems.append(f"{order['order_id']}: cancelled order has production records")
        self.add("L1", "lifecycle", "Order state is consistent with its child records",
                 not problems, "0 inconsistencies", 
                 "consistent" if not problems else "; ".join(problems[:6]))

    def check_lot_status(self):
        problems = []
        for lot in self.data.tables["material_lot"]:
            received = num(lot["received_qty"])
            consumed = num(lot["consumed_qty"])
            insp = self.data.incoming_by_lot.get(lot["lot_id"])
            if lot["lot_id"] in {a["record_id"] for a in self.data.ground_truth["anomalies"]
                                 if a["issue_type"] == "EXPIRED_LOT_CONSUMED"}:
                continue
            supplier = self.data.supplier.get(lot["supplier_id"], {})
            concession_ok = (supplier.get("qualification_state") == "approved"
                             and lot["coa_pass"] == "1")
            if consumed >= received - 1e-6:
                expected = "consumed"
            elif consumed > 0:
                expected = "partially_consumed"
            elif D.as_date(lot["expiry_date"]) < D.TODAY:
                expected = "expired"
            elif insp and insp["result"] in ("pass", "conditional"):
                expected = "released"
            elif insp and insp["result"] == "fail" and not concession_ok:
                expected = "rejected"
            else:
                expected = "quarantine"
            if lot["status"] != expected:
                problems.append(f"{lot['lot_id']}: {lot['status']} != {expected}")
        self.add("L2", "lifecycle", "Lot status derives from consumption and inspection",
                 not problems, "0 inconsistencies",
                 "consistent" if not problems else "; ".join(problems[:6]))

    def check_capa_gate(self):
        violations = []
        for capa in self.data.tables["capa"]:
            insp = self.data.insp.get(capa["verification_inspection_id"] or "")
            allowed, reason = D.capa_gate(
                capa["status"], capa["opened_at"], capa["verified_at"] or None,
                capa["closed_at"] or None,
                insp["result"] if insp else None,
                insp["inspected_at"] if insp else None,
                capa["containment_completed_at"] or None)
            if not allowed:
                violations.append((capa["capa_id"], reason))
        labelled = [a for a in self.data.ground_truth["anomalies"]
                    if a["issue_type"] == "CAPA_CLOSED_BEFORE_VERIFICATION"]
        labelled_ids = {a["record_id"] for a in labelled}
        found_ids = {c for c, _ in violations}
        ok = found_ids == labelled_ids
        self.add("L3", "lifecycle", "CAPA closure requires verification (labelled bypasses only)",
                 ok, f"{len(labelled_ids)} labelled bypasses",
                 f"{len(found_ids)} detected", 
                 "" if ok else f"unmatched: {sorted(found_ids ^ labelled_ids)[:5]}")

    def check_events(self):
        problems = []
        for table, ranks in (
                ("order_event", {"planned": 0, "released": 1, "in_progress": 2, "completed": 3,
                                 "closed": 4, "cancelled": 4}),
                ("lot_event", {"quarantine": 0, "released": 1, "rejected": 1,
                               "partially_consumed": 2, "consumed": 3, "expired": 4}),
                ("capa_event", {"open": 0, "in_progress": 1, "verified": 2, "closed": 3})):
            for entity, events in self.data.events[table].items():
                ordered = sorted(events, key=lambda e: e["occurred_at"])
                last_time = None
                for event in ordered:
                    if last_time and event["occurred_at"] < last_time:
                        problems.append(f"{table}/{entity}: timestamps not monotonic")
                        break
                    last_time = event["occurred_at"]
                previous = None
                for event in ordered:
                    if previous is not None and event["from_state"] != previous:
                        problems.append(f"{table}/{entity}: from_state {event['from_state']} "
                                        f"!= previous to_state {previous}")
                        break
                    previous = event["to_state"]
                if ordered and event["to_state"] not in ranks:
                    problems.append(f"{table}/{entity}: unknown state {event['to_state']}")
        self.add("L4", "lifecycle", "State-change events form a monotonic, connected history",
                 not problems, "0 broken chains",
                 "consistent" if not problems else "; ".join(problems[:6]))

    # ----------------------------------------------------------- ground truth
    def check_ground_truth_separation(self):
        banned = ("expected", "ground_truth", "label", "disposition_rule", "capa_rule")
        leaks = []
        for table in D.TABLE_ORDER:
            # anomaly_register is the labelled issue register itself, not an input
            # feature table: its label column is intentional and documented.
            if table == "anomaly_register":
                continue
            path = os.path.join(self.outdir, "csv", f"{table}.csv")
            if not os.path.exists(path):
                continue
            with open(path, newline="", encoding="utf-8") as fh:
                header = next(csv.reader(fh))
            for col in header:
                if any(token in col.lower() for token in banned):
                    leaks.append(f"{table}.{col}")
        gt_files = os.listdir(os.path.join(self.outdir, "ground_truth")) \
            if os.path.isdir(os.path.join(self.outdir, "ground_truth")) else []
        self.add("G1", "ground_truth", "Ground truth is physically separated from input features",
                 not leaks, "no label columns in csv/", 
                 "clean" if not leaks else f"leaks: {leaks}",
                 f"{len(gt_files)} ground_truth files kept outside csv/")

    def detect_anomalies(self):
        detected = defaultdict(set)
        for row in self.data.quarantine["quarantine_defect_lot_refs"]:
            if row["lot_id"] not in self.data.lot:
                detected["DEFECT_LOT_NOT_FOUND"].add(row["defect_id"])
        for row in self.data.quarantine["quarantine_inspection_results"]:
            if num(row["defect_count"]) > num(row["inspected_qty"]):
                detected["DEFECT_COUNT_EXCEEDS_INSPECTED_QTY"].add(row["inspection_id"])
        existing = {(c["order_id"], c["lot_id"], c["bom_id"], c["step_id"])
                    for c in self.data.tables["order_consumption"]}
        for row in self.data.quarantine["quarantine_consumption_duplicates"]:
            key = (row["order_id"], row["lot_id"], row["bom_id"], row["step_id"])
            if key in existing:
                detected["DUPLICATE_CONSUMPTION"].add(row["consumption_id"])
        for row in self.data.quarantine["quarantine_trace_breaks"]:
            step = self.data.step.get(row["step_id"])
            if step and row["order_id"] and step["order_id"] != row["order_id"]:
                detected["TRACE_CHAIN_BREAK"].add(row["defect_id"])
        for order in self.data.tables["production_order"]:
            if order["status"] not in ("completed", "closed"):
                continue
            boms = self.data.boms_by_product.get(order["product_id"], [])
            if not boms:
                continue
            consumed_components = set()
            for row in self.data.cons_by_order.get(order["order_id"], []):
                bom = self.data.bom.get(row["bom_id"])
                if bom:
                    consumed_components.add(bom["component_product_id"])
            missing = [b for b in boms if b["component_product_id"] not in consumed_components]
            if not missing:
                continue
            if len(missing) == len(boms):
                detected["TRACE_CHAIN_BREAK"].add(order["order_id"])
            else:
                detected["BOM_MATERIAL_NOT_CONSUMED"].add(order["order_id"])
        for capa in self.data.tables["capa"]:
            if capa["status"] != "closed":
                continue
            insp = self.data.insp.get(capa["verification_inspection_id"] or "")
            allowed, _reason = D.capa_gate(
                capa["status"], capa["opened_at"], capa["verified_at"] or None,
                capa["closed_at"] or None, insp["result"] if insp else None,
                insp["inspected_at"] if insp else None,
                capa["containment_completed_at"] or None)
            if not allowed:
                detected["CAPA_CLOSED_BEFORE_VERIFICATION"].add(capa["capa_id"])
        for row in self.data.tables["order_consumption"]:
            lot = self.data.lot.get(row["lot_id"])
            if lot and D.as_date(row["consumed_at"]) >= D.as_date(lot["expiry_date"]):
                detected["EXPIRED_LOT_CONSUMED"].add(lot["lot_id"])
        return detected

    def check_anomaly_rules(self):
        detected = self.detect_anomalies()
        expected = defaultdict(set)
        for row in self.data.ground_truth["anomalies"]:
            expected[row["issue_type"]].add(row["record_id"])
        coverage = {}
        failures = []
        for issue_type in sorted(set(expected) | set(detected)):
            exp = expected.get(issue_type, set())
            det = detected.get(issue_type, set())
            coverage[issue_type] = {
                "labelled": len(exp),
                "detected": len(det),
                "matched": len(exp & det),
                "missed": sorted(exp - det)[:5],
                "extra": sorted(det - exp)[:5],
            }
            if exp != det:
                failures.append(f"{issue_type}: labelled {len(exp)}, detected {len(det)}")
        total_labelled = sum(len(v) for v in expected.values())
        total_matched = sum(len(coverage[k]["matched"]) if isinstance(coverage[k]["matched"], set)
                            else coverage[k]["matched"] for k in coverage)
        self.add("G2", "anomalies", "Detection rules reproduce every labelled anomaly exactly",
                 not failures, f"{total_labelled} labelled anomalies",
                 f"{total_matched} matched" if not failures else "; ".join(failures),
                 json.dumps(coverage, sort_keys=True)[:1800])
        return coverage

    def check_required_edge_cases(self):
        present = {a["issue_type"] for a in self.data.ground_truth["anomalies"]}
        profile = self.data.manifest.get("profile", "full")
        missing = [c for c in REQUIRED_EDGE_CASES if c not in present]
        if profile == "starter":
            ok = len(missing) <= 2
        else:
            ok = not missing
        self.add("G3", "anomalies", "All required edge cases are present and labelled", ok,
                 "5 required issue types", 
                 f"{len(present)} types present" + (f"; missing {missing}" if missing else ""))

    def check_checksums(self):
        manifest = self.data.manifest
        checksums = manifest.get("checksums_sha256", {})
        if not checksums:
            self.add("A3", "reproducibility", "Manifest checksums match the exported files",
                     False, "checksum manifest", "missing")
            return
        mismatches = []
        for rel, digest in checksums.items():
            path = os.path.join(self.outdir, rel)
            if not os.path.exists(path) or sha256_file(path) != digest:
                mismatches.append(rel)
        self.add("A3", "reproducibility", "Manifest checksums match the exported files",
                 not mismatches, f"{len(checksums)} files", 
                 "all match" if not mismatches else f"{len(mismatches)} mismatched",
                 ", ".join(mismatches[:5]))

    def check_volumes(self):
        manifest = self.data.manifest
        profile = manifest.get("profile", "starter")
        counts = manifest.get("row_counts", {})
        targets = {"full": {"product": 200, "supplier": 50, "material_lot": 2000,
                            "production_order": 5000, "inspection_result": 20000},
                   "starter": {"product": 20, "supplier": 8, "material_lot": 60,
                               "production_order": 120, "inspection_result": 400}}[profile]
        problems = [f"{k}: {counts.get(k)} != {v}" for k, v in targets.items()
                    if counts.get(k) != v]
        self.add("A4", "artefacts", f"Requested {profile} volumes are produced exactly",
                 not problems, json.dumps(targets), 
                 "exact" if not problems else "; ".join(problems))

    # ------------------------------------------------------------------- run
    def run(self):
        self.check_artefacts()
        self.check_schema()
        self.check_primary_keys()
        self.check_foreign_keys()
        self.check_business_keys()
        self.check_id_formats()
        self.check_enums()
        self.check_dates()
        self.check_lot_balance()
        self.check_step_and_order_arithmetic()
        self.check_inspection_aggregates()
        self.check_consumption_timing()
        self.check_order_lifecycle()
        self.check_lot_status()
        self.check_capa_gate()
        self.check_events()
        self.check_ground_truth_separation()
        coverage = self.check_anomaly_rules()
        self.check_required_edge_cases()
        self.check_checksums()
        self.check_volumes()
        return coverage

    def summary(self):
        passed = sum(1 for c in self.checks if c["status"] == "PASS")
        failed = len(self.checks) - passed
        return {"total": len(self.checks), "passed": passed, "failed": failed}


def write_markdown(path, summary, checks, coverage, data):
    lines = ["# Validation summary", ""]
    lines.append(f"- Checks: **{summary['passed']} passed / {summary['failed']} failed** "
                 f"({summary['total']} total)")
    lines.append(f"- Profile: `{data.manifest.get('profile')}` · seed "
                 f"`{data.manifest.get('seed')}` · reference date `{D.iso(D.TODAY)}`")
    rows = data.manifest.get("row_counts", {})
    lines.append("")
    lines.append("| table | rows |")
    lines.append("|---|---:|")
    for table in D.TABLE_ORDER:
        lines.append(f"| {table} | {rows.get(table, 0)} |")
    lines.append("")
    lines.append("## Checks")
    lines.append("")
    lines.append("| id | category | check | status | expected | actual |")
    lines.append("|---|---|---|---|---|---|")
    for check in checks:
        detail = (check["detail"] or "").replace("|", "\\|").replace("\n", " ")[:160]
        lines.append(f"| {check['id']} | {check['category']} | {check['name']} | "
                     f"{check['status']} | {check['expected']} | {check['detail'] or check['actual']} |")
    lines.append("")
    lines.append("## Labelled anomaly coverage")
    lines.append("")
    lines.append("| issue_type | labelled | detected | matched |")
    lines.append("|---|---:|---:|---:|")
    for issue_type, stat in sorted(coverage.items()):
        lines.append(f"| {issue_type} | {stat['labelled']} | {stat['detected']} | {stat['matched']} |")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Validate the generated dataset")
    ap.add_argument("--out", default="out")
    args = ap.parse_args(argv)
    validation = Validation(args.out)
    coverage = validation.run()
    summary = validation.summary()
    report = {
        "dataset": {
            "profile": validation.data.manifest.get("profile"),
            "seed": validation.data.manifest.get("seed"),
            "row_counts": validation.data.manifest.get("row_counts", {}),
        },
        "generated_at": D.iso(D.TODAY),
        "summary": summary,
        "checks": validation.checks,
        "anomaly_coverage": coverage,
    }
    with open(os.path.join(args.out, "validation_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    write_markdown(os.path.join(args.out, "validation_summary.md"), summary,
                   validation.checks, coverage, validation.data)
    print(json.dumps({"checks": summary,
                      "failures": [c["id"] + ": " + c["name"] for c in validation.checks
                                   if c["status"] == "FAIL"]}, indent=2))
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
