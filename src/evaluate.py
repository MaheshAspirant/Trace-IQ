#!/usr/bin/env python3
"""Evaluation of the traceability engine against the documented ground truth.

Produces ``evaluation_report.json`` and ``evaluation_report.md`` with:
  * decision agreement (disposition + CAPA trigger) vs rule-derived labels
  * CAPA closure-gate agreement
  * process-drift detection precision/recall at machine-week level
  * anomaly-rule recall from validation_summary.json
  * observed vs latent supplier defect rates (measurement error)
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import defaultdict
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import domain as D  # noqa: E402
from analytics import Dataset  # noqa: E402
from trace import decide, get_defect  # noqa: E402


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def week_key(day):
    return day.strftime("%Y-%W")


def drift_truth_weeks(rows):
    weeks = set()
    for row in rows:
        start = D.as_date(row["window_start"])
        end = D.as_date(row["window_end"])
        cursor = start - timedelta(days=start.weekday())
        while cursor <= end:
            weeks.add((row["machine_id"], week_key(cursor)))
            cursor += timedelta(days=7)
    return weeks


def pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs) ** 0.5
    vy = sum((y - my) ** 2 for y in ys) ** 0.5
    return cov / (vx * vy) if vx and vy else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Evaluate engine decisions and detectors")
    ap.add_argument("--out", default="out")
    args = ap.parse_args(argv)
    outdir = args.out
    ds = Dataset(os.path.join(outdir, "sqlite", "traceability.db"))

    # ------------------------------------------------------------- decisions
    decisions = read_csv(os.path.join(outdir, "ground_truth", "decisions.csv"))
    total = agree = capa_agree = 0
    by_rule = defaultdict(lambda: {"total": 0, "agree": 0})
    by_capa_rule = defaultdict(lambda: {"total": 0, "agree": 0})
    mismatches = []
    for expected in decisions:
        defect = get_defect(ds, expected["defect_id"])
        if not defect:
            continue
        result = decide(ds, defect)
        total += 1
        ok = result["disposition"] == expected["expected_disposition"]
        agree += ok
        capa_agree += int(result["capa_required"]) == int(expected["expected_capa_required"])
        stat = by_rule[expected["disposition_rule"]]
        stat["total"] += 1
        stat["agree"] += ok
        capa_rule = expected.get("capa_rule") or "NONE"
        cstat = by_capa_rule[capa_rule]
        cstat["total"] += 1
        cstat["agree"] += int(result["capa_required"]) == int(expected["expected_capa_required"])
        if not ok and len(mismatches) < 12:
            mismatches.append({
                "defect_id": expected["defect_id"],
                "expected": expected["expected_disposition"],
                "engine": result["disposition"],
                "expected_rule": expected["disposition_rule"],
                "engine_rule": result["disposition_rule"],
                "inputs": result["inputs"],
            })

    # ------------------------------------------------------------ CAPA gate
    gate_rows = read_csv(os.path.join(outdir, "ground_truth", "capa_gate.csv"))
    gate_agree = 0
    gate_checked = 0
    gate_mismatch = []
    for row in gate_rows:
        capa = ds.q1("SELECT * FROM capa WHERE capa_id = ?", (row["capa_id"],))
        if not capa:
            continue
        insp = ds.q1("SELECT * FROM inspection_result WHERE inspection_id = ?",
                     (capa["verification_inspection_id"],)) if capa["verification_inspection_id"] else {}
        allowed, reason = D.capa_gate(capa["status"], capa["opened_at"], capa["verified_at"],
                                     capa["closed_at"], insp.get("result"),
                                     insp.get("inspected_at"), capa["containment_completed_at"])
        expected = int(row["expected_closure_allowed"])
        gate_checked += 1
        gate_agree += int(allowed) == expected
        if int(allowed) != expected and len(gate_mismatch) < 10:
            gate_mismatch.append({"capa_id": row["capa_id"], "expected": expected,
                                  "engine": int(allowed), "reason": reason})

    # ---------------------------------------------------------------- drift
    weeks, _ = ds.machine_weeks()
    detected = {(w["machine_id"], w["iso_week"]) for w in weeks if w["drift_suspected"]}
    evaluable = {(w["machine_id"], w["iso_week"]) for w in weeks if w["input_qty"] >= 200}
    truth_rows = read_csv(os.path.join(outdir, "ground_truth", "process_drift.csv"))
    truth_all = drift_truth_weeks(truth_rows)
    truth = truth_all & evaluable
    tp = len(detected & truth)
    fp = len(detected - truth)
    fn = len(truth - detected)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    # ------------------------------------------------------------- anomalies
    validation_path = os.path.join(outdir, "validation_summary.json")
    validation = json.load(open(validation_path, encoding="utf-8")) \
        if os.path.exists(validation_path) else {}
    coverage = validation.get("anomaly_coverage", {})

    # ------------------------------------------------- supplier measurement
    scorecard = {row["supplier_id"]: row for row in ds.supplier_scorecard()}
    latent = {row["supplier_id"]: float(row["latent_incoming_defect_rate"])
              for row in read_csv(os.path.join(outdir, "ground_truth", "supplier_rates.csv"))}
    pairs = [(obs["incoming_defect_rate"], latent[sid])
             for sid, obs in scorecard.items()
             if sid in latent and obs["incoming_inspected_qty"]]
    mae = sum(abs(o - l) for o, l in pairs) / len(pairs) if pairs else 0.0
    correlation = pearson([o for o, _ in pairs], [l for _, l in pairs]) if pairs else 0.0

    report = {
        "dataset": {"profile": validation.get("dataset", {}).get("profile"),
                    "seed": validation.get("dataset", {}).get("seed")},
        "decisions": {
            "evaluated": total,
            "disposition_agreement": round(agree / total, 6) if total else 0.0,
            "capa_agreement": round(capa_agree / total, 6) if total else 0.0,
            "by_rule": dict(by_rule),
            "by_capa_rule": dict(by_capa_rule),
            "mismatches": mismatches,
        },
        "capa_gate": {
            "evaluated": gate_checked,
            "agreement": round(gate_agree / gate_checked, 6) if gate_checked else 0.0,
            "mismatches": gate_mismatch,
        },
        "drift_detection": {
            "machine_weeks_flagged": len(detected),
            "labelled_machine_weeks": len(truth),
            "labelled_machine_weeks_total": len(truth_all),
            "evaluable_coverage": round(len(truth) / len(truth_all), 4) if truth_all else 0.0,
            "true_positive": tp,
            "false_positive": fp,
            "false_negative": fn,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        },
        "anomaly_detection": coverage,
        "supplier_rate_measurement": {
            "suppliers": len(pairs),
            "mean_absolute_error": round(mae, 6),
            "pearson_r": round(correlation, 4),
        },
        "validation": validation.get("summary", {}),
    }

    with open(os.path.join(outdir, "evaluation_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    lines = ["# Evaluation report", ""]
    lines.append(f"Profile `{report['dataset']['profile']}` · seed `{report['dataset']['seed']}`")
    lines.append("")
    lines.append("## Decision agreement (engine re-derived from persisted rows)")
    lines.append("")
    lines.append(f"- Disposition agreement: **{report['decisions']['disposition_agreement']:.2%}** "
                 f"over {total} labelled defects")
    lines.append(f"- CAPA trigger agreement: **{report['decisions']['capa_agreement']:.2%}**")
    lines.append(f"- CAPA closure-gate agreement: **{report['capa_gate']['agreement']:.2%}** "
                 f"over {gate_checked} CAPAs")
    lines.append("")
    lines.append("| disposition rule | evaluated | agreement |")
    lines.append("|---|---:|---:|")
    for rule, stat in sorted(by_rule.items()):
        lines.append(f"| {rule} | {stat['total']} | {stat['agree'] / stat['total']:.2%} |")
    lines.append("")
    lines.append("## Process-drift detection (machine-week granularity)")
    lines.append("")
    lines.append(f"- Precision **{precision:.2f}**, recall **{recall:.2f}**, F1 **{f1:.2f}**")
    lines.append(f"- flagged {len(detected)} machine-weeks, labelled {len(truth)}; "
                 f"TP {tp}, FP {fp}, FN {fn}")
    lines.append("")
    lines.append("## Anomaly detection")
    lines.append("")
    lines.append("| issue_type | labelled | detected | matched |")
    lines.append("|---|---:|---:|---:|")
    for issue_type, stat in sorted(coverage.items()):
        lines.append(f"| {issue_type} | {stat['labelled']} | {stat['detected']} | {stat['matched']} |")
    lines.append("")
    lines.append("## Supplier defect-rate measurement")
    lines.append("")
    lines.append(f"- Observed vs latent incoming defect rate over {len(pairs)} suppliers: "
                 f"MAE **{mae:.4f}**, Pearson r **{correlation:.2f}**")
    with open(os.path.join(outdir, "evaluation_report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(json.dumps({k: report[k] for k in ("decisions", "capa_gate", "drift_detection",
                                             "supplier_rate_measurement")}, indent=2)[:3000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
