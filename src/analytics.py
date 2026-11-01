"""Read-only analytics over the generated traceability database.

Every rate here is computed from persisted records only (no latent generator
state), and every rate names its denominator explicitly.
"""
from __future__ import annotations

import os
import sqlite3
import statistics
from datetime import date

import domain as D


def _today():
    return D.TODAY


class Dataset:
    def __init__(self, db_path):
        self.db_path = db_path

    # ------------------------------------------------------------- plumbing
    def connect(self):
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def q(self, sql, params=()):
        conn = self.connect()
        try:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def q1(self, sql, params=()):
        rows = self.q(sql, params)
        return rows[0] if rows else {}

    # -------------------------------------------------------------- summary
    def overview(self):
        counts = self.q1("""
            SELECT (SELECT COUNT(*) FROM product) AS skus,
                   (SELECT COUNT(*) FROM supplier) AS suppliers,
                   (SELECT COUNT(*) FROM bom_line) AS bom_lines,
                   (SELECT COUNT(*) FROM material_lot) AS lots,
                   (SELECT COUNT(*) FROM production_order) AS orders,
                   (SELECT COUNT(*) FROM process_step) AS steps,
                   (SELECT COUNT(*) FROM order_consumption) AS consumptions,
                   (SELECT COUNT(*) FROM inspection_result) AS inspections,
                   (SELECT COUNT(*) FROM defect) AS defects,
                   (SELECT COUNT(*) FROM capa) AS capas,
                   (SELECT COUNT(*) FROM anomaly_register) AS registered_anomalies
        """)
        insp = self.q1("""
            SELECT SUM(inspected_qty) AS inspected_qty,
                   SUM(defect_count) AS defect_qty,
                   SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) AS passed,
                   SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) AS failed,
                   SUM(CASE WHEN result = 'conditional' THEN 1 ELSE 0 END) AS conditional
            FROM inspection_result
        """)
        prod = self.q1("""
            SELECT SUM(actual_qty) AS actual_qty, SUM(scrap_qty) AS scrap_qty,
                   SUM(good_qty) AS good_qty
            FROM production_order WHERE actual_qty IS NOT NULL
        """)
        capa = self.q1("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN status IN ('open','in_progress','pending_verification') THEN 1 ELSE 0 END) AS open,
                   SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
                   SUM(CASE WHEN status IN ('verified','closed') THEN 1 ELSE 0 END) AS verified_or_closed,
                   SUM(CASE WHEN status NOT IN ('closed','cancelled') AND due_at < ? THEN 1 ELSE 0 END) AS overdue,
                   SUM(CASE WHEN status = 'closed' AND closed_at IS NOT NULL AND closed_at <= due_at THEN 1 ELSE 0 END) AS on_time
            FROM capa
        """, (D.iso(_today()),))
        gate = self.q1("""
            SELECT SUM(CASE WHEN status = 'closed' AND closure_allowed = 0 THEN 1 ELSE 0 END) AS violations,
                   SUM(CASE WHEN status = 'closed' AND verification_inspection_id IS NOT NULL THEN 1 ELSE 0 END) AS closed_with_verification
            FROM v_capa_gate
        """)
        trace = self.q1("""
            SELECT COUNT(*) AS defects,
                   SUM(CASE WHEN d.order_id IS NOT NULL THEN 1 ELSE 0 END) AS with_order,
                   SUM(CASE WHEN d.lot_id IS NOT NULL THEN 1 ELSE 0 END) AS with_lot,
                   SUM(CASE WHEN d.machine_id IS NOT NULL THEN 1 ELSE 0 END) AS with_machine,
                   SUM(CASE WHEN d.order_id IS NOT NULL AND
                            (d.lot_id IS NOT NULL OR d.machine_id IS NOT NULL) THEN 1 ELSE 0 END) AS traceable
            FROM defect d
        """)
        inspected = insp["inspected_qty"] or 0
        defect_qty = insp["defect_qty"] or 0
        actual = prod["actual_qty"] or 0
        total_insp = counts["inspections"] or 0
        capa_total = capa["total"] or 0
        closed = capa["closed"] or 0
        return {
            "counts": counts,
            "quality": {
                "inspected_qty": inspected,
                "defect_qty": defect_qty,
                "defect_rate": round(defect_qty / inspected, 6) if inspected else 0.0,
                "dppm": int(round(defect_qty / inspected * 1_000_000)) if inspected else 0,
                "first_pass_yield": round((insp["passed"] or 0) / total_insp, 6) if total_insp else 0.0,
                "failed_inspections": insp["failed"] or 0,
                "conditional_inspections": insp["conditional"] or 0,
                "scrap_rate": round((prod["scrap_qty"] or 0) / actual, 6) if actual else 0.0,
                "scrap_qty": prod["scrap_qty"] or 0,
                "produced_qty": actual,
            },
            "capa": {
                "total": capa_total,
                "open": capa["open"] or 0,
                "closed": closed,
                "verified_or_closed": capa["verified_or_closed"] or 0,
                "closure_rate": round(closed / capa_total, 6) if capa_total else 0.0,
                "verification_rate": round((capa["verified_or_closed"] or 0) / capa_total, 6) if capa_total else 0.0,
                "overdue": capa["overdue"] or 0,
                "on_time_rate": round((capa["on_time"] or 0) / closed, 6) if closed else 0.0,
                "closure_gate_violations": gate["violations"] or 0,
            },
            "traceability": {
                "defects": trace["defects"] or 0,
                "with_order": trace["with_order"] or 0,
                "with_lot": trace["with_lot"] or 0,
                "with_machine": trace["with_machine"] or 0,
                "trace_completeness": round((trace["traceable"] or 0) / (trace["defects"] or 1), 6),
            },
            "as_of": D.iso(_today()),
        }

    # ------------------------------------------------------------- suppliers
    def supplier_scorecard(self):
        rows = self.q("""
            WITH incoming AS (
                SELECT l.supplier_id,
                       COUNT(i.inspection_id) AS incoming_inspections,
                       SUM(i.inspected_qty) AS incoming_inspected_qty,
                       SUM(i.defect_count) AS incoming_defect_qty,
                       SUM(CASE WHEN i.result = 'fail' THEN 1 ELSE 0 END) AS incoming_failures
                FROM inspection_result i
                JOIN material_lot l ON l.lot_id = i.lot_id
                WHERE i.inspection_type = 'incoming'
                GROUP BY 1
            ), attributed AS (
                SELECT l.supplier_id, SUM(d.qty) AS attributed_defect_qty,
                       COUNT(*) AS attributed_defect_events,
                       SUM(CASE WHEN d.severity = 'critical' THEN 1 ELSE 0 END) AS critical_events
                FROM defect d JOIN material_lot l ON l.lot_id = d.lot_id
                WHERE d.supplier_responsibility = 1
                GROUP BY 1
            ), lots AS (
                SELECT supplier_id, COUNT(*) AS lots_received,
                       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS lots_rejected,
                       SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS lots_expired
                FROM material_lot GROUP BY 1
            )
            SELECT s.supplier_id, s.name, s.supplier_type, s.risk_tier, s.qualification_state,
                   s.lead_time_days,
                   COALESCE(i.incoming_inspections, 0) AS incoming_inspections,
                   COALESCE(i.incoming_inspected_qty, 0) AS incoming_inspected_qty,
                   COALESCE(i.incoming_defect_qty, 0) AS incoming_defect_qty,
                   COALESCE(i.incoming_failures, 0) AS incoming_failures,
                   COALESCE(a.attributed_defect_qty, 0) AS attributed_defect_qty,
                   COALESCE(a.attributed_defect_events, 0) AS attributed_defect_events,
                   COALESCE(a.critical_events, 0) AS critical_events,
                   COALESCE(l.lots_received, 0) AS lots_received,
                   COALESCE(l.lots_rejected, 0) AS lots_rejected,
                   COALESCE(l.lots_expired, 0) AS lots_expired
            FROM supplier s
            LEFT JOIN incoming i ON i.supplier_id = s.supplier_id
            LEFT JOIN attributed a ON a.supplier_id = s.supplier_id
            LEFT JOIN lots l ON l.supplier_id = s.supplier_id
            ORDER BY s.supplier_id
        """)
        rates = [r["incoming_defect_qty"] / r["incoming_inspected_qty"]
                 for r in rows if r["incoming_inspected_qty"]]
        median = statistics.median(rates) if rates else 0.0
        for r in rows:
            qty = r["incoming_inspected_qty"] or 0
            r["incoming_defect_rate"] = round(r["incoming_defect_qty"] / qty, 6) if qty else 0.0
            r["portfolio_median_rate"] = round(median, 6)
            if r["qualification_state"] == "blocked" or r["lots_rejected"] >= 3:
                r["decision"] = "BLOCK_AND_AUDIT"
                r["decision_reason"] = "blocked qualification or >= 3 rejected incoming lots"
            elif qty and r["incoming_defect_rate"] >= max(2 * median, 0.02) and r["lots_received"] >= 3:
                r["decision"] = "ESCALATE_8D"
                r["decision_reason"] = "incoming defect rate at least 2x portfolio median"
            elif r["critical_events"] >= 2:
                r["decision"] = "CONDITIONAL_MONITOR"
                r["decision_reason"] = ">= 2 critical supplier-attributed defect events"
            else:
                r["decision"] = "MONITOR"
                r["decision_reason"] = "within portfolio band"
        return rows

    # -------------------------------------------------------------- machines
    def machine_weeks(self):
        rows = self.q("""
            SELECT machine_id, strftime('%Y-%W', started_at) AS iso_week,
                   MIN(date(started_at)) AS week_start,
                   SUM(input_qty) AS input_qty,
                   SUM(scrap_qty) AS scrap_qty,
                   COUNT(*) AS steps
            FROM process_step
            GROUP BY 1, 2
            ORDER BY 1, 2
        """)
        by_machine = {}
        for r in rows:
            by_machine.setdefault(r["machine_id"], []).append(r)
        for machine_id, weeks in by_machine.items():
            # baseline = median weekly scrap rate of the machine itself; weeks
            # with fewer than 200 units are not evaluable (insufficient sample)
            base = [w["scrap_qty"] / w["input_qty"] for w in weeks if w["input_qty"] >= 200]
            median = statistics.median(base) if base else 0.0
            for w in weeks:
                rate = w["scrap_qty"] / w["input_qty"] if w["input_qty"] else 0.0
                w["scrap_rate"] = round(rate, 6)
                w["baseline_rate"] = round(median, 6)
                w["evaluable"] = int(w["input_qty"] >= 200)
                w["drift_suspected"] = int(
                    w["evaluable"] and median > 0 and rate >= 2 * median and rate >= 0.005)
        return rows, by_machine

    def machine_scorecard(self):
        rows = self.q("""
            WITH steps AS (
                SELECT machine_id, COUNT(*) AS step_count, SUM(input_qty) AS input_qty,
                       SUM(scrap_qty) AS scrap_qty
                FROM process_step GROUP BY 1
            ), insp AS (
                SELECT machine_id, COUNT(*) AS inspections, SUM(inspected_qty) AS inspected_qty,
                       SUM(defect_count) AS defect_qty
                FROM inspection_result WHERE machine_id IS NOT NULL GROUP BY 1
            )
            SELECT m.machine_id, m.name, m.plant, m.line, m.machine_type, m.status,
                   COALESCE(s.step_count, 0) AS step_count,
                   COALESCE(s.input_qty, 0) AS input_qty,
                   COALESCE(s.scrap_qty, 0) AS scrap_qty,
                   COALESCE(i.inspections, 0) AS inspections,
                   COALESCE(i.inspected_qty, 0) AS inspected_qty,
                   COALESCE(i.defect_qty, 0) AS defect_qty
            FROM machine m
            LEFT JOIN steps s ON s.machine_id = m.machine_id
            LEFT JOIN insp i ON i.machine_id = m.machine_id
            ORDER BY m.machine_id
        """)
        weeks, _ = self.machine_weeks()
        drift = {}
        for w in weeks:
            if w["drift_suspected"]:
                drift[w["machine_id"]] = drift.get(w["machine_id"], 0) + 1
        for r in rows:
            r["scrap_rate"] = round(r["scrap_qty"] / r["input_qty"], 6) if r["input_qty"] else 0.0
            r["defect_rate"] = round(r["defect_qty"] / r["inspected_qty"], 6) if r["inspected_qty"] else 0.0
            r["drift_weeks"] = drift.get(r["machine_id"], 0)
            r["decision"] = "MAINTENANCE_REVIEW" if r["drift_weeks"] >= 2 else "NORMAL"
        return rows

    # -------------------------------------------------------------- products
    def product_scorecard(self):
        rows = self.q("""
            WITH ord AS (
                SELECT product_id, COUNT(*) AS orders,
                       SUM(CASE WHEN rework_of_order_id IS NOT NULL THEN 1 ELSE 0 END) AS rework_orders,
                       SUM(actual_qty) AS actual_qty, SUM(scrap_qty) AS scrap_qty
                FROM production_order WHERE actual_qty IS NOT NULL GROUP BY 1
            ), insp AS (
                SELECT o.product_id, SUM(i.inspected_qty) AS inspected_qty,
                       SUM(i.defect_count) AS defect_qty,
                       SUM(CASE WHEN i.result = 'fail' THEN 1 ELSE 0 END) AS failures
                FROM inspection_result i JOIN production_order o ON o.order_id = i.order_id
                GROUP BY 1
            )
            SELECT p.product_id, p.name, p.family, p.product_type, p.lifecycle_state,
                   COALESCE(o.orders, 0) AS orders,
                   COALESCE(o.rework_orders, 0) AS rework_orders,
                   COALESCE(o.actual_qty, 0) AS actual_qty,
                   COALESCE(o.scrap_qty, 0) AS scrap_qty,
                   COALESCE(i.inspected_qty, 0) AS inspected_qty,
                   COALESCE(i.defect_qty, 0) AS defect_qty,
                   COALESCE(i.failures, 0) AS failures
            FROM product p
            LEFT JOIN ord o ON o.product_id = p.product_id
            LEFT JOIN insp i ON i.product_id = p.product_id
            ORDER BY p.product_id
        """)
        for r in rows:
            r["scrap_rate"] = round(r["scrap_qty"] / r["actual_qty"], 6) if r["actual_qty"] else 0.0
            r["defect_rate"] = round(r["defect_qty"] / r["inspected_qty"], 6) if r["inspected_qty"] else 0.0
        return rows

    # ----------------------------------------------------------------- CAPA
    def capa_queue(self, limit=100):
        return self.q("""
            SELECT c.capa_id, c.status, c.root_cause_category, c.opened_at, c.due_at,
                   c.verified_at, c.closed_at, c.verification_inspection_id, c.effectiveness_score,
                   c.owner_role, g.closure_allowed, g.gate_reason,
                   d.defect_id, d.severity, d.defect_code, d.defect_name, d.qty, d.detected_at,
                   o.order_id, o.product_id, p.name AS product_name,
                   l.supplier_id, s.name AS supplier_name,
                   CASE WHEN c.status NOT IN ('closed','cancelled') AND c.due_at < ?
                        THEN CAST(julianday(?) - julianday(c.due_at) AS INTEGER) ELSE 0 END AS days_overdue
            FROM capa c
            JOIN defect d ON d.defect_id = c.defect_id
            JOIN v_capa_gate g ON g.capa_id = c.capa_id
            LEFT JOIN inspection_result i ON i.inspection_id = d.inspection_id
            LEFT JOIN production_order o ON o.order_id = d.order_id
            LEFT JOIN product p ON p.product_id = o.product_id
            LEFT JOIN material_lot l ON l.lot_id = d.lot_id
            LEFT JOIN supplier s ON s.supplier_id = l.supplier_id
            ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1
                     WHEN 'pending_verification' THEN 2 WHEN 'verified' THEN 3 ELSE 4 END,
                     c.due_at
            LIMIT ?
        """, (D.iso(_today()), D.iso(_today()), limit))

    # ----------------------------------------------------------- exceptions
    def exception_feed(self, limit=400):
        feed = []
        for row in self.q("""
            SELECT anomaly_id AS id, issue_type AS type, severity, record_id AS ref,
                   table_name AS source, expected_label AS label, detection_rule AS rule, note
            FROM anomaly_register ORDER BY anomaly_id
        """):
            feed.append({"kind": "DATA", **row, "detail": row["note"], "action":
                         "Reconcile the record against master data before using it."})
        for row in self.q("""
            SELECT c.capa_id AS id, 'CAPA_GATE_VIOLATION' AS type, 'critical' AS severity,
                   c.defect_id AS ref, 'capa' AS source, g.gate_reason AS label,
                   'GATE:capa_closure' AS rule,
                   'CAPA ' || c.capa_id || ' is closed but the closure gate fails' AS detail
            FROM capa c JOIN v_capa_gate g ON g.capa_id = c.capa_id
            WHERE c.status = 'closed' AND g.closure_allowed = 0
        """):
            feed.append({"kind": "DECISION", **row, "action":
                         "Reopen the CAPA, run effectiveness verification, then close."})
        for row in self.q("""
            SELECT capa_id AS id, 'CAPA_OVERDUE' AS type, 'high' AS severity,
                   defect_id AS ref, 'capa' AS source, 'OVERDUE' AS label, 'RULE:capa_due_date' AS rule,
                   'CAPA ' || capa_id || ' passed its due date' AS detail
            FROM capa
            WHERE status NOT IN ('closed','cancelled') AND due_at < ?
            ORDER BY due_at
        """, (D.iso(_today()),)):
            feed.append({"kind": "DECISION", **row, "action":
                         "Escalate to the quality manager and re-plan the due date."})
        for row in self.q("""
            SELECT l.lot_id AS id, 'EXPIRED_STOCK' AS type, 'medium' AS severity,
                   l.supplier_id AS ref, 'material_lot' AS source, 'EXPIRED_AT_RISK' AS label,
                   'RECONCILE:remaining_qty>0' AS rule,
                   'Lot ' || l.lot_id || ' expired on ' || l.expiry_date || ' with stock remaining' AS detail
            FROM material_lot l
            WHERE l.status = 'expired' AND l.remaining_qty > 0
        """):
            feed.append({"kind": "INVENTORY", **row, "action":
                         "Scrap or return the expired balance; do not issue."})
        for row in self.q("""
            SELECT d.defect_id AS id, 'DEFECT_WITHOUT_SUPPLIER_ATTRIBUTION' AS type,
                   'low' AS severity, d.inspection_id AS ref, 'defect' AS source,
                   'UNATTRIBUTED' AS label, 'TRACE:defect.lot_id' AS rule,
                   'Critical defect without a supplier lot attribution' AS detail
            FROM defect d WHERE d.severity = 'critical' AND d.lot_id IS NULL
            LIMIT 50
        """):
            feed.append({"kind": "TRACE", **row, "action":
                         "Attach the implicated lot so containment can be scoped."})
        order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        feed.sort(key=lambda f: (order.get(f["severity"], 9), f["id"]))
        return feed[:limit]

    # ----------------------------------------------------------------- trace
    def order_trace(self, order_id):
        return self.q("""
            SELECT o.order_id, o.product_id, p.name AS product_name, o.plant, o.line,
                   o.planned_qty, o.actual_qty, o.scrap_qty, o.good_qty, o.status,
                   o.actual_start, o.actual_end, o.rework_of_order_id
            FROM production_order o JOIN product p ON p.product_id = o.product_id
            WHERE o.order_id = ?
        """, (order_id,))

    def consumptions_for_order(self, order_id):
        return self.q("""
            SELECT c.consumption_id, c.lot_id, c.bom_id, c.step_id, c.qty_consumed, c.uom,
                   c.consumed_at, b.component_product_id, cp.name AS component_name,
                   l.supplier_id, s.name AS supplier_name, s.risk_tier, s.qualification_state,
                   l.received_date, l.expiry_date, l.status AS lot_status
            FROM order_consumption c
            JOIN bom_line b ON b.bom_id = c.bom_id
            JOIN product cp ON cp.product_id = b.component_product_id
            JOIN material_lot l ON l.lot_id = c.lot_id
            JOIN supplier s ON s.supplier_id = l.supplier_id
            WHERE c.order_id = ?
            ORDER BY c.consumed_at, c.consumption_id
        """, (order_id,))

    def inspections_for_order(self, order_id):
        return self.q("""
            SELECT i.inspection_id, i.inspection_type, i.inspected_at, i.inspected_qty,
                   i.defect_count, i.defect_rate, i.result, i.step_id, i.machine_id,
                   s.sequence_no, s.step_name
            FROM inspection_result i
            LEFT JOIN process_step s ON s.step_id = i.step_id
            WHERE i.order_id = ?
            ORDER BY i.inspected_at, i.inspection_id
        """, (order_id,))
