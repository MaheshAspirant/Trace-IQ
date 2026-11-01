"""Domain constants, deterministic ID helpers and the documented business rules.

This module is the single source of truth for
  * identifier formats (SKU / SUP / LOT / WO / INSP / DEF / CAPA / BOM / CAPA)
  * generation profiles and latent-rate parameters
  * the disposition / CAPA / closure-gate rule tables

The *same* rule functions are used by ``generate.py`` (to derive expected
labels for ground truth) and by ``trace.py`` (to re-derive decisions from
persisted records only).  That keeps the rule set auditable while still
proving that the stored data contains every input the decision needs.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

SEED = 20261022
DATASET_VERSION = "1.0.0"
DATASET_YEAR = 2026
TODAY = date(2026, 10, 22)

# ---------------------------------------------------------------- profiles
# Both profiles run the *same* generator; only volumes change.
PROFILES = {
    "starter": dict(products=20, suppliers=8, lots=60, orders=120, inspections=400, machines=8),
    "full": dict(products=200, suppliers=50, lots=2000, orders=5000, inspections=20000, machines=30),
}

# ------------------------------------------------------------- mnemonics
PLANTS = ["PLANT-01", "PLANT-02", "PLANT-03"]
PLANT_CITIES = {"PLANT-01": "Cedar Rapids", "PLANT-02": "Monterrey", "PLANT-03": "Brno"}
LINES = ["L1", "L2"]

FAMILIES = ["Hydraulic Valve", "Pump Assembly", "Sensor Module", "Gearbox", "Actuator", "Manifold"]
FAMILY_PREFIX = {
    "Hydraulic Valve": "HV",
    "Pump Assembly": "PA",
    "Sensor Module": "SM",
    "Gearbox": "GB",
    "Actuator": "AC",
    "Manifold": "MF",
}
# latent complexity multiplier applied to defect probability
FAMILY_COMPLEXITY = {
    "Hydraulic Valve": 1.00,
    "Pump Assembly": 1.10,
    "Sensor Module": 1.25,
    "Gearbox": 1.30,
    "Actuator": 1.05,
    "Manifold": 0.90,
}

MACHINE_TYPES = ["cnc", "press", "weld", "assembly", "oven", "leak_test", "packaging", "test"]

# routing template per product family: (step name, machine type, minutes,
# baseline temperature C, baseline pressure bar, baseline speed units/h)
ROUTINGS = {
    "Hydraulic Valve": [
        ("Cut bar stock", "cnc", 22, 24.0, 4.0, 90),
        ("Machine valve body", "cnc", 38, 26.0, 6.0, 60),
        ("Assemble valve", "assembly", 30, 23.0, 3.0, 45),
        ("Leak test", "leak_test", 12, 22.0, 12.0, 120),
        ("Pack and label", "packaging", 8, 21.0, 1.0, 200),
    ],
    "Pump Assembly": [
        ("Prepare casting", "cnc", 25, 25.0, 4.0, 80),
        ("Machine housing", "cnc", 45, 27.0, 6.5, 50),
        ("Assemble pump", "assembly", 40, 23.5, 3.0, 35),
        ("Performance test", "leak_test", 18, 22.5, 14.0, 60),
        ("Pack and label", "packaging", 9, 21.0, 1.0, 180),
    ],
    "Sensor Module": [
        ("SMT placement", "assembly", 20, 24.0, 2.0, 140),
        ("Reflow solder", "oven", 25, 245.0, 1.2, 110),
        ("Calibrate module", "test", 15, 23.0, 2.0, 70),
        ("Final functional test", "leak_test", 12, 22.5, 8.0, 90),
        ("Pack and label", "packaging", 7, 21.0, 1.0, 220),
    ],
    "Gearbox": [
        ("Cut gear blanks", "cnc", 28, 25.0, 5.0, 70),
        ("Hob gear teeth", "cnc", 50, 26.5, 6.0, 40),
        ("Press bearings", "press", 20, 24.0, 9.0, 55),
        ("Assemble gearbox", "assembly", 45, 23.5, 3.0, 30),
        ("Run-in test", "leak_test", 20, 24.0, 10.0, 45),
        ("Pack and label", "packaging", 9, 21.0, 1.0, 160),
    ],
    "Actuator": [
        ("Cut tube", "cnc", 18, 24.0, 4.0, 100),
        ("Weld housing", "weld", 30, 180.0, 2.0, 40),
        ("Assemble actuator", "assembly", 35, 23.0, 3.0, 38),
        ("Torque test", "leak_test", 14, 22.0, 11.0, 85),
        ("Pack and label", "packaging", 8, 21.0, 1.0, 200),
    ],
    "Manifold": [
        ("Cut block", "cnc", 20, 25.0, 4.5, 85),
        ("Mill ports", "cnc", 42, 26.0, 6.0, 55),
        ("Deburr and clean", "assembly", 18, 23.0, 2.5, 95),
        ("Pressure test", "leak_test", 16, 22.0, 15.0, 75),
        ("Pack and label", "packaging", 8, 21.0, 1.0, 190),
    ],
}

COUNTRIES = ["US", "MX", "CZ", "DE", "CN", "VN", "IN", "BR", "IT", "PL"]

# defect catalogue: code, name, category, severity, reworkable, supplier-prone, weight
DEFECT_CATALOG = [
    ("DIM-OD-HIGH", "Outside diameter above tolerance", "dimensional", "major", True, False, 9),
    ("DIM-BORE-LOW", "Bore diameter below tolerance", "dimensional", "major", True, False, 7),
    ("DIM-FLATNESS", "Flatness out of tolerance", "dimensional", "minor", True, False, 6),
    ("MAT-POROSITY", "Material porosity detected", "material", "critical", False, True, 4),
    ("MAT-HARDNESS", "Hardness outside specification", "material", "major", True, True, 5),
    ("MAT-CONTAM", "Material contamination", "material", "critical", False, True, 2),
    ("MAT-ALLOY", "Alloy grade does not match certificate", "material", "critical", False, True, 2),
    ("ASM-MISSING", "Missing component", "assembly", "critical", True, True, 3),
    ("ASM-TORQUE", "Fastener torque out of specification", "assembly", "major", True, False, 8),
    ("ASM-ORIENT", "Component installed in wrong orientation", "assembly", "major", True, False, 4),
    ("FUN-LEAK", "Leak detected during pressure test", "functional", "critical", False, False, 6),
    ("FUN-NOISE", "Abnormal noise at run-in", "functional", "major", True, False, 4),
    ("FUN-FLOW", "Flow rate below specification", "functional", "major", True, False, 5),
    ("COS-SCRATCH", "Surface scratch", "cosmetic", "minor", False, False, 10),
    ("COS-BURR", "Burr on machined edge", "cosmetic", "minor", True, False, 8),
    ("PKG-LABEL", "Label / lot code mismatch", "documentation", "major", False, True, 3),
    ("DOC-CERT", "Supplier certificate missing or incomplete", "documentation", "major", False, True, 3),
]

DEFECT_BY_CODE = {c[0]: c for c in DEFECT_CATALOG}

SEVERITY_RANK = {"minor": 1, "major": 2, "critical": 3}

# ----------------------------------------------------------- rule tables
# Ordered, first match wins.  Documented in docs/DATA_DICTIONARY.md.
DISPOSITION_RULES = [
    ("R1_DATA_QUALITY", "Defect quantity exceeds inspected quantity: quarantine the record and review data capture."),
    ("R2_BLOCKED_SUPPLIER", "Supplier-attributed defect from a blocked supplier: return the lot to the supplier."),
    ("R3_CRITICAL_DEFECT", "Critical severity: scrap when the product forbids rework, otherwise rework."),
    ("R4_RATE_LIMIT", "Inspection defect rate >= 5%: rework the affected units and re-inspect."),
    ("R5_REPEAT_SUPPLIER", "Supplier-attributed defect and >= 3 supplier defects in 90 days: return to supplier."),
    ("R6_MAJOR_DEFECT", "Major severity below the rate limit: rework."),
    ("R7_MINOR_DEFECT", "Minor severity: use-as-is with deviation record."),
]

CAPA_RULES = [
    ("C1_CRITICAL_DEFECT", "Critical defect on a failed inspection requires a corrective action."),
    ("C2_RATE_THRESHOLD", "Inspection defect rate >= 10% requires a corrective action."),
    ("C3_REPEAT_SUPPLIER", "Major supplier-attributed defect with a repeat supplier pattern."),
    ("C4_PROCESS_DRIFT", "Major defect produced on a machine inside a suspected drift window."),
]

DISPOSITION_STATUS = {
    "SCRAP": "scrap",
    "REWORK": "rework",
    "RETURN_TO_SUPPLIER": "contained",
    "QUARANTINE_REVIEW": "contained",
    "USE_AS_IS": "closed",
}

RATE_SCRAP_LIMIT = 0.05   # R4
RATE_CAPA_LIMIT = 0.10    # C2
REPEAT_WINDOW_DAYS = 90
REPEAT_COUNT = 3
DRIFT_SCRAP_MULTIPLIER = 4.0
DRIFT_DEFECT_MULTIPLIER = 3.5
SUPPLIER_RISK_FACTOR = {"A": 1.0, "B": 1.8, "C": 3.0}
QUALIFICATION_FACTOR = {"approved": 1.0, "conditional": 1.45, "blocked": 3.2}


def disposition(severity, defect_rate, supplier_responsibility, supplier_state,
                rework_allowed, repeat_supplier, data_quality_bad=False):
    """Return (disposition_code, rule_id) for a defect context, first match wins."""
    if data_quality_bad:
        return "QUARANTINE_REVIEW", "R1_DATA_QUALITY"
    if supplier_responsibility and supplier_state == "blocked":
        return "RETURN_TO_SUPPLIER", "R2_BLOCKED_SUPPLIER"
    if severity == "critical":
        return ("REWORK", "R3_CRITICAL_DEFECT") if rework_allowed else ("SCRAP", "R3_CRITICAL_DEFECT")
    if defect_rate >= RATE_SCRAP_LIMIT:
        return "REWORK", "R4_RATE_LIMIT"
    if supplier_responsibility and repeat_supplier:
        return "RETURN_TO_SUPPLIER", "R5_REPEAT_SUPPLIER"
    if severity == "major":
        return "REWORK", "R6_MAJOR_DEFECT"
    return "USE_AS_IS", "R7_MINOR_DEFECT"


def capa_required(severity, defect_rate, supplier_responsibility, repeat_supplier,
                  drift_exposed, inspection_failed):
    """Return (required: bool, rule_id|None)."""
    if severity == "critical" and inspection_failed:
        return True, "C1_CRITICAL_DEFECT"
    if defect_rate >= RATE_CAPA_LIMIT:
        return True, "C2_RATE_THRESHOLD"
    if supplier_responsibility and repeat_supplier and severity == "major" and inspection_failed:
        return True, "C3_REPEAT_SUPPLIER"
    if drift_exposed and severity == "major" and inspection_failed:
        return True, "C4_PROCESS_DRIFT"
    return False, None


def capa_gate(status, opened_at, verified_at, closed_at,
              verification_result, verification_date, containment_completed_at):
    """Closure gate: a CAPA may only be closed on verified effectiveness.

    Returns (allowed: bool, reason: str|None).
    """
    if status != "closed":
        return True, None
    if not verified_at or not verification_result:
        return False, "NO_VERIFICATION"
    if closed_at and closed_at < verified_at:
        return False, "CLOSED_BEFORE_VERIFICATION"
    if verified_at < opened_at:
        return False, "VERIFIED_BEFORE_OPEN"
    if verification_result != "pass":
        return False, "VERIFICATION_NOT_PASSED"
    if containment_completed_at and verification_date and verification_date < containment_completed_at:
        return False, "VERIFIED_BEFORE_CONTAINMENT"
    return True, None


ROOT_CAUSE_BY_CATEGORY = {
    "dimensional": "process_parameter",
    "material": "supplier_material",
    "assembly": "operator_error",
    "functional": "machine_calibration",
    "cosmetic": "handling",
    "documentation": "documentation",
}

CONTAINMENT_BY_ROOT_CAUSE = {
    "supplier_material": "Quarantine lot and all orders consuming it; request 8D from supplier.",
    "process_parameter": "Hold downstream orders on the affected machine; re-inspect last 2 hours of output.",
    "machine_calibration": "Stop machine for calibration check; verify last 24 hours of measurements.",
    "operator_error": "Re-train operator and add second-person verification at the station.",
    "design": "Engineering review of drawing tolerance; interim 100% inspection.",
    "handling": "Re-palletise affected units and audit handling procedure.",
    "documentation": "Block shipment until certificate is reconciled with the production order.",
}

CORRECTIVE_BY_ROOT_CAUSE = {
    "supplier_material": "Tighten incoming inspection sampling and add supplier certificate check.",
    "process_parameter": "Recentre process window and add SPC alarm limits on the monitored parameter.",
    "machine_calibration": "Recalibrate tooling and shorten calibration interval to 30 days.",
    "operator_error": "Update work instruction and add poka-yoke at the station.",
    "design": "Release drawing revision and validate first article.",
    "handling": "Introduce protective packaging at the transfer point.",
    "documentation": "Automate certificate matching against lot master data.",
}

PREVENTIVE_BY_ROOT_CAUSE = {
    "supplier_material": "Add supplier to quarterly audit plan and scorecard review.",
    "process_parameter": "Add parameter drift monitoring to the daily tier-1 review.",
    "machine_calibration": "Add calibration reminder to preventive maintenance schedule.",
    "operator_error": "Add station to layered process audit rotation.",
    "design": "Add DFMEA entry and design review gate.",
    "handling": "Add handling risk to PFMEA.",
    "documentation": "Add label/certificate reconciliation to end-of-line checklist.",
}


# --------------------------------------------------------------- ID helpers
def product_id(i):
    return f"SKU-{i:06d}"


def supplier_id(i):
    return f"SUP-{i:04d}"


def supplier_material_id(i):
    return f"SM-{i:06d}"


def bom_id(i):
    return f"BOM-{i:06d}"


def machine_id(i):
    return f"MAC-{i:03d}"


def plan_id(i):
    return f"IP-{i:04d}"


def lot_id(supplier, year, seq):
    return f"LOT-{supplier}-{year}-{seq:06d}"


def order_id(i, year=DATASET_YEAR):
    return f"WO-{year}-{i:06d}"


def step_id(order, seq):
    return f"PS-{order[3:]}-{seq:02d}"


def inspection_id(parent_ref, seq):
    return f"INSP-{parent_ref}-{seq:03d}"


def consumption_id(i):
    return f"CONS-{DATASET_YEAR}-{i:06d}"


def defect_id(i):
    return f"DEF-{DATASET_YEAR}-{i:06d}"


def capa_id(i):
    return f"CAPA-{DATASET_YEAR}-{i:06d}"


def anomaly_id(i):
    return f"ANOM-{i:04d}"


def event_id(prefix, i):
    return f"EVT-{prefix}-{i:06d}"


# --------------------------------------------------------------- utilities
def iso(d):
    """Date or datetime -> ISO text (date-only for date objects)."""
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d %H:%M:%S")
    return d.strftime("%Y-%m-%d")


def as_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(value[:10], "%Y-%m-%d").date()


def as_datetime(value):
    if isinstance(value, datetime):
        return value
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")


def week_start(value):
    """Monday of the ISO week containing the given date."""
    d = as_date(value)
    return d - timedelta(days=d.weekday())


# ------------------------------------------------------- typed table columns
# Ordered column lists per table; used for CSV export, sqlite load and the
# schema/column consistency check in validate.py.
COLUMNS = {
    "product": ["product_id", "name", "family", "product_type", "uom", "revision",
                "lifecycle_state", "rework_allowed", "scrap_tolerance_pct",
                "effective_from", "effective_to", "created_at"],
    "supplier": ["supplier_id", "name", "supplier_type", "country", "risk_tier",
                 "qualification_state", "approved_on", "lead_time_days",
                 "effective_from", "effective_to", "quality_contact_role"],
    "supplier_material": ["supplier_material_id", "supplier_id", "product_id",
                          "qualification_state", "unit_price_usd", "effective_from",
                          "effective_to"],
    "bom_line": ["bom_id", "product_id", "component_product_id", "qty_per_unit", "uom",
                 "scrap_pct", "alternate_group", "effective_from", "effective_to"],
    "machine": ["machine_id", "name", "plant", "line", "machine_type", "commissioned_on",
                "last_maintenance_on", "status", "design_uph"],
    "inspection_plan": ["plan_id", "product_id", "inspection_type", "sample_size", "aql_level",
                        "acceptance_qty", "rejection_qty", "criteria", "effective_from",
                        "effective_to"],
    "material_lot": ["lot_id", "supplier_id", "material_product_id", "supplier_material_id",
                     "received_date", "received_qty", "uom", "expiry_date", "coa_pass",
                     "certificate_ref", "status", "consumed_qty", "remaining_qty", "created_at"],
    "production_order": ["order_id", "product_id", "plant", "line", "planned_qty", "actual_qty",
                         "scrap_qty", "good_qty", "planned_start", "planned_end", "actual_start",
                         "actual_end", "status", "priority", "rework_of_order_id", "planner_code",
                         "created_at"],
    "process_step": ["step_id", "order_id", "sequence_no", "step_name", "machine_id",
                     "planned_duration_min", "actual_duration_min", "started_at", "ended_at",
                     "operator_code", "temperature_c", "pressure_bar", "speed_uph", "input_qty",
                     "output_qty", "scrap_qty", "status"],
    "order_consumption": ["consumption_id", "order_id", "lot_id", "bom_id", "step_id",
                          "qty_consumed", "uom", "consumed_at"],
    "order_event": ["event_id", "order_id", "event_type", "from_state", "to_state", "occurred_at",
                    "actor_code", "note"],
    "lot_event": ["event_id", "lot_id", "event_type", "from_state", "to_state", "occurred_at",
                  "actor_code", "note"],
    "inspection_result": ["inspection_id", "plan_id", "inspection_type", "order_id", "lot_id",
                          "step_id", "machine_id", "inspected_qty", "sampled_qty",
                          "measured_value", "spec_min", "spec_max", "acceptance_qty",
                          "rejection_qty", "defect_count", "defect_rate", "result",
                          "inspected_at", "inspector_code"],
    "defect": ["defect_id", "inspection_id", "order_id", "lot_id", "step_id", "machine_id",
               "defect_code", "defect_name", "category", "severity", "qty",
               "supplier_responsibility", "detection_method", "detected_at", "status"],
    "capa": ["capa_id", "defect_id", "root_cause_category", "containment_action",
             "containment_completed_at", "corrective_action", "preventive_action", "owner_role",
             "opened_at", "due_at", "verification_inspection_id", "verified_at", "closed_at",
             "status", "effectiveness_score"],
    "capa_event": ["event_id", "capa_id", "event_type", "from_state", "to_state", "occurred_at",
                   "actor_code", "note"],
    "anomaly_register": ["anomaly_id", "issue_type", "source_file", "table_name", "record_id",
                         "field_name", "expected_label", "detection_rule", "severity",
                         "injected_value", "note"],
}

# dependency order used for CSV export and sqlite load
TABLE_ORDER = [
    "product", "supplier", "supplier_material", "bom_line", "machine", "inspection_plan",
    "material_lot", "production_order", "process_step", "order_consumption",
    "inspection_result", "defect", "capa", "order_event", "lot_event", "capa_event",
    "anomaly_register",
]
