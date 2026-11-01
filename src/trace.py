"""Defect traceability and decision engine.

The engine never reads the ground-truth files: every decision is re-derived
from persisted rows (defect -> inspection -> order/step/machine -> consumed
lots -> suppliers) using the rule table in ``domain.py``.
"""
from __future__ import annotations

from datetime import date, timedelta

import domain as D
from analytics import Dataset


# --------------------------------------------------------------------- lookups
def get_defect(ds, defect_id):
    rows = ds.q("""
        SELECT d.defect_id, d.inspection_id, d.order_id, d.lot_id, d.step_id, d.machine_id,
               d.defect_code, d.defect_name, d.category, d.severity, d.qty,
               d.supplier_responsibility, d.detection_method, d.detected_at, d.status,
               i.inspection_type, i.inspected_qty, i.defect_count, i.defect_rate, i.result,
               i.inspected_at, i.acceptance_qty, i.lot_id AS inspection_lot_id,
               s.sequence_no, s.step_name, s.started_at AS step_started_at,
               m.machine_type, m.plant AS machine_plant,
               COALESCE(o.product_id, l.material_product_id) AS product_id,
               o.plant, o.line, o.status AS order_status,
               COALESCE(p.name, mp.name) AS product_name,
               COALESCE(p.family, mp.family) AS family,
               COALESCE(p.rework_allowed, mp.rework_allowed) AS rework_allowed,
               COALESCE(p.scrap_tolerance_pct, mp.scrap_tolerance_pct) AS scrap_tolerance_pct,
               l.supplier_id, l.material_product_id, l.received_date, l.expiry_date,
               l.received_qty, l.remaining_qty, l.status AS lot_status,
               sup.name AS supplier_name, sup.risk_tier, sup.qualification_state
        FROM defect d
        JOIN inspection_result i ON i.inspection_id = d.inspection_id
        LEFT JOIN process_step s ON s.step_id = d.step_id
        LEFT JOIN machine m ON m.machine_id = d.machine_id
        LEFT JOIN production_order o ON o.order_id = d.order_id
        LEFT JOIN product p ON p.product_id = o.product_id
        LEFT JOIN material_lot l ON l.lot_id = d.lot_id
        LEFT JOIN product mp ON mp.product_id = l.material_product_id
        LEFT JOIN supplier sup ON sup.supplier_id = l.supplier_id
        WHERE d.defect_id = ?
    """, (defect_id,))
    return rows[0] if rows else None


def _drift_index(ds):
    if "_drift_index" not in ds.__dict__:
        weeks, by_machine = ds.machine_weeks()
        index = {}
        for w in weeks:
            index[(w["machine_id"], w["iso_week"])] = bool(w["drift_suspected"])
        ds._drift_index = index
    return ds._drift_index


def is_drift_exposed(ds, machine_id, when):
    if not machine_id or not when:
        return False
    day = D.as_date(when)
    key = (machine_id, day.strftime("%Y-%W"))
    return _drift_index(ds).get(key, False)


def repeat_supplier(ds, supplier_id, detected_at, defect_id):
    if not supplier_id or not detected_at:
        return False
    row = ds.q1("""
        SELECT COUNT(*) AS n
        FROM defect d JOIN material_lot l ON l.lot_id = d.lot_id
        WHERE d.supplier_responsibility = 1
          AND l.supplier_id = ?
          AND d.defect_id <> ?
          AND (d.detected_at < ? OR (d.detected_at = ? AND d.defect_id < ?))
          AND date(d.detected_at) >= date(?, '-90 days')
    """, (supplier_id, defect_id, detected_at, detected_at, defect_id, detected_at))
    return (row.get("n") or 0) >= D.REPEAT_COUNT


