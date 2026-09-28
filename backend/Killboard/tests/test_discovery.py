"""Red tests for bounded, classified kill-id discovery."""

from datetime import datetime, timezone

from django.test import TestCase

from Killboard.discovery import DiscoveryConfig, DiscoveryRunner, ProbeStatus
from Killboard.models import CollectionPolicy, ProbeCursor, ShipClass


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

    def test_jump_reprobes_neighbor_before_accepting_candidate(self):
        client = FakeClient({
            100: response(100),
            103: response(103, "2026-09-28T12:00:03+00:00"),
            102: None,
        })
        cursor = ProbeCursor.objects.create(name="jump", next_probe_id=100)

        DiscoveryRunner(
            client,
            cursor=cursor,
            policy=self.policy,
            config=DiscoveryConfig(step=3, neighbor_reprobe=1, empty_threshold=1, max_requests=3),
        ).run()

        self.assertEqual(client.calls, [100, 102, 103])

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
