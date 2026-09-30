"""Operator-only, bounded candidate search; never a claim of global coverage."""

from django.core.management import BaseCommand, CommandError
from django.db import transaction

from Killboard.bootstrap import BootstrapConfig, BootstrapRunner
from Killboard.discovery import DiscoveryRunner
from Killboard.management.commands.killboard_probe import Command as ProbeCommand
from Killboard.models import ProbeCursor, ProbeRun, epoch_ms
from Killboard.services import persist_report
from Killboard.worker import CollectorPacer, LeaseLostError


class Command(BaseCommand):
    help = 'Find a latest-ID candidate under an explicitly acknowledged continuity assumption.'
    _client = ProbeCommand._client
    _policy = ProbeCommand._policy

    def add_arguments(self, parser):
        parser.add_argument('--client')
        parser.add_argument('--known-id', type=int, required=True)
        parser.add_argument('--upper-id', type=int, default=21111111)
        parser.add_argument('--assume-contiguous', action='store_true')
        parser.add_argument('--initialize', action='store_true', help='Initialize only an unused latest cursor')
        parser.add_argument('--recent-count', type=int, default=30, help='Explicit latest-only window, not historical coverage')
        parser.add_argument('--write', action='store_true')
        parser.add_argument('--max-requests', type=int, default=48)
        parser.add_argument('--rpc-interval', type=float, default=5)
        parser.add_argument('--rpc-budget', type=int, default=60)
        parser.add_argument('--max-seconds', type=float, default=600)

    def handle(self, *args, **options):
        try:
            config = BootstrapConfig(known_existing_id=options['known_id'], upper_id=options['upper_id'],
                                     assume_contiguous=options['assume_contiguous'], max_requests=options['max_requests'])
            pacer = CollectorPacer(interval=options['rpc_interval'], max_rpcs=options['rpc_budget'],
                                   max_seconds=options['max_seconds'])
            if not 1 <= options['recent_count'] <= 1000:
                raise ValueError('recent-count must be between 1 and 1000')
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        client = None

        def execute():
            nonlocal client
            with transaction.atomic():
                cursor, _ = ProbeCursor.objects.get_or_create(name='latest')
                cursor = ProbeCursor.objects.select_for_update().get(pk=cursor.pk)
                if options['initialize'] and (cursor.next_probe_id is not None or cursor.last_success_id is not None):
                    raise CommandError('refusing to overwrite an existing collection cursor')
                paused = DiscoveryRunner.paused_reason(cursor)
                if paused:
                    self.stdout.write(f'stopped: {paused}; no session loaded')
                    return
                helper = DiscoveryRunner(None, cursor=cursor, policy=self._policy('high_value_all'))
                helper._recover_orphaned_runs(cursor, epoch_ms())
                helper._assert_no_running(cursor)
                run = helper._create_run(cursor)
            helper.active_run = run
            pacer.heartbeat = helper.heartbeat
            class Adapter:
                def get_kill_info(self, kill_id):
                    helper.heartbeat()
                    outcome = helper._fetch(kill_id)
                    with transaction.atomic():
                        helper._owned(run, cursor)
                        if outcome.status.value == 'report':
                            persist_report(outcome.payload, policy=helper.policy, source='kill_api_bootstrap')
                    return outcome

            try:
                try:
                    client = self._client(options['client'])
                except Exception:
                    with transaction.atomic():
                        helper._owned(run, cursor)
                        cursor.pause_reason, cursor.cooldown_until_ms = 'configuration_error', None
                        cursor.save(update_fields=['pause_reason', 'cooldown_until_ms'])
                        run.stop_reason = 'configuration_error'
                    raise CommandError('Collector configuration rejected; refresh config and explicitly resume.') from None
                if hasattr(client, 'set_before_rpc'):
                    client.set_before_rpc(pacer)
                if hasattr(client, 'enrich'):
                    client.enrich = False
                helper.client = client
                result = BootstrapRunner(Adapter(), config=config).run()
                with transaction.atomic():
                    helper._owned(run, cursor)
                    cursor.refresh_from_db()
                    DiscoveryRunner.pause(cursor, result.stop_reason)
                    if result.candidate_id is not None:
                        cursor.candidate_id, cursor.candidate_at_ms = result.candidate_id, epoch_ms()
                        if options['initialize']:
                            cursor.next_probe_id = max(config.known_existing_id, result.candidate_id-options['recent_count']+1)
                    cursor.save()
                    run.status, run.stop_reason = 'stopped', result.stop_reason
                    run.request_count = result.request_count
                    run.report_count = sum(item.status.value == 'report' for item in result.observations)
                    run.empty_count = sum(item.status.value == 'empty' for item in result.observations)
                    run.finished_at_ms, run.lease_owner, run.lease_expires_at_ms = epoch_ms(), '', None
                    run.save()
                self.stdout.write(f"candidate={result.candidate_id} stop={result.stop_reason} requests={result.request_count} coverage_verified=False")
            except Exception:
                ProbeRun.objects.filter(pk=run.pk, status='running', lease_owner=run.lease_owner).update(
                    status='failed', stop_reason=run.stop_reason or 'failed', finished_at_ms=epoch_ms(), lease_owner='', lease_expires_at_ms=None)
                raise

        try:
            if options['write']:
                execute()
            else:
                with transaction.atomic():
                    execute()
                    transaction.set_rollback(True)
        finally:
            if client and hasattr(client, 'close'):
                client.close()