# ------------------------------------------------------------------ decisions
def decide(ds, defect):
    """Return the documented disposition and CAPA decision for a defect row."""
    rate = defect.get("defect_rate") or 0.0
    severity = defect.get("severity")
    sup_resp = int(defect.get("supplier_responsibility") or 0)
    supplier_state = defect.get("qualification_state") or "approved"
    rework_allowed = bool(defect.get("rework_allowed", 1))
    repeat = repeat_supplier(ds, defect.get("supplier_id"), defect.get("detected_at"),
                             defect["defect_id"])
    drift = is_drift_exposed(ds, defect.get("machine_id"), defect.get("detected_at"))
    failed = defect.get("result") == "fail"

    disposition, rule = D.disposition(severity, rate, sup_resp, supplier_state,
                                      rework_allowed, repeat)
    required, capa_rule = D.capa_required(severity, rate, sup_resp, repeat, drift, failed)

    rationale = []
    if rule == "R3_CRITICAL_DEFECT":
        rationale.append(f"Critical severity with rework_allowed={int(rework_allowed)} "
                         f"selects {'REWORK' if rework_allowed else 'SCRAP'}.")
    if rule == "R4_RATE_LIMIT":
        rationale.append(f"Inspection defect rate {rate:.2%} is at or above the 5% rework limit.")
    if rule == "R5_REPEAT_SUPPLIER":
        rationale.append("Supplier already has at least 3 supplier-attributed defects in 90 days.")
    if rule == "R2_BLOCKED_SUPPLIER":
        rationale.append(f"Supplier qualification is {supplier_state}; shipment must be returned.")
    if rule == "R7_MINOR_DEFECT":
        rationale.append("Minor defect below all escalation limits: use-as-is with a deviation record.")
    rationale.append(f"Rework allowed: {'yes' if rework_allowed else 'no'}; "
                     f"supplier responsibility: {'yes' if sup_resp else 'no'}; "
                     f"inspection result: {defect.get('result')}.")
    if drift:
        rationale.append("Machine-week scrap rate is at least 2x the machine baseline (drift suspected).")

    return {
        "disposition": disposition,
        "disposition_rule": rule,
        "capa_required": bool(required),
        "capa_rule": capa_rule,
        "inputs": {
            "severity": severity,
            "defect_rate": rate,
            "supplier_responsibility": sup_resp,
            "supplier_qualification": supplier_state,
            "rework_allowed": int(rework_allowed),
            "repeat_supplier": int(repeat),
            "drift_exposed": int(drift),
            "inspection_failed": int(failed),
        },
        "rationale": rationale,
    }


