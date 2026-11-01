"""End-to-end tests: generator determinism, validation, decisions and trace."""
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

import domain as D  # noqa: E402
from analytics import Dataset  # noqa: E402
from generate import Generator  # noqa: E402
from trace import decide, get_defect, trace_defect  # noqa: E402
from validate import Validation, read_csv  # noqa: E402


class StarterPipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="trace-test-")
        cls.out = os.path.join(cls.tmp, "a")
        cls.manifest = Generator(profile="starter", seed=D.SEED).run(cls.out)
        cls.ds = Dataset(os.path.join(cls.out, "sqlite", "traceability.db"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_requested_volumes(self):
        counts = self.manifest["row_counts"]
        self.assertEqual(counts["product"], 20)
        self.assertEqual(counts["supplier"], 8)
        self.assertEqual(counts["material_lot"], 60)
        self.assertEqual(counts["production_order"], 120)
        self.assertEqual(counts["inspection_result"], 400)

    def test_validation_suite_is_clean(self):
        validation = Validation(self.out)
        validation.run()
        failures = [c for c in validation.checks if c["status"] != "PASS"]
        self.assertEqual(failures, [], msg=json.dumps(failures, indent=1)[:3000])

    def test_required_edge_cases_are_labelled(self):
        with open(os.path.join(self.out, "ground_truth", "ground_truth.json"),
                  encoding="utf-8") as fh:
            bundle = json.load(fh)
        counts = bundle["anomaly_counts_by_type"]
        for issue in ("DEFECT_LOT_NOT_FOUND", "BOM_MATERIAL_NOT_CONSUMED",
                      "CAPA_CLOSED_BEFORE_VERIFICATION",
                      "DEFECT_COUNT_EXCEEDS_INSPECTED_QTY", "TRACE_CHAIN_BREAK"):
            self.assertGreaterEqual(counts.get(issue, 0), 1, issue)
        self.assertEqual(bundle["seed"], D.SEED)

    def test_same_seed_reproduces_every_file(self):
        other = os.path.join(self.tmp, "b")
        second = Generator(profile="starter", seed=D.SEED).run(other)
        self.assertEqual(second["row_counts"], self.manifest["row_counts"])
        differing = [name for name, digest in self.manifest["checksums_sha256"].items()
                     if second["checksums_sha256"].get(name) != digest]
        self.assertEqual(differing, [])

    def test_engine_reproduces_rule_decisions(self):
        rows = read_csv(os.path.join(self.out, "ground_truth", "decisions.csv"))
        self.assertTrue(rows)
        for expected in rows:
            defect = get_defect(self.ds, expected["defect_id"])
            self.assertIsNotNone(defect)
            result = decide(self.ds, defect)
            self.assertEqual(result["disposition"], expected["expected_disposition"],
                             expected["defect_id"])

    def test_trace_chain_reaches_supplier(self):
        row = self.ds.q1("""
            SELECT defect_id FROM defect
            WHERE lot_id IS NOT NULL AND order_id IS NOT NULL
            ORDER BY defect_id LIMIT 1
        """)
        self.assertIsNotNone(row)
        result = trace_defect(self.ds, row["defect_id"])
        stages = [step["stage"] for step in result["chain"]]
        for stage in ("inspection", "production_order", "material_lot", "supplier"):
            self.assertIn(stage, stages)
        self.assertTrue(result["decision"]["rationale"])
        self.assertIsInstance(result["containment"]["qty_at_risk"], (int, float))

    def test_capa_closure_gate(self):
        allowed, reason = D.capa_gate("closed", "2026-01-01", None, "2026-02-01",
                                      None, None, None)
        self.assertFalse(allowed)
        self.assertEqual(reason, "NO_VERIFICATION")
        allowed, reason = D.capa_gate("closed", "2026-01-01", "2026-02-10", "2026-02-05",
                                      "pass", "2026-02-10", "2026-01-03")
        self.assertFalse(allowed)
        self.assertEqual(reason, "CLOSED_BEFORE_VERIFICATION")
        allowed, _ = D.capa_gate("closed", "2026-01-01", "2026-02-10", "2026-02-15",
                                 "pass", "2026-02-10", "2026-01-03")
        self.assertTrue(allowed)

    def test_ground_truth_columns_are_not_input_features(self):
        banned = ("expected", "ground_truth", "label")
        for table in D.TABLE_ORDER:
            if table == "anomaly_register":
                continue
            path = os.path.join(self.out, "csv", f"{table}.csv")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as fh:
                header = fh.readline().lower()
            for token in banned:
                self.assertNotIn(token, header, f"{table}: {token}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
