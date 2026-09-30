"""Synthetic-only tests for the bounded, assumption-based latest-ID candidate."""

from datetime import datetime, timedelta, timezone
import importlib
import unittest

import msgpack


def report(kill_id, when=None):
    if when is None:
        when = (datetime(2026, 9, 28, tzinfo=timezone.utc) + timedelta(seconds=kill_id)).isoformat()
    nested = msgpack.packb({
        "kill_id": kill_id,
        "kill_time": when,
        "kill_blob": '<other><o data="-3.0"/></other>',
    }, use_bin_type=True)
    business = msgpack.packb(msgpack.ExtType(19, msgpack.packb([71, nested], use_bin_type=True)), use_bin_type=True)
    return msgpack.packb(msgpack.ExtType(10, business), use_bin_type=True)


class SyntheticClient:
    """A local function-backed transport; never accesses accounts or sockets."""

    def __init__(self, last_id=117, overrides=None):
        self.last_id = last_id
        self.overrides = overrides or {}
        self.calls = []

    def get_kill_info(self, kill_id):
        self.calls.append(kill_id)
        value = self.overrides.get(kill_id, report(kill_id) if kill_id <= self.last_id else None)
        if callable(value):
            value = value(self.calls.count(kill_id))
        if isinstance(value, BaseException):
            raise value
        return value


class Unauthorized(Exception):
    code = "unauthorized"


class RateLimited(Exception):
    code = "rate_limited"


class BootstrapTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module("Killboard.bootstrap")
        except ModuleNotFoundError:
            self.fail("the pure, bounded bootstrap module has not been implemented")

    def run_candidate(self, client=None, **options):
        module = self.module()
        config = module.BootstrapConfig(
            known_existing_id=options.pop("known_existing_id", 100),
            upper_id=options.pop("upper_id", 160),
            assume_contiguous=options.pop("assume_contiguous", True),
            **options,
        )
        client = client or SyntheticClient()
        return module.BootstrapRunner(client, config=config).run(), client

    def test_finds_only_a_neighbor_validated_candidate(self):
        result, client = self.run_candidate()

        self.assertEqual(result.stop_reason, "candidate_only")
        self.assertEqual(result.candidate_id, 117)
        self.assertEqual(result.existing_lower_id, 117)
        self.assertEqual(result.empty_upper_id, 118)
        self.assertTrue(result.neighbor_validated)
        self.assertTrue(result.assumed_contiguous)
        self.assertFalse(result.coverage_verified)
        self.assertEqual(result.request_count, len(client.calls))
        self.assertEqual(client.calls[-6:], [115, 116, 117, 118, 119, 120])
        self.assertLessEqual(result.request_count, 64)

    def test_continuity_must_be_explicitly_acknowledged(self):
        module = self.module()
        for assumption in (False, None, 1, "true"):
            with self.subTest(assumption=assumption), self.assertRaises(ValueError):
                module.BootstrapConfig(known_existing_id=100, assume_contiguous=assumption)

    def test_default_high_id_is_21111111_and_hard_request_limit_is_64(self):
        config = self.module().BootstrapConfig(known_existing_id=100, assume_contiguous=True)
        self.assertEqual(config.upper_id, 21_111_111)
        self.assertEqual(config.max_requests, 64)

    def test_configuration_rejects_unsafe_ranges_and_non_integer_limits(self):
        module = self.module()
        unsafe = (
            {"known_existing_id": 0}, {"known_existing_id": True},
            {"known_existing_id": 160}, {"known_existing_id": 161},
            {"upper_id": 2**63}, {"upper_id": False}, {"upper_id": 160.0},
            {"max_requests": 0}, {"max_requests": 65}, {"max_requests": True},
            {"max_requests": 2.5}, {"neighbor_radius": 0},
            {"neighbor_radius": 17}, {"neighbor_radius": True},
        )
        for override in unsafe:
            options = {"known_existing_id": 100, "upper_id": 160, "assume_contiguous": True, **override}
            with self.subTest(override=override), self.assertRaises(ValueError):
                module.BootstrapConfig(**options)

    def test_known_lower_is_verified_before_any_upper_probe(self):
        result, client = self.run_candidate(SyntheticClient(overrides={100: None}))
        self.assertEqual(result.stop_reason, "lower_not_existing")
        self.assertIsNone(result.candidate_id)
        self.assertEqual(client.calls, [100])

    def test_non_empty_upper_stops_without_expanding_or_searching(self):
        result, client = self.run_candidate(SyntheticClient(last_id=200))
        self.assertEqual(result.stop_reason, "upper_not_empty")
        self.assertIsNone(result.candidate_id)
        self.assertEqual(client.calls, [100, 160])

    def test_neighbor_report_beyond_an_observed_empty_rejects_a_hole(self):
        result, client = self.run_candidate(SyntheticClient(last_id=149, overrides={130: None}))
        self.assertEqual(result.stop_reason, "continuity_violation")
        self.assertIsNone(result.candidate_id)
        self.assertIn(131, client.calls)
        self.assertFalse(result.neighbor_validated)

    def test_unobserved_report_island_never_becomes_a_coverage_claim(self):
        result, client = self.run_candidate(SyntheticClient(last_id=129, overrides={145: report(145)}))
        self.assertEqual(result.candidate_id, 129)
        self.assertNotIn(145, client.calls)
        self.assertEqual(result.stop_reason, "candidate_only")
        self.assertFalse(result.coverage_verified)

    def test_neighbor_reprobe_detects_a_boundary_changing_during_search(self):
        client = SyntheticClient(overrides={118: lambda count: None if count == 1 else report(118)})
        result, _ = self.run_candidate(client)
        self.assertEqual(result.stop_reason, "boundary_changed")
        self.assertIsNone(result.candidate_id)
        self.assertFalse(result.neighbor_validated)

    def test_reversed_report_time_stops_at_the_first_observation(self):
        client = SyntheticClient(overrides={115: report(115, "2026-09-27T00:00:00+00:00")})
        result, _ = self.run_candidate(client)
        self.assertEqual(result.stop_reason, "time_reversed")
        self.assertIsNone(result.candidate_id)
        self.assertFalse(result.time_order_verified)
        self.assertEqual(client.calls, [100, 160, 130, 115])

    def test_neighbor_time_is_checked_in_id_order_not_request_order(self):
        client = SyntheticClient(last_id=149, overrides={147: report(147, "2026-09-27T00:00:00+00:00")})
        result, _ = self.run_candidate(client)
        self.assertEqual(result.stop_reason, "time_reversed")
        self.assertIsNone(result.candidate_id)
        self.assertEqual(client.calls[-1], 147)

    def test_missing_time_does_not_claim_verified_time_order(self):
        client = SyntheticClient(overrides={117: report(117, "")})
        result, _ = self.run_candidate(client)
        self.assertEqual(result.candidate_id, 117)
        self.assertFalse(result.time_order_verified)

    def test_auth_rate_network_and_unknown_transport_errors_stop_immediately(self):
        for error, reason in (
            (Unauthorized("private secret"), "unauthorized"),
            (RateLimited("private secret"), "rate_limited"),
            (TimeoutError("private secret"), "network_error"),
            (ConnectionError("private secret"), "network_error"),
            (RuntimeError("private secret"), "malformed"),
        ):
            with self.subTest(reason=reason):
                result, client = self.run_candidate(SyntheticClient(overrides={130: error}))
                self.assertEqual(result.stop_reason, reason)
                self.assertIsNone(result.candidate_id)
                self.assertEqual(client.calls, [100, 160, 130])
                self.assertNotIn("private secret", repr(result))

    def test_malformed_responses_are_never_empty_boundary_evidence(self):
        for malformed in ({"wrong": "shape"}, {"kill_blob": None}, b"invalid", report(999), report(130, "invalid-time")):
            with self.subTest(malformed=type(malformed).__name__):
                result, client = self.run_candidate(SyntheticClient(overrides={130: malformed}))
                self.assertEqual(result.stop_reason, "malformed")
                self.assertIsNone(result.candidate_id)
                self.assertEqual(client.calls, [100, 160, 130])
                self.assertEqual(result.empty_upper_id, 160)

    def test_transport_neutral_outcomes_are_validated_and_errors_are_sanitized(self):
        module = self.module()
        for status in ("unauthorized", "rate_limited", "network_error", "malformed"):
            with self.subTest(status=status):
                outcome = module.ProbeOutcome(module.ProbeStatus(status), error_code="token=private-secret")
                result, client = self.run_candidate(SyntheticClient(overrides={130: outcome}))
                self.assertEqual(result.stop_reason, status)
                self.assertEqual(result.request_count, 3)
                self.assertNotIn("private-secret", repr(result))
                self.assertEqual(client.calls[-1], 130)
        result, _ = self.run_candidate(SyntheticClient(overrides={130: module.ProbeOutcome(module.ProbeStatus.REPORT, payload={"kill_id": 999})}))
        self.assertEqual(result.stop_reason, "malformed")

    def test_decoded_mapping_and_fetch_alias_are_supported_without_database(self):
        class DecodedClient:
            def fetch(self, kill_id):
                if kill_id > 3:
                    return None
                return {"kill_blob": f'<kill killID="{kill_id}" killTime="2026-09-28T00:00:00"/>'}

        result, _ = self.run_candidate(DecodedClient(), known_existing_id=1, upper_id=8)
        self.assertEqual(result.candidate_id, 3)
        self.assertTrue(result.neighbor_validated)

    def test_budget_applies_to_initial_search_and_neighbor_requests(self):
        for budget in (1, 2, 8, 11):
            with self.subTest(budget=budget):
                result, client = self.run_candidate(max_requests=budget)
                self.assertEqual(result.stop_reason, "max_requests")
                self.assertEqual(result.request_count, budget)
                self.assertEqual(len(client.calls), budget)
                self.assertIsNone(result.candidate_id)
                self.assertFalse(result.neighbor_validated)

    def test_signed_64_bit_edges_never_probe_outside_configured_interval(self):
        for lower, upper, last in ((1, 2, 1), (2**63 - 3, 2**63 - 1, 2**63 - 2)):
            class EdgeClient:
                def __init__(self):
                    self.calls = []

                def get_kill_info(self, kill_id):
                    self.calls.append(kill_id)
                    return report(kill_id, "2026-09-28T00:00:00+00:00") if kill_id <= last else None

            with self.subTest(lower=lower):
                client = EdgeClient()
                result, _ = self.run_candidate(client, known_existing_id=lower, upper_id=upper)
                self.assertEqual(result.candidate_id, last)
                self.assertTrue(all(lower <= value <= upper for value in client.calls))

    def test_cancellation_is_not_reclassified_or_retried(self):
        with self.assertRaises(KeyboardInterrupt):
            self.run_candidate(SyntheticClient(overrides={100: KeyboardInterrupt()}))

    def test_full_64_request_budget_cannot_be_bypassed_by_a_huge_interval(self):
        result, client = self.run_candidate(SyntheticClient(last_id=3000), known_existing_id=1, upper_id=2**63 - 1)
        self.assertEqual(result.stop_reason, "max_requests")
        self.assertEqual(result.request_count, 64)
        self.assertEqual(len(client.calls), 64)
        self.assertIsNone(result.candidate_id)


if __name__ == "__main__":
    unittest.main()
