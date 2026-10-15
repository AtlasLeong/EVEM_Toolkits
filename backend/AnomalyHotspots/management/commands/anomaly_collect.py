"""One authorized, bounded pass; journal only sanitized status and counts."""
import json
import time

from django.conf import settings
from django.core.management import BaseCommand, CommandError
from AnomalyHotspots.collector import collect_once, CollectorError, safe_audit
from AnomalyHotspots.session_bundle import load_round_robin_session, NeedsAuthError
from AnomalyHotspots.snapshot import write_success, write_failure, STATUSES, SnapshotError
from AnomalyHotspots.history import record_success, record_attempt, HistoryError


class Command(BaseCommand):
    help = 'Collect one anomaly-statistics snapshot with one explicitly selected private pool session.'
    requires_system_checks = []
    requires_migrations_checks = False

    def handle(self, *args, **options):
        snapshot = getattr(settings, 'ANOMALY_SNAPSHOT_FILE', '')
        if not snapshot: raise CommandError('Anomaly snapshot configuration is unavailable.')
        history = getattr(settings, 'ANOMALY_HISTORY_DIR', '')
        status, count = 'configuration_error', 0
        selection, audit, rows = {}, {}, None
        try:
            bundle, slot, index, size = load_round_robin_session()
            selection = {'session_slot': slot, 'pool_size': size}
            rows = collect_once(bundle, session_index=index, pool_size=size, audit=audit)
            status, count = 'ok', len(rows)
        except NeedsAuthError:
            status = 'unauthorized'
        except CollectorError as error:
            status = error.reason if error.reason == 'account_busy' else error.code
            if status not in STATUSES: status = 'configuration_error'
            audit.setdefault('reason', error.reason)
        except Exception:
            status = 'configuration_error'
        accepted_at_ms = int(time.time() * 1000)
        try:
            if status == 'ok': write_success(snapshot, rows, now_ms=accepted_at_ms)
            else: write_failure(snapshot, status, now_ms=accepted_at_ms)
        except SnapshotError:
            raise CommandError('Anomaly snapshot publication is unavailable.') from None
        history_status = 'disabled'
        if history:
            history_status = 'ok'
            if status == 'ok':
                try: record_success(history, rows, now_ms=accepted_at_ms)
                except HistoryError: history_status = 'unavailable'
            try:
                record_attempt(history, status, now_ms=accepted_at_ms, system_count=count,
                               **selection, audit=safe_audit(audit))
            except HistoryError:
                history_status = 'unavailable'
        self.stdout.write(json.dumps({'status': status, 'system_count': count,
                                      'history_status': history_status,
                                      **selection, **safe_audit(audit)}, sort_keys=True))
