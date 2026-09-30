"""Red tests for bounded, classified kill-id discovery."""

from datetime import datetime, timezone
from Killboard.models import epoch_ms
import msgpack

from django.core.management import call_command
from django.test import TestCase
from unittest.mock import patch

from Killboard.discovery import DiscoveryConfig, DiscoveryRunner, ProbeStatus
from Killboard.models import CollectionPolicy, KillReport, ProbeCursor, ProbeRun, ShipClass


def response(kill_id, when="2026-09-28T12:00:00+00:00"):
    blob = (
        f'<kill killID="{kill_id}" shipTypeID="9001" shipName="Test Battleship" '
        f'shipClass="battleship" solarSystemID="30000001" systemName="Jita" '
        f'killTime="{when}" participantCount="1">'
        '<victim characterID="7" characterName="Victim" />'
        '<attackers><attacker characterID="8" characterName="Pilot" '
        'damageDone="1" damagePercent="100" finalBlow="1" topDamage="1" /></attackers>'
        '</kill>'
    )
    return {"kill_blob": blob}


def captured_response(kill_id, identity_map=None):
    blob = '<attackers><a c="8" s="401" w="501" d="100" /></attackers><other />'
    payload = {
        "kill_id": kill_id,
        "solar_system_id": 30000001,
        "victim_ship_type_id": 9001,
        "victim_character_id": 7,
        "final_character_id": 8,
        "final_damage_done": 100,
        "kill_time": "2026-09-28T12:00:00",
        "kill_blob": blob,
    }
    if identity_map is not None:
        payload["identity_map"] = identity_map
    nested = msgpack.packb(payload, use_bin_type=True)
    inner = msgpack.packb([71, nested], use_bin_type=True)
    return msgpack.packb(msgpack.ExtType(19, inner), use_bin_type=True)


class FakeClient:
    def __init__(self, values):
        self.values = values
        self.calls = []

    def get_kill_info(self, kill_id):
        self.calls.append(kill_id)
        value = self.values.get(kill_id)
        if isinstance(value, BaseException):
            raise value
        return value


class CommandClient:
    def get_kill_info(self, kill_id):
        return None


class Unauthorized(Exception):
    code = "unauthorized"


class RateLimited(Exception):
    code = "rate_limited"


class NetworkFailure(Exception):
    code = "network_error"