# ---------------------------------------------------------------------- trace
def trace_defect(ds, defect_id):
    defect = get_defect(ds, defect_id)
    if not defect:
        return None
    decision = decide(ds, defect)

    order = None
    if defect.get("order_id"):
        rows = ds.q("""
            SELECT o.order_id, o.product_id, p.name AS product_name, o.plant, o.line,
                   o.planned_qty, o.actual_qty, o.scrap_qty, o.good_qty, o.status,
                   o.actual_start, o.actual_end, o.rework_of_order_id
            FROM production_order o JOIN product p ON p.product_id = o.product_id
            WHERE o.order_id = ?
        """, (defect["order_id"],))
        order = rows[0] if rows else None

    steps = ds.q("""
        SELECT s.step_id, s.sequence_no, s.step_name, s.machine_id, s.started_at, s.ended_at,
               s.input_qty, s.output_qty, s.scrap_qty, s.temperature_c, s.pressure_bar, s.speed_uph,
               m.machine_type, m.plant AS machine_plant, m.line AS machine_line
        FROM process_step s JOIN machine m ON m.machine_id = s.machine_id
        WHERE s.order_id = ? ORDER BY s.sequence_no
    """, (defect["order_id"],)) if defect.get("order_id") else []

    consumptions = ds.consumptions_for_order(defect["order_id"]) if defect.get("order_id") else []
    inspections = ds.inspections_for_order(defect["order_id"]) if defect.get("order_id") else []

    chain = []
    chain.append({"stage": "defect", "record": defect["defect_id"],
                  "detail": f"{defect['defect_code']} / {defect['severity']} / qty {defect['qty']} "
                            f"detected {defect['detected_at']}"})
    chain.append({"stage": "inspection", "record": defect["inspection_id"],
                  "detail": f"{defect['inspection_type']} inspection of {defect['inspected_qty']} units, "
                            f"defect rate {defect['defect_rate']:.2%}, result {defect['result']}"})
    if defect.get("step_id"):
        chain.append({"stage": "process_step", "record": defect["step_id"],
                      "detail": f"step {defect.get('sequence_no')} {defect.get('step_name')}"})
    if defect.get("machine_id"):
        chain.append({"stage": "machine", "record": defect["machine_id"],
                      "detail": f"{defect.get('machine_type')} at {defect.get('machine_plant')}, "
                                f"drift_suspected={int(decide(ds, defect)['inputs']['drift_exposed'])}"})
    if order:
        chain.append({"stage": "production_order", "record": order["order_id"],
                      "detail": f"{order['product_name']} planned {order['planned_qty']}, "
                                f"status {order['status']}, line {order['plant']}/{order['line']}"})
    if defect.get("lot_id"):
        chain.append({"stage": "material_lot", "record": defect["lot_id"],
                      "detail": f"received {defect['received_date']}, remaining {defect['remaining_qty']}, "
                                f"status {defect['lot_status']}"})
        chain.append({"stage": "supplier", "record": defect["supplier_id"],
                      "detail": f"{defect['supplier_name']} (risk {defect['risk_tier']}, "
                                f"{defect['qualification_state']})"})

    # exposure: everything that shares the implicated lot or the same machine window
    exposure = {"orders_sharing_lot": [], "lots_same_source": [], "orders_same_machine_window": []}
    if defect.get("lot_id"):
        exposure["orders_sharing_lot"] = ds.q("""
            SELECT DISTINCT o.order_id, o.status, o.product_id, p.name AS product_name
            FROM order_consumption c
            JOIN production_order o ON o.order_id = c.order_id
            JOIN product p ON p.product_id = o.product_id
            WHERE c.lot_id = ?
            ORDER BY o.order_id
        """, (defect["lot_id"],))
        exposure["lots_same_source"] = ds.q("""
            SELECT lot_id, received_date, status, remaining_qty
            FROM material_lot
            WHERE supplier_id = ? AND material_product_id = ?
              AND date(received_date) BETWEEN date(?, '-30 days') AND date(?, '+30 days')
            ORDER BY received_date
        """, (defect["supplier_id"], defect["material_product_id"],
              defect["received_date"], defect["received_date"]))
    if defect.get("machine_id"):
        exposure["orders_same_machine_window"] = ds.q("""
            SELECT DISTINCT o.order_id, o.status, o.product_id, COUNT(*) AS steps_on_machine
            FROM process_step s JOIN production_order o ON o.order_id = s.order_id
            WHERE s.machine_id = ? AND date(s.started_at)
                  BETWEEN date(?, '-3 days') AND date(?, '+3 days')
            GROUP BY 1, 2, 3 ORDER BY 1
        """, (defect["machine_id"], defect["detected_at"], defect["detected_at"]))

    containment = {
        "qty_at_risk": 0.0,
        "open_orders": [],
        "actions": [],
        "note": "",
    }
    if defect.get("lot_id"):
        rows = ds.q("""
            SELECT o.order_id, o.status, SUM(c.qty_consumed) AS qty
            FROM order_consumption c JOIN production_order o ON o.order_id = c.order_id
            WHERE c.lot_id = ? GROUP BY 1, 2 ORDER BY 1
        """, (defect["lot_id"],))
        containment["open_orders"] = [r for r in rows if r["status"] not in ("closed", "cancelled")]
        containment["qty_at_risk"] = round(sum(
            r["qty"] for r in rows if r["status"] not in ("closed", "cancelled")), 3)
        containment["note"] = ("Quantity already consumed by orders that are not closed plus the "
                              "unconsumed balance of the lot stays under quarantine.")
        containment["actions"].append(
            f"Quarantine remaining {defect['remaining_qty']} of {defect['lot_id']}.")
        containment["actions"].append(
            f"Re-inspect {len(containment['open_orders'])} open order(s) that consumed the lot.")
    else:
        containment["note"] = "No material lot attributed; containment limited to the order output."
        if order:
            containment["actions"].append(f"Hold the output of {order['order_id']} pending review.")
    if decision["disposition"] in ("SCRAP", "REWORK"):
        containment["actions"].append("Segregate affected units at the end-of-line quarantine rack.")

    downstream = {"orders_same_product": [], "affected_lots": []}
    if order:
        downstream["orders_same_product"] = ds.q("""
            SELECT order_id, status, actual_start, planned_qty
            FROM production_order
            WHERE product_id = ? AND order_id <> ? AND date(actual_start) >= date(?)
            ORDER BY actual_start LIMIT 20
        """, (order["product_id"], order["order_id"], defect["detected_at"]))
    if defect.get("supplier_id"):
        downstream["affected_lots"] = ds.q("""
            SELECT lot_id, received_date, status
            FROM material_lot
            WHERE supplier_id = ? AND date(received_date) >= date(?)
            ORDER BY received_date LIMIT 20
        """, (defect["supplier_id"], defect["detected_at"]))

    capa = ds.q("""
        SELECT c.capa_id, c.status, c.owner_role, c.opened_at, c.due_at, c.verified_at,
               c.closed_at, c.verification_inspection_id, c.effectiveness_score,
               g.closure_allowed, g.gate_reason
        FROM capa c LEFT JOIN v_capa_gate g ON g.capa_id = c.capa_id
        WHERE c.defect_id = ?
    """, (defect["defect_id"],))

    return {
        "defect": defect,
        "decision": decision,
        "order": order,
        "steps": steps,
        "consumptions": consumptions,
        "inspections": inspections,
        "chain": chain,
        "exposure": exposure,
        "containment": containment,
        "downstream": downstream,
        "capa": capa[0] if capa else None,
        "chain_complete": bool(order) and bool(defect.get("step_id") or defect.get("inspection_lot_id")),
    }


