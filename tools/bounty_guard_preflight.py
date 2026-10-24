#!/usr/bin/env python3
"""Optional public-GitHub bounty preflight using original vendored BountyGuard.

This does NOT establish independently audited escrow or actual payout.
No user wallet, browser profile, signing secret or API key is read or sent.
Original x402 Quote Guard action stays entirely offline and unchanged.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "bountyguard" / "bounty_guard.py"
TARGET = re.compile(
    r"https://github\.com/[A-Za-z0-9_.-]{1,39}/"
    r"[A-Za-z0-9_.-]{1,100}/(?:issues|pull)/[1-9]\d{0,8}/?\Z"
)


class PreflightError(ValueError):
    pass


def checked_public_issue_url(value: str) -> str:
    if not isinstance(value, str) or not TARGET.fullmatch(value):
        raise PreflightError(
            "Require one exact public https://github.com/owner/repo/issues/N "
            "or pull/N URL, without credentials, query strings or fragments"
        )
    return value.rstrip("/")


def _load_vendor():
    spec = importlib.util.spec_from_file_location("pinned_bounty_guard", VENDOR)
    if not spec or not spec.loader:
        raise PreflightError("Pinned BountyGuard source not present")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Critical: upstream normally reads GH_TOKEN, GITHUB_TOKEN or runs
    # 'gh auth token'. Never let it read any original logged-in account.
    # The only permitted operations are anonymous public GitHub issue GET
    # and the issuer's read-only published escrow status.
    module.get_github_token = lambda: None
    return module


def preflight(target: str, *, vet=None) -> dict:
    target = checked_public_issue_url(target)
    upstream = _load_vendor() if vet is None else None
    reviewer = vet or upstream.vet_target
    raw = reviewer(target, inspect_files=False)
    if not isinstance(raw, dict):
        raise PreflightError("Unexpected scanner result")
    verdict = raw.get("verdict")
    classification = raw.get("classification")
    if verdict not in {"SAFE", "CAUTION", "QUARANTINE"}:
        raise PreflightError("Unknown scanner verdict")
    if classification not in {"SAFE_WITH_ESCROW", "SAFE_NO_ESCROW", "QUARANTINE"}:
        raise PreflightError("Unknown scanner classification")
    risk = raw.get("risk_score")
    if isinstance(risk, bool) or not isinstance(risk, int) or not 0 <= risk <= 100:
        raise PreflightError("Invalid scanner risk score")
    return {
        "publicTarget": target,
        "vendor": "doomsday-network/bounty-guard v1.1.0 (vendored MIT)",
        "vendorVerdict": verdict,
        "vendorClassification": classification,
        "vendorRiskScore": risk,
        "proceedForAdditionalManualReview": verdict == "SAFE",
        "issuerClaimsEscrow": bool(raw.get("has_escrow", False)),
        "escrowIndependentlyVerified": False,
        "paidClientConfirmed": False,
        "bountyAwardConfirmed": False,
        "walletUsed": False,
        "safetyNote": (
            "Publisher classifications and escrow claims are not independent "
            "payout guarantees. Verify origin, rules, budget and actual reward "
            "before contract work. No wallets, secrets or transactions here."
        ),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Read-only public Github BountyGuard preflight; not a payment guarantee."
    )
    parser.add_argument("target", help="One exact public GitHub issue or PR URL")
    args = parser.parse_args(argv)
    try:
        info = preflight(args.target)
    except (PreflightError, ValueError, OSError, TimeoutError) as exc:
        print(json.dumps({
            "vendorVerdict": "UNVERIFIED",
            "proceedForAdditionalManualReview": False,
            "reason": str(exc)[:300],
        }, ensure_ascii=False))
        return 2
    except Exception as exc:
        # No fallback to 'safe' on network error or issuer failure.
        print(json.dumps({
            "vendorVerdict": "UNVERIFIED",
            "proceedForAdditionalManualReview": False,
            "reason": "Public issuer/scanner read failed: " + type(exc).__name__,
        }))
        return 2
    print(json.dumps(info, indent=2, ensure_ascii=False))
    return 0 if info["proceedForAdditionalManualReview"] else 2


if __name__ == "__main__":
    sys.exit(main())
