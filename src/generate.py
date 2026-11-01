#!/usr/bin/env python3
"""Deterministic synthetic data generator for the defect-traceability workflow.

Usage
-----
    python src/generate.py --profile full --seed 20261022 --out out
    python src/generate.py --profile starter --out out/starter

The same code path produces both profiles; the seed and profile fully
determine every row, every derived value and every labelled anomaly.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import random
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import domain as D  # noqa: E402

# Inbound cover factor: each lot covers its demand chunk plus a buffer for
# scrapped/wasted material.  The validator asserts that shortages are zero.
SUPPLY_MULTIPLIER = 1.35
LOT_START = date(2025, 7, 1)
LOT_END = date(2026, 9, 10)


# ----------------------------------------------------------------- helpers
def csv_value(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, float):
        s = f"{v:.6f}".rstrip("0").rstrip(".")
        return s if s not in ("", "-0") else "0"
    return str(v)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Generator:
    def __init__(self, profile="full", seed=D.SEED, today=D.TODAY):
        self.profile = profile
        self.cfg = dict(D.PROFILES[profile])
        self.seed = seed
        self.today = today
        self.rng = random.Random(seed)
        self.tables = {name: [] for name in D.TABLE_ORDER}
        self.anomalies = []
        self.quarantine = defaultdict(list)
        self.decision_truth = []
        self.drift_windows = []
        self.supplier_latent = {}
        self.shortages = 0
        self.shortage_detail = []
        self.bucket_info = {}

        self.products = []
        self.product_by_id = {}
        self.boms = defaultdict(list)
        self.suppliers = []
        self.supplier_by_id = {}
        self.supplier_materials = []
        self.sm_by_supplier = defaultdict(list)
        self.sm_by_material = defaultdict(list)
        self.machines = []
        self.machine_by_id = {}
        self.machine_factor = {}
        self.machine_by_type = defaultdict(list)
        self.machine_by_pltype = defaultdict(list)
        self.plans = {}
        self.orders = []
        self.order_by_id = {}
        self.order_steps = defaultdict(list)
        self.lots = []
        self.lot_by_id = {}
        self.stock = defaultdict(list)
        self.remaining = {}
        self.lot_rejected = set()
        self.lot_blocked = set()
        self.inspections = []
        self.inspection_by_id = {}
        self.defects = []
        self.defect_by_id = {}
        self.repeat_supplier = {}
        self.consumption_seq = 0
        self.inspections_by_product = defaultdict(list)
        self.incoming_inspection_by_lot = {}
        self.cons_by_order = defaultdict(list)
        self.cons_by_lot = defaultdict(list)
        self.consumed_lots_by_order = defaultdict(list)
        self.defect_qty_by_inspection = defaultdict(int)
        for name in ("quarantine_defect_lot_refs", "quarantine_inspection_results",
                     "quarantine_trace_breaks", "quarantine_consumption_duplicates"):
            self.quarantine[name] = []

    # ------------------------------------------------------------- products
    def build_products(self):
        n = self.cfg["products"]
        n_fg = max(1, int(round(n * 0.45)))
        n_sub = max(1, int(round(n * 0.25)))
        n_comp = max(1, int(round(n * 0.20)))
        types = (["finished_good"] * n_fg + ["subassembly"] * n_sub +
                 ["component"] * n_comp)
        types += ["raw_material"] * (n - len(types))
        suffix = {"finished_good": "FG", "subassembly": "SA",
                  "component": "CP", "raw_material": "RM"}
        for i in range(1, n + 1):
            ptype = types[i - 1]
            family = D.FAMILIES[(i - 1) % len(D.FAMILIES)]
            uom = "KG" if ptype == "raw_material" else "EA"
            lifecycle = "active"
            r = self.rng.random()
            if r > 0.975:
                lifecycle = "obsolete"
            elif r > 0.92:
                lifecycle = "phase_out"
            effective_from = date(2024, 1, 1) + timedelta(days=self.rng.randrange(0, 540))
            effective_to = None
            if lifecycle == "obsolete":
                effective_to = effective_from + timedelta(days=self.rng.randrange(300, 700))
            rework = 0
            if ptype in ("finished_good", "subassembly", "component"):
                rework = 1 if self.rng.random() < 0.88 else 0
            row = {
                "product_id": D.product_id(i),
                "name": f"{family} {suffix[ptype]} {i:03d}",
                "family": family,
                "product_type": ptype,
                "uom": uom,
                "revision": f"R{self.rng.randint(1, 6):02d}",
                "lifecycle_state": lifecycle,
                "rework_allowed": rework,
                "scrap_tolerance_pct": round(self.rng.uniform(0.4, 2.6), 2) if ptype != "raw_material" else 0.0,
                "effective_from": D.iso(effective_from),
                "effective_to": D.iso(effective_to) if effective_to else None,
                "created_at": D.iso(effective_from - timedelta(days=self.rng.randrange(1, 30))),
            }
            self.tables["product"].append(row)
            self.products.append(row)
            self.product_by_id[row["product_id"]] = row

    # ------------------------------------------------------------ suppliers
    def build_suppliers(self):
        stems = ["Nordwerk", "Baltic", "Prairie", "Monterrey", "Praha", "Pacific",
                 "Rhein", "Vistula", "Andes", "Sakura", "Danube", "Atlas"]
        types = ["raw_material", "component", "packaging", "service"]
        weights = [0.42, 0.36, 0.12, 0.10]
        for i in range(1, self.cfg["suppliers"] + 1):
            stype = self.rng.choices(types, weights=weights, k=1)[0]
            risk = self.rng.choices(["A", "B", "C"], weights=[0.50, 0.35, 0.15], k=1)[0]
            r = self.rng.random()
            qual = "approved" if r < 0.88 else ("conditional" if r < 0.96 else "blocked")
            approved_on = date(2023, 1, 1) + timedelta(days=self.rng.randrange(0, 900))
            country = self.rng.choice(D.COUNTRIES)
            row = {
                "supplier_id": D.supplier_id(i),
                "name": f"{stems[(i - 1) % len(stems)]} {stype.replace('_', ' ').title()} {i:03d}",
                "supplier_type": stype,
                "country": country,
                "risk_tier": risk,
                "qualification_state": qual,
                "approved_on": D.iso(approved_on),
                "lead_time_days": self.rng.randint(7, 60),
                "effective_from": D.iso(approved_on),
                "effective_to": None,
                "quality_contact_role": "Supplier Quality Engineer",
            }
            self.tables["supplier"].append(row)
            self.suppliers.append(row)
            self.supplier_by_id[row["supplier_id"]] = row
            factor = D.SUPPLIER_RISK_FACTOR[risk] * D.QUALIFICATION_FACTOR[qual]
            self.supplier_latent[row["supplier_id"]] = round(0.015 * factor, 6)

    def build_supplier_materials(self):
        comps = [p for p in self.products if p["product_type"] in ("component", "subassembly")]
        raws = [p for p in self.products if p["product_type"] == "raw_material"]
        pools = {"raw_material": raws, "component": comps, "packaging": comps, "service": comps}
        seq = 0
        for sup in self.suppliers:
            pool = pools[sup["supplier_type"]] or comps
            k = self.rng.randint(1, min(4, len(pool)))
            chosen = self.rng.sample(pool, k)
            for prod in chosen:
                seq += 1
                row = {
                    "supplier_material_id": D.supplier_material_id(seq),
                    "supplier_id": sup["supplier_id"],
                    "product_id": prod["product_id"],
                    "qualification_state": sup["qualification_state"],
                    "unit_price_usd": round(self.rng.uniform(0.4, 180.0), 2),
                    "effective_from": sup["effective_from"],
                    "effective_to": None,
                }
                self.tables["supplier_material"].append(row)
                self.supplier_materials.append(row)
                self.sm_by_supplier[sup["supplier_id"]].append(row)
                self.sm_by_material[prod["product_id"]].append(row)
        # every material used by a BOM must be purchasable somewhere
        for prod in self.products:
            if prod["product_type"] == "raw_material" and not self.sm_by_material[prod["product_id"]]:
                self._force_supplier_material(prod)
        for prod in comps:
            if not self.sm_by_material[prod["product_id"]]:
                self._force_supplier_material(prod)

    def _force_supplier_material(self, prod):
        candidates = [s for s in self.suppliers if s["supplier_type"] != "service"]
        sup = candidates[len(self.sm_by_material[prod["product_id"]]) % len(candidates)]
        seq = len(self.supplier_materials) + 1
        row = {
            "supplier_material_id": D.supplier_material_id(seq),
            "supplier_id": sup["supplier_id"],
            "product_id": prod["product_id"],
            "qualification_state": sup["qualification_state"],
            "unit_price_usd": round(self.rng.uniform(0.4, 180.0), 2),
            "effective_from": sup["effective_from"],
            "effective_to": None,
        }
        self.tables["supplier_material"].append(row)
        self.supplier_materials.append(row)
        self.sm_by_supplier[sup["supplier_id"]].append(row)
        self.sm_by_material[prod["product_id"]].append(row)

    # ----------------------------------------------------------- bill of mat.
    def build_boms(self):
        comps = [p for p in self.products if p["product_type"] in ("component", "subassembly")]
        raws = [p for p in self.products if p["product_type"] == "raw_material"]
        any_parts = comps + raws
        seq = 0
        for prod in self.products:
            if prod["product_type"] not in ("finished_good", "subassembly"):
                continue
            idx = self.products.index(prod)
            sub_ok = [p for p in comps
                      if p["product_type"] == "component" or self.products.index(p) < idx]
            cand = sub_ok + raws
            if not cand:
                continue
            k = self.rng.randint(3, min(7, len(cand)))
            chosen = self.rng.sample(cand, k)
            for comp in chosen:
                seq += 1
                if comp["product_type"] == "raw_material":
                    qty = round(self.rng.uniform(0.2, 8.0), 3)
                elif comp["product_type"] == "subassembly":
                    qty = round(self.rng.uniform(1, 2), 0)
                else:
                    qty = float(self.rng.randint(1, 4))
                row = {
                    "bom_id": D.bom_id(seq),
                    "product_id": prod["product_id"],
                    "component_product_id": comp["product_id"],
                    "qty_per_unit": qty,
                    "uom": comp["uom"],
                    "scrap_pct": round(self.rng.uniform(0.0, 2.0), 2),
                    "alternate_group": f"ALT-{seq:05d}" if self.rng.random() < 0.15 else None,
                    "effective_from": prod["effective_from"],
                    "effective_to": None,
                }
                self.tables["bom_line"].append(row)
                self.boms[prod["product_id"]].append(row)

    # -------------------------------------------------------------- machines
    def build_machines(self):
        m = self.cfg["machines"]
        for i in range(1, m + 1):
            mtype = D.MACHINE_TYPES[(i - 1) % len(D.MACHINE_TYPES)]
            plant = D.PLANTS[(i - 1) % len(D.PLANTS)]
            line = D.LINES[((i - 1) // len(D.PLANTS)) % len(D.LINES)]
            r = self.rng.random()
            status = "running" if r < 0.9 else ("idle" if r < 0.95 else ("maintenance" if r < 0.98 else "down"))
            commissioned = date(2017, 1, 1) + timedelta(days=self.rng.randrange(0, 2600))
            last_maint = max(date(2026, 1, 5), self.today - timedelta(days=self.rng.randrange(3, 120)))
            row = {
                "machine_id": D.machine_id(i),
                "name": f"{plant} {line} {mtype.upper()} {i:02d}",
                "plant": plant,
                "line": line,
                "machine_type": mtype,
                "commissioned_on": D.iso(commissioned),
                "last_maintenance_on": D.iso(last_maint),
                "status": status,
                "design_uph": float(self.rng.choice([30, 45, 60, 75, 90, 110, 140, 180, 220])),
            }
            self.tables["machine"].append(row)
            self.machines.append(row)
            self.machine_by_id[row["machine_id"]] = row
            self.machine_by_type[mtype].append(row)
            self.machine_by_pltype[(plant, line, mtype)].append(row)
            self.machine_factor[row["machine_id"]] = round(self.rng.uniform(0.7, 1.6), 4)
        # process-drift windows: a minority of machines run out of parameter
        n_drift = max(1, m // 10)
        for mach in self.rng.sample(self.machines, n_drift):
            start = date(2026, 2, 15) + timedelta(days=self.rng.randrange(0, 170))
            days = self.rng.choice([28, 35, 42, 49, 56])
            end = start + timedelta(days=days)
            self.drift_windows.append({
                "machine_id": mach["machine_id"],
                "window_start": start,
                "window_end": end,
                "multiplier": D.DRIFT_SCRAP_MULTIPLIER,
            })

    def in_drift(self, machine_id, when):
        day = D.as_date(when)
        for w in self.drift_windows:
            if w["machine_id"] == machine_id and w["window_start"] <= day <= w["window_end"]:
                return True
        return False

    # ------------------------------------------------------ inspection plans
    def build_inspection_plans(self):
        seq = 0
        for prod in self.products:
            for itype in ("incoming", "in_process", "final"):
                seq += 1
                if itype == "incoming":
                    size = self.rng.randint(60, 200)
                elif itype == "in_process":
                    size = self.rng.randint(40, 120)
                else:
                    size = self.rng.randint(80, 260)
                acceptance = max(1, int(round(size * 0.015)))
                criteria = {
                    "incoming": "certificate check; dimensional sample; material grade verification",
                    "in_process": "critical dimension; torque; visual; key characteristic within spec",
                    "final": "functional test; leak test; label check; packaging audit",
                }[itype]
                row = {
                    "plan_id": D.plan_id(seq),
                    "product_id": prod["product_id"],
                    "inspection_type": itype,
                    "sample_size": size,
                    "aql_level": self.rng.choice([0.65, 1.0, 1.5, 2.5]),
                    "acceptance_qty": acceptance,
                    "rejection_qty": acceptance + 1,
                    "criteria": criteria,
                    "effective_from": prod["effective_from"],
                    "effective_to": None,
                }
                self.tables["inspection_plan"].append(row)
                self.plans[(prod["product_id"], itype)] = row

    # --------------------------------------------------------------- orders
    def build_orders(self):
        prod_pool = [p for p in self.products if p["product_type"] in ("finished_good", "subassembly")]
        weights = [0.7 if p["product_type"] == "finished_good" else 0.3 for p in prod_pool]
        n = self.cfg["orders"]
        self.orders_by_product = defaultdict(list)
        for i in range(1, n + 1):
            prod = self.rng.choices(prod_pool, weights=weights, k=1)[0]
            routing = D.ROUTINGS[prod["family"]]
            base_minutes = sum(s[2] for s in routing)
            planned_qty = self.rng.randrange(50, 2001, 5)
            planned_start = date(2026, 1, 5) + timedelta(days=self.rng.randrange(0, 300))
            duration_days = max(1, min(12, math.ceil(planned_qty / 260.0)))
            planned_end = planned_start + timedelta(days=duration_days)
            days_ago = (self.today - planned_start).days

            if days_ago < 5:
                status = "planned" if self.rng.random() < 0.6 else "released"
            elif days_ago < 20:
                status = "in_progress" if self.rng.random() < 0.55 else "completed"
            else:
                r = self.rng.random()
                if r < 0.02:
                    status = "cancelled"
                elif r < 0.24:
                    status = "completed"
                else:
                    status = "closed"

            actual_start = None
            actual_end = None
            actual_qty = None
            if status in ("released", "in_progress", "completed", "closed"):
                actual_start = datetime.combine(
                    planned_start + timedelta(days=self.rng.randint(-1, 2)),
                    datetime.min.time()) + timedelta(hours=self.rng.randint(6, 9),
                                                      minutes=self.rng.choice([0, 15, 30, 45]))
            if status in ("completed", "closed"):
                actual_end = actual_start + timedelta(days=duration_days,
                                                      hours=self.rng.randint(1, 6))
                if actual_end.date() >= self.today:
                    actual_end = datetime.combine(self.today - timedelta(days=self.rng.randint(2, 6)),
                                                  datetime.min.time()) + timedelta(hours=15)
                    actual_start = actual_end - timedelta(days=duration_days,
                                                          hours=self.rng.randint(1, 5))
            if status in ("in_progress", "completed", "closed"):
                actual_qty = int(round(planned_qty * self.rng.uniform(0.93, 1.03)))

            rework_of = None
            if i > 20 and status in ("completed", "closed") and self.rng.random() < 0.04:
                prior = [o for o in self.orders_by_product[prod["product_id"]]
                         if o["status"] in ("completed", "closed")]
                if prior:
                    original = self.rng.choice(prior)
                    rework_of = original["order_id"]
                    planned_qty = max(5, int(round(original["planned_qty"] * self.rng.uniform(0.05, 0.2))))
                    if actual_qty is not None:
                        actual_qty = min(actual_qty, planned_qty)

            priority = self.rng.choices(["standard", "expedite", "hold"], weights=[0.85, 0.12, 0.03], k=1)[0]
            row = {
                "order_id": D.order_id(i),
                "product_id": prod["product_id"],
                "plant": D.PLANTS[(i - 1) % len(D.PLANTS)],
                "line": D.LINES[((i - 1) // len(D.PLANTS)) % len(D.LINES)],
                "planned_qty": planned_qty,
                "actual_qty": actual_qty,
                "scrap_qty": 0,
                "good_qty": 0,
                "planned_start": D.iso(planned_start),
                "planned_end": D.iso(planned_end),
                "actual_start": D.iso(actual_start) if actual_start else None,
                "actual_end": D.iso(actual_end) if actual_end else None,
                "status": status,
                "priority": priority,
                "rework_of_order_id": rework_of,
                "planner_code": f"PLN-{self.rng.randint(1, 8):02d}",
                "created_at": D.iso(min(
                    planned_start - timedelta(days=self.rng.randint(3, 21)),
                    (actual_start - timedelta(days=3)).date()) if actual_start
                    else planned_start - timedelta(days=self.rng.randint(3, 21))),
            }
            self.tables["production_order"].append(row)
            self.orders.append(row)
            self.order_by_id[row["order_id"]] = row
            self.orders_by_product[prod["product_id"]].append(row)

    # ---------------------------------------------------------- material lots
    def build_lots(self):
        """Lot sizing follows the demand timeline: every lot is sized to the
        demand it has to cover and is received before its first issue, so no
        order can ever be issued material that does not exist yet."""
        demand = defaultdict(float)
        timeline = defaultdict(list)
        for order in self.orders:
            if order["status"] not in ("in_progress", "completed", "closed"):
                continue
            day = D.as_date(order["actual_start"])
            for line in self.boms[order["product_id"]]:
                need = line["qty_per_unit"] * order["planned_qty"] * (1 + line["scrap_pct"] / 100.0)
                demand[line["component_product_id"]] += need
                timeline[line["component_product_id"]].append((day, need))

        materials = sorted(demand)
        total = sum(demand.values()) or 1.0
        n = self.cfg["lots"]
        counts = {}
        for m in materials:
            counts[m] = max(1, int(round(demand[m] / total * n)))
        # force the exact requested lot count
        while sum(counts.values()) < n:
            m = max(materials, key=lambda x: demand[x] / counts[x])
            counts[m] += 1
        while sum(counts.values()) > n:
            m = max(counts, key=lambda x: counts[x])
            if counts[m] <= 1:
                break
            counts[m] -= 1

        staged = []
        for m in materials:
            sup_rows = list(self.sm_by_material[m])
            if not sup_rows:
                continue
            cnt = counts[m]
            events = sorted(timeline[m])
            tot = sum(q for _d, q in events) or 1.0
            buckets = [[] for _ in range(cnt)]
            acc = 0.0
            for day, qty in events:
                k = min(cnt - 1, int(acc / tot * cnt))
                buckets[k].append((day, qty))
                acc += qty
            prev_day = LOT_START
            for k, bucket in enumerate(buckets):
                sm = sup_rows[k % len(sup_rows)]
                sup = self.supplier_by_id[sm["supplier_id"]]
                if bucket:
                    first_day = bucket[0][0]
                    last_day = bucket[-1][0]
                    chunk_demand = sum(q for _d, q in bucket)
                else:
                    first_day = prev_day + timedelta(days=30)
                    last_day = first_day
                    chunk_demand = 0.0
                received = first_day - timedelta(days=self.rng.randint(3, 15))
                received = max(received, LOT_START)
                prev_day = received
                prod = self.product_by_id[m]
                qty = chunk_demand * SUPPLY_MULTIPLIER * self.rng.uniform(0.95, 1.05)
                qty = round(qty, 3) if prod["uom"] == "KG" else max(1.0, float(int(qty)))
                shelf = max(365, (last_day - received).days + 120)
                self.bucket_info.setdefault(m, []).append(
                    {"received": D.iso(received), "qty": round(qty, 3),
                     "chunk_demand": round(chunk_demand, 3),
                     "first_day": D.iso(first_day), "last_day": D.iso(last_day)})
                staged.append({
                    "supplier_id": sup["supplier_id"],
                    "supplier_material_id": sm["supplier_material_id"],
                    "material_product_id": m,
                    "received_date": received,
                    "received_qty": qty,
                    "uom": prod["uom"],
                    "expiry_date": received + timedelta(days=shelf),
                    "coa_pass": 1 if self.rng.random() < 0.955 else 0,
                })
        # deterministic ids: sequence per supplier per receipt year
        staged.sort(key=lambda r: (r["supplier_id"], r["received_date"], r["material_product_id"]))
        counters = defaultdict(int)
        for item in staged:
            key = (item["supplier_id"], item["received_date"].year)
            counters[key] += 1
            lid = D.lot_id(item["supplier_id"], item["received_date"].year, counters[key])
            row = {
                "lot_id": lid,
                "supplier_id": item["supplier_id"],
                "material_product_id": item["material_product_id"],
                "supplier_material_id": item["supplier_material_id"],
                "received_date": D.iso(item["received_date"]),
                "received_qty": item["received_qty"],
                "uom": item["uom"],
                "expiry_date": D.iso(item["expiry_date"]),
                "coa_pass": item["coa_pass"],
                "certificate_ref": f"COA-{item['supplier_id']}-{counters[key]:05d}",
                "status": "quarantine",
                "consumed_qty": 0.0,
                "remaining_qty": item["received_qty"],
                "created_at": D.iso(item["received_date"]),
            }
            self.tables["material_lot"].append(row)
            self.lots.append(row)
            self.lot_by_id[lid] = row
            self.remaining[lid] = item["received_qty"]
        for lid in self.remaining:
            self.stock[self.lot_by_id[lid]["material_product_id"]].append(lid)
        for m in self.stock:
            self.stock[m].sort(key=lambda lid: (self.lot_by_id[lid]["received_date"], lid))

    # -------------------------------------------------- incoming inspections
    def build_incoming_inspections(self):
        for lot in self.lots:
            plan = self.plans[(lot["material_product_id"], "incoming")]
            sup = self.supplier_by_id[lot["supplier_id"]]
            inspected_qty = min(plan["sample_size"], max(10, int(lot["received_qty"])))
            received = D.as_date(lot["received_date"])
            inspected_at = datetime.combine(received + timedelta(days=self.rng.randint(0, 1)),
                                            datetime.min.time()) + timedelta(hours=self.rng.randint(8, 16))
            p = 0.010 * D.SUPPLIER_RISK_FACTOR[sup["risk_tier"]] * \
                D.QUALIFICATION_FACTOR[sup["qualification_state"]]
            if not lot["coa_pass"]:
                p *= 2.2
            units = self.sample_defect_units(inspected_qty, p)
            row = self.new_inspection(
                parent_ref=lot["lot_id"][4:], seq=1, plan=plan, itype="incoming",
                order_id=None, lot_id=lot["lot_id"], step_id=None, machine_id=None,
                inspected_qty=inspected_qty, inspected_at=inspected_at,
                measured=None)
            self.finish_inspection(row, units, context={"kind": "incoming", "lot": lot,
                                                        "supplier": sup})
            self.incoming_inspection_by_lot[lot["lot_id"]] = row

    # ------------------------------------------------- process steps + issue
    def build_steps_and_consumption(self):
        """Build process steps first, then issue material strictly in
        chronological issue order so FIFO reflects real shop-floor sequence."""
        pending = []
        for order in self.orders:
            if order["status"] not in ("in_progress", "completed", "closed"):
                continue
            prod = self.product_by_id[order["product_id"]]
            routing = D.ROUTINGS[prod["family"]]
            if order["status"] == "in_progress":
                completed = self.rng.randint(1, max(1, len(routing) - 1))
            else:
                completed = len(routing)
            cursor = D.as_datetime(order["actual_start"]) if order["actual_start"] else None
            if cursor is None:
                cursor = datetime.combine(D.as_date(order["planned_start"]), datetime.min.time()) + timedelta(hours=7)
            input_qty = order["actual_qty"] or order["planned_qty"]
            drift_exposed = False
            steps = []
            for seq in range(1, completed + 1):
                name, mtype, dur, temp, press, speed = routing[seq - 1]
                mach = self.pick_machine(mtype, order["plant"], order["line"])
                drift = self.in_drift(mach["machine_id"], cursor.date())
                factor = self.machine_factor[mach["machine_id"]]
                actual_dur = dur * self.rng.uniform(0.9, 1.15) * (1.08 if drift else 1.0)
                scrap_rate = 0.004 * factor * (D.DRIFT_SCRAP_MULTIPLIER if drift else 1.0)
                scrap = 0
                # drift also makes scrap *more frequent*, not just larger
                if self.rng.random() < (0.55 if drift else 0.28):
                    scrap = max(1, int(round(input_qty * scrap_rate * self.rng.uniform(0.4, 1.6))))
                scrap = min(scrap, input_qty)
                output_qty = input_qty - scrap
                started_at = cursor
                ended_at = started_at + timedelta(minutes=actual_dur)
                row = {
                    "step_id": D.step_id(order["order_id"], seq),
                    "order_id": order["order_id"],
                    "sequence_no": seq,
                    "step_name": name,
                    "machine_id": mach["machine_id"],
                    "planned_duration_min": float(dur),
                    "actual_duration_min": round(actual_dur, 2),
                    "started_at": D.iso(started_at),
                    "ended_at": D.iso(ended_at),
                    "operator_code": f"OP-{self.rng.randint(1, 40):03d}",
                    "temperature_c": round(temp + (6.0 if drift else 0.0) + self.rng.uniform(-1.2, 1.2), 2),
                    "pressure_bar": round(press * (1.15 if drift else 1.0) + self.rng.uniform(-0.3, 0.3), 2),
                    "speed_uph": round(speed * (0.88 if drift else 1.0) * self.rng.uniform(0.96, 1.04), 2),
                    "input_qty": input_qty,
                    "output_qty": output_qty,
                    "scrap_qty": scrap,
                    "status": "completed",
                }
                self.tables["process_step"].append(row)
                self.order_steps[order["order_id"]].append(row)
                steps.append(row)
                drift_exposed = drift_exposed or drift
                input_qty = output_qty
                cursor = ended_at + timedelta(minutes=self.rng.randint(5, 40))
            order["_drift_exposed"] = drift_exposed
            order["_steps"] = steps
            issue_step = steps[min(1, len(steps) - 1)]
            pending.append((issue_step["started_at"], order["order_id"], order, steps))
        pending.sort(key=lambda item: (item[0], item[1]))
        for _started, _oid, order, steps in pending:
            self.issue_material(order, steps)

    def pick_machine(self, mtype, plant, line):
        pool = self.machine_by_pltype.get((plant, line, mtype))
        if pool:
            return self.rng.choice(pool)
        pool = self.machine_by_type.get(mtype)
        if pool:
            return self.rng.choice(pool)
        return self.machines[0]

    def issue_material(self, order, steps):
        """FIFO issue of BOM components from lots that exist, are released and
        are inside their shelf life on the day of issue.  No future-dated lot is
        ever consumed: a shortfall is counted so validation can fail loudly."""
        if not steps:
            return
        for line in self.boms[order["product_id"]]:
            prod = self.product_by_id[line["component_product_id"]]
            step_idx = 0 if prod["product_type"] == "raw_material" else min(1, len(steps) - 1)
            step = steps[step_idx]
            issue_day = D.as_date(step["started_at"])
            need = line["qty_per_unit"] * order["planned_qty"] * (1 + line["scrap_pct"] / 100.0)
            if prod["uom"] == "KG":
                need = round(need, 3)
            else:
                need = float(math.ceil(need))
            remaining_need = need
            for lid in self.stock[line["component_product_id"]]:
                if remaining_need <= 1e-6:
                    break
                lot = self.lot_by_id[lid]
                if D.as_date(lot["received_date"]) > issue_day:
                    continue
                if D.as_date(lot["expiry_date"]) <= issue_day:
                    continue
                avail = self.remaining[lid]
                if avail <= 1e-6:
                    continue
                take = min(avail, remaining_need)
                self.record_consumption(order, lot, line, step, take, prod)
                remaining_need -= take
            if remaining_need > 1e-6:
                self.shortages += 1
                avail_total = avail_future = avail_blocked = avail_now = 0.0
                skipped_expired = 0
                first_now = []
                for other in self.stock[line["component_product_id"]]:
                    rem = self.remaining[other]
                    if rem <= 1e-6:
                        continue
                    avail_total += rem
                    other_day = D.as_date(self.lot_by_id[other]["received_date"])
                    if other_day > issue_day:
                        avail_future += rem
                        continue
                    if other in self.lot_blocked:
                        avail_blocked += rem
                        continue
                    if D.as_date(self.lot_by_id[other]["expiry_date"]) <= issue_day:
                        skipped_expired += 1
                        continue
                    avail_now += rem
                    if len(first_now) < 3:
                        first_now.append({"lot": other, "rem": round(rem, 3),
                                          "received": D.iso(other_day)})
                self.shortage_detail.append({
                    "material": line["component_product_id"],
                    "order": order["order_id"],
                    "day": D.iso(issue_day),
                    "need": round(need, 3),
                    "short": round(remaining_need, 3),
                    "avail_total": round(avail_total, 3),
                    "avail_future": round(avail_future, 3),
                    "avail_blocked": round(avail_blocked, 3),
                    "avail_now": round(avail_now, 3),
                    "expired_lots": skipped_expired,
                    "now_sample": first_now,
                    "stock": [{"lot": l, "received": self.lot_by_id[l]["received_date"],
                               "expiry": self.lot_by_id[l]["expiry_date"],
                               "remaining": round(self.remaining[l], 3)}
                              for l in self.stock[line["component_product_id"]]][:20]
                    if len(self.shortage_detail) < 3 else None,
                })

    def record_consumption(self, order, lot, line, step, qty, prod):
        self.consumption_seq += 1
        if prod["uom"] == "KG":
            qty = round(qty, 3)
        consumed_at = D.as_datetime(step["started_at"]) + timedelta(minutes=self.rng.randint(0, 45))
        row = {
            "consumption_id": D.consumption_id(self.consumption_seq),
            "order_id": order["order_id"],
            "lot_id": lot["lot_id"],
            "bom_id": line["bom_id"],
            "step_id": step["step_id"],
            "qty_consumed": qty,
            "uom": prod["uom"],
            "consumed_at": D.iso(consumed_at),
        }
        self.tables["order_consumption"].append(row)
        self.cons_by_order[order["order_id"]].append(row)
        self.cons_by_lot[lot["lot_id"]].append(row)
        self.consumed_lots_by_order[order["order_id"]].append(lot["lot_id"])
        self.remaining[lot["lot_id"]] = round(self.remaining[lot["lot_id"]] - qty, 6)

    # ------------------------------------------------------ order inspections
    def build_order_inspections(self):
        target = self.cfg["inspections"]
        final_orders = [o for o in self.orders if o["status"] in ("completed", "closed")]
        n_incoming = len(self.lots)
        n_final = len(final_orders)
        n_in_process = max(0, target - n_incoming - n_final)

        candidates = []
        for order in self.orders:
            steps = self.order_steps.get(order["order_id"], [])
            if not steps or order["status"] not in ("in_progress", "completed", "closed"):
                continue
            for step in steps:
                if step["output_qty"] > 0:
                    candidates.append((order, step))
        self.rng.shuffle(candidates)
        chosen = defaultdict(list)
        taken = 0
        for order, step in candidates:
            if taken >= n_in_process:
                break
            if len(chosen[order["order_id"]]) >= 4:
                continue
            chosen[order["order_id"]].append(step)
            taken += 1

        for order in self.orders:
            prod = self.product_by_id[order["product_id"]]
            steps = self.order_steps.get(order["order_id"], [])
            if not steps:
                continue
            seq = 0
            drift_exposed = order.get("_drift_exposed", False)
            for step in sorted(chosen.get(order["order_id"], []), key=lambda s: s["started_at"]):
                plan = self.plans[(prod["product_id"], "in_process")]
                inspected_qty = min(plan["sample_size"], max(1, step["output_qty"]))
                inspected_at = D.as_datetime(step["ended_at"]) + timedelta(hours=self.rng.randint(0, 4))
                p = 0.018 * self.machine_factor[step["machine_id"]] * D.FAMILY_COMPLEXITY[prod["family"]]
                if self.in_drift(step["machine_id"], inspected_at.date()):
                    p *= D.DRIFT_DEFECT_MULTIPLIER
                units = self.sample_defect_units(inspected_qty, p)
                seq += 1
                row = self.new_inspection(
                    parent_ref=order["order_id"][3:], seq=seq, plan=plan, itype="in_process",
                    order_id=order["order_id"], lot_id=None, step_id=step["step_id"],
                    machine_id=step["machine_id"], inspected_qty=inspected_qty,
                    inspected_at=inspected_at, measured=True)
                self.finish_inspection(row, units, context={"kind": "process", "order": order,
                                                            "step": step, "drift": self.in_drift(step["machine_id"], inspected_at.date())})
            if order["status"] in ("completed", "closed"):
                plan = self.plans[(prod["product_id"], "final")]
                inspected_qty = min(plan["sample_size"], max(1, order["good_qty"] or order["actual_qty"] or 1))
                inspected_at = datetime.combine(D.as_date(order["actual_end"]),
                                                datetime.min.time()) + timedelta(hours=self.rng.randint(9, 18))
                p = 0.014 * D.FAMILY_COMPLEXITY[prod["family"]] * (1.5 if drift_exposed else 1.0)
                p *= self.rng.uniform(0.85, 1.2)
                units = self.sample_defect_units(inspected_qty, p)
                seq += 1
                row = self.new_inspection(
                    parent_ref=order["order_id"][3:], seq=seq, plan=plan, itype="final",
                    order_id=order["order_id"], lot_id=None, step_id=None, machine_id=None,
                    inspected_qty=inspected_qty, inspected_at=inspected_at, measured=True)
                self.finish_inspection(row, units, context={"kind": "final", "order": order,
                                                            "drift": drift_exposed})

    # -------------------------------------------------------- inspection util
    def new_inspection(self, parent_ref, seq, plan, itype, order_id, lot_id, step_id,
                       machine_id, inspected_qty, inspected_at, measured=None):
        sampled = max(1, int(inspected_qty * self.rng.uniform(0.35, 1.0)))
        measured_value = spec_min = spec_max = None
        if measured:
            nominal = self.rng.uniform(20, 120)
            spec_min = round(nominal - 0.5, 3)
            spec_max = round(nominal + 0.5, 3)
            measured_value = round(self.rng.gauss(nominal, 0.22), 3)
        row = {
            "inspection_id": D.inspection_id(parent_ref, seq),
            "plan_id": plan["plan_id"],
            "inspection_type": itype,
            "order_id": order_id,
            "lot_id": lot_id,
            "step_id": step_id,
            "machine_id": machine_id,
            "inspected_qty": inspected_qty,
            "sampled_qty": sampled,
            "measured_value": measured_value,
            "spec_min": spec_min,
            "spec_max": spec_max,
            "acceptance_qty": plan["acceptance_qty"],
            "rejection_qty": plan["rejection_qty"],
            "defect_count": 0,
            "defect_rate": 0.0,
            "result": "pending",
            "inspected_at": D.iso(inspected_at),
            "inspector_code": f"QC-{self.rng.randint(1, 15):02d}",
        }
        self.tables["inspection_result"].append(row)
        self.inspections.append(row)
        self.inspection_by_id[row["inspection_id"]] = row
        self.inspections_by_product[plan["product_id"]].append(row)
        return row

    def sample_defect_units(self, inspected_qty, p):
        presence = min(0.85, p * 8.0)
        if self.rng.random() > presence:
            return 0
        units = p * inspected_qty * self.rng.uniform(0.6, 1.6)
        units = max(1, min(int(round(units)), max(1, int(inspected_qty * 0.2))))
        return int(min(units, inspected_qty))

    def pick_defect_codes(self, kind, n):
        pool = []
        for entry in D.DEFECT_CATALOG:
            code, name, cat, sev, reworkable, sup_prone, weight = entry
            if kind == "incoming":
                if not sup_prone:
                    continue
                w = weight
            elif kind == "documentation":
                if not sup_prone:
                    continue
                w = weight
            else:
                w = weight * (3.0 if not sup_prone else 0.4)
            pool.append((code, w))
        picked = []
        available = list(pool)
        for _ in range(n):
            total = sum(w for _, w in available)
            r = self.rng.uniform(0, total)
            acc = 0
            chosen = available[-1][0]
            for code, w in available:
                acc += w
                if acc >= r:
                    chosen = code
                    break
            picked.append(chosen)
            available = [(c, w) for c, w in available if c != chosen] or available
        return picked

    def finish_inspection(self, row, units, context):
        """Create defect rows from defective units and set the inspection result."""
        if units > 0:
            n_rows = 1 if units <= 2 else (2 if units <= 5 else 3)
            n_rows = min(n_rows, units)
            parts = []
            base = units // n_rows
            rem = units - base * n_rows
            for k in range(n_rows):
                parts.append(base + (1 if k < rem else 0))
            if context["kind"] == "incoming":
                code_kind = "incoming"
            elif context["kind"] == "process":
                code_kind = "process"
            else:
                code_kind = "process"
            codes = self.pick_defect_codes(code_kind, n_rows)
            for code, qty in zip(codes, parts):
                if qty <= 0:
                    continue
                self.create_defect(row, code, qty, context)
        self.recompute_inspection(row)

    def recompute_inspection(self, row):
        total = self.defect_qty_by_inspection[row["inspection_id"]]
        row["defect_count"] = int(total)
        row["defect_rate"] = round(total / row["inspected_qty"], 6) if row["inspected_qty"] else 0.0
        if total > row["acceptance_qty"]:
            row["result"] = "fail"
        elif total > 0:
            row["result"] = "conditional"
        else:
            row["result"] = "pass"

    def create_defect(self, insp, code, qty, context):
        entry = D.DEFECT_BY_CODE[code]
        _, name, category, severity, reworkable, sup_prone, _w = entry
        order = context.get("order")
        order_id = order["order_id"] if order else None
        lot_id = None
        supplier_responsibility = 0
        if context["kind"] == "incoming":
            lot_id = context["lot"]["lot_id"]
            supplier_responsibility = 1 if sup_prone else 0
        else:
            if sup_prone and order is not None:
                lots = self.consumed_lots_by_order.get(order["order_id"], [])
                if lots and self.rng.random() < 0.75:
                    lot_id = self.rng.choice(lots)
                    supplier_responsibility = 1
        detection = {"dimensional": "gauge", "material": "certificate_review",
                     "assembly": "visual", "functional": "functional_test",
                     "cosmetic": "visual", "documentation": "certificate_review"}[category]
        idx = len(self.defects) + 1
        row = {
            "defect_id": D.defect_id(idx),
            "inspection_id": insp["inspection_id"],
            "order_id": order_id,
            "lot_id": lot_id,
            "step_id": insp["step_id"],
            "machine_id": insp["machine_id"],
            "defect_code": code,
            "defect_name": name,
            "category": category,
            "severity": severity,
            "qty": int(qty),
            "supplier_responsibility": supplier_responsibility,
            "detection_method": detection,
            "detected_at": insp["inspected_at"],
            "status": "open",
        }
        self.tables["defect"].append(row)
        self.defects.append(row)
        self.defect_by_id[row["defect_id"]] = row
        self.defect_qty_by_inspection[row["inspection_id"]] += int(qty)
        return row

    # --------------------------------------------------------- CAPA + events
    def compute_repeat_suppliers(self):
        by_supplier = defaultdict(list)
        for d in self.defects:
            if not d["lot_id"]:
                continue
            lot = self.lot_by_id.get(d["lot_id"])
            if not lot:
                continue
            if d["supplier_responsibility"]:
                by_supplier[lot["supplier_id"]].append(d)
        for supplier, items in by_supplier.items():
            items.sort(key=lambda d: (d["detected_at"], d["defect_id"]))
            for i, d in enumerate(items):
                when = D.as_datetime(d["detected_at"])
                prior = 0
                for other in items[:i]:
                    delta = when - D.as_datetime(other["detected_at"])
                    if delta <= timedelta(days=D.REPEAT_WINDOW_DAYS):
                        prior += 1
                self.repeat_supplier[d["defect_id"]] = prior >= D.REPEAT_COUNT

    def defect_context(self, defect):
        insp = self.inspection_by_id[defect["inspection_id"]]
        order = self.order_by_id.get(defect["order_id"]) if defect["order_id"] else None
        product = None
        if order:
            product = self.product_by_id[order["product_id"]]
        elif insp["lot_id"]:
            lot = self.lot_by_id[insp["lot_id"]]
            product = self.product_by_id[lot["material_product_id"]]
        supplier = None
        if defect["lot_id"]:
            lot = self.lot_by_id.get(defect["lot_id"])
            if lot:
                supplier = self.supplier_by_id[lot["supplier_id"]]
        drift = bool(defect["machine_id"]) and self.in_drift(defect["machine_id"], defect["detected_at"])
        return {
            "inspection": insp,
            "order": order,
            "product": product,
            "supplier": supplier,
            "repeat": self.repeat_supplier.get(defect["defect_id"], False),
            "drift": drift,
            "inspection_failed": insp["result"] == "fail",
        }

    def plan_product(self, plan_id):
        for (pid, _t), plan in self.plans.items():
            if plan["plan_id"] == plan_id:
                return pid
        return None

    def build_defect_status(self):
        for defect in self.defects:
            ctx = self.defect_context(defect)
            prod = ctx["product"]
            supplier = ctx["supplier"]
            code, rule = D.disposition(
                defect["severity"],
                self.inspection_by_id[defect["inspection_id"]]["defect_rate"],
                defect["supplier_responsibility"],
                supplier["qualification_state"] if supplier else "approved",
                bool(prod["rework_allowed"]) if prod else True,
                ctx["repeat"],
            )
            defect["status"] = D.DISPOSITION_STATUS[code]
            defect["_disposition"] = code
            defect["_disposition_rule"] = rule
            required, capa_rule = D.capa_required(
                defect["severity"],
                self.inspection_by_id[defect["inspection_id"]]["defect_rate"],
                defect["supplier_responsibility"],
                ctx["repeat"], ctx["drift"], ctx["inspection_failed"],
            )
            self.decision_truth.append({
                "defect_id": defect["defect_id"],
                "severity": defect["severity"],
                "defect_rate": self.inspection_by_id[defect["inspection_id"]]["defect_rate"],
                "supplier_responsibility": defect["supplier_responsibility"],
                "repeat_supplier": int(ctx["repeat"]),
                "drift_exposed": int(ctx["drift"]),
                "inspection_failed": int(ctx["inspection_failed"]),
                "expected_disposition": code,
                "disposition_rule": rule,
                "expected_capa_required": int(required),
                "capa_rule": capa_rule,
            })

    def build_capas(self):
        seq = 0
        for defect in self.defects:
            ctx = self.defect_context(defect)
            required, capa_rule = D.capa_required(
                defect["severity"],
                self.inspection_by_id[defect["inspection_id"]]["defect_rate"],
                defect["supplier_responsibility"], ctx["repeat"], ctx["drift"],
                ctx["inspection_failed"])
            if not required:
                continue
            seq += 1
            defect["_capa_required"] = True
            detected = D.as_datetime(defect["detected_at"])
            opened = detected + timedelta(days=self.rng.randint(0, 3), hours=self.rng.randint(0, 6))
            due = opened + timedelta(days=self.rng.choice([45, 60, 75, 90]))
            root = D.ROOT_CAUSE_BY_CATEGORY[defect["category"]]
            if defect["supplier_responsibility"]:
                root = "supplier_material"
            containment_at = opened + timedelta(days=self.rng.randint(0, 5), hours=self.rng.randint(1, 8))
            age = (self.today - opened.date()).days
            if age < 21:
                status = self.rng.choices(["open", "in_progress"], weights=[0.6, 0.4], k=1)[0]
            else:
                status = self.rng.choices(
                    ["open", "in_progress", "pending_verification", "verified", "closed"],
                    weights=[0.14, 0.20, 0.18, 0.16, 0.32], k=1)[0]
            verification = None
            verified_at = None
            closed_at = None
            effectiveness = None
            if status in ("verified", "closed", "pending_verification"):
                verification = self.find_verification_inspection(defect, containment_at)
                if verification is None:
                    status = "in_progress"
                else:
                    verified_at = D.as_datetime(verification["inspected_at"])
                    before = self.inspection_by_id[defect["inspection_id"]]["defect_rate"]
                    after = verification["defect_rate"]
                    effectiveness = round(clamp(1 - after / before, 0, 1), 4) if before > 0 else 1.0
                    if status == "closed":
                        cand = verified_at + timedelta(days=self.rng.randint(3, 21))
                        if cand.date() >= self.today:
                            status = "verified"
                        else:
                            closed_at = cand
            row = {
                "capa_id": D.capa_id(seq),
                "defect_id": defect["defect_id"],
                "root_cause_category": root,
                "containment_action": D.CONTAINMENT_BY_ROOT_CAUSE[root],
                "containment_completed_at": D.iso(containment_at) if status != "open" else None,
                "corrective_action": D.CORRECTIVE_BY_ROOT_CAUSE[root],
                "preventive_action": D.PREVENTIVE_BY_ROOT_CAUSE[root],
                "owner_role": self.rng.choice(["Quality Engineer", "Process Engineer",
                                               "Supplier Quality Engineer", "Maintenance Lead"]),
                "opened_at": D.iso(opened),
                "due_at": D.iso(due),
                "verification_inspection_id": verification["inspection_id"] if verification else None,
                "verified_at": D.iso(verified_at) if verified_at else None,
                "closed_at": D.iso(closed_at) if closed_at else None,
                "status": status,
                "effectiveness_score": effectiveness,
            }
            self.tables["capa"].append(row)

    def find_verification_inspection(self, defect, after):
        insp = self.inspection_by_id[defect["inspection_id"]]
        product_id = None
        if defect["order_id"]:
            product_id = self.order_by_id[defect["order_id"]]["product_id"]
        elif insp["lot_id"]:
            product_id = self.lot_by_id[insp["lot_id"]]["material_product_id"]
        if not product_id:
            return None
        floor = after + timedelta(days=self.rng.randint(3, 10))
        cands = [i for i in self.inspections_by_product[product_id]
                 if i["inspection_id"] != insp["inspection_id"]
                 and i["result"] == "pass"
                 and D.as_datetime(i["inspected_at"]) >= floor]
        if not cands:
            return None
        cands.sort(key=lambda i: (i["inspected_at"], i["inspection_id"]))
        return cands[0]

    # ------------------------------------------------------ derived recompute
    def recompute_derived(self):
        # a lot can only be rejected if it was never issued; an issued lot that
        # failed incoming inspection is a documented concession release
        for lot in self.lots:
            insp = self.incoming_inspection_by_lot.get(lot["lot_id"])
            if not insp or insp["result"] != "fail":
                continue
            issued = self.remaining[lot["lot_id"]] < lot["received_qty"] - 1e-6
            sup = self.supplier_by_id[lot["supplier_id"]]
            if not issued and (sup["qualification_state"] != "approved" or not lot["coa_pass"]):
                self.lot_rejected.add(lot["lot_id"])
        consumed = defaultdict(float)
        first_use = {}
        last_use = {}
        for row in self.tables["order_consumption"]:
            consumed[row["lot_id"]] += row["qty_consumed"]
            first_use.setdefault(row["lot_id"], row["consumed_at"])
            last_use[row["lot_id"]] = max(last_use.get(row["lot_id"], row["consumed_at"]), row["consumed_at"])
        incoming_result = {}
        for insp in self.inspections:
            if insp["inspection_type"] == "incoming" and insp["lot_id"]:
                incoming_result[insp["lot_id"]] = insp["result"]
        for lot in self.lots:
            used = round(consumed[lot["lot_id"]], 6)
            received = lot["received_qty"]
            lot["consumed_qty"] = used
            lot["remaining_qty"] = round(received - used, 6)
            if lot["lot_id"] in self.lot_rejected:
                lot["status"] = "rejected"
            elif used >= received - 1e-6:
                lot["status"] = "consumed"
            elif used > 0:
                lot["status"] = "partially_consumed"
            elif D.as_date(lot["expiry_date"]) < self.today:
                lot["status"] = "expired"
            elif incoming_result.get(lot["lot_id"]) in ("pass", "conditional"):
                lot["status"] = "released"
            else:
                lot["status"] = "quarantine"

        final_scrap = defaultdict(int)
        for defect in self.defects:
            insp = self.inspection_by_id[defect["inspection_id"]]
            if insp["inspection_type"] == "final" and defect["_disposition"] == "SCRAP":
                final_scrap[defect["order_id"]] += defect["qty"]
        for order in self.orders:
            steps = self.order_steps.get(order["order_id"], [])
            step_scrap = sum(s["scrap_qty"] for s in steps)
            total_scrap = step_scrap + final_scrap.get(order["order_id"], 0)
            actual = order["actual_qty"] or 0
            if actual:
                total_scrap = min(total_scrap, actual)
            order["scrap_qty"] = int(total_scrap)
            order["good_qty"] = int(max(0, actual - total_scrap))

    # ------------------------------------------------------------- events
    def build_events(self):
        ord_ev = lot_ev = capa_ev = 0
        events = []
        for order in self.orders:
            created = datetime.combine(D.as_date(order["created_at"]), datetime.min.time()) + timedelta(hours=8)
            events.append((created, "order", order["order_id"], "order_created", None, "planned",
                           "PLN-SYS", "Order created from demand plan"))
            status = order["status"]
            if order["actual_start"]:
                start = D.as_datetime(order["actual_start"])
                released = max(start - timedelta(days=self.rng.randint(1, 4)),
                               created + timedelta(hours=2))
                events.append((released, "order", order["order_id"], "released", "planned", "released",
                               order["planner_code"], "Materials reserved, order released to shop floor"))
            if status in ("in_progress", "completed", "closed"):
                events.append((D.as_datetime(order["actual_start"]), "order", order["order_id"],
                               "started", "released", "in_progress", "OP-SHOP", "First process step started"))
            if status in ("completed", "closed"):
                events.append((D.as_datetime(order["actual_end"]), "order", order["order_id"],
                               "completed", "in_progress", "completed", "OP-SHOP", "Last process step finished"))
            if status == "closed":
                closed = D.as_datetime(order["actual_end"]) + timedelta(days=self.rng.randint(1, 7))
                if closed.date() < self.today:
                    events.append((closed, "order", order["order_id"], "closed", "completed", "closed",
                                   "PLN-SYS", "Order closed after final inspection"))
            if status == "cancelled":
                events.append((datetime.combine(D.as_date(order["planned_start"]), datetime.min.time()),
                               "order", order["order_id"], "cancelled", "planned", "cancelled",
                               order["planner_code"], "Order cancelled by production planning"))
        events.sort(key=lambda e: (e[0], e[2]))
        for when, kind, ref, etype, frm, to, actor, note in events:
            ord_ev += 1
            self.tables["order_event"].append({
                "event_id": D.event_id("ORD", ord_ev), "order_id": ref, "event_type": etype,
                "from_state": frm, "to_state": to, "occurred_at": D.iso(when),
                "actor_code": actor, "note": note,
            })

        events = []
        for lot in self.lots:
            received = datetime.combine(D.as_date(lot["received_date"]), datetime.min.time()) + timedelta(hours=7)
            events.append((received, lot["lot_id"], "lot_received", None, "quarantine", "WH-01",
                           "Goods receipt booked"))
            insp = self.incoming_inspection_by_lot.get(lot["lot_id"])
            if insp:
                when = D.as_datetime(insp["inspected_at"])
                to = "rejected" if lot["status"] == "rejected" else "released"
                events.append((when, lot["lot_id"], "incoming_inspection", "quarantine", to, "QC-01",
                               "Incoming inspection completed"))
            uses = [c["consumed_at"] for c in self.cons_by_lot[lot["lot_id"]]]
            if uses:
                events.append((D.as_datetime(min(uses)), lot["lot_id"], "issued_to_production",
                               "released", "partially_consumed", "WH-01", "First issue to a production order"))
                if lot["status"] == "consumed":
                    events.append((D.as_datetime(max(uses)), lot["lot_id"], "depleted",
                                   "partially_consumed", "consumed", "WH-01", "Lot fully consumed"))
            if lot["status"] == "expired":
                events.append((datetime.combine(D.as_date(lot["expiry_date"]), datetime.min.time()) + timedelta(hours=6),
                               lot["lot_id"], "expired", "released", "expired", "WH-01",
                               "Shelf life elapsed with stock remaining"))
        events.sort(key=lambda e: (e[0], e[1]))
        for when, ref, etype, frm, to, actor, note in events:
            lot_ev += 1
            self.tables["lot_event"].append({
                "event_id": D.event_id("LOT", lot_ev), "lot_id": ref, "event_type": etype,
                "from_state": frm, "to_state": to, "occurred_at": D.iso(when),
                "actor_code": actor, "note": note,
            })

        events = []
        for capa in self.tables["capa"]:
            opened = D.as_datetime(capa["opened_at"])
            events.append((opened, capa["capa_id"], "capa_opened", None, "open", "QA-01",
                           "Corrective action opened"))
            if capa["containment_completed_at"]:
                events.append((D.as_datetime(capa["containment_completed_at"]), capa["capa_id"],
                               "containment_completed", "open", "in_progress", "QA-02",
                               "Containment verified by quality"))
            if capa["verified_at"]:
                events.append((D.as_datetime(capa["verified_at"]), capa["capa_id"],
                               "verification_inspection_passed", "in_progress", "verified", "QC-01",
                               "Effectiveness verification inspection passed"))
            if capa["closed_at"]:
                events.append((D.as_datetime(capa["closed_at"]), capa["capa_id"], "capa_closed",
                               "verified", "closed", "QA-01", "Closed after verified effectiveness"))
        events.sort(key=lambda e: (e[0], e[1]))
        for when, ref, etype, frm, to, actor, note in events:
            capa_ev += 1
            self.tables["capa_event"].append({
                "event_id": D.event_id("CAPA", capa_ev), "capa_id": ref, "event_type": etype,
                "from_state": frm, "to_state": to, "occurred_at": D.iso(when),
                "actor_code": actor, "note": note,
            })

    # ---------------------------------------------------- anomaly injection
    def register_anomaly(self, issue_type, source_file, table, record_id, field, label,
                         rule, severity, injected_value, note):
        idx = len(self.anomalies) + 1
        row = {
            "anomaly_id": D.anomaly_id(idx),
            "issue_type": issue_type,
            "source_file": source_file,
            "table_name": table,
            "record_id": record_id,
            "field_name": field,
            "expected_label": label,
            "detection_rule": rule,
            "severity": severity,
            "injected_value": injected_value,
            "note": note,
        }
        self.anomalies.append(row)
        self.tables["anomaly_register"].append(row)
        return row

    def inject_anomalies(self):
        rng = self.rng

        # 1. defect referencing a material lot that does not exist -> quarantine feed
        picks = [self.defects[i] for i in
                 rng.sample(range(len(self.defects)), min(8, len(self.defects)))]
        for d in picks:
            row = dict(d)
            row["lot_id"] = "LOT-SUP-9999-2026-000001"
            self.quarantine["quarantine_defect_lot_refs"].append(row)
            self.register_anomaly(
                "DEFECT_LOT_NOT_FOUND", "csv/quarantine/quarantine_defect_lot_refs.csv", "defect",
                d["defect_id"], "lot_id", "INVALID_REFERENCE", "FK_CHECK:defect.lot_id->material_lot.lot_id",
                "high", row["lot_id"],
                "Defect event from an external claim feed referencing a lot that is not in master data")

        # 2. bill-of-material component that was never consumed by a completed order
        candidates = [o for o in self.orders if o["status"] in ("completed", "closed")]
        used = 0
        for order in candidates:
            if used >= 12:
                break
            rows = self.cons_by_order.get(order["order_id"], [])
            if len(rows) < 3:
                continue
            target = rows[len(rows) // 2]
            remaining_rows = [c for c in rows if c["bom_id"] != target["bom_id"]]
            if not remaining_rows:
                continue
            self.tables["order_consumption"] = [
                c for c in self.tables["order_consumption"]
                if not (c["order_id"] == order["order_id"] and c["bom_id"] == target["bom_id"])]
            self.register_anomaly(
                "BOM_MATERIAL_NOT_CONSUMED", "csv/order_consumption.csv", "order_consumption",
                order["order_id"], "bom_id", "MISSING_CONSUMPTION",
                "RECONCILE:bom_line_vs_order_consumption",
                "medium", target["bom_id"],
                f"No consumption row for BOM line {target['bom_id']} on a completed order")
            used += 1

        # 3. corrective action closed before verification (gate bypass)
        capas = [c for c in self.tables["capa"] if c["status"] in ("closed", "verified")]
        injected_capa = 0
        for capa in capas:
            if injected_capa >= 6:
                break
            if capa["status"] == "verified" or capa["verified_at"] is None:
                capa["status"] = "closed"
                capa["verification_inspection_id"] = None
                capa["verified_at"] = None
                capa["closed_at"] = capa["closed_at"] or capa["opened_at"]
                self.tables["capa_event"] = [
                    e for e in self.tables["capa_event"]
                    if not (e["capa_id"] == capa["capa_id"]
                            and e["event_type"] == "verification_inspection_passed")]
                self.register_anomaly(
                    "CAPA_CLOSED_BEFORE_VERIFICATION", "csv/capa.csv", "capa", capa["capa_id"],
                    "verification_inspection_id", "NO_VERIFICATION", "GATE:capa_closure",
                    "critical", "NULL",
                    "CAPA closed with no effectiveness verification inspection")
                injected_capa += 1
                continue
            new_closed = (D.as_datetime(capa["verified_at"]) - timedelta(days=rng.randint(4, 15),
                                                                        hours=rng.randint(1, 8)))
            if new_closed.date() <= D.as_date(capa["opened_at"]):
                continue
            capa["closed_at"] = D.iso(new_closed)
            self.register_anomaly(
                "CAPA_CLOSED_BEFORE_VERIFICATION", "csv/capa.csv", "capa", capa["capa_id"],
                "closed_at", "CLOSED_BEFORE_VERIFICATION", "GATE:capa_closure", "critical",
                capa["closed_at"],
                f"closed_at precedes verified_at ({capa['verified_at']})")
            injected_capa += 1

        # 4. defect count exceeds the inspected quantity -> quarantine feed
        picks = [self.inspections[i] for i in
                 rng.sample(range(len(self.inspections)), min(6, len(self.inspections)))]
        for insp in picks:
            row = dict(insp)
            row["defect_count"] = int(round(insp["inspected_qty"] * 2.5))
            row["defect_rate"] = round(row["defect_count"] / insp["inspected_qty"], 6)
            row["result"] = "fail"
            self.quarantine["quarantine_inspection_results"].append(row)
            self.register_anomaly(
                "DEFECT_COUNT_EXCEEDS_INSPECTED_QTY", "csv/quarantine/quarantine_inspection_results.csv",
                "inspection_result", insp["inspection_id"], "defect_count", "INVALID_ARITHMETIC",
                "ARITH:defect_count<=inspected_qty", "high", str(row["defect_count"]),
                "Legacy line-terminal export with defect count above the inspected quantity")

        # 5a. traceability chain break: inspection/defect whose step belongs to another order
        candidates = [d for d in self.defects if d["order_id"] and d["step_id"]]
        rng.shuffle(candidates)
        injected_break = 0
        for d in candidates:
            if injected_break >= 5:
                break
            other = rng.choice(self.tables["process_step"])
            if other["order_id"] == d["order_id"]:
                continue
            row = dict(d)
            row["step_id"] = other["step_id"]
            self.quarantine["quarantine_trace_breaks"].append(row)
            self.register_anomaly(
                "TRACE_CHAIN_BREAK", "csv/quarantine/quarantine_trace_breaks.csv", "defect",
                d["defect_id"], "step_id", "BROKEN_CHAIN", "TRACE:defect.step_id.order_id=defect.order_id",
                "high", row["step_id"], "Defect points at a process step of a different production order")
            injected_break += 1
        # 5b. completed order with no material issue at all
        with_cons = {c["order_id"] for c in self.tables["order_consumption"]}
        already_labelled = {a["record_id"] for a in self.anomalies
                            if a["issue_type"] == "BOM_MATERIAL_NOT_CONSUMED"}
        broke = 0
        for order in self.orders:
            if broke >= 4:
                break
            if order["order_id"] in already_labelled:
                continue
            if order["status"] in ("completed", "closed") and order["order_id"] in with_cons:
                self.tables["order_consumption"] = [
                    c for c in self.tables["order_consumption"]
                    if c["order_id"] != order["order_id"]]
                self.register_anomaly(
                    "TRACE_CHAIN_BREAK", "csv/production_order.csv", "production_order",
                    order["order_id"], "order_id", "BROKEN_CHAIN", "TRACE:order_has_consumption",
                    "high", "no_consumption_rows",
                    "Completed order with process steps but no material consumption records")
                broke += 1

        # 6. expired material consumed in production
        consumed_rows = self.tables["order_consumption"]
        picks = list(consumed_rows)
        rng.shuffle(picks)
        injected = 0
        touched = set()
        for c in picks:
            if injected >= 7:
                break
            lot = self.lot_by_id[c["lot_id"]]
            if lot["lot_id"] in touched:
                continue
            consumed_day = D.as_date(c["consumed_at"])
            received_day = D.as_date(lot["received_date"])
            if (consumed_day - received_day).days < 60:
                continue
            new_expiry = consumed_day - timedelta(days=rng.randint(5, 40))
            if new_expiry <= received_day:
                continue
            lot["expiry_date"] = D.iso(new_expiry)
            touched.add(lot["lot_id"])
            injected += 1
            self.register_anomaly(
                "EXPIRED_LOT_CONSUMED", "csv/material_lot.csv", "material_lot", lot["lot_id"],
                "expiry_date", "LOT_EXPIRED_AT_ISSUE", "RECONCILE:consumed_at<expiry_date",
                "high", lot["expiry_date"],
                f"Lot consumed at {c['consumed_at']} after its expiry date")

        # 7. duplicated material issue -> quarantine feed
        picks = rng.sample(consumed_rows, min(5, len(consumed_rows)))
        for c in picks:
            self.quarantine["quarantine_consumption_duplicates"].append(dict(c))
            self.register_anomaly(
                "DUPLICATE_CONSUMPTION", "csv/quarantine/quarantine_consumption_duplicates.csv",
                "order_consumption", c["consumption_id"], "consumption_id", "DUPLICATE",
                "UNIQUE:order+lot+bom+step", "medium", c["consumption_id"],
                "Duplicate issue transaction for the same order, lot, BOM line and step")

        self.recompute_derived()

    # --------------------------------------------------------------- outputs
    def write_csv(self, outdir):
        csvdir = os.path.join(outdir, "csv")
        os.makedirs(csvdir, exist_ok=True)
        written = []
        for table in D.TABLE_ORDER:
            cols = D.COLUMNS[table]
            path = os.path.join(csvdir, f"{table}.csv")
            rows = sorted(self.tables[table], key=lambda r: r[cols[0]])
            with open(path, "w", newline="", encoding="utf-8") as fh:
                writer = csv.writer(fh, lineterminator="\n")
                writer.writerow(cols)
                for row in rows:
                    writer.writerow([csv_value(row.get(c)) for c in cols])
            written.append(path)
        qdir = os.path.join(csvdir, "quarantine")
        os.makedirs(qdir, exist_ok=True)
        for name, rows in self.quarantine.items():
            table = "defect" if "defect" in name else (
                "inspection_result" if "inspection" in name else (
                    "order_consumption" if "consumption" in name else "defect"))
            cols = D.COLUMNS[table]
            path = os.path.join(qdir, f"{name}.csv")
            with open(path, "w", newline="", encoding="utf-8") as fh:
                writer = csv.writer(fh, lineterminator="\n")
                writer.writerow(cols)
                for row in rows:
                    writer.writerow([csv_value(row.get(c)) for c in cols])
            written.append(path)
        return written

    def write_json(self, outdir):
        jsondir = os.path.join(outdir, "json")
        os.makedirs(jsondir, exist_ok=True)
        written = []
        for table in D.TABLE_ORDER:
            cols = D.COLUMNS[table]
            rows = sorted(self.tables[table], key=lambda r: r[cols[0]])
            path = os.path.join(jsondir, f"{table}.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(rows, fh, separators=(",", ":"), sort_keys=False)
            written.append(path)
        return written

    def write_ground_truth(self, outdir):
        gt = os.path.join(outdir, "ground_truth")
        os.makedirs(gt, exist_ok=True)
        written = []

        path = os.path.join(gt, "anomalies.csv")
        cols = D.COLUMNS["anomaly_register"]
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(cols)
            for row in sorted(self.anomalies, key=lambda r: r["anomaly_id"]):
                w.writerow([csv_value(row.get(c)) for c in cols])
        written.append(path)

        path = os.path.join(gt, "decisions.csv")
        cols = list(self.decision_truth[0].keys()) if self.decision_truth else ["defect_id"]
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(cols)
            for row in sorted(self.decision_truth, key=lambda r: r["defect_id"]):
                w.writerow([csv_value(row.get(c)) for c in cols])
        written.append(path)

        path = os.path.join(gt, "process_drift.csv")
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["machine_id", "window_start", "window_end", "expected_label",
                        "scrap_multiplier"])
            for win in self.drift_windows:
                w.writerow([win["machine_id"], D.iso(win["window_start"]), D.iso(win["window_end"]),
                            "DRIFT", csv_value(win["multiplier"])])
        written.append(path)

        path = os.path.join(gt, "capa_gate.csv")
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["capa_id", "defect_id", "status", "verification_inspection_id",
                        "verified_at", "closed_at", "expected_closure_allowed", "expected_reason"])
            for capa in sorted(self.tables["capa"], key=lambda r: r["capa_id"]):
                allowed, reason = D.capa_gate(
                    capa["status"], capa["opened_at"], capa["verified_at"], capa["closed_at"],
                    self.inspection_by_id[capa["verification_inspection_id"]]["result"]
                    if capa["verification_inspection_id"] else None,
                    self.inspection_by_id[capa["verification_inspection_id"]]["inspected_at"]
                    if capa["verification_inspection_id"] else None,
                    capa["containment_completed_at"])
                w.writerow([capa["capa_id"], capa["defect_id"], capa["status"],
                            capa["verification_inspection_id"] or "", capa["verified_at"] or "",
                            capa["closed_at"] or "", int(allowed), reason or ""])
        written.append(path)

        path = os.path.join(gt, "supplier_rates.csv")
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(["supplier_id", "risk_tier", "qualification_state",
                        "latent_incoming_defect_rate"])
            for sup in sorted(self.suppliers, key=lambda s: s["supplier_id"]):
                w.writerow([sup["supplier_id"], sup["risk_tier"], sup["qualification_state"],
                            csv_value(self.supplier_latent[sup["supplier_id"]])])
        written.append(path)

        bundle = {
            "dataset_version": D.DATASET_VERSION,
            "seed": self.seed,
            "profile": self.profile,
            "label_definitions": {
                "DEFECT_LOT_NOT_FOUND": "defect.lot_id has no matching material_lot row (quarantine feed)",
                "BOM_MATERIAL_NOT_CONSUMED": "completed order has a BOM line with no order_consumption row",
                "CAPA_CLOSED_BEFORE_VERIFICATION": "capa.status=closed but closure gate fails",
                "DEFECT_COUNT_EXCEEDS_INSPECTED_QTY": "inspection_result.defect_count > inspected_qty (quarantine feed)",
                "TRACE_CHAIN_BREAK": "defect/step/order chain cannot be joined end to end",
                "EXPIRED_LOT_CONSUMED": "order_consumption.consumed_at >= material_lot.expiry_date",
                "DUPLICATE_CONSUMPTION": "same order+lot+bom+step issued twice (quarantine feed)",
            },
            "counts": {k: len(v) for k, v in self.quarantine.items()},
            "anomaly_count": len(self.anomalies),
            "anomaly_counts_by_type": {
                t: sum(1 for a in self.anomalies if a["issue_type"] == t)
                for t in sorted({a["issue_type"] for a in self.anomalies})
            },
            "drift_windows": [
                {"machine_id": w["machine_id"], "window_start": D.iso(w["window_start"]),
                 "window_end": D.iso(w["window_end"])} for w in self.drift_windows
            ],
        }
        path = os.path.join(gt, "ground_truth.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(bundle, fh, indent=2)
        written.append(path)
        return written

    def load_sqlite(self, outdir):
        dbdir = os.path.join(outdir, "sqlite")
        os.makedirs(dbdir, exist_ok=True)
        db_path = os.path.join(dbdir, "traceability.db")
        if os.path.exists(db_path):
            os.remove(db_path)
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        with open(os.path.join(HERE, "schema.sql"), encoding="utf-8") as fh:
            conn.executescript(fh.read())
        for table in D.TABLE_ORDER:
            cols = D.COLUMNS[table]
            placeholders = ",".join("?" for _ in cols)
            sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
            rows = sorted(self.tables[table], key=lambda r: r[cols[0]])
            conn.executemany(sql, [tuple(r.get(c) for c in cols) for r in rows])
        conn.commit()
        conn.close()
        return db_path

    def write_seed_sql(self, outdir):
        path = os.path.join(outdir, "sqlite", "seed.sql")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("-- Generated seed data. Regenerate with src/generate.py\n")
            fh.write("PRAGMA foreign_keys = ON;\n")
            for table in D.TABLE_ORDER:
                cols = D.COLUMNS[table]
                for row in sorted(self.tables[table], key=lambda r: r[cols[0]]):
                    vals = []
                    for c in cols:
                        v = row.get(c)
                        if v is None:
                            vals.append("NULL")
                        elif isinstance(v, (int, float)):
                            vals.append(str(v))
                        else:
                            vals.append("'" + str(v).replace("'", "''") + "'")
                    fh.write(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join(vals)});\n")
        return path

    # ------------------------------------------------------------------ run
    def run(self, outdir, with_seed_sql=False):
        self.build_products()
        self.build_suppliers()
        self.build_supplier_materials()
        self.build_boms()
        self.build_machines()
        self.build_inspection_plans()
        self.build_orders()
        self.build_lots()
        self.build_incoming_inspections()
        self.build_steps_and_consumption()
        self.build_order_inspections()
        self.compute_repeat_suppliers()
        self.build_defect_status()
        self.build_capas()
        self.recompute_derived()
        self.build_events()
        self.inject_anomalies()

        os.makedirs(outdir, exist_ok=True)
        shutil.copy(os.path.join(HERE, "schema.sql"), os.path.join(outdir, "schema.sql"))
        files = []
        files += self.write_csv(outdir)
        files += self.write_json(outdir)
        gt_files = self.write_ground_truth(outdir)
        db_path = self.load_sqlite(outdir)
        if with_seed_sql:
            files.append(self.write_seed_sql(outdir))
        files.append(db_path)
        files += gt_files
        files.append(os.path.join(outdir, "schema.sql"))

        checksums = {}
        for f in sorted(files):
            rel = os.path.relpath(f, outdir)
            checksums[rel] = sha256_file(f)

        shortage_summary = defaultdict(lambda: {"lines": 0, "short": 0.0, "avail_total": 0.0,
                                                 "avail_future": 0.0, "first_day": "9999",
                                                 "last_day": ""})
        for s in self.shortage_detail:
            agg = shortage_summary[s["material"]]
            agg["lines"] += 1
            agg["short"] += s["short"]
            agg["avail_total"] += s["avail_total"]
            agg["avail_future"] += s["avail_future"]
            agg["first_day"] = min(agg["first_day"], s["day"])
            agg["last_day"] = max(agg["last_day"], s["day"])
        shortage_top = sorted(shortage_summary.items(), key=lambda kv: -kv[1]["lines"])[:10]
        if self.shortages:
            with open(os.path.join(outdir, "debug_shortages.json"), "w", encoding="utf-8") as fh:
                json.dump({"shortages": self.shortage_detail[:5]}, fh, indent=1)

        manifest = {
            "dataset_version": D.DATASET_VERSION,
            "profile": self.profile,
            "seed": self.seed,
            "generator": "src/generate.py",
            "generator_command": f"python src/generate.py --profile {self.profile} --seed {self.seed} --out {outdir}",
            "generated_at": D.iso(datetime.now()),
            "reference_date": D.iso(self.today),
            "sources": [{
                "kind": "synthetic",
                "description": "All rows are generated by src/generate.py from the fixed seed. "
                               "No external dataset was downloaded, scraped or redistributed.",
                "license": "CC0-1.0 (generated data, project-owned)",
                "attribution": "Generated for this project; identifier conventions inspired by "
                               "common GS1/ISA-95 shop-floor naming (no data copied).",
            }],
            "row_counts": {t: len(self.tables[t]) for t in D.TABLE_ORDER},
            "quarantine_row_counts": {k: len(v) for k, v in self.quarantine.items()},
            "checksums_sha256": checksums,
            "notes": {
                "late_allocation_fallbacks": self.shortages,
                "shortage_top": [{"material": k, **v} for k, v in shortage_top],
                "drift_windows": len(self.drift_windows),
                "capa_count": len(self.tables["capa"]),
                "anomaly_count": len(self.anomalies),
            },
        }
        with open(os.path.join(outdir, "source_manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)
        with open(os.path.join(outdir, "checksums.json"), "w", encoding="utf-8") as fh:
            json.dump(checksums, fh, indent=2)
        return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate the defect-traceability dataset")
    ap.add_argument("--profile", choices=sorted(D.PROFILES), default="full")
    ap.add_argument("--seed", type=int, default=D.SEED)
    ap.add_argument("--out", default="out")
    ap.add_argument("--with-seed-sql", action="store_true")
    args = ap.parse_args(argv)

    gen = Generator(profile=args.profile, seed=args.seed)
    manifest = gen.run(args.out, with_seed_sql=args.with_seed_sql)
    print(json.dumps({
        "profile": args.profile,
        "seed": manifest["seed"],
        "row_counts": manifest["row_counts"],
        "quarantine": manifest["quarantine_row_counts"],
        "anomalies": manifest["notes"]["anomaly_count"],
        "capa": manifest["notes"]["capa_count"],
        "allocation_fallbacks": manifest["notes"]["late_allocation_fallbacks"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
