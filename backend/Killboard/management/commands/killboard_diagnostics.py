"""Read retained KM diagnostics; never load sessions or invoke collection."""

import json

from django.core.management import BaseCommand, CommandError

from Killboard.diagnostics import DEFAULT_WINDOW_HOURS, diagnostic_summary, validate_window_hours
from Killboard.models import ProbeCursor


class Command(BaseCommand):
    help = 'Print bounded, read-only KM diagnostic statistics as safe JSON or a text summary.'

    def add_arguments(self, parser):
        parser.add_argument('--cursor', default='latest')
        parser.add_argument('--window-hours', type=int, default=DEFAULT_WINDOW_HOURS)
        parser.add_argument('--format', choices=('json', 'summary'), default='json')

    def handle(self, *args, **options):
        try:
            # Validation precedes database lookup; no client factories are imported.
            validate_window_hours(options['window_hours'])
        except ValueError as exc:
            raise CommandError(str(exc)) from None
        cursor = ProbeCursor.objects.filter(name=options['cursor']).first()
        report = diagnostic_summary(cursor, window_hours=options['window_hours'])
        if options['format'] == 'json':
            self.stdout.write(json.dumps(report, sort_keys=True, ensure_ascii=True))
            return
        totals, coverage = report['totals'], report['coverage']
        def count(value):
            return 'unknown' if value is None else str(value)
        self.stdout.write(
            f"window_hours={report['window']['hours']} runs={totals['runs']} "
            f"attempts={totals['attempted_runs']} run_km_responses={totals['km_response_count']} "
            f"empty={totals['empty_count']} rpc={count(totals['rpc_count'])}\n"
            f"dispositions={json.dumps(totals['dispositions'], sort_keys=True)}\n"
            f"failure_runs={json.dumps(totals['failure_counts'], sort_keys=True)}\n"
            f"cooldown_skips={totals['skipped_cooldown_runs']} unknown_attempts={totals['unknown_attempt_runs']} "
            f"stops={json.dumps(totals['stop_counts'], sort_keys=True)}\n"
            f"stable_material_runs={coverage['stable_material_runs']} legacy_slot_runs={coverage['legacy_slot_runs']} "
            f"unattributed_runs={coverage['unattributed_runs']} truncated={str(coverage['truncated']).lower()}\n"
            f"retained_runs={coverage['retained_runs']} included_runs={coverage['included_runs']} "
            f"omitted_runs={coverage['omitted_runs']} included_events={coverage['included_events']} "
            f"omitted_events={coverage['omitted_events']} omitted_groups={coverage['omitted_groups']} "
            f"missing_diagnostics_runs={coverage['missing_diagnostics_runs']} missing_rpc_runs={totals['missing_rpc_runs']}\n"
            'account_mapping=not_consulted account_identity=unverified collection_coverage=unverified\n'
            'km_count_basis=retained_run_report_count event_report_counts_may_differ=true'
        )
        for row in report['materials'] + report['legacy_slots']:
            label = (f"material={row['material_alias']}/{row['material_version']}/{row['pool_version']}"
                     if row['attribution'] == 'material' else f"legacy_slot={row['session_slot']}")
            self.stdout.write(
                f"{label} attempts={row['attempted_runs']} unknown_attempts={row['unknown_attempt_runs']} "
                f"run_km_responses={row['km_response_count']} empty={row['empty_count']} "
                f"dispositions={json.dumps(row['dispositions'], sort_keys=True)} "
                f"failures={json.dumps(row['failure_counts'], sort_keys=True)}"
            )
