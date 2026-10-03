"""Latest-first bounded worker; sequential killboard_probe remains available."""
from django.core.management import CommandError
from django.db import transaction

from Killboard.discovery import DiscoveryConfig
from Killboard.freshness import FreshnessRunner
from Killboard.models import ProbeCursor
from Killboard.worker import CollectorPacer
from .killboard_probe import Command as ProbeCommand


class Command(ProbeCommand):
    help = 'Collect newest candidate KM first, preserving historical pending ranges (dry-run by default).'

    def handle(self, *args, **options):
        try:
            config = DiscoveryConfig(start_id=options['start_id'], max_requests=options['max_requests'],
                                     step=options['step'], neighbor_reprobe=options['neighbor_reprobe'],
                                     empty_threshold=options['empty_threshold'])
            pacer = CollectorPacer(interval=options['rpc_interval'], jitter=options['rpc_jitter'],
                                   max_rpcs=options['rpc_budget'], max_seconds=options['max_seconds'])
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        if options['resume']:
            raise CommandError('Use the explicit sequential operator command to confirm a refreshed session; collection never clears pauses.')
        client = None
        def execute(dry_run=False):
            nonlocal client
            policy = self._policy(options['policy'])
            cursor, _ = ProbeCursor.objects.get_or_create(name=options['cursor'])
            def load_client():
                nonlocal client
                client = self._client(options['client'])
                if hasattr(client, 'set_before_rpc'):
                    client.set_before_rpc(pacer)
                if hasattr(client, 'set_enrichment_min_isk'):
                    client.set_enrichment_min_isk(policy.min_isk_lost)
                return client
            runner = FreshnessRunner(None, cursor=cursor, policy=policy, config=config,
                                     source=options['source'], client_factory=load_client)
            pacer.heartbeat = runner.heartbeat
            return runner.run(dry_run=dry_run)
        try:
            if options['write']:
                run = execute()
            else:
                with transaction.atomic():
                    run = execute(dry_run=True)
                    transaction.set_rollback(True)
        finally:
            if client and hasattr(client, 'close'):
                client.close()
        self.stdout.write(f"{'committed' if options['write'] else 'dry-run'}: run={run.pk} "
                          f"requests={run.request_count} parsed={run.report_count} stop={run.stop_reason}")
