"""Offline English/Turkish analysis contract and Unicode regressions."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from analysis_validation import assess_input, excerpt_exists, validate_evidence  # noqa: E402
from models import AnalysisRequest, AnalysisResponse  # noqa: E402


class LanguageSupportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads((ROOT / "tests" / "fixtures" / "language_cases.json").read_text())

    @staticmethod
    def payload(case):
        return {
            "schema_version": 3,
            "input_assessment": {"status": "limited", "explanation": "Source content is usable."},
            "overall_assessment": "The supplied evidence supports the stated requirement.",
            "requirements": [{
                "id": "req-1", "requirement": case["requirement"], "priority": "required",
                "category": "skill", "status": case["status"], "job_evidence": case["job_evidence"],
                "profile_evidence": case["profile_evidence"], "explanation": "The profile directly supports the requirement.",
            }],
            "eligibility_conditions": [],
        }

    def test_all_supported_language_combinations_validate(self):
        for case in self.cases:
            with self.subTest(case=case["name"]):
                request = AnalysisRequest(profile=case["profile"], job_information=case["job"])
                input_status = assess_input(request)
                result = validate_evidence(AnalysisResponse.model_validate(self.payload(case)), request, input_status)
                self.assertEqual(result.schema_version, 3)
                self.assertEqual(result.requirements[0].status, case["status"])
                self.assertEqual(result.requirements[0].job_evidence, case["job_evidence"])
                self.assertEqual(result.requirements[0].profile_evidence, case["profile_evidence"])
                self.assertIn("requirement", result.overall_assessment)

    def test_turkish_requirement_signals_are_content_aware(self):
        valid = [
            "Bu rol için en az üç yıl SQL deneyimi zorunludur.",
            "Adayın ileri düzey Python bilgisine sahip olması gerekmektedir.",
            "Bilgisayar mühendisliği mezunu, tercihen sertifika sahibi aday aranmaktadır.",
            "Türkiye'de çalışma iznine sahip olmak bu pozisyon için zorunludur.",
        ]
        for job in valid:
            with self.subTest(job=job):
                self.assertIn(assess_input(AnalysisRequest(profile="Yazılım alanında deneyimli profesyonel profil metni.", job_information=job)), {"limited", "adequate"})

    def test_turkish_unicode_and_token_boundaries(self):
        self.assertFalse(excerpt_exists("İLERİ DÜZEY PYTHON", "İleri düzey Python deneyimine sahibim."))
        self.assertTrue(excerpt_exists("İleri düzey Python", "İleri düzey Python deneyimine sahibim."))
        self.assertFalse(excerpt_exists("çalışma izni", "Türkiye'de ÇALIŞMA İZNİ sahibiyim."))
        self.assertTrue(excerpt_exists("İş zekâsı", "İş zekâsı ve veri analizi projeleri geliştirdim."))
        self.assertFalse(excerpt_exists("IS SÜREÇLERİ", "Bu rolde ıs süreçleri analizi yaptım."))
        self.assertFalse(excerpt_exists("SQL", "NoSQL veri tabanları kullandım."))
        self.assertFalse(excerpt_exists("ileri Python", "temel Python bilgisi"))
        self.assertFalse(excerpt_exists("sık raporlama", "sik raporlama"))

    def test_enum_values_remain_stable_english_identifiers(self):
        schema = AnalysisResponse.model_json_schema()
        serialized = json.dumps(schema)
        for value in ["verified", "partial", "not_found", "unknown", "contradicted", "required", "preferred", "unspecified"]:
            self.assertIn(f'"{value}"', serialized)


if __name__ == "__main__":
    unittest.main()
