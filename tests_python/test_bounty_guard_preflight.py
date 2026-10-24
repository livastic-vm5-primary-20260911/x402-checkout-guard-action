"""Local tests only; public GitHub and sponsor are always mocked."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "bounty_guard_preflight.py"
spec = importlib.util.spec_from_file_location("owner_bounty_guard_preflight", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

KNOWN_GOOD = "https://github.com/priors-agents/priors/issues/13"


class GuardTests(unittest.TestCase):
    def test_valid_public_issue(self):
        self.assertEqual(module.checked_public_issue_url(KNOWN_GOOD), KNOWN_GOOD)

    def test_valid_public_pr(self):
        value = "https://github.com/doomsday-network/doomsday/pull/27"
        self.assertEqual(module.checked_public_issue_url(value), value)

    def test_only_safe_exact_canonical_urls(self):
        bad = [
            "http://github.com/a/b/issues/1", "https://evil.test/a/b/issues/1",
            "https://github.com/a/b/issues/1?x=1",
            "https://github.com/a/b/issues/1#claim",
            "https://github.com/a/b/issues/0", "https://github.com/a/b/issues/-2",
            "https://github.com/a/b/issues/1/../../bad",
            "https://github.com/a/b/issues/1%2f..",
            "https://github.com@evil.test/a/b/issues/1",
            "https://github.com/a/b/issues/1;touch",
            "https://github.com/a/b/unknown/1",
            "https://github.com/a/b/issues/1\nx", ""
        ]
        for value in bad:
            with self.subTest(value=value):
                with self.assertRaises(module.PreflightError):
                    module.checked_public_issue_url(value)

    def test_safe_with_escrow_is_not_payment_guarantee(self):
        def reviewer(target, inspect_files):
            self.assertFalse(inspect_files)
            self.assertEqual(target, KNOWN_GOOD)
            return {
                "verdict": "SAFE", "classification": "SAFE_WITH_ESCROW",
                "risk_score": 0, "has_escrow": True,
            }
        res = module.preflight(KNOWN_GOOD, vet=reviewer)
        self.assertTrue(res["proceedForAdditionalManualReview"])
        self.assertTrue(res["issuerClaimsEscrow"])
        self.assertFalse(res["escrowIndependentlyVerified"])
        self.assertFalse(res["paidClientConfirmed"])
        self.assertFalse(res["bountyAwardConfirmed"])
        self.assertFalse(res["walletUsed"])

    def test_safe_unbacked_remains_unbacked(self):
        def reviewer(_target, inspect_files):
            return {"verdict": "SAFE", "classification": "SAFE_NO_ESCROW",
                    "risk_score": 0, "has_escrow": False}
        res = module.preflight(KNOWN_GOOD, vet=reviewer)
        self.assertFalse(res["issuerClaimsEscrow"])
        self.assertFalse(res["bountyAwardConfirmed"])

    def test_quarantine_is_not_eligible(self):
        def reviewer(_target, inspect_files):
            return {"verdict": "QUARANTINE", "classification": "QUARANTINE",
                    "risk_score": 95, "has_escrow": False}
        res = module.preflight(KNOWN_GOOD, vet=reviewer)
        self.assertFalse(res["proceedForAdditionalManualReview"])

    def test_caution_is_not_eligible(self):
        def reviewer(_target, inspect_files):
            return {"verdict": "CAUTION", "classification": "QUARANTINE",
                    "risk_score": 24, "has_escrow": True}
        res = module.preflight(KNOWN_GOOD, vet=reviewer)
        self.assertFalse(res["proceedForAdditionalManualReview"])

    def test_unknown_result_fails_closed(self):
        def reviewer(_target, inspect_files):
            return {"verdict": "UNKNOWN", "classification": "SAFE_NO_ESCROW",
                    "risk_score": 0}
        with self.assertRaises(module.PreflightError):
            module.preflight(KNOWN_GOOD, vet=reviewer)

    def test_broken_network_response_fails_closed(self):
        def reviewer(_target, inspect_files):
            raise OSError("network down")
        with self.assertRaises(OSError):
            module.preflight(KNOWN_GOOD, vet=reviewer)

    def test_missing_risk_score_fails_closed(self):
        def reviewer(_target, inspect_files):
            return {"verdict": "SAFE", "classification": "SAFE_NO_ESCROW"}
        with self.assertRaises(module.PreflightError):
            module.preflight(KNOWN_GOOD, vet=reviewer)

    def test_refuses_boolean_risk_score(self):
        def reviewer(_target, inspect_files):
            return {"verdict": "SAFE", "classification": "SAFE_NO_ESCROW",
                    "risk_score": True}
        with self.assertRaises(module.PreflightError):
            module.preflight(KNOWN_GOOD, vet=reviewer)

    def test_original_cli_is_forced_anonymous(self):
        vendor = module._load_vendor()
        self.assertIsNone(vendor.get_github_token())


if __name__ == "__main__":
    unittest.main()
