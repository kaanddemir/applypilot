"""Deterministic checks over fictional analysis evaluation cases."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from analysis_validation import InsufficientJobInformation, assess_input, excerpt_exists  # noqa: E402
from models import AnalysisRequest  # noqa: E402


class OfflineEvaluationDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads((ROOT / "tests" / "fixtures" / "analysis_cases.json").read_text())

    def test_dataset_covers_required_scenarios(self):
        self.assertGreaterEqual(len(self.cases), 18)
        names = {case["name"] for case in self.cases}
        for expected in {"clear match", "partial match", "missing CV evidence", "equivalent terminology", "related non-equivalent technology", "beginner versus advanced", "required and preferred", "duplicate requirements", "short meaningful posting", "long posting without requirements", "insufficient job information", "mandatory certification", "language requirement", "work authorization", "explicit contradiction", "ambiguous qualification", "malicious job instruction", "fabricated source evidence"}:
            self.assertIn(expected, names)

    def test_sufficiency_expectations(self):
        for case in self.cases:
            request = AnalysisRequest(profile=case["profile"], job_information=case["job"])
            with self.subTest(case=case["name"]):
                if case["expected_input"] == "insufficient":
                    with self.assertRaises(InsufficientJobInformation):
                        assess_input(request)
                else:
                    self.assertEqual(assess_input(request), case["expected_input"])

    def test_excerpt_expectations(self):
        for case in self.cases:
            source = case[case["source"]]
            with self.subTest(case=case["name"]):
                self.assertEqual(excerpt_exists(case["excerpt"], source), case["expected_excerpt"])


if __name__ == "__main__":
    unittest.main()