# ------------------------------------------------------------------ CAPA gate
def check_capa_gate(ds, capa_id):
    rows = ds.q("""
        SELECT c.*, g.closure_allowed, g.gate_reason,
               i.result AS verification_result, i.inspected_at AS verification_date
        FROM capa c
        LEFT JOIN v_capa_gate g ON g.capa_id = c.capa_id
        LEFT JOIN inspection_result i ON i.inspection_id = c.verification_inspection_id
        WHERE c.capa_id = ?
    """, (capa_id,))
    if not rows:
        return None
    row = rows[0]
    allowed, reason = D.capa_gate(
        row["status"], row["opened_at"], row["verified_at"], row["closed_at"],
        row["verification_result"], row["verification_date"], row["containment_completed_at"])
    return {
        "capa": row,
        "closure_allowed": bool(allowed),
        "reason": reason,
        "open_items": [
            "Verification inspection missing" if not row["verification_inspection_id"] else None,
            "Verification inspection did not pass" if row["verification_result"] not in (None, "pass") else None,
            "Closed before verification" if row["closed_at"] and row["verified_at"] and row["closed_at"] < row["verified_at"] else None,
            "Containment not completed" if not row["containment_completed_at"] else None,
        ],
    }


# --------------------------------------------------------------- audit helper
def decision_audit(ds, decision_rows, limit_mismatch=10):
    """Compare engine decisions with the documented ground-truth decisions."""
    total = 0
    agree = 0
    capa_agree = 0
    by_rule = {}
    mismatches = []
    for expected in decision_rows:
        defect_id = expected["defect_id"]
        defect = get_defect(ds, defect_id)
        if not defect:
            mismatches.append({"defect_id": defect_id, "error": "not found"})
            continue
        result = decide(ds, defect)
        total += 1
        ok = result["disposition"] == expected["expected_disposition"]
        agree += 1 if ok else 0
        capa_agree += 1 if int(result["capa_required"]) == int(expected["expected_capa_required"]) else 0
        key = expected["disposition_rule"]
        stat = by_rule.setdefault(key, {"total": 0, "agree": 0})
        stat["total"] += 1
        stat["agree"] += 1 if ok else 0
        if not ok and len(mismatches) < limit_mismatch:
            mismatches.append({
                "defect_id": defect_id,
                "expected": expected["expected_disposition"],
                "engine": result["disposition"],
                "rule_expected": expected["disposition_rule"],
                "rule_engine": result["disposition_rule"],
            })
    return {
        "total": total,
        "disposition_agreement": round(agree / total, 6) if total else 0.0,
        "capa_agreement": round(capa_agree / total, 6) if total else 0.0,
        "by_rule": by_rule,
        "mismatches": mismatches,
    }
