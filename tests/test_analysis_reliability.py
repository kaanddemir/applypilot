"""Offline adversarial regressions. All provider requests use MockTransport."""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import sys
import unittest
from dataclasses import replace
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import app as api
import gemini
from analysis_validation import assess_input, excerpt_exists, validate_evidence
from config import load_settings
from models import AnalysisRequest, AnalysisResponse, ProviderAnalysis
from protection import CapacityGuard, SlidingWindowLimiter
from qualification_checks import source_priority
from test_analysis_api import ANALYSIS, REQUEST, provider_json


def provider_response(data=ANALYSIS, finish="STOP"):
    return httpx.Response(200, json={"candidates": [{"finishReason": finish, "content": {"parts": [{"text": provider_json(data)}]}}]})


class EvidenceReliabilityTests(unittest.TestCase):
    def validate(self, job, profile, requirement, evidence=None, category="skill", status="verified", job_evidence=None):
        payload = copy.deepcopy(ANALYSIS)
        payload["requirements"][0].update(requirement=requirement, category=category, status=status,
                                         job_evidence=job_evidence or job, profile_evidence=evidence or profile)
        request = AnalysisRequest(profile=profile, job_information=job)
        return validate_evidence(AnalysisResponse.model_validate(payload), request, assess_input(request))

    def test_exact_short_technical_unicode_and_punctuation_quotes(self):
        for quote, source in [("C", "C is required"), ("R", "R is required"), (".NET", ".NET is required"),
                              ("C++", "Use C++ daily"), ("İleri düzey", "İleri düzey Python"),
                              ("çalışma izni", "Türkiye'de çalışma izni"), ("zekâsı", "İş zeka\u0302sı"),
                              ("SQL experience", "SQL\n  experience")]:
            with self.subTest(quote=quote):
                self.assertTrue(excerpt_exists(quote, source))
        for quote, source in [("SQL", "NoSQL"), ("C", "C++"), ("C", "C#"), ("NET", ".NET"),
                              ("3 5 years", "3.5 years"), ("IS", "ıs"), ("ileri Python", "ileri, Python"),
                              ("SQL is required", "SQL and Python are required"), ("", "text")]:
            with self.subTest(quote=quote):
                self.assertFalse(excerpt_exists(quote, source))

    def test_adversarial_semantic_fixtures(self):
        cases = json.loads((Path(__file__).parent / "fixtures" / "semantic_cases.json").read_text())
        for case in cases:
            with self.subTest(name=case["name"]):
                result = self.validate(case["job"], case["profile"], case["requirement"],
                                       evidence=case.get("evidence"), category=case.get("category", "skill"),
                                       status=case.get("status", "verified"))
                self.assertEqual(result.requirements[0].status, case["expected"])
                if case["expected"] == "unknown":
                    self.assertIsNone(result.requirements[0].profile_evidence)
                    self.assertIn("unknown", result.requirements[0].explanation)

    def test_distinct_nested_requirements_survive(self):
        payload = copy.deepcopy(ANALYSIS)
        first = payload["requirements"][0]
        first.update(requirement="JavaScript experience", job_evidence="JavaScript experience is required")
        payload["requirements"].append({**first, "id": "req-2", "requirement": "JavaScript experience with production systems", "job_evidence": "JavaScript experience with production systems is preferred"})
        request = AnalysisRequest(profile=REQUEST["profile"], job_information="JavaScript experience is required. JavaScript experience with production systems is preferred.")
        result = validate_evidence(AnalysisResponse.model_validate(payload), request, assess_input(request))
        self.assertEqual(len(result.requirements), 2)
        self.assertEqual([item.priority for item in result.requirements], ["required", "preferred"])

    def test_priority_from_clause_and_headings(self):
        for excerpt, job, expected in [
            ("SQL", "SQL is preferred but not mandatory for this role.", "preferred"),
            ("Python", "Python is required for production services.", "required"),
            ("Python", "Required qualifications:\n- Python\nPreferred qualifications:\n- SQL", "required"),
            ("SQL", "Required qualifications:\n- Python\nPreferred qualifications:\n- SQL", "preferred"),
            ("Python", "Python ile deneyim tercih sebebi olarak belirtilmiştir.", "preferred"),
            ("Python", "Python bilgisi zorunludur ve her gün kullanılır.", "required"),
            ("Python", "Python powers our internal services.", "unspecified"),
            ("Python", "Required skills: SQL, Python", "required"),
            ("SQL", "SQL required, Python preferred", "required"),
            ("Python", "SQL required, Python preferred", "preferred"),
        ]:
            with self.subTest(job=job, excerpt=excerpt):
                self.assertEqual(source_priority(excerpt, job), expected)

    def test_missing_named_requirement_is_explicitly_limited(self):
        result = validate_evidence(AnalysisResponse.model_validate(ANALYSIS), AnalysisRequest(**REQUEST), "adequate")
        self.assertEqual(result.input_assessment.status, "limited")
        self.assertIn("coverage", result.input_assessment.explanation.lower())
        self.assertIn("incomplete", result.overall_assessment)

    def test_invented_job_meaning_and_wrong_language_are_rejected(self):
        for update in [{"requirement": "SQL expertise"}, {"explanation": "Bu beceri profilde doğrulanmıştır."}]:
            payload = copy.deepcopy(ANALYSIS)
            payload["requirements"][0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                validate_evidence(AnalysisResponse.model_validate(payload), AnalysisRequest(**REQUEST), "adequate")

    def test_sufficiency_accepts_skills_and_rejects_meaningless_text(self):
        self.assertEqual(assess_input(AnalysisRequest(profile=REQUEST["profile"], job_information="Strong Python and SQL skills for building scalable services.")), "limited")
        for job in ["Engineer at Acme", "Welcome to our friendly team and office"]:
            with self.subTest(job=job), self.assertRaises(ValueError):
                assess_input(AnalysisRequest(profile=REQUEST["profile"], job_information=job))

    def test_shared_sufficiency_fixtures(self):
        cases = json.loads((Path(__file__).parent / "fixtures" / "sufficiency_cases.json").read_text())
        for case in cases:
            with self.subTest(text=case["text"]):
                try:
                    assess_input(AnalysisRequest(profile=REQUEST["profile"], job_information=case["text"]))
                    sufficient = True
                except ValueError:
                    sufficient = False
                self.assertEqual(sufficient, case["sufficient"])

    def test_eligibility_is_derived_once_from_required_conditions(self):
        payload = copy.deepcopy(ANALYSIS)
        payload["requirements"][0].update(requirement="English fluency", job_evidence="Fluent English is required", category="language", profile_evidence="fluent English")
        payload["eligibility_conditions"] = [{"requirement_id": "req-1", "condition": "bad", "status": "unknown", "warning": "bad"}] * 2
        result = validate_evidence(AnalysisResponse.model_validate(payload), AnalysisRequest(**REQUEST), "adequate")
        self.assertEqual(len(result.eligibility_conditions), 1)
        self.assertEqual(result.eligibility_conditions[0].status, result.requirements[0].status)


class TransportReliabilityTests(unittest.IsolatedAsyncioTestCase):
    def settings(self, **kwargs):
        return replace(api.settings, gemini_api_key="SYNTHETIC_API_KEY", **kwargs)

    async def run_provider(self, handler, **settings):
        return await gemini.analyze_with_gemini(AnalysisRequest(**REQUEST), current_settings=self.settings(**settings), transport=httpx.MockTransport(handler))

    async def test_exhaustion_incomplete_json_and_schema_errors_never_retry(self):
        for body, code in [
            ({"candidates": [{"finishReason": "MAX_TOKENS"}]}, "output_exhausted"),
            ({"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": '{"requirements":['}]}}]}, "output_exhausted"),
            ({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": '{"requirements":['}]}}]}, "invalid_provider_response"),
            ({"candidates": [{"content": {"parts": [{"text": '{}'}]}}]}, "invalid_provider_response"),
            ({"candidates": [{"content": {"parts": [{"text": json.dumps({"schema_version": 3, "extraction_complete": False, "requirements": ANALYSIS["requirements"]})}]}}]}, "incomplete_analysis"),
        ]:
            calls = []
            async def handler(request):
                calls.append(request)
                return httpx.Response(200, json=body)
            with self.subTest(code=code), self.assertRaisesRegex(gemini.GeminiFailure, code):
                await self.run_provider(handler)
            self.assertEqual(len(calls), 1)

    async def test_repair_cannot_silently_drop_a_requirement(self):
        invalid = copy.deepcopy(ANALYSIS)
        invalid["requirements"].append({**invalid["requirements"][0], "id": "req-2", "requirement": "Additional JavaScript scope", "job_evidence": "not present in source"})
        calls = []
        async def handler(request):
            calls.append(request)
            return provider_response(invalid if len(calls) == 1 else ANALYSIS)
        with self.assertRaisesRegex(gemini.GeminiFailure, "incomplete_analysis"):
            await self.run_provider(handler)
        self.assertEqual(len(calls), 2)

    async def test_provider_errors_do_not_retry_and_key_is_not_in_url(self):
        for status, code in [(400, "provider_configuration"), (404, "provider_configuration"), (403, "provider_authentication"), (429, "provider_quota"), (500, "provider_unavailable"), (503, "provider_unavailable")]:
            calls = []
            async def handler(request):
                calls.append(request)
                self.assertNotIn("SYNTHETIC_API_KEY", str(request.url))
                self.assertEqual(request.headers["x-goog-api-key"], "SYNTHETIC_API_KEY")
                return httpx.Response(status, json={"error": "PRIVATE_PROVIDER_BODY"})
            with self.subTest(status=status), self.assertRaisesRegex(gemini.GeminiFailure, code):
                await self.run_provider(handler)
            self.assertEqual(len(calls), 1)

    async def test_bounded_configuration_lean_schema_and_safe_usage_logs(self):
        captured = []
        async def handler(request):
            captured.append(json.loads(request.content))
            response = provider_response()
            data = json.loads(response.content)
            data["usageMetadata"] = {"promptTokenCount": 123, "thoughtsTokenCount": 456, "private": "PRIVATE_USAGE", "candidatesTokenCount": "PRIVATE_USAGE"}
            return httpx.Response(200, json=data)
        with self.assertLogs("gemini", logging.INFO) as logs:
            await self.run_provider(handler)
        self.assertIn("123", " ".join(logs.output))
        self.assertNotIn("PRIVATE_USAGE", " ".join(logs.output))
        config = captured[0]["generationConfig"]
        self.assertEqual(config["maxOutputTokens"], 16384)
        self.assertEqual(config["thinkingConfig"], {"thinkingLevel": "low", "includeThoughts": False})
        self.assertEqual(set(config["responseJsonSchema"]["properties"]), {"schema_version", "extraction_complete", "requirements"})

    async def test_sensitive_values_and_unknown_keys_are_never_logged(self):
        canary = "PRIVATE_CV_JOB_QUOTE_KEY_CANARY"
        for data in [{"schema_version": 3, canary: canary},
                     {"schema_version": 3, "extraction_complete": True, "requirements": [{**ANALYSIS["requirements"][0], "status": canary, "profile_evidence": canary}]},
                     {"candidates": "PRIVATE_PROVIDER_CANARY"}]:
            async def handler(_request):
                return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(data)}]}}]})
            with self.assertLogs("gemini", logging.WARNING) as logs, self.assertRaises(gemini.GeminiFailure):
                await self.run_provider(handler)
            self.assertNotIn(canary, " ".join(logs.output))
            self.assertNotIn("PRIVATE_PROVIDER_CANARY", " ".join(logs.output))
            self.assertNotIn("SYNTHETIC_API_KEY", " ".join(logs.output))

    async def test_thought_parts_are_not_parsed_as_json(self):
        async def handler(_request):
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"thought": True, "text": "PRIVATE_THOUGHT"}, {"text": provider_json(ANALYSIS)}]}}]})
        result = await self.run_provider(handler)
        self.assertEqual(result.schema_version, 3)

    async def test_no_repair_without_remaining_time(self):
        invalid = copy.deepcopy(ANALYSIS)
        invalid["requirements"][0]["job_evidence"] = "not present in source"
        calls = []
        async def handler(request):
            calls.append(request)
            return provider_response(invalid)
        # Transport deadline uses a monotonic clock independent of asyncio's loop.
        with patch.object(gemini, "time") as clock:
            clock.monotonic.side_effect = [0, 80]
            with self.assertRaisesRegex(gemini.GeminiFailure, "provider_timeout"):
                await self.run_provider(handler)
        self.assertEqual(len(calls), 1)

    async def test_total_deadline_cancels_slow_transport(self):
        cancelled = asyncio.Event()
        async def handler(_request):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        with self.assertRaisesRegex(gemini.GeminiFailure, "provider_timeout"):
            await self.run_provider(handler, gemini_timeout_seconds=0.02)
        self.assertTrue(cancelled.is_set())

    async def test_one_total_deadline_covers_initial_and_repair(self):
        invalid = copy.deepcopy(ANALYSIS)
        invalid["requirements"][0]["job_evidence"] = "not present in source"
        calls = []
        cancelled = asyncio.Event()
        async def handler(request):
            calls.append(request)
            if len(calls) == 1:
                await asyncio.sleep(0.02)
                return provider_response(invalid)
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        # Fake only the repair admission clock; the real asyncio deadline remains.
        with patch.object(gemini, "time") as clock:
            clock.monotonic.side_effect = [0, -20]
            with self.assertRaisesRegex(gemini.GeminiFailure, "provider_timeout"):
                await self.run_provider(handler, gemini_timeout_seconds=0.05)
        self.assertEqual(len(calls), 2)
        self.assertTrue(cancelled.is_set())

    async def test_external_cancellation_is_not_retried_or_reclassified(self):
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        async def handler(_request):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        work = asyncio.create_task(self.run_provider(handler))
        await entered.wait()
        work.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await work
        self.assertTrue(cancelled.is_set())

    async def test_large_job_cv_and_sixty_requirements(self):
        requirements = [{**ANALYSIS["requirements"][0], "id": f"req-{index + 1}", "requirement": f"JavaScript delivery scope {index}", "job_evidence": f"JavaScript delivery scope {index} is required"} for index in range(60)]
        description = "\n".join(item["job_evidence"] for item in requirements) + "\n" + "Ordinary company background. " * 850
        request = AnalysisRequest(profile=REQUEST["profile"] + " Documented project work." * 1100, job_information=description)
        calls = []
        async def handler(upstream):
            calls.append(upstream)
            return provider_response({"requirements": requirements})
        result = await gemini.analyze_with_gemini(request, current_settings=self.settings(), transport=httpx.MockTransport(handler))
        self.assertEqual(len(result.requirements), 60)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("incomplete", result.overall_assessment)


class EndpointLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_oversized_chunked_requests_return_safe_413(self):
        called = AsyncMock()
        middleware = api.AnalysisBodyLimitMiddleware(called, 1024)
        for path, size in [("/api/analyze-job", 1025), ("/api/parse-profile-file", 11 * 1024 * 1024 + 1)]:
            sent = []
            chunks = iter([{"type": "http.request", "body": b"x" * 1000, "more_body": True}, {"type": "http.request", "body": b"x" * (size - 1000), "more_body": False}])
            async def receive(): return next(chunks)
            async def send(event): sent.append(event)
            with patch.object(api, "profile_upload_limiter", SlidingWindowLimiter(100, 100)):
                await middleware({"type": "http", "path": path, "headers": [], "client": ("test", 123)}, receive, send)
            self.assertEqual(sent[0]["status"], 413)
            self.assertIsInstance(json.loads(sent[1]["body"])["error"]["message"], str)
        called.assert_not_awaited()

    async def test_unicode_body_limit_is_enforced_before_provider(self):
        provider = AsyncMock()
        # Character counts fit, but actual UTF-8 bytes exceed the transport cap.
        profile = "漢" * 29_999
        content = json.dumps({**REQUEST, "profile": profile}, ensure_ascii=False).encode()
        self.assertGreater(len(content), api.settings.analysis_max_body_bytes)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app), base_url="http://testserver") as client:
            with patch.object(api, "analyze_with_gemini", provider):
                response = await client.post("/api/analyze-job", content=content, headers={"content-type": "application/json"})
        self.assertEqual(response.status_code, 413)
        provider.assert_not_awaited()

    async def test_body_replay_preserves_disconnect(self):
        events = iter([{"type": "http.request", "body": b"{}", "more_body": False}, {"type": "http.disconnect"}])
        async def receive(): return next(events)
        async def send(_event): pass
        async def downstream(scope, receive, send):
            self.assertEqual((await receive())["body"], b"{}")
            self.assertEqual((await receive())["type"], "http.disconnect")
        await api.AnalysisBodyLimitMiddleware(downstream, 1024)({"type": "http", "path": "/api/analyze-job", "headers": []}, receive, send)

    async def test_disconnect_cancels_provider_and_releases_capacity(self):
        entered = asyncio.Event()
        cancelled = asyncio.Event()
        async def provider(*args, **kwargs):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        class Request:
            client = type("Client", (), {"host": "test"})()
            async def receive(self):
                await entered.wait()
                return {"type": "http.disconnect"}
        guard = CapacityGuard(1)
        with patch.object(api, "analyze_with_gemini", provider), patch.object(api, "analysis_capacity", guard), patch.object(api, "analysis_limiter", SlidingWindowLimiter(100, 100)):
            with self.assertRaises(api.ApiError) as error:
                await api.analyze_job(Request(), AnalysisRequest(**REQUEST))
            self.assertEqual(error.exception.code, "request_cancelled")
            self.assertTrue(cancelled.is_set())
            self.assertTrue(await guard.try_acquire())
            await guard.release()

    async def test_public_new_errors_are_nontechnical(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app), base_url="http://testserver") as client:
            for code in ["output_exhausted", "incomplete_analysis", "provider_configuration"]:
                with patch.object(api, "analysis_limiter", SlidingWindowLimiter(100, 100)), patch.object(api, "analyze_with_gemini", AsyncMock(side_effect=gemini.GeminiFailure(code))):
                    response = await client.post("/api/analyze-job", json=REQUEST)
                self.assertIn(response.status_code, {502, 503})
                self.assertEqual(response.json()["error"]["code"], code)
                self.assertNotIn("MAX_TOKENS", response.text)


class ConfigurationTests(unittest.TestCase):
    def test_deadline_thinking_model_and_token_limits_are_validated(self):
        for env in [{"GEMINI_TIMEOUT_SECONDS": "91"}, {"GEMINI_THINKING_LEVEL": "minimal"}, {"GEMINI_MODEL": "unknown"}, {"GEMINI_MAX_OUTPUT_TOKENS": "1000000"}]:
            with self.subTest(env=env), patch.dict(os.environ, env), self.assertRaises(RuntimeError):
                load_settings()


if __name__ == "__main__":
    unittest.main()
