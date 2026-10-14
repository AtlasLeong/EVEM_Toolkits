"""One authorized, bounded pass; journal only sanitized status and counts."""
import json

from django.conf import settings
from django.core.management import BaseCommand, CommandError
from AnomalyHotspots.collector import collect_once, CollectorError, safe_audit
from AnomalyHotspots.session_bundle import load_round_robin_session, NeedsAuthError
from AnomalyHotspots.snapshot import write_success, write_failure, STATUSES, SnapshotError


class Command(BaseCommand):
    help = 'Collect one anomaly-statistics snapshot with one explicitly selected private pool session.'
    requires_system_checks = []
    requires_migrations_checks = False

    def handle(self, *args, **options):
        snapshot = getattr(settings, 'ANOMALY_SNAPSHOT_FILE', '')
        if not snapshot: raise CommandError('Anomaly snapshot configuration is unavailable.')
        status, count = 'configuration_error', 0
        selection, audit = {}, {}
        try:
            bundle, slot, index, size = load_round_robin_session()
            selection = {'session_slot': slot, 'pool_size': size}
            rows = collect_once(bundle, session_index=index, pool_size=size, audit=audit)
            write_success(snapshot, rows)
            status, count = 'ok', len(rows)
        except NeedsAuthError:
            status = 'unauthorized'
        except CollectorError as error:
            status = error.reason if error.reason == 'account_busy' else error.code
            if status not in STATUSES: status = 'configuration_error'
            audit.setdefault('reason', error.reason)
        except SnapshotError:
            raise CommandError('Anomaly snapshot publication is unavailable.') from None
        except Exception:
            status = 'configuration_error'
        if status != 'ok':
            try: write_failure(snapshot, status)
            except SnapshotError:
                raise CommandError('Anomaly snapshot publication is unavailable.') from None
        self.stdout.write(json.dumps({'status': status, 'system_count': count,
                                      **selection, **safe_audit(audit)}, sort_keys=True))
