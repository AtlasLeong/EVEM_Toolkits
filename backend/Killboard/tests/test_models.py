"""Model tests.

Run with ``--settings=EVE_MDjango.killboard_test_settings`` so this suite
uses an isolated in-memory SQLite database and never imports production
credentials or connects to the live MySQL databases.
"""

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from decimal import Decimal

from django.test import TestCase

from Killboard.models import (
    CollectionPolicy,
    KillItem,
    KillParticipant,
    KillReport,
    ProbeCursor,
    ProbeEvent,
    ProbeRun,
    ShipClass,
)


class KillboardModelTests(TestCase):
    def test_corporation_tickers_are_blank_default_bounded_strings(self):
        report = KillReport.objects.create(kill_id=120)
        participant = KillParticipant.objects.create(report=report)
        self.assertEqual(getattr(report, 'victim_corporation_ticker', None), '')
        self.assertEqual(getattr(participant, 'corporation_ticker', None), '')
        report.victim_corporation_ticker = 'GCG1'
        participant.corporation_ticker = 'KOFR'
        report.save()
        participant.save()
        report.refresh_from_db()
        participant.refresh_from_db()
        self.assertEqual(report.victim_corporation_ticker, 'GCG1')
        self.assertEqual(participant.corporation_ticker, 'KOFR')
        for model, field_name in ((KillReport, 'victim_corporation_ticker'),
                                  (KillParticipant, 'corporation_ticker')):
            field = model._meta.get_field(field_name)
            self.assertEqual(field.max_length, 255)
            self.assertTrue(field.blank)
            self.assertFalse(field.null)

    def test_strategy_and_audit_json_are_independent_and_round_trip(self):
        first = ProbeCursor.objects.create(name='audit-first')
        second = ProbeCursor.objects.create(name='audit-second')
        self.assertEqual(first.strategy_state, {})
        first.strategy_state['phase'] = 'bracket'
        first.save()
        second.refresh_from_db()
        self.assertEqual(second.strategy_state, {})
        run = ProbeRun.objects.create(cursor=first, diagnostics={'session_slot': 'A'})
        event = ProbeEvent.objects.create(run=run, status='report', diagnostics={'disposition': 'created'})
        run.refresh_from_db()
        event.refresh_from_db()
        self.assertEqual(run.diagnostics, {'session_slot': 'A'})
        self.assertEqual(event.diagnostics, {'disposition': 'created'})
    def test_kill_report_id_is_unique_and_related_rows_are_supported(self):
        report = KillReport.objects.create(
            kill_id=19748417,
            ship_type_id=123,
            ship_name="Vassago",
            ship_class_key="assault_carrier",
            system_id=30000299,
            system_name="Test system",
            kill_time_raw="2026-08-15T06:43:05",
            source="test",
        )

        participant = KillParticipant.objects.create(
            report=report,
            character_id=42,
            character_name="Pilot",
            damage=1234,
            damage_pct="100.000",
            is_final_blow=True,
            is_top_damage=True,
            source_index=0,
        )
        item = KillItem.objects.create(
            report=report,
            type_id=456,
            name="Test module",
            quantity_dropped=1,
            status=KillItem.Status.DROPPED,
        )

        report.participants_status = 'provided'
        report.equipment_status = 'provided'
        report.save(update_fields=['participants_status', 'equipment_status'])
        participant.ship_type_id = 9001
        participant.weapon_type_id = 9002
        participant.save(update_fields=['ship_type_id', 'weapon_type_id'])
        report.refresh_from_db()
        participant.refresh_from_db()
        self.assertEqual(report.equipment_status, 'provided')
        self.assertEqual(report.participants_status, 'provided')
        self.assertEqual(participant.ship_type_id, 9001)
        self.assertEqual(participant.weapon_type_id, 9002)

        self.assertEqual(report.participants.get(), participant)
        self.assertEqual(report.items.get(), item)

        with self.assertRaises(IntegrityError), transaction.atomic():
            KillReport.objects.create(kill_id=19748417)

    def test_kill_item_status_has_only_supported_values(self):
        report = KillReport.objects.create(kill_id=19748418, source="test")
        for status in KillItem.Status.values:
            item = KillItem.objects.create(report=report, status=status)
            self.assertEqual(item.status, status)

        with self.assertRaises(IntegrityError), transaction.atomic():
            KillItem.objects.create(report=report, status="salvaged")

    def test_policy_cursor_and_run_are_registered_domain_models(self):
        ship_class = ShipClass.objects.create(key="battleship", label="Battleship", rank=4)
        policy = CollectionPolicy.objects.create(
            name="battleship_plus",
            min_ship_rank=ship_class.rank,
            allowed_class_keys=[ship_class.key],
            min_isk_lost=Decimal("20000000000.00"),
        )
        cursor = ProbeCursor.objects.create(name="default", next_probe_id=19748419)
        run = ProbeRun.objects.create(cursor=cursor, policy=policy, status=ProbeRun.Status.QUEUED)

        self.assertEqual(run.cursor, cursor)
        self.assertEqual(run.policy, policy)
        self.assertEqual(ShipClass.objects.get(key="battleship"), ship_class)
        self.assertEqual(policy.min_isk_lost, Decimal("20000000000.00"))

    def test_policy_threshold_is_nullable_and_decimal(self):
        policy = CollectionPolicy.objects.create(name="all-value", min_ship_rank=0, allowed_class_keys=[])
        self.assertIsNone(policy.min_isk_lost)

    def test_invalid_status_is_rejected_by_model_validation(self):
        item = KillItem(status="salvaged")
        with self.assertRaises(ValidationError):
            item.full_clean()