class DiscoveryTests(TestCase):
    def setUp(self):
        ShipClass.objects.create(key="battleship", label="Battleship", rank=4)
        self.policy = CollectionPolicy.objects.create(
            name="battleship_plus",
            min_ship_rank=4,
            allowed_class_keys=["battleship"],
        )

    def test_runner_passes_captured_summary_to_parser(self):
        cursor = ProbeCursor.objects.create(name="captured-summary", next_probe_id=100)
        runner = DiscoveryRunner(
            FakeClient({100: captured_response(100, {
                "characters": {"8": {"name": "击毁者", "corporation_id": 9}},
                "corporations": {"9": {"name": "侦察军团"}},
            })}),
            cursor=cursor,
            policy=None,
            config=DiscoveryConfig(max_requests=1),
        )

        run = runner.run()

        self.assertEqual(run.report_count, 1)
        participant = KillReport.objects.get(kill_id=100).participants.get()
        self.assertEqual(participant.character_name, "击毁者")
        self.assertEqual(participant.corporation_name, "侦察军团")

    def test_rate_limit_backoff_increases_to_fifteen_thirty_and_sixty_minutes(self):
        cursor = ProbeCursor.objects.create(name="rate-backoff")
        now = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
        with patch("Killboard.discovery.timezone.now", return_value=now):
            for expected_minutes in (15, 30, 60):
                DiscoveryRunner.pause(cursor, "rate_limited")
                self.assertEqual(cursor.failure_count, (15, 30, 60).index(expected_minutes) + 1)
                self.assertEqual(
                    cursor.cooldown_until_ms,
                    int(now.timestamp() * 1000) + expected_minutes * 60 * 1000,
                )
        self.assertEqual(cursor.pause_reason, "rate_limited")

    def test_contiguous_reports_advance_cursor_and_stop_on_empty_hole(self):
        client = FakeClient({
            100: response(100),
            101: response(101, "2026-09-28T12:00:01+00:00"),
            102: None,
            103: None,
        })
        cursor = ProbeCursor.objects.create(name="default", next_probe_id=100)

        run = DiscoveryRunner(
            client,
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(empty_threshold=2, max_requests=10),
        ).run()

        cursor.refresh_from_db()
        self.assertEqual(run.stop_reason, "empty_threshold")
        self.assertEqual(run.request_count, 4)
        self.assertEqual(cursor.last_success_id, 101)
        self.assertEqual(cursor.next_probe_id, 102)
        self.assertEqual(cursor.consecutive_empty_count, 2)

    def test_step_greater_than_one_is_rejected_to_avoid_skipping_ids(self):
        with self.assertRaises(ValueError):
            DiscoveryConfig(step=3, neighbor_reprobe=1)

    def test_empty_counter_is_reset_at_the_start_of_each_run(self):
        client = FakeClient({100: None, 101: response(101)})
        cursor = ProbeCursor.objects.create(
            name="reset-empty", next_probe_id=100, consecutive_empty_count=2
        )

        run = DiscoveryRunner(
            client,
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(empty_threshold=2, max_requests=2),
        ).run()

        cursor.refresh_from_db()
        self.assertEqual(client.calls, [100, 101])
        self.assertEqual(run.stop_reason, "max_requests")
        self.assertEqual(cursor.last_success_id, 101)
        self.assertEqual(cursor.consecutive_empty_count, 0)

    def test_classified_errors_stop_without_being_counted_as_empty(self):
        for error, expected in (
            (Unauthorized(), ProbeStatus.UNAUTHORIZED),
            (RateLimited(), ProbeStatus.RATE_LIMITED),
            (NetworkFailure(), ProbeStatus.NETWORK_ERROR),
        ):
            with self.subTest(expected=expected):
                client = FakeClient({100: error})
                cursor = ProbeCursor.objects.create(name=f"{expected}-cursor", next_probe_id=100)
                run = DiscoveryRunner(
                    client,
                    cursor=cursor,
                    policy=self.policy,
                    config=DiscoveryConfig(max_requests=4),
                ).run()
                self.assertEqual(run.stop_reason, expected.value)
                self.assertEqual(run.empty_count, 0)

    def test_malformed_response_stops_and_time_reversal_does_not_advance(self):
        client = FakeClient({
            100: response(100, "2026-09-28T12:00:02+00:00"),
            101: response(101, "2026-09-28T11:00:00+00:00"),
        })
        cursor = ProbeCursor.objects.create(name="reverse", next_probe_id=100)
        run = DiscoveryRunner(
            client,
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(max_requests=4),
        ).run()

        cursor.refresh_from_db()
        self.assertEqual(run.stop_reason, "time_reversed")
        self.assertEqual(cursor.last_success_id, 100)
        self.assertEqual(cursor.next_probe_id, 101)

        malformed = FakeClient({200: {"not": "a kill blob"}})
        malformed_cursor = ProbeCursor.objects.create(name="malformed", next_probe_id=200)
        malformed_run = DiscoveryRunner(
            malformed,
            cursor=malformed_cursor,
            policy=self.policy,
            config=DiscoveryConfig(max_requests=1),
        ).run()
        self.assertEqual(malformed_run.stop_reason, ProbeStatus.MALFORMED.value)

    def test_max_requests_is_a_hard_client_call_limit(self):
        client = FakeClient({100: response(100), 101: response(101)})
        cursor = ProbeCursor.objects.create(name="bounded", next_probe_id=100)
        run = DiscoveryRunner(
            client,
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(max_requests=1),
        ).run()

        self.assertEqual(client.calls, [100])
        self.assertEqual(run.stop_reason, "max_requests")

    def test_max_requests_and_start_id_have_hard_bounds(self):
        with self.assertRaises(ValueError):
            DiscoveryConfig(max_requests=10001)
        with self.assertRaises(ValueError):
            DiscoveryConfig(start_id=0)

    def test_unexpected_exception_is_recorded_as_failed_run(self):
        cursor = ProbeCursor.objects.create(name="failed", next_probe_id=100)
        run = None
        with self.assertRaises(RuntimeError):
            DiscoveryRunner(
                FakeClient({100: RuntimeError("boom")}),
                cursor=cursor,
                policy=self.policy,
                config=DiscoveryConfig(max_requests=1),
            ).run()

        run = cursor.runs.get()
        self.assertEqual(run.status, run.Status.FAILED)
        self.assertEqual(run.stop_reason, "failed")

    def test_dry_run_rolls_back_run_cursor_and_reports(self):
        cursor = ProbeCursor.objects.create(name="dry", next_probe_id=100)
        runner = DiscoveryRunner(
            FakeClient({100: response(100)}),
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(max_requests=1),
        )

        runner.run(dry_run=True)

        cursor.refresh_from_db()
        self.assertIsNone(cursor.last_success_id)
        self.assertFalse(cursor.runs.exists())

    def test_management_command_dry_run_does_not_create_configuration(self):
        call_command(
            "killboard_probe",
            client="Killboard.tests.test_discovery.CommandClient",
            cursor="command-dry",
            policy="command-policy",
            start_id=100,
            max_requests=1,
        )

        self.assertFalse(ProbeCursor.objects.filter(name="command-dry").exists())
        self.assertFalse(CollectionPolicy.objects.filter(name="command-policy").exists())
        self.assertEqual(ShipClass.objects.count(), 1)

    def test_management_command_rejects_invalid_config_before_writes(self):
        from django.core.management import CommandError

        with self.assertRaises(CommandError):
            call_command(
                "killboard_probe",
                client="Killboard.tests.test_discovery.CommandClient",
                cursor="command-invalid",
                policy="command-invalid-policy",
                start_id=100,
                step=2,
            )

        self.assertFalse(ProbeCursor.objects.filter(name="command-invalid").exists())
        self.assertFalse(CollectionPolicy.objects.filter(name="command-invalid-policy").exists())

    def test_default_command_policy_excludes_battlecruisers(self):
        from Killboard.management.commands.killboard_probe import Command

        policy = Command()._policy("battleship_plus")

        self.assertEqual(policy.min_ship_rank, 4)
        self.assertNotIn("battlecruiser", policy.allowed_class_keys)
        self.assertEqual(ShipClass.objects.get(key="battlecruiser").rank, 3)

    def test_expired_running_run_is_recovered_before_next_run(self):
        now = epoch_ms()
        cursor = ProbeCursor.objects.create(name="orphan", next_probe_id=100)
        orphan = ProbeRun.objects.create(
            cursor=cursor,
            status=ProbeRun.Status.RUNNING,
            started_at_ms=now - 120_000,
            lease_expires_at_ms=now - 1,
            lease_owner="old-worker",
        )
        runner = DiscoveryRunner(
            FakeClient({100: response(100)}),
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(max_requests=1),
        )

        run = runner.run()

        orphan.refresh_from_db()
        self.assertEqual(orphan.status, ProbeRun.Status.FAILED)
        self.assertEqual(orphan.stop_reason, "lease_expired")
        self.assertEqual(run.status, ProbeRun.Status.STOPPED)
        self.assertIsNone(run.lease_expires_at_ms)
        self.assertEqual(run.lease_owner, "")

    def test_default_value_policy_is_repaired_to_all_classes_and_enabled(self):
        from decimal import Decimal
        from Killboard.management.commands.killboard_probe import Command, DEFAULT_POLICY

        existing = CollectionPolicy.objects.create(
            name=DEFAULT_POLICY,
            enabled=False,
            min_ship_rank=4,
            allowed_class_keys=["battleship"],
            min_isk_lost=Decimal("1.00"),
        )

        policy = Command()._policy(DEFAULT_POLICY)

        existing.refresh_from_db()
        self.assertEqual(policy.pk, existing.pk)
        self.assertTrue(existing.enabled)
        self.assertEqual(existing.min_ship_rank, 0)
        self.assertEqual(existing.allowed_class_keys, [])
        self.assertEqual(existing.min_isk_lost, Decimal("20000000000.00"))

    def test_active_lease_still_blocks_second_run(self):
        now = epoch_ms()
        cursor = ProbeCursor.objects.create(name="active-lease", next_probe_id=100)
        ProbeRun.objects.create(
            cursor=cursor,
            status=ProbeRun.Status.RUNNING,
            started_at_ms=now,
            lease_expires_at_ms=now + 120_000,
            lease_owner="active-worker",
        )
        runner = DiscoveryRunner(
            FakeClient({100: response(100)}),
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(max_requests=1),
        )

        with self.assertRaises(RuntimeError):
            runner.run()
