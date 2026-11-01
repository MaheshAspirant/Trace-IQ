"""TraceIQ API v2.

Read endpoints are derived from the generated dataset (immutable). Write
endpoints (CAPA lifecycle, defect containment, preferences) persist to
``out/ops.db`` through :mod:`ops`, so regeneration never destroys user work and
validation of the generated evidence is unaffected.
"""
from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime

import domain as D
import trace as T
from analytics import Dataset
from ops import OpsStore, now_iso

API_VERSION = "2.0.0"
ACTOR = "quality.manager"

CAPA_STATUSES = ["open", "in_progress", "pending_verification", "verified", "closed", "cancelled"]
OWNER_ROLES = [
    "quality_engineer", "supplier_quality", "process_engineer", "maintenance_lead",
    "production_supervisor", "quality_manager",
]
DEFECT_TRANSITIONS = {
    "open": {"contain", "rework", "scrap"},
    "contained": {"contain", "rework", "scrap", "close"},
    "rework": {"close", "scrap"},
    "scrap": {"close"},
    "closed": set(),
}
ACTION_TO_STATUS = {"contain": "contained", "rework": "rework", "scrap": "scrap", "close": "closed"}


# --------------------------------------------------------------------- helpers
def _num(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _rate(part, whole):
    return round(part / whole, 6) if whole else 0.0


def _sort(rows, key, desc=True):
    present = [r for r in rows if r.get(key) is not None]
    missing = [r for r in rows if r.get(key) is None]
    try:
        present.sort(key=lambda r: r[key], reverse=desc)
    except TypeError:
        present.sort(key=lambda r: str(r[key]), reverse=desc)
    return present + missing


def _match(text, needle):
    return needle in (text or "").lower()


def paginate(rows, query, default_size=25):
    size = max(5, min(200, _int(query.get("size"), default_size)))
    pages = max(1, math.ceil(len(rows) / size))
    page = min(max(1, _int(query.get("page"), 1)), pages)
    start = (page - 1) * size
    return {
        "rows": rows[start:start + size],
        "total": len(rows),
        "page": page,
        "size": size,
        "pages": pages,
    }


def envelope(rows, query, **extra):
    payload = paginate(rows, query)
    payload.update(extra)
    return payload


class Api:
    def __init__(self, outdir: str):
        self.outdir = outdir
        self.ds = Dataset(os.path.join(outdir, "sqlite", "traceability.db"))
        self.ops = OpsStore(os.path.join(outdir, "ops.db"))
        self._reports: dict = {}

    # ------------------------------------------------------------------ meta
    def report(self, name):
        if name not in self._reports:
            path = os.path.join(self.outdir, f"{name}.json")
            payload = {}
            if os.path.exists(path):
                with open(path, encoding="utf-8") as fh:
                    payload = json.load(fh)
            self._reports[name] = payload
        return self._reports[name]

    def meta(self):
        manifest = self.report("source_manifest")
        return {
            "name": "TraceIQ",
            "api_version": API_VERSION,
            "writable": True,
            "profile": manifest.get("profile"),
            "seed": manifest.get("seed"),
            "dataset_version": manifest.get("dataset_version"),
            "reference_date": manifest.get("reference_date"),
            "generated_at": manifest.get("generated_at"),
            "row_counts": manifest.get("row_counts", {}),
            "generator_command": manifest.get("generator_command"),
            "sources": manifest.get("sources", []),
            "checksums": manifest.get("checksums_sha256"),
            "actions_recorded": len(self.ops.recent_activity(limit=100000)),
        }

    # ------------------------------------------------------------- dashboard
    def _monthly(self):
        insp = self.ds.q("""
            SELECT strftime('%Y-%m', inspected_at) AS month,
                   COUNT(*) AS inspections,
                   SUM(inspected_qty) AS inspected_qty,
                   SUM(defect_count) AS defect_qty,
                   SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) AS failed,
                   SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) AS passed
            FROM inspection_result GROUP BY 1
        """)
        prod = self.ds.q("""
            SELECT strftime('%Y-%m', COALESCE(actual_end, actual_start)) AS month,
                   SUM(actual_qty) AS produced_qty, SUM(scrap_qty) AS scrap_qty,
                   SUM(good_qty) AS good_qty
            FROM production_order WHERE actual_qty IS NOT NULL GROUP BY 1
        """)
        merged = {}
        for row in insp:
            if not row["month"]:
                continue
            merged[row["month"]] = {
                "month": row["month"], "inspections": row["inspections"],
                "inspected_qty": row["inspected_qty"] or 0, "defect_qty": row["defect_qty"] or 0,
                "failed": row["failed"] or 0, "passed": row["passed"] or 0,
                "produced_qty": 0, "scrap_qty": 0, "good_qty": 0,
            }
        for row in prod:
            if not row["month"]:
                continue
            entry = merged.setdefault(row["month"], {
                "month": row["month"], "inspections": 0, "inspected_qty": 0, "defect_qty": 0,
                "failed": 0, "passed": 0, "produced_qty": 0, "scrap_qty": 0, "good_qty": 0,
            })
            entry["produced_qty"] = row["produced_qty"] or 0
            entry["scrap_qty"] = row["scrap_qty"] or 0
            entry["good_qty"] = row["good_qty"] or 0
        out = []
        for month in sorted(merged):
            row = merged[month]
            row["defect_rate"] = _rate(row["defect_qty"], row["inspected_qty"])
            row["scrap_rate"] = _rate(row["scrap_qty"], row["produced_qty"])
            row["fail_rate"] = _rate(row["failed"], row["inspections"])
            out.append(row)
        return out

    def _defect_groups(self, dimension):
        joins = {
            "supplier": "JOIN material_lot l ON l.lot_id = d.lot_id JOIN supplier s ON s.supplier_id = l.supplier_id",
            "machine": "JOIN machine m ON m.machine_id = d.machine_id",
            "product": ("LEFT JOIN production_order o ON o.order_id = d.order_id "
                        "LEFT JOIN material_lot l ON l.lot_id = d.lot_id "
                        "JOIN product p ON p.product_id = COALESCE(o.product_id, l.material_product_id)"),
        }[dimension]
        cols = {
            "supplier": "s.supplier_id AS id, s.name AS name",
            "machine": "m.machine_id AS id, m.name AS name",
            "product": "p.product_id AS id, p.name AS name",
        }[dimension]
        return self.ds.q(f"""
            SELECT {cols}, SUM(d.qty) AS qty, COUNT(*) AS events
            FROM defect d {joins}
            GROUP BY 1, 2 ORDER BY qty DESC LIMIT 8
        """)

    def _capa_merged(self):
        rows = self.ds.q("""
            SELECT c.capa_id, c.defect_id, c.root_cause_category, c.containment_action,
                   c.containment_completed_at, c.corrective_action, c.preventive_action,
                   c.owner_role, c.opened_at, c.due_at, c.verification_inspection_id,
                   c.verified_at, c.closed_at, c.status, c.effectiveness_score,
                   d.severity, d.defect_code, d.defect_name, d.category AS defect_category,
                   d.qty, d.detected_at, d.order_id, d.lot_id, d.machine_id,
                   o.product_id, p.name AS product_name,
                   l.supplier_id, s.name AS supplier_name,
                   i.result AS verification_result, i.inspected_at AS verification_date
            FROM capa c
            JOIN defect d ON d.defect_id = c.defect_id
            LEFT JOIN production_order o ON o.order_id = d.order_id
            LEFT JOIN product p ON p.product_id = o.product_id
            LEFT JOIN material_lot l ON l.lot_id = d.lot_id
            LEFT JOIN supplier s ON s.supplier_id = l.supplier_id
            LEFT JOIN inspection_result i ON i.inspection_id = c.verification_inspection_id
            ORDER BY c.capa_id
        """)
        overrides = self.ops.capa_overrides()
        extra_ids = {o["verification_inspection_id"] for o in overrides.values()
                     if o.get("verification_inspection_id")}
        inspections = {}
        if extra_ids:
            marks = ",".join("?" for _ in extra_ids)
            for row in self.ds.q(
                f"SELECT inspection_id, result, inspected_at FROM inspection_result "
                f"WHERE inspection_id IN ({marks})", tuple(extra_ids)
            ):
                inspections[row["inspection_id"]] = row
        today = D.iso(D.TODAY)
        for row in rows:
            override = overrides.get(row["capa_id"])
            if override:
                for key in ("status", "containment_completed_at", "verification_inspection_id",
                            "verified_at", "closed_at", "effectiveness_score", "owner_role",
                            "root_cause_category", "corrective_action"):
                    if key in override:
                        row[key] = override[key]
                if override.get("verification_inspection_id"):
                    found = inspections.get(override["verification_inspection_id"])
                    if found:
                        row["verification_result"] = found["result"]
                        row["verification_date"] = found["inspected_at"]
                    else:
                        row["verification_result"] = None
                        row["verification_date"] = None
            allowed, reason = D.capa_gate(
                row["status"], row["opened_at"], row["verified_at"], row["closed_at"],
                row["verification_result"], row["verification_date"],
                row["containment_completed_at"])
            row["closure_allowed"] = int(bool(allowed))
            row["gate_reason"] = reason
            row["days_overdue"] = 0
            if row["status"] not in ("closed", "cancelled") and row["due_at"] < today:
                row["days_overdue"] = (D.as_date(today) - D.as_date(row["due_at"])).days
            row["days_open"] = (D.as_date(today) - D.as_date(row["opened_at"])).days
            row["overridden"] = bool(override)
        return rows

    def dashboard(self):
        overview = self.ds.overview()
        trend = self._monthly()
        capas = self._capa_merged()
        open_capas = [c for c in capas if c["status"] in ("open", "in_progress", "pending_verification")]
        suppliers = self.ds.supplier_scorecard()
        incoming_qty = sum(s["incoming_inspected_qty"] for s in suppliers)
        incoming_defects = sum(s["incoming_defect_qty"] for s in suppliers)
        incoming_rate = _rate(incoming_defects, incoming_qty)
        worst = max(suppliers, key=lambda s: s["incoming_defect_rate"], default=None)
        completed = self.ds.q1("""
            SELECT SUM(CASE WHEN status IN ('completed','closed') THEN 1 ELSE 0 END) AS completed,
                   SUM(CASE WHEN rework_of_order_id IS NOT NULL THEN 1 ELSE 0 END) AS rework,
                   COUNT(*) AS total
            FROM production_order
        """)
        defects = overview["counts"]["defects"]
        defect_qty = overview["quality"]["defect_qty"]
        current_rate = trend[-1]["defect_rate"] if trend else 0
        previous_rate = trend[-2]["defect_rate"] if len(trend) > 1 else 0
        anomalies = self.ds.q1("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN severity IN ('critical','high') THEN 1 ELSE 0 END) AS severe
            FROM anomaly_register
        """)
        machines = self.ds.machine_scorecard()
        drift_machines = [m for m in machines if m["drift_weeks"] >= 2]
        gate_violations = overview["capa"]["closure_gate_violations"]
        critical_open = self.ds.q1("""
            SELECT COUNT(*) AS n FROM defect WHERE severity = 'critical'
            AND status IN ('open','contained','rework')
        """)
        alerts = [
            {"severity": "critical", "title": f"{gate_violations} CAPA closures bypass the gate",
             "detail": "CAPAs were closed without a passing verification inspection.",
             "href": "/quality"},
            {"severity": "high", "title": f"{overview['capa']['overdue']} CAPAs overdue",
             "detail": "Corrective actions past their committed due date.",
             "href": "/capa?overdue=1"},
            {"severity": "high", "title": f"{anomalies['severe'] or 0} high-severity data exceptions",
             "detail": "Broken trace links or inconsistent records in the labelled register.",
             "href": "/quality"},
            {"severity": "medium", "title": f"{len(drift_machines)} machines in suspected drift",
             "detail": "Weekly scrap rate at least 2x the machine baseline.",
             "href": "/machines"},
            {"severity": "medium", "title": f"{critical_open['n']} critical defects still open",
             "detail": "Critical defects without containment or disposition.",
             "href": "/defects?severity=critical"},
        ]
        return {
            "kpis": {
                "orders": {
                    "value": completed["total"] or 0,
                    "completed": completed["completed"] or 0,
                    "rework": completed["rework"] or 0,
                },
                "inspections": {
                    "value": overview["counts"]["inspections"],
                    "failed": overview["quality"]["failed_inspections"],
                    "pass_rate": overview["quality"]["first_pass_yield"],
                },
                "defects": {
                    "value": defects, "qty": defect_qty,
                    "critical_open": critical_open["n"] or 0,
                },
                "defect_rate": {
                    "value": overview["quality"]["defect_rate"],
                    "dppm": overview["quality"]["dppm"],
                    "delta": round(current_rate - previous_rate, 6),
                },
                "scrap_rate": {
                    "value": overview["quality"]["scrap_rate"],
                    "scrap_qty": overview["quality"]["scrap_qty"],
                    "produced_qty": overview["quality"]["produced_qty"],
                },
                "rework_rate": {
                    "value": _rate(completed["rework"] or 0, completed["completed"] or 0),
                    "rework_orders": completed["rework"] or 0,
                    "completed": completed["completed"] or 0,
                },
                "open_capas": {
                    "value": len(open_capas),
                    "overdue": overview["capa"]["overdue"],
                    "pending_verification": sum(1 for c in capas if c["status"] == "pending_verification"),
                },
                "supplier_score": {
                    "value": round((1 - incoming_rate) * 100, 2),
                    "incoming_rate": incoming_rate,
                    "worst_supplier": worst["name"] if worst else None,
                    "blocked": sum(1 for s in suppliers if s["qualification_state"] == "blocked"),
                },
            },
            "trend": trend,
            "defects_by_supplier": self._defect_groups("supplier"),
            "defects_by_machine": self._defect_groups("machine"),
            "defects_by_product": self._defect_groups("product"),
            "top_categories": self.ds.q("""
                SELECT category, SUM(qty) AS qty, COUNT(*) AS events
                FROM defect GROUP BY 1 ORDER BY qty DESC
            """),
            "recent_orders": self.ds.q("""
                SELECT o.order_id, o.product_id, p.name AS product_name, o.status, o.priority,
                       o.actual_qty, o.scrap_qty, o.actual_start, o.plant, o.line
                FROM production_order o JOIN product p ON p.product_id = o.product_id
                ORDER BY o.order_id DESC LIMIT 8
            """),
            "recent_defects": self.ds.q("""
                SELECT d.defect_id, d.defect_code, d.defect_name, d.severity, d.qty, d.detected_at,
                       d.status, d.order_id, d.lot_id, p.name AS product_name, s.name AS supplier_name
                FROM defect d
                LEFT JOIN production_order o ON o.order_id = d.order_id
                LEFT JOIN product p ON p.product_id = o.product_id
                LEFT JOIN material_lot l ON l.lot_id = d.lot_id
                LEFT JOIN supplier s ON s.supplier_id = l.supplier_id
                ORDER BY d.detected_at DESC, d.defect_id DESC LIMIT 8
            """),
            "pending_capas": sorted(open_capas, key=lambda c: (c["due_at"], c["capa_id"]))[:6],
            "alerts": alerts,
            "as_of": D.iso(D.TODAY),
        }

    # ------------------------------------------------------------- analytics
    def analytics(self):
        rows = self.ds.q("""
            SELECT defect_code AS code, defect_name AS name, category,
                   COUNT(*) AS events, SUM(qty) AS qty
            FROM defect GROUP BY 1, 2, 3 ORDER BY qty DESC
        """)
        total_qty = sum(r["qty"] for r in rows) or 1
        running = 0
        for row in rows:
            running += row["qty"]
            row["share"] = round(row["qty"] / total_qty, 6)
            row["cumulative"] = round(running / total_qty, 6)
        suppliers = self.ds.supplier_scorecard()
        plants = {r["plant"]: r for r in self.ds.q("""
            SELECT o.plant,
                   COUNT(DISTINCT o.order_id) AS orders,
                   SUM(o.actual_qty) AS produced_qty, SUM(o.scrap_qty) AS scrap_qty
            FROM production_order o WHERE o.actual_qty IS NOT NULL GROUP BY 1
        """)}
        for row in self.ds.q("""
            SELECT o.plant, SUM(i.defect_count) AS defect_qty, SUM(i.inspected_qty) AS inspected_qty
            FROM inspection_result i JOIN production_order o ON o.order_id = i.order_id
            GROUP BY 1
        """):
            entry = plants.setdefault(row["plant"], {"plant": row["plant"], "orders": 0,
                                                    "produced_qty": 0, "scrap_qty": 0})
            entry["defect_qty"] = row["defect_qty"] or 0
            entry["inspected_qty"] = row["inspected_qty"] or 0
        plant_rows = []
        for entry in plants.values():
            entry.setdefault("defect_qty", 0)
            entry.setdefault("inspected_qty", 0)
            entry["scrap_rate"] = _rate(entry.get("scrap_qty") or 0, entry.get("produced_qty") or 0)
            entry["defect_rate"] = _rate(entry["defect_qty"], entry["inspected_qty"])
            plant_rows.append(entry)
        families = self.ds.q("""
            SELECT p.family, COUNT(DISTINCT o.order_id) AS orders,
                   SUM(o.actual_qty) AS produced_qty, SUM(o.scrap_qty) AS scrap_qty,
                   SUM(i.inspected_qty) AS inspected_qty, SUM(i.defect_count) AS defect_qty
            FROM production_order o
            JOIN product p ON p.product_id = o.product_id
            LEFT JOIN inspection_result i ON i.order_id = o.order_id
            GROUP BY p.family ORDER BY p.family
        """)
        for row in families:
            row["scrap_rate"] = _rate(row["scrap_qty"] or 0, row["produced_qty"] or 0)
            row["defect_rate"] = _rate(row["defect_qty"] or 0, row["inspected_qty"] or 0)
        capas = self._capa_merged()
        closed = [c for c in capas if c["status"] == "closed" and c["closed_at"]]
        days = []
        for c in closed:
            try:
                delta = (D.as_datetime(c["closed_at"]) - D.as_datetime(c["opened_at"])).days
                days.append(max(0, delta))
            except ValueError:
                continue
        by_cause = {}
        for c in capas:
            entry = by_cause.setdefault(c["root_cause_category"], {"category": c["root_cause_category"],
                                                                   "count": 0, "closed": 0})
            entry["count"] += 1
            entry["closed"] += 1 if c["status"] == "closed" else 0
        machines = self.ds.machine_scorecard()
        return {
            "trend": self._monthly(),
            "pareto": rows[:12],
            "suppliers": [{
                "supplier_id": s["supplier_id"], "name": s["name"],
                "incoming_defect_rate": s["incoming_defect_rate"],
                "attributed_qty": s["attributed_defect_qty"],
                "lots": s["lots_received"], "decision": s["decision"],
                "risk_tier": s["risk_tier"],
            } for s in suppliers],
            "plants": sorted(plant_rows, key=lambda r: r["plant"]),
            "families": families,
            "inspection_mix": self.ds.q("""
                SELECT inspection_type AS type, COUNT(*) AS count,
                       SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN result = 'conditional' THEN 1 ELSE 0 END) AS conditional,
                       SUM(inspected_qty) AS inspected_qty, SUM(defect_count) AS defect_qty
                FROM inspection_result GROUP BY 1 ORDER BY 1
            """),
            "capa_performance": {
                "closed": len(closed),
                "avg_days_to_close": round(sum(days) / len(days), 1) if days else 0,
                "on_time": sum(1 for c in closed if c["closed_at"] <= c["due_at"]),
                "by_root_cause": sorted(by_cause.values(), key=lambda r: -r["count"]),
                "gate_violations": sum(1 for c in capas if c["status"] == "closed" and not c["closure_allowed"]),
            },
            "drift": sorted([{
                "machine_id": m["machine_id"], "name": m["name"], "plant": m["plant"],
                "drift_weeks": m["drift_weeks"], "scrap_rate": m["scrap_rate"],
                "decision": m["decision"],
            } for m in machines if m["drift_weeks"]], key=lambda r: -r["drift_weeks"])[:10],
        }

    # -------------------------------------------------------------- products
    def _product_rows(self):
        rows = self.ds.q("""
            SELECT p.product_id, p.name, p.family, p.product_type, p.lifecycle_state, p.revision,
                   p.uom, p.rework_allowed, p.effective_from,
                   (SELECT COUNT(*) FROM bom_line b WHERE b.product_id = p.product_id) AS bom_lines,
                   (SELECT COUNT(*) FROM supplier_material sm WHERE sm.product_id = p.product_id) AS suppliers
            FROM product p ORDER BY p.product_id
        """)
        stats = {r["product_id"]: r for r in self.ds.q("""
            SELECT o.product_id, COUNT(*) AS orders, SUM(o.actual_qty) AS produced_qty,
                   SUM(o.scrap_qty) AS scrap_qty, SUM(o.good_qty) AS good_qty,
                   SUM(CASE WHEN o.rework_of_order_id IS NOT NULL THEN 1 ELSE 0 END) AS rework_orders
            FROM production_order o WHERE o.actual_qty IS NOT NULL GROUP BY 1
        """)}
        insp = {r["product_id"]: r for r in self.ds.q("""
            SELECT o.product_id, SUM(i.inspected_qty) AS inspected_qty,
                   SUM(i.defect_count) AS defect_qty
            FROM inspection_result i JOIN production_order o ON o.order_id = i.order_id
            GROUP BY 1
        """)}
        for row in rows:
            stat = stats.get(row["product_id"], {})
            quality = insp.get(row["product_id"], {})
            row["orders"] = stat.get("orders", 0)
            row["produced_qty"] = stat.get("produced_qty") or 0
            row["scrap_qty"] = stat.get("scrap_qty") or 0
            row["rework_orders"] = stat.get("rework_orders") or 0
            row["inspected_qty"] = quality.get("inspected_qty") or 0
            row["defect_qty"] = quality.get("defect_qty") or 0
            row["scrap_rate"] = _rate(row["scrap_qty"], row["produced_qty"])
            row["defect_rate"] = _rate(row["defect_qty"], row["inspected_qty"])
        return rows

    def products(self, query):
        q = (query.get("q") or "").strip().lower()
        rows = self._product_rows()
        if q:
            rows = [r for r in rows if q in r["product_id"].lower() or q in r["name"].lower()]
        if query.get("family"):
            rows = [r for r in rows if r["family"] == query["family"]]
        if query.get("lifecycle"):
            rows = [r for r in rows if r["lifecycle_state"] == query["lifecycle"]]
        rows = _sort(rows, query.get("sort", "product_id"),
                     (query.get("dir") or "asc").lower() == "desc")
        return envelope(rows, query, facets=self.ds.q("""
            SELECT family AS value, COUNT(*) AS count FROM product GROUP BY 1 ORDER BY 1
        """))

    def product_detail(self, product_id):
        product = self.ds.q1("SELECT * FROM product WHERE product_id = ?", (product_id,))
        if not product:
            return None
        product.update(self.ds.q1("""
            SELECT COUNT(*) AS orders, SUM(actual_qty) AS produced_qty, SUM(scrap_qty) AS scrap_qty,
                   SUM(good_qty) AS good_qty,
                   SUM(CASE WHEN rework_of_order_id IS NOT NULL THEN 1 ELSE 0 END) AS rework_orders
            FROM production_order WHERE product_id = ? AND actual_qty IS NOT NULL
        """, (product_id,)) or {})
        quality = self.ds.q1("""
            SELECT SUM(i.inspected_qty) AS inspected_qty, SUM(i.defect_count) AS defect_qty,
                   SUM(CASE WHEN i.result = 'fail' THEN 1 ELSE 0 END) AS failed
            FROM inspection_result i JOIN production_order o ON o.order_id = i.order_id
            WHERE o.product_id = ?
        """, (product_id,))
        product["scrap_rate"] = _rate(product.get("scrap_qty") or 0, product.get("produced_qty") or 0)
        product["defect_rate"] = _rate(quality.get("defect_qty") or 0, quality.get("inspected_qty") or 0)
        product["inspected_qty"] = quality.get("inspected_qty") or 0
        product["defect_qty"] = quality.get("defect_qty") or 0
        product["failed_inspections"] = quality.get("failed") or 0
        bom = self.ds.q("""
            SELECT b.bom_id, b.component_product_id, c.name AS component_name, c.family,
                   c.product_type, c.uom, c.lifecycle_state, b.qty_per_unit, b.scrap_pct,
                   b.alternate_group, b.effective_from, b.effective_to,
                   (SELECT COUNT(DISTINCT sm.supplier_id) FROM supplier_material sm
                    WHERE sm.product_id = b.component_product_id) AS suppliers,
                   (SELECT COUNT(*) FROM material_lot l
                    WHERE l.material_product_id = b.component_product_id) AS lots
            FROM bom_line b JOIN product c ON c.product_id = b.component_product_id
            WHERE b.product_id = ? ORDER BY b.bom_id
        """, (product_id,))
        orders = self.ds.q("""
            SELECT order_id, status, priority, planned_qty, actual_qty, scrap_qty, good_qty,
                   actual_start, actual_end, plant, line
            FROM production_order WHERE product_id = ?
            ORDER BY order_id DESC LIMIT 12
        """, (product_id,))
        codes = self.ds.q("""
            SELECT d.defect_code, d.defect_name, d.category, d.severity,
                   COUNT(*) AS events, SUM(d.qty) AS qty
            FROM defect d
            LEFT JOIN production_order o ON o.order_id = d.order_id
            LEFT JOIN material_lot l ON l.lot_id = d.lot_id
            WHERE COALESCE(o.product_id, l.material_product_id) = ?
            GROUP BY 1, 2, 3, 4 ORDER BY qty DESC LIMIT 8
        """, (product_id,))
        plans = self.ds.q("""
            SELECT plan_id, inspection_type, sample_size, aql_level, acceptance_qty,
                   rejection_qty, criteria, effective_from
            FROM inspection_plan WHERE product_id = ? ORDER BY inspection_type
        """, (product_id,))
        return {"product": product, "bom": bom, "orders": orders, "defect_codes": codes,
                "plans": plans}

    # -------------------------------------------------------------- suppliers
    def suppliers(self, query):
        q = (query.get("q") or "").strip().lower()
        rows = self.ds.supplier_scorecard()
        if q:
            rows = [r for r in rows if q in r["supplier_id"].lower() or q in r["name"].lower()
                    or q in (r["country"] or "").lower()]
        for key, field in (("risk", "risk_tier"), ("qualification", "qualification_state"),
                           ("decision", "decision")):
            if query.get(key):
                rows = [r for r in rows if r[field] == query[key]]
        rows = _sort(rows, query.get("sort", "supplier_id"),
                     (query.get("dir") or "asc").lower() == "desc")
        return envelope(rows, query)

    def supplier_detail(self, supplier_id):
        supplier = self.ds.q1("SELECT * FROM supplier WHERE supplier_id = ?", (supplier_id,))
        if not supplier:
            return None
        scorecard = next((s for s in self.ds.supplier_scorecard()
                          if s["supplier_id"] == supplier_id), {})
        supplier.update({k: scorecard.get(k) for k in (
            "incoming_inspections", "incoming_inspected_qty", "incoming_defect_qty",
            "incoming_failures", "incoming_defect_rate", "attributed_defect_qty",
            "attributed_defect_events", "critical_events", "lots_received", "lots_rejected",
            "lots_expired", "decision", "decision_reason")})
        trend = self.ds.q("""
            SELECT strftime('%Y-%m', i.inspected_at) AS month,
                   SUM(i.inspected_qty) AS inspected_qty, SUM(i.defect_count) AS defect_qty
            FROM inspection_result i JOIN material_lot l ON l.lot_id = i.lot_id
            WHERE l.supplier_id = ? AND i.inspection_type = 'incoming'
            GROUP BY 1 ORDER BY 1
        """, (supplier_id,))
        for row in trend:
            row["defect_rate"] = _rate(row["defect_qty"] or 0, row["inspected_qty"] or 0)
        materials = self.ds.q("""
            SELECT sm.supplier_material_id, sm.product_id, p.name, p.family, sm.qualification_state,
                   sm.unit_price_usd, sm.effective_from
            FROM supplier_material sm JOIN product p ON p.product_id = sm.product_id
            WHERE sm.supplier_id = ? ORDER BY p.name
        """, (supplier_id,))
        lots = self.ds.q("""
            SELECT l.lot_id, l.material_product_id, p.name AS material_name, l.received_date,
                   l.expiry_date, l.received_qty, l.consumed_qty, l.remaining_qty, l.uom,
                   l.status, l.coa_pass
            FROM material_lot l JOIN product p ON p.product_id = l.material_product_id
            WHERE l.supplier_id = ? ORDER BY l.received_date DESC, l.lot_id LIMIT 20
        """, (supplier_id,))
        defects = self.ds.q("""
            SELECT d.defect_id, d.defect_code, d.defect_name, d.severity, d.qty, d.detected_at,
                   d.status, d.lot_id, d.order_id
            FROM defect d JOIN material_lot l ON l.lot_id = d.lot_id
            WHERE l.supplier_id = ?
            ORDER BY d.detected_at DESC LIMIT 12
        """, (supplier_id,))
        capas = [c for c in self._capa_merged() if c["supplier_id"] == supplier_id][:8]
        return {"supplier": supplier, "trend": trend, "materials": materials,
                "lots": lots, "defects": defects, "capas": capas}

    # ------------------------------------------------------------------ lots
    def lots(self, query):
        rows = self.ds.q("""
            SELECT l.lot_id, l.supplier_id, s.name AS supplier_name, l.material_product_id,
                   p.name AS material_name, l.received_date, l.expiry_date, l.received_qty,
                   l.consumed_qty, l.remaining_qty, l.uom, l.status, l.coa_pass,
                   (SELECT COUNT(*) FROM order_consumption c WHERE c.lot_id = l.lot_id) AS consumption_count
            FROM material_lot l
            JOIN supplier s ON s.supplier_id = l.supplier_id
            JOIN product p ON p.product_id = l.material_product_id
            ORDER BY l.received_date DESC, l.lot_id
        """)
        q = (query.get("q") or "").strip().lower()
        if q:
            rows = [r for r in rows if q in r["lot_id"].lower() or q in r["supplier_name"].lower()
                    or q in r["material_name"].lower() or q in (r["supplier_id"] or "").lower()]
        for key, field in (("status", "status"), ("supplier", "supplier_id"),
                           ("material", "material_product_id")):
            if query.get(key):
                rows = [r for r in rows if r[field] == query[key]]
        if query.get("expiring"):
            rows = [r for r in rows if r["status"] == "expired"]
        rows = _sort(rows, query.get("sort", "received_date"),
                     (query.get("dir") or "desc").lower() == "desc")
        summary = {
            "total": len(rows),
            "remaining_qty": round(sum(r["remaining_qty"] for r in rows), 3),
            "expired": sum(1 for r in rows if r["status"] == "expired"),
            "rejected": sum(1 for r in rows if r["status"] == "rejected"),
            "consumed": sum(1 for r in rows if r["status"] == "consumed"),
        }
        return envelope(rows, query, summary=summary,
                        facets=self.ds.q("""
                            SELECT status AS value, COUNT(*) AS count
                            FROM material_lot GROUP BY 1 ORDER BY 1
                        """))

    def lot_detail(self, lot_id):
        lot = self.ds.q1("""
            SELECT l.*, s.name AS supplier_name, s.risk_tier, s.qualification_state,
                   p.name AS material_name, p.family, p.uom AS material_uom
            FROM material_lot l
            JOIN supplier s ON s.supplier_id = l.supplier_id
            JOIN product p ON p.product_id = l.material_product_id
            WHERE l.lot_id = ?
        """, (lot_id,))
        if not lot:
            return None
        lot["remaining_pct"] = _rate(lot["remaining_qty"], lot["received_qty"])
        consumptions = self.ds.q("""
            SELECT c.consumption_id, c.order_id, o.product_id, o.product_id AS sku,
                   p.name AS product_name, c.qty_consumed, c.consumed_at, c.step_id, s.sequence_no
            FROM order_consumption c
            JOIN production_order o ON o.order_id = c.order_id
            JOIN product p ON p.product_id = o.product_id
            LEFT JOIN process_step s ON s.step_id = c.step_id
            WHERE c.lot_id = ? ORDER BY c.consumed_at, c.consumption_id
        """, (lot_id,))
        inspections = self.ds.q("""
            SELECT inspection_id, inspection_type, inspected_at, inspected_qty, defect_count,
                   defect_rate, result, sampled_qty, tested_value
            FROM inspection_result WHERE lot_id = ? ORDER BY inspected_at
        """, (lot_id,)) if False else self.ds.q("""
            SELECT inspection_id, inspection_type, inspected_at, inspected_qty, defect_count,
                   defect_rate, result, sampled_qty
            FROM inspection_result WHERE lot_id = ? ORDER BY inspected_at
        """, (lot_id,))
        defects = self.ds.q("""
            SELECT defect_id, defect_code, defect_name, severity, qty, detected_at, status,
                   order_id, supplier_responsibility
            FROM defect WHERE lot_id = ? ORDER BY detected_at DESC
        """, (lot_id,))
        events = self.ds.q("""
            SELECT event_id, event_type, from_state, to_state, occurred_at, actor_code, note
            FROM lot_event WHERE lot_id = ? ORDER BY occurred_at, event_id
        """, (lot_id,))
        return {"lot": lot, "consumptions": consumptions, "inspections": inspections,
                "defects": defects, "events": events}

    # ---------------------------------------------------------------- orders
    def _order_rows(self):
        rows = self.ds.q("""
            SELECT o.order_id, o.product_id, p.name AS product_name, p.family, o.plant, o.line,
                   o.status, o.priority, o.planned_qty, o.actual_qty, o.good_qty, o.scrap_qty,
                   o.planned_start, o.planned_end, o.actual_start, o.actual_end,
                   o.rework_of_order_id, o.planner_code,
                   (SELECT COUNT(*) FROM process_step s WHERE s.order_id = o.order_id) AS steps_total,
                   (SELECT COUNT(*) FROM process_step s WHERE s.order_id = o.order_id
                     AND s.status = 'completed') AS steps_done,
                   (SELECT COUNT(*) FROM defect d WHERE d.order_id = o.order_id) AS defect_events,
                   (SELECT COUNT(*) FROM inspection_result i WHERE i.order_id = o.order_id) AS inspections
            FROM production_order o JOIN product p ON p.product_id = o.product_id
            ORDER BY o.order_id DESC
        """)
        for row in rows:
            row["progress"] = _rate(row["actual_qty"] or 0, row["planned_qty"] or 0)
            row["scrap_rate"] = _rate(row["scrap_qty"] or 0, row["actual_qty"] or 0)
            row["is_rework"] = bool(row["rework_of_order_id"])
        return rows

    def orders(self, query):
        q = (query.get("q") or "").strip().lower()
        rows = self._order_rows()
        if q:
            rows = [r for r in rows if q in r["order_id"].lower() or q in r["product_id"].lower()
                    or q in r["product_name"].lower()]
        for key, field in (("status", "status"), ("plant", "plant"), ("line", "line"),
                           ("product", "product_id")):
            if query.get(key):
                rows = [r for r in rows if r[field] == query[key]]
        if query.get("rework") in ("1", "true"):
            rows = [r for r in rows if r["is_rework"]]
        if query.get("from"):
            rows = [r for r in rows if (r["actual_start"] or "")[:10] >= query["from"]]
        if query.get("to"):
            rows = [r for r in rows if (r["actual_start"] or "")[:10] <= query["to"]]
        rows = _sort(rows, query.get("sort", "order_id"),
                     (query.get("dir") or "desc").lower() == "desc")
        summary = {
            "total": len(rows),
            "in_progress": sum(1 for r in rows if r["status"] == "in_progress"),
            "completed": sum(1 for r in rows if r["status"] in ("completed", "closed")),
            "planned": sum(1 for r in rows if r["status"] == "planned"),
            "scrap_qty": sum(r["scrap_qty"] or 0 for r in rows),
        }
        return envelope(rows, query, summary=summary)

    def order_detail(self, order_id):
        order = self.ds.q1("""
            SELECT o.*, p.name AS product_name, p.family, p.rework_allowed, p.lifecycle_state
            FROM production_order o JOIN product p ON p.product_id = o.product_id
            WHERE o.order_id = ?
        """, (order_id,))
        if not order:
            return None
        steps = self.ds.q("""
            SELECT s.step_id, s.sequence_no, s.step_name, s.machine_id, m.name AS machine_name,
                   m.machine_type, s.started_at, s.ended_at, s.operator_code, s.input_qty,
                   s.output_qty, s.scrap_qty, s.temperature_c, s.pressure_bar, s.speed_uph,
                   s.status
            FROM process_step s JOIN machine m ON m.machine_id = s.machine_id
            WHERE s.order_id = ? ORDER BY s.sequence_no
        """, (order_id,))
        consumptions = self.ds.consumptions_for_order(order_id)
        inspections = self.ds.q("""
            SELECT i.inspection_id, i.inspection_type, i.inspected_at, i.inspected_qty,
                   i.defect_count, i.defect_rate, i.result, i.step_id, i.machine_id
            FROM inspection_result i WHERE i.order_id = ?
            ORDER BY i.inspected_at, i.inspection_id
        """, (order_id,))
        defects = self.ds.q("""
            SELECT defect_id, defect_code, defect_name, category, severity, qty, status,
                   detected_at, lot_id, step_id, machine_id, supplier_responsibility
            FROM defect WHERE order_id = ? ORDER BY detected_at
        """, (order_id,))
        capas = [c for c in self._capa_merged() if c["order_id"] == order_id]
        events = self.ds.q("""
            SELECT event_id, event_type, from_state, to_state, occurred_at, actor_code, note
            FROM order_event WHERE order_id = ? ORDER BY occurred_at, event_id
        """, (order_id,))
        order["progress"] = _rate(order["actual_qty"] or 0, order["planned_qty"] or 0)
        order["scrap_rate"] = _rate(order["scrap_qty"] or 0, order["actual_qty"] or 0)
        quality = self.ds.q1("""
            SELECT SUM(inspected_qty) AS inspected_qty, SUM(defect_count) AS defect_qty
            FROM inspection_result WHERE order_id = ?
        """, (order_id,))
        order["inspected_qty"] = quality.get("inspected_qty") or 0
        order["defect_qty"] = quality.get("defect_qty") or 0
        order["defect_rate"] = _rate(order["defect_qty"], order["inspected_qty"])
        return {"order": order, "steps": steps, "consumptions": consumptions,
                "inspections": inspections, "defects": defects, "capas": capas,
                "events": events, "activity": self.ops.events("order", order_id, limit=20)}

    # -------------------------------------------------------------- machines
    def machines(self, query):
        rows = self.ds.machine_scorecard()
        q = (query.get("q") or "").strip().lower()
        if q:
            rows = [r for r in rows if q in r["machine_id"].lower() or q in r["name"].lower()
                    or q in r["plant"].lower()]
        for key, field in (("status", "status"), ("plant", "plant"), ("type", "machine_type")):
            if query.get(key):
                rows = [r for r in rows if r[field] == query[key]]
        if query.get("drift") in ("1", "true"):
            rows = [r for r in rows if r["drift_weeks"]]
        rows = _sort(rows, query.get("sort", "machine_id"),
                     (query.get("dir") or "asc").lower() == "desc")
        summary = {
            "total": len(rows),
            "running": sum(1 for r in rows if r["status"] == "running"),
            "drift": sum(1 for r in rows if r["drift_weeks"] >= 2),
            "steps": sum(r["step_count"] or 0 for r in rows),
        }
        return envelope(rows, query, summary=summary)

    def machine_detail(self, machine_id):
        rows = self.ds.machine_scorecard()
        machine = next((m for m in rows if m["machine_id"] == machine_id), None)
        if not machine:
            return None
        weeks, _ = self.ds.machine_weeks()
        series = [w for w in weeks if w["machine_id"] == machine_id]
        steps = self.ds.q("""
            SELECT s.step_id, s.order_id, s.sequence_no, s.step_name, s.started_at, s.ended_at,
                   s.input_qty, s.output_qty, s.scrap_qty, s.operator_code, s.status
            FROM process_step s WHERE s.machine_id = ?
            ORDER BY s.started_at DESC LIMIT 15
        """, (machine_id,))
        defects = self.ds.q("""
            SELECT d.defect_id, d.defect_code, d.defect_name, d.severity, d.qty, d.detected_at,
                   d.order_id, d.status
            FROM defect d WHERE d.machine_id = ?
            ORDER BY d.detected_at DESC LIMIT 12
        """, (machine_id,))
        return {"machine": machine, "weeks": series, "steps": steps, "defects": defects}

    # ----------------------------------------------------------- inspections
    def _inspection_rows(self):
        return self.ds.q("""
            SELECT i.inspection_id, i.inspection_type, i.result, i.inspected_at,
                   i.inspected_qty, i.sampled_qty, i.defect_count, i.defect_rate,
                   i.order_id, o.product_id, p.name AS product_name,
                   i.lot_id, l.supplier_id, s.name AS supplier_name,
                   i.step_id, ps.sequence_no, ps.step_name, i.machine_id, m.name AS machine_name
            FROM inspection_result i
            LEFT JOIN production_order o ON o.order_id = i.order_id
            LEFT JOIN product p ON p.product_id = o.product_id
            LEFT JOIN material_lot l ON l.lot_id = i.lot_id
            LEFT JOIN supplier s ON s.supplier_id = l.supplier_id
            LEFT JOIN process_step ps ON ps.step_id = i.step_id
            LEFT JOIN machine m ON m.machine_id = i.machine_id
            ORDER BY i.inspected_at DESC, i.inspection_id DESC
        """)

    def inspections(self, query):
        q = (query.get("q") or "").strip().lower()
        rows = self._inspection_rows()
        if q:
            rows = [r for r in rows if q in r["inspection_id"].lower()
                    or q in (r["order_id"] or "").lower() or q in (r["lot_id"] or "").lower()
                    or q in (r["product_name"] or "").lower()]
        for key, field in (("type", "inspection_type"), ("result", "result")):
            if query.get(key):
                rows = [r for r in rows if r[field] == query[key]]
        if query.get("order"):
            rows = [r for r in rows if r["order_id"] == query["order"]]
        if query.get("lot"):
            rows = [r for r in rows if r["lot_id"] == query["lot"]]
        if query.get("from"):
            rows = [r for r in rows if (r["inspected_at"] or "")[:10] >= query["from"]]
        if query.get("to"):
            rows = [r for r in rows if (r["inspected_at"] or "")[:10] <= query["to"]]
        rows = _sort(rows, query.get("sort", "inspected_at"),
                     (query.get("dir") or "desc").lower() == "desc")
        summary = {
            "total": len(rows),
            "failed": sum(1 for r in rows if r["result"] == "fail"),
            "conditional": sum(1 for r in rows if r["result"] == "conditional"),
            "pass_rate": _rate(sum(1 for r in rows if r["result"] == "pass"), len(rows)),
            "defect_qty": sum(r["defect_count"] or 0 for r in rows),
        }
        return envelope(rows, query, summary=summary)

    def inspection_detail(self, inspection_id):
        inspection = self.ds.q1("""
            SELECT i.*, o.product_id, p.name AS product_name, o.status AS order_status,
                   l.supplier_id, s.name AS supplier_name, l.material_product_id,
                   ps.sequence_no, ps.step_name, m.name AS machine_name, m.machine_type,
                   ip.criteria, ip.aql_level, ip.sample_size
            FROM inspection_result i
            LEFT JOIN production_order o ON o.order_id = i.order_id
            LEFT JOIN product p ON p.product_id = o.product_id
            LEFT JOIN material_lot l ON l.lot_id = i.lot_id
            LEFT JOIN supplier s ON s.supplier_id = l.supplier_id
            LEFT JOIN process_step ps ON ps.step_id = i.step_id
            LEFT JOIN machine m ON m.machine_id = i.machine_id
            LEFT JOIN inspection_plan ip ON ip.plan_id = i.plan_id
            WHERE i.inspection_id = ?
        """, (inspection_id,))
        if not inspection:
            return None
        defects = self.ds.q("""
            SELECT defect_id, defect_code, defect_name, category, severity, qty, status,
                   detected_at, supplier_responsibility
            FROM defect WHERE inspection_id = ? ORDER BY defect_id
        """, (inspection_id,))
        capas = [c for c in self._capa_merged()
                 if c["defect_id"] in {d["defect_id"] for d in defects}]
        return {"inspection": inspection, "defects": defects, "capas": capas}

    # --------------------------------------------------------------- defects
    def _defect_rows(self):
        return self.ds.q("""
            SELECT d.defect_id, d.defect_code, d.defect_name, d.category, d.severity, d.qty,
                   d.status, d.detected_at, d.supplier_responsibility, d.detection_method,
                   d.order_id, d.lot_id, d.step_id, d.machine_id, d.inspection_id,
                   COALESCE(o.product_id, l.material_product_id) AS product_id,
                   COALESCE(p.name, mp.name) AS product_name,
                   l.supplier_id, s.name AS supplier_name, m.name AS machine_name,
                   c.capa_id, c.status AS capa_status
            FROM defect d
            LEFT JOIN production_order o ON o.order_id = d.order_id
            LEFT JOIN product p ON p.product_id = o.product_id
            LEFT JOIN material_lot l ON l.lot_id = d.lot_id
            LEFT JOIN product mp ON mp.product_id = l.material_product_id
            LEFT JOIN supplier s ON s.supplier_id = l.supplier_id
            LEFT JOIN machine m ON m.machine_id = d.machine_id
            LEFT JOIN capa c ON c.defect_id = d.defect_id
            ORDER BY d.detected_at DESC, d.defect_id DESC
        """)

    def defects(self, query):
        rows = self._defect_rows()
        overrides = self.ops.defect_overrides()
        for row in rows:
            if row["defect_id"] in overrides:
                row["status"] = overrides[row["defect_id"]]
        q = (query.get("q") or "").strip().lower()
        if q:
            rows = [r for r in rows if q in r["defect_id"].lower()
                    or q in r["defect_code"].lower() or q in r["defect_name"].lower()
                    or q in (r["order_id"] or "").lower() or q in (r["lot_id"] or "").lower()]
        for key, field in (("severity", "severity"), ("category", "category"),
                           ("status", "status"), ("supplier", "supplier_id"),
                           ("product", "product_id"), ("order", "order_id")):
            if query.get(key):
                rows = [r for r in rows if r[field] == query[key]]
        if query.get("from"):
            rows = [r for r in rows if (r["detected_at"] or "")[:10] >= query["from"]]
        if query.get("to"):
            rows = [r for r in rows if (r["detected_at"] or "")[:10] <= query["to"]]
        rows = _sort(rows, query.get("sort", "detected_at"),
                     (query.get("dir") or "desc").lower() == "desc")
        summary = {
            "total": len(rows),
            "critical": sum(1 for r in rows if r["severity"] == "critical"),
            "open": sum(1 for r in rows if r["status"] == "open"),
            "qty": sum(r["qty"] or 0 for r in rows),
            "capa_linked": sum(1 for r in rows if r["capa_id"]),
        }
        return envelope(rows, query, summary=summary)

    def defect_detail(self, defect_id):
        trace = T.trace_defect(self.ds, defect_id)
        if not trace:
            return None
        overrides = self.ops.defect_overrides()
        if defect_id in overrides:
            trace["defect"]["status"] = overrides[defect_id]
        capa = None
        if trace.get("capa"):
            capa = next((c for c in self._capa_merged()
                         if c["capa_id"] == trace["capa"]["capa_id"]), None)
        return {
            "trace": trace,
            "decision": trace["decision"],
            "capa": capa,
            "activity": self.ops.events("defect", defect_id, limit=50),
            "allowed_actions": sorted(DEFECT_TRANSITIONS.get(trace["defect"]["status"], set())),
        }

    # ------------------------------------------------------------------ CAPA
    def capas(self, query):
        rows = self._capa_merged()
        q = (query.get("q") or "").strip().lower()
        if q:
            rows = [r for r in rows if q in r["capa_id"].lower()
                    or q in (r["defect_id"] or "").lower()
                    or q in (r["supplier_name"] or "").lower()
                    or q in (r["product_name"] or "").lower()]
        if query.get("status"):
            wanted = set(query["status"].split(","))
            rows = [r for r in rows if r["status"] in wanted]
        if query.get("owner"):
            rows = [r for r in rows if r["owner_role"] == query["owner"]]
        if query.get("overdue") in ("1", "true"):
            rows = [r for r in rows if r["days_overdue"] > 0]
        if query.get("severity"):
            rows = [r for r in rows if r["severity"] == query["severity"]]
        rows = _sort(rows, query.get("sort", "due_at"),
                     (query.get("dir") or "asc").lower() == "desc")
        status_counts = {}
        for row in self._capa_merged():
            status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
        summary = {
            "total": len(rows),
            "open": sum(1 for r in rows if r["status"] in ("open", "in_progress")),
            "pending_verification": sum(1 for r in rows if r["status"] == "pending_verification"),
            "overdue": sum(1 for r in rows if r["days_overdue"] > 0),
            "gate_violations": sum(1 for r in rows if r["status"] == "closed" and not r["closure_allowed"]),
            "by_status": status_counts,
        }
        return envelope(rows, query, summary=summary)

    def _gate_checklist(self, capa):
        verification = None
        if capa.get("verification_inspection_id"):
            verification = self.ds.q1("""
                SELECT inspection_id, result, inspected_at, inspected_qty
                FROM inspection_result WHERE inspection_id = ?
            """, (capa["verification_inspection_id"],))
        items = [
            {"key": "containment", "label": "Containment completed",
             "ok": bool(capa.get("containment_completed_at")),
             "detail": capa.get("containment_completed_at") or "Not recorded"},
            {"key": "verification", "label": "Verification inspection passed",
             "ok": bool(verification and verification["result"] == "pass"),
             "detail": (f"{verification['inspection_id']} · {verification['result']}"
                        if verification else "No verification inspection linked")},
            {"key": "sequence", "label": "Verified after containment",
             "ok": bool(verification and capa.get("containment_completed_at")
                        and verification["inspected_at"] >= capa["containment_completed_at"]),
             "detail": (f"{verification['inspected_at']} vs containment "
                        f"{capa.get('containment_completed_at') or 'n/a'}"
                        if verification else "n/a")},
            {"key": "closed_after", "label": "Closed after verification",
             "ok": bool(capa.get("verified_at") and (not capa.get("closed_at")
                                                     or capa["closed_at"] >= capa["verified_at"])),
             "detail": f"closed {capa.get('closed_at') or '—'} · verified {capa.get('verified_at') or '—'}"},
        ]
        return items

    def capa_detail(self, capa_id):
        capa = next((c for c in self._capa_merged() if c["capa_id"] == capa_id), None)
        if not capa:
            return None
        checklist = self._gate_checklist(capa)
        options = self.ds.q("""
            SELECT i.inspection_id, i.inspected_at, i.result, i.inspected_qty, i.defect_count,
                   i.inspection_type
            FROM inspection_result i
            WHERE ((? IS NOT NULL AND i.order_id = ?) OR (? IS NOT NULL AND i.lot_id = ?))
              AND i.result = 'pass'
              AND (? IS NULL OR i.inspected_at >= ?)
            ORDER BY i.inspected_at DESC LIMIT 40
        """, (capa["order_id"], capa["order_id"], capa["lot_id"], capa["lot_id"],
              capa.get("containment_completed_at"), capa.get("containment_completed_at")))
        events = self.ds.q("""
            SELECT event_id, event_type, from_state, to_state, occurred_at, actor_code, note
            FROM capa_event WHERE capa_id = ? ORDER BY occurred_at, event_id
        """, (capa_id,))
        activity = self.ops.events("capa", capa_id, limit=60)
        return {"capa": capa, "checklist": checklist, "verification_options": options,
                "events": events, "activity": activity, "defect": self._defect_context(capa["defect_id"])}

    def _defect_context(self, defect_id):
        return self.ds.q1("""
            SELECT d.defect_id, d.defect_code, d.defect_name, d.category, d.severity, d.qty,
                   d.detected_at, d.status, d.order_id, d.lot_id, d.supplier_responsibility,
                   d.inspection_id
            FROM defect d WHERE d.defect_id = ?
        """, (defect_id,))

    # --------------------------------------------------------------- actions
    def _capa(self, capa_id):
        return next((c for c in self._capa_merged() if c["capa_id"] == capa_id), None)

    def capa_action(self, capa_id, body):
        capa = self._capa(capa_id)
        if not capa:
            return 404, {"error": f"CAPA {capa_id} not found"}
        action = (body.get("action") or "").strip()
        note = (body.get("note") or "").strip() or None
        actor = (body.get("actor") or ACTOR).strip()
        now = now_iso()
        status = capa["status"]

        if action == "note":
            if not note:
                return 400, {"error": "A note is required"}
            self.ops.add_note("capa", capa_id, note, actor)
            return 200, {"ok": True, "activity": self.ops.events("capa", capa_id, limit=60)}

        if action == "assign":
            owner = (body.get("owner_role") or "").strip()
            if owner not in OWNER_ROLES:
                return 400, {"error": f"owner_role must be one of {', '.join(OWNER_ROLES)}"}
            self.ops.save_capa(capa_id, {"owner_role": owner}, action, status, status, actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        if action == "contain":
            if status in ("closed", "cancelled"):
                return 409, {"error": f"Cannot record containment on a {status} CAPA"}
            # Containment is recorded against the quality event: using the defect
            # detection timestamp keeps later (historical) effectiveness
            # inspections usable while still enforcing containment before review.
            completed = capa.get("detected_at") or now
            self.ops.save_capa(capa_id, {
                "status": "in_progress", "containment_completed_at": completed,
            }, action, status, "in_progress", actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        if action == "start":
            if status != "open":
                return 409, {"error": f"Only an open CAPA can start (current: {status})"}
            self.ops.save_capa(capa_id, {"status": "in_progress"}, action, status,
                               "in_progress", actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        if action == "submit_verification":
            if status not in ("open", "in_progress"):
                return 409, {"error": f"Cannot submit a {status} CAPA for verification"}
            if not capa.get("containment_completed_at"):
                return 409, {"error": "Containment must be completed before verification",
                             "retryable": True}
            self.ops.save_capa(capa_id, {"status": "pending_verification"}, action, status,
                               "pending_verification", actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        if action == "verify":
            inspection_id = (body.get("verification_inspection_id")
                             or capa.get("verification_inspection_id"))
            if not inspection_id:
                return 400, {"error": "Select the verification inspection that proves effectiveness"}
            inspection = self.ds.q1("""
                SELECT inspection_id, result, inspected_at, inspection_type, order_id, lot_id,
                       defect_count, inspected_qty
                FROM inspection_result WHERE inspection_id = ?
            """, (inspection_id,))
            if not inspection:
                return 404, {"error": f"Inspection {inspection_id} not found"}
            same_scope = ((capa["order_id"] and inspection["order_id"] == capa["order_id"])
                          or (capa["lot_id"] and inspection["lot_id"] == capa["lot_id"]))
            if not same_scope:
                return 409, {"error": "Verification inspection must belong to the same order or lot"}
            if inspection["result"] != "pass":
                return 409, {"error": "Verification inspection did not pass",
                             "detail": f"{inspection_id} result is {inspection['result']}"}
            if capa.get("containment_completed_at") and \
                    inspection["inspected_at"] < capa["containment_completed_at"]:
                return 409, {"error": "Verification inspection predates containment completion"}
            score = _num(body.get("effectiveness_score"))
            if score is None:
                score = round(max(0.0, 1 - (inspection["defect_count"] or 0) /
                                  (inspection["inspected_qty"] or 1)), 3)
            self.ops.save_capa(capa_id, {
                "status": "verified", "verified_at": now,
                "verification_inspection_id": inspection_id, "effectiveness_score": score,
                "closed_at": None,
            }, action, status, "verified", actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        if action == "close":
            if status != "verified":
                return 409, {"error": f"Only a verified CAPA can be closed (current: {status})",
                             "gate_reason": "VERIFICATION_REQUIRED"}
            updated = self._capa(capa_id)
            allowed, reason = D.capa_gate(
                "closed", updated["opened_at"], updated["verified_at"], now,
                updated["verification_result"], updated["verification_date"],
                updated["containment_completed_at"])
            if not allowed:
                return 409, {"error": "Closure gate failed", "gate_reason": reason,
                             "checklist": self._gate_checklist(updated)}
            self.ops.save_capa(capa_id, {"status": "closed", "closed_at": now},
                               action, status, "closed", actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        if action == "reopen":
            if status not in ("closed", "verified", "cancelled"):
                return 409, {"error": f"Only verified, closed or cancelled CAPAs can be reopened"}
            self.ops.save_capa(capa_id, {
                "status": "in_progress", "closed_at": None, "verified_at": None,
                "verification_inspection_id": None,
            }, action, status, "in_progress", actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        if action == "cancel":
            if status == "closed":
                return 409, {"error": "A closed CAPA cannot be cancelled"}
            self.ops.save_capa(capa_id, {"status": "cancelled"}, action, status,
                               "cancelled", actor, note)
            return 200, {"ok": True, "capa": self._capa(capa_id)}

        return 400, {"error": f"Unknown action '{action}'"}

    def defect_action(self, defect_id, body):
        defect = self.ds.q1("SELECT defect_id, status FROM defect WHERE defect_id = ?",
                            (defect_id,))
        if not defect:
            return 404, {"error": f"Defect {defect_id} not found"}
        overrides = self.ops.defect_overrides()
        current = overrides.get(defect_id, defect["status"])
        action = (body.get("action") or "").strip()
        if action not in ACTION_TO_STATUS:
            return 400, {"error": f"action must be one of {', '.join(ACTION_TO_STATUS)}"}
        if action not in DEFECT_TRANSITIONS.get(current, set()):
            return 409, {"error": f"Cannot '{action}' a defect that is {current}"}
        target = ACTION_TO_STATUS[action]
        self.ops.save_defect(defect_id, target, action, current,
                             (body.get("actor") or ACTOR).strip(),
                             (body.get("note") or "").strip() or None)
        return 200, {"ok": True, "status": target,
                     "allowed_actions": sorted(DEFECT_TRANSITIONS.get(target, set()))}

    # ---------------------------------------------------------------- search
    def search(self, query):
        q = (query.get("q") or "").strip()
        if len(q) < 2:
            return {"q": q, "groups": [], "total": 0}
        needle = f"%{q}%"
        groups = []
        specs = [
            ("Products", "product", "/products/", """
                SELECT product_id AS id, name AS title, family AS subtitle
                FROM product WHERE product_id LIKE ? OR name LIKE ? ORDER BY product_id LIMIT 5
            """),
            ("Production orders", "order", "/orders/", """
                SELECT o.order_id AS id, p.name AS title,
                       o.product_id || ' · ' || o.status AS subtitle
                FROM production_order o JOIN product p ON p.product_id = o.product_id
                WHERE o.order_id LIKE ? OR o.product_id LIKE ? OR p.name LIKE ?
                ORDER BY o.order_id DESC LIMIT 5
            """),
            ("Material lots", "lot", "/lots/", """
                SELECT l.lot_id AS id, p.name AS title,
                       l.supplier_id || ' · ' || l.status AS subtitle
                FROM material_lot l JOIN product p ON p.product_id = l.material_product_id
                WHERE l.lot_id LIKE ? OR p.name LIKE ? OR l.supplier_id LIKE ?
                ORDER BY l.received_date DESC LIMIT 5
            """),
            ("Suppliers", "supplier", "/suppliers/", """
                SELECT supplier_id AS id, name AS title, country AS subtitle
                FROM supplier WHERE supplier_id LIKE ? OR name LIKE ?
                ORDER BY supplier_id LIMIT 5
            """),
            ("Defects", "defect", "/defects/", """
                SELECT defect_id AS id, defect_name AS title,
                       defect_code || ' · ' || severity AS subtitle
                FROM defect WHERE defect_id LIKE ? OR defect_code LIKE ? OR defect_name LIKE ?
                ORDER BY detected_at DESC LIMIT 5
            """),
            ("CAPAs", "capa", "/capa/", """
                SELECT capa_id AS id, root_cause_category AS title,
                       defect_id || ' · ' || status AS subtitle
                FROM capa WHERE capa_id LIKE ? OR defect_id LIKE ? OR owner_role LIKE ?
                ORDER BY opened_at DESC LIMIT 5
            """),
            ("Machines", "machine", "/machines/", """
                SELECT machine_id AS id, name AS title, plant || ' · ' || line AS subtitle
                FROM machine WHERE machine_id LIKE ? OR name LIKE ?
                ORDER BY machine_id LIMIT 5
            """),
            ("Inspections", "inspection", "/inspections/", """
                SELECT inspection_id AS id, inspection_type || ' inspection' AS title,
                       result || ' · ' || inspected_qty || ' units' AS subtitle
                FROM inspection_result WHERE inspection_id LIKE ? OR order_id LIKE ?
                ORDER BY inspected_at DESC LIMIT 5
            """),
        ]
        total = 0
        for label, kind, href, sql in specs:
            params = (needle, needle) if sql.count("?") == 2 else (needle, needle, needle)
            rows = self.ds.q(sql, params)
            if rows:
                total += len(rows)
                groups.append({"label": label, "kind": kind, "items": [
                    {**row, "href": href + row["id"]} for row in rows
                ]})
        return {"q": q, "groups": groups, "total": total}

    # ------------------------------------------------------------ exceptions
    def exceptions(self, query):
        rows = self.ds.exception_feed(limit=4000)
        q = (query.get("q") or "").strip().lower()
        if q:
            rows = [r for r in rows if q in r["id"].lower() or q in r["type"].lower()
                    or q in (r["detail"] or "").lower()]
        for key, field in (("severity", "severity"), ("type", "type"), ("kind", "kind")):
            if query.get(key):
                rows = [r for r in rows if r[field] == query[key]]
        rows = _sort(rows, query.get("sort", "severity"),
                     (query.get("dir") or "asc").lower() == "desc")
        counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        types = {}
        for row in self.ds.exception_feed(limit=4000):
            counts[row["severity"]] = counts.get(row["severity"], 0) + 1
            entry = types.setdefault(row["type"], {"type": row["type"], "count": 0,
                                                   "severity": row["severity"]})
            entry["count"] += 1
        validation = self.report("validation_summary")
        evaluation = self.report("evaluation_report")
        return envelope(rows, query, severity_counts=counts,
                        type_counts=sorted(types.values(), key=lambda r: -r["count"]),
                        validation=validation.get("checks", []),
                        evaluation={
                            "decision_agreement": (evaluation.get("decisions") or {}).get(
                                "disposition_agreement"),
                            "drift": evaluation.get("drift_detection"),
                        })

    # -------------------------------------------------------------- settings
    def settings(self):
        return {
            "dataset": self.meta(),
            "preferences": self.ops.settings(),
            "defaults": {"page_size": 25, "density": "comfortable", "notify_critical": True,
                         "notify_overdue": True, "default_plant": "all"},
            "owners": OWNER_ROLES,
            "capa_statuses": CAPA_STATUSES,
            "activity": self.ops.recent_activity(limit=20),
        }

    def save_settings(self, body):
        prefs = body.get("preferences") if isinstance(body.get("preferences"), dict) else body
        allowed = {"page_size", "density", "notify_critical", "notify_overdue", "default_plant"}
        patch = {k: v for k, v in (prefs or {}).items() if k in allowed}
        if not patch:
            return 400, {"error": "No recognised preference keys supplied"}
        if "page_size" in patch and _int(patch["page_size"], 25) not in (10, 25, 50, 100):
            return 400, {"error": "page_size must be 10, 25, 50 or 100"}
        saved = self.ops.save_settings(patch)
        return 200, {"ok": True, "preferences": saved}

    def clear_history(self):
        self.ops.clear_history()
        return {"ok": True}

    # -------------------------------------------------------------- trace
    def trace_graph(self, defect_id):
        trace = T.trace_defect(self.ds, defect_id)
        if not trace:
            return None
        d = trace["defect"]
        order = trace["order"]
        nodes, edges = [], []
        seen = set()

        def node(key, kind, title, subtitle, status=None, meta=None, href=None):
            if key in seen:
                return key
            seen.add(key)
            nodes.append({
                "id": key, "kind": kind, "title": title, "subtitle": subtitle,
                "status": status, "meta": meta or {}, "href": href,
            })
            return key

        def edge(a, b, label):
            if a and b:
                edges.append({"from": a, "to": b, "label": label})

        capa = trace.get("capa")
        capa_row = None
        if capa:
            capa_row = next((c for c in self._capa_merged() if c["capa_id"] == capa["capa_id"]), None)

        supplier_key = None
        if d.get("supplier_id"):
            supplier_key = node(f"supplier:{d['supplier_id']}", "supplier", d["supplier_name"],
                                f"{d['supplier_id']} · {d.get('country') or d['supplier_id']}",
                                d.get("qualification_state"),
                                {"risk tier": d.get("risk_tier")}, f"/suppliers/{d['supplier_id']}")
        lot_key = None
        if d.get("lot_id"):
            lot_key = node(f"lot:{d['lot_id']}", "lot", d["lot_id"], "material lot",
                           d.get("lot_status"),
                           {"received": d.get("received_date"),
                            "expiry": d.get("expiry_date"),
                            "remaining": d.get("remaining_qty")},
                           f"/lots/{d['lot_id']}")
        material_key = None
        if d.get("material_product_id"):
            material_key = node(f"product:{d['material_product_id']}", "product",
                                self.ds.q1("SELECT name FROM product WHERE product_id = ?",
                                           (d["material_product_id"],)).get("name", d["material_product_id"]),
                                d["material_product_id"], None, {"role": "component"},
                                f"/products/{d['material_product_id']}")
        order_key = None
        product_key = None
        if order:
            order_key = node(f"order:{order['order_id']}", "order", order["order_id"],
                             order["product_name"], order["status"],
                             {"planned": order["planned_qty"], "actual": order["actual_qty"],
                              "line": f"{order['plant']}/{order['line']}"},
                             f"/orders/{order['order_id']}")
            product_key = node(f"product:{order['product_id']}", "product", order["product_name"],
                               order["product_id"], order["status"], {"role": "finished good"},
                               f"/products/{order['product_id']}")
        machine_key = None
        if d.get("machine_id"):
            machine_key = node(f"machine:{d['machine_id']}", "machine", d["machine_id"],
                               d.get("machine_type") or "machine", None,
                               {"plant": d.get("machine_plant")}, f"/machines/{d['machine_id']}")
        step_key = None
        if d.get("step_id"):
            step_key = node(f"step:{d['step_id']}", "step",
                            d.get("step_name") or d["step_id"],
                            f"step {d.get('sequence_no')} · {d['step_id']}", None,
                            {"order": d.get("order_id")}, f"/orders/{d.get('order_id')}")
        inspection_key = node(f"inspection:{d['inspection_id']}", "inspection", d["inspection_id"],
                              f"{d['inspection_type']} · {d['result']}", d["result"],
                              {"inspected": d["inspected_qty"], "defects": d["defect_count"]},
                              f"/inspections/{d['inspection_id']}")
        defect_key = node(f"defect:{d['defect_id']}", "defect", d["defect_name"],
                          f"{d['defect_id']} · {d['severity']}", d["status"],
                          {"qty": d["qty"], "detected": d["detected_at"]},
                          f"/defects/{d['defect_id']}")
        capa_key = None
        if capa_row:
            capa_key = node(f"capa:{capa_row['capa_id']}", "capa", capa_row["capa_id"],
                            capa_row["root_cause_category"], capa_row["status"],
                            {"due": capa_row["due_at"], "owner": capa_row["owner_role"]},
                            f"/capa/{capa_row['capa_id']}")

        edge(supplier_key, lot_key, "supplied")
        edge(lot_key, material_key, "material")
        edge(lot_key, inspection_key, "inspected at receipt")
        edge(material_key, order_key, "consumed by")
        edge(product_key, order_key, "produces")
        edge(order_key, step_key, "ran")
        edge(step_key, machine_key, "on machine")
        edge(step_key, inspection_key, "inspected")
        edge(order_key, inspection_key, "inspected")
        edge(inspection_key, defect_key, "found")
        edge(order_key, defect_key, "occurred on")
        edge(defect_key, capa_key, "corrected by")

        return {
            "defect_id": defect_id,
            "nodes": nodes,
            "edges": edges,
            "decision": trace["decision"],
            "chain_complete": trace["chain_complete"],
            "stages": [
                {"key": "source", "label": "Source", "node_ids": [n for n in
                 [supplier_key, lot_key, material_key] if n]},
                {"key": "production", "label": "Production", "node_ids": [n for n in
                 [order_key, product_key] if n]},
                {"key": "process", "label": "Process", "node_ids": [n for n in
                 [step_key, machine_key] if n]},
                {"key": "quality", "label": "Inspection", "node_ids": [inspection_key]},
                {"key": "defect", "label": "Defect", "node_ids": [defect_key]},
                {"key": "action", "label": "Corrective action",
                 "node_ids": [capa_key] if capa_key else []},
            ],
            "containment": trace["containment"],
            "exposure": trace["exposure"],
            "capa": capa_row,
        }

    # ------------------------------------------------------------------ pulse
    def pulse(self):
        capas = self._capa_merged()
        machines = self.ds.machine_scorecard()
        return {
            "open_capas": sum(1 for c in capas if c["status"] in
                              ("open", "in_progress", "pending_verification")),
            "overdue_capas": sum(1 for c in capas if c["days_overdue"] > 0),
            "gate_violations": sum(1 for c in capas if c["status"] == "closed"
                                   and not c["closure_allowed"]),
            "pending_verification": sum(1 for c in capas if c["status"] == "pending_verification"),
            "critical_defects": self.ds.q1("""
                SELECT COUNT(*) AS n FROM defect WHERE severity = 'critical'
                  AND status IN ('open','contained','rework')
            """)["n"],
            "exceptions": self.ds.q1("SELECT COUNT(*) AS n FROM anomaly_register")["n"],
            "severe_exceptions": self.ds.q1("""
                SELECT COUNT(*) AS n FROM anomaly_register WHERE severity IN ('critical','high')
            """)["n"],
            "drift_machines": sum(1 for m in machines if m["drift_weeks"] >= 2),
            "orders_in_progress": self.ds.q1("""
                SELECT COUNT(*) AS n FROM production_order WHERE status = 'in_progress'
            """)["n"],
        }

    # --------------------------------------------------------------- routing
    def handle(self, method, path, query, body):
        body = body or {}
        routes = [
            ("GET", r"/api/health", lambda: {"ok": True, "version": API_VERSION}),
            ("GET", r"/api/meta", self.meta),
            ("GET", r"/api/overview", self.ds.overview),
            ("GET", r"/api/dashboard", self.dashboard),
            ("GET", r"/api/pulse", self.pulse),
            ("GET", r"/api/analytics", self.analytics),
            ("GET", r"/api/products", lambda: self.products(query)),
            ("GET", r"/api/products/([^/]+)", self.product_detail),
            ("GET", r"/api/suppliers", lambda: self.suppliers(query)),
            ("GET", r"/api/suppliers/([^/]+)", self.supplier_detail),
            ("GET", r"/api/lots", lambda: self.lots(query)),
            ("GET", r"/api/lots/([^/]+)", self.lot_detail),
            ("GET", r"/api/orders", lambda: self.orders(query)),
            ("GET", r"/api/orders/([^/]+)", self.order_detail),
            ("GET", r"/api/machines", lambda: self.machines(query)),
            ("GET", r"/api/machines/([^/]+)", self.machine_detail),
            ("GET", r"/api/inspections", lambda: self.inspections(query)),
            ("GET", r"/api/inspections/([^/]+)", self.inspection_detail),
            ("GET", r"/api/defects", lambda: self.defects(query)),
            ("GET", r"/api/defects/([^/]+)", self.defect_detail),
            ("GET", r"/api/capas", lambda: self.capas(query)),
            ("GET", r"/api/capas/([^/]+)", self.capa_detail),
            ("GET", r"/api/capa-gate", lambda: T.check_capa_gate(self.ds, query.get("capa_id", ""))),
            ("GET", r"/api/trace", lambda: T.trace_defect(self.ds, (query.get("defect_id") or "").upper())),
            ("GET", r"/api/trace-graph", lambda: self.trace_graph(
                (query.get("defect_id") or "").upper())),
            ("GET", r"/api/exceptions", lambda: self.exceptions(query)),
            ("GET", r"/api/search", lambda: self.search(query)),
            ("GET", r"/api/validation", lambda: self.report("validation_summary")),
            ("GET", r"/api/evaluation", lambda: self.report("evaluation_report")),
            ("GET", r"/api/reproducibility", lambda: self.report("reproducibility")),
            ("GET", r"/api/settings", self.settings),
            ("GET", r"/api/activity", lambda: {"events": self.ops.recent_activity(limit=50)}),
            ("POST", r"/api/capas/([^/]+)/actions", self.capa_action),
            ("POST", r"/api/defects/([^/]+)/actions", self.defect_action),
            ("PUT", r"/api/settings", self.save_settings),
            ("POST", r"/api/settings/clear-history", lambda body: self.clear_history()),
            ("GET", r"/api/decision", lambda: self._decision(query)),
            ("GET", r"/api/sample-defect", lambda: self._sample_defect(query)),
        ]
        for route_method, pattern, handler in routes:
            if route_method != method:
                continue
            match = re.fullmatch(pattern, path)
            if not match:
                continue
            args = match.groups()
            if pattern.startswith(r"/api/capas/([^/]+)/actions") and method == "POST":
                return handler(args[0], body)
            if pattern.startswith(r"/api/defects/([^/]+)/actions") and method == "POST":
                return handler(args[0], body)
            if method in ("POST", "PUT"):
                result = handler(body)
                if isinstance(result, tuple):
                    return result
                return 200, result
            result = handler(*args)
            if result is None:
                return 404, {"error": "not found"}
            return 200, result
        return 404, {"error": f"unknown endpoint {path}"}

    def _decision(self, query):
        defect = T.get_defect(self.ds, (query.get("defect_id") or "").upper())
        if not defect:
            return {"error": "not found"}
        return {"defect": defect, "decision": T.decide(self.ds, defect)}

    def _sample_defect(self, query):
        row = self.ds.q1("""
            SELECT d.defect_id, d.defect_name, d.severity, d.detected_at, d.order_id, d.lot_id
            FROM defect d
            LEFT JOIN capa c ON c.defect_id = d.defect_id
            WHERE d.severity = ? AND d.order_id IS NOT NULL
            ORDER BY (c.capa_id IS NULL), d.defect_id
            LIMIT 1 OFFSET 2
        """, (query.get("severity") or "critical",))
        if not row:
            row = self.ds.q1("SELECT defect_id FROM defect ORDER BY defect_id LIMIT 1")
        return row or {"error": "no defects"}
