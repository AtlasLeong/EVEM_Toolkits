"""Run one bounded killboard discovery pass.

The command is intentionally dry-run unless ``--write`` is supplied.  A
transport client is injected with ``--client``; no credentials or packet
captures are read from the repository.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.management import BaseCommand, CommandError
from django.db import transaction
from django.utils.module_loading import import_string

from Killboard.discovery import DiscoveryConfig, DiscoveryRunner
from Killboard.models import CollectionPolicy, ProbeCursor, ShipClass
from Killboard.worker import CollectorPacer


DEFAULT_CLASSES = (
    ("battleship", "战列舰", 4),
    # Battlecruisers are below battleships for collection-policy ranking.
    ("battlecruiser", "战列巡洋舰", 3),
    ("dreadnought", "无畏舰", 6),
    ("carrier", "航母", 7),
    ("supercarrier", "超级航母", 8),
    ("titan", "泰坦", 9),
)
DEFAULT_POLICY = "high_value_all"
DEFAULT_MIN_ISK_LOST = Decimal("20000000000.00")


class Command(BaseCommand):
    help = "Probe a bounded range of kill IDs (dry-run by default)."

    def add_arguments(self, parser):
        parser.add_argument("--client", help="Dotted path to a ProbeClient factory/class")
        parser.add_argument("--cursor", default="default")
        parser.add_argument("--policy", default=DEFAULT_POLICY)
        parser.add_argument("--start-id", type=int)
        parser.add_argument("--step", type=int, default=1)
        parser.add_argument("--neighbor-reprobe", type=int, default=0)
        parser.add_argument("--empty-threshold", type=int, default=3)
        parser.add_argument("--max-requests", type=int, default=100)
        parser.add_argument("--source", default="kill_api")
        parser.add_argument("--write", action="store_true", help="Commit cursor and reports")
        parser.add_argument('--resume', action='store_true', help='Operator-confirmed session refresh; clear pause')
        parser.add_argument('--rpc-interval', type=float, default=5)
        parser.add_argument('--rpc-budget', type=int, default=36)
        parser.add_argument('--max-seconds', type=float, default=210)

    def _policy(self, name):
        for key, label, rank in DEFAULT_CLASSES:
            ship_class, _ = ShipClass.objects.get_or_create(
                key=key, defaults={"label": label, "rank": rank}
            )
            if ship_class.rank != rank or ship_class.label != label or not ship_class.enabled:
                ship_class.rank = rank
                ship_class.label = label
                ship_class.enabled = True
                ship_class.save(update_fields=["rank", "label", "enabled"])
        allowed = [key for key, _, rank in DEFAULT_CLASSES if rank >= 4]
        if name == DEFAULT_POLICY:
            defaults = {
                "min_ship_rank": 0,
                "allowed_class_keys": [],
                "min_isk_lost": DEFAULT_MIN_ISK_LOST,
                "enabled": True,
            }
        else:
            defaults = {
                "min_ship_rank": 4,
                "allowed_class_keys": allowed,
                "enabled": True,
            }
        policy, _ = CollectionPolicy.objects.get_or_create(name=name, defaults=defaults)
        # Only repair built-in presets. A named custom policy is operator
        # configuration and must not be silently rewritten by every probe.
        if name == DEFAULT_POLICY:
            changed = []
            for field, value in (("enabled", True), ("min_ship_rank", 0), ("allowed_class_keys", []),
                                 ("min_isk_lost", DEFAULT_MIN_ISK_LOST)):
                if getattr(policy, field) != value:
                    setattr(policy, field, value)
                    changed.append(field)
            if changed:
                policy.save(update_fields=changed)
        elif name == "battleship_plus" and (
            policy.min_ship_rank != 4 or policy.allowed_class_keys != allowed
        ):
            policy.min_ship_rank = 4
            policy.allowed_class_keys = allowed
            policy.save(update_fields=["min_ship_rank", "allowed_class_keys"])
        return policy

    def _client(self, path):
        if not path:
            raise CommandError("--client is required; credentials must be injected by deployment config")
        factory = import_string(path)
        return factory() if isinstance(factory, type) else factory()

    def handle(self, *args, **options):
        # Validate all operator input before creating/updating any rows.  This
        # also guarantees a malformed dry-run never writes configuration.
        try:
            config = DiscoveryConfig(
                start_id=options["start_id"],
                step=options["step"],
                neighbor_reprobe=options["neighbor_reprobe"],
                empty_threshold=options["empty_threshold"],
                max_requests=options["max_requests"],
            )
            pacer = CollectorPacer(interval=options['rpc_interval'], max_rpcs=options['rpc_budget'],
                                   max_seconds=options['max_seconds'])
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
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
                return client
            runner = DiscoveryRunner(None, cursor=cursor, policy=policy, config=config,
                                     source=options['source'], client_factory=load_client)
            pacer.heartbeat = runner.heartbeat
            return runner.run(dry_run=dry_run, resume=options['resume'])

        try:
            if options['write']:
                run = execute()
            else:
            # Policy, cursor, run and reports all execute in a rollback-only
            # transaction.  DiscoveryRunner uses its dedicated dry-run path so
            # the normal short-transaction lease is not committed underneath.
                with transaction.atomic():
                    run = execute(dry_run=True)
                    transaction.set_rollback(True)
        finally:
            if client and hasattr(client, 'close'):
                client.close()
        mode = "committed" if options["write"] else "dry-run"
        self.stdout.write(
            self.style.SUCCESS(
                f"{mode}: run={run.pk} status={run.status} requests={run.request_count} "
                f"reports={run.report_count} stop={run.stop_reason}"
            )
        )
