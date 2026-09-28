"""Run one bounded killboard discovery pass.

The command is intentionally dry-run unless ``--write`` is supplied.  A
transport client is injected with ``--client``; no credentials or packet
captures are read from the repository.
"""

from __future__ import annotations

from django.core.management import BaseCommand, CommandError
from django.db import transaction
from django.utils.module_loading import import_string

from Killboard.discovery import DiscoveryConfig, DiscoveryRunner
from Killboard.models import CollectionPolicy, ProbeCursor, ShipClass


DEFAULT_CLASSES = (
    ("battleship", "战列舰", 4),
    # Battlecruisers are below battleships for collection-policy ranking.
    ("battlecruiser", "战列巡洋舰", 3),
    ("dreadnought", "无畏舰", 6),
    ("carrier", "航母", 7),
    ("supercarrier", "超级航母", 8),
    ("titan", "泰坦", 9),
)


class Command(BaseCommand):
    help = "Probe a bounded range of kill IDs (dry-run by default)."

    def add_arguments(self, parser):
        parser.add_argument("--client", help="Dotted path to a ProbeClient factory/class")
        parser.add_argument("--cursor", default="default")
        parser.add_argument("--policy", default="battleship_plus")
        parser.add_argument("--start-id", type=int)
        parser.add_argument("--step", type=int, default=1)
        parser.add_argument("--neighbor-reprobe", type=int, default=0)
        parser.add_argument("--empty-threshold", type=int, default=3)
        parser.add_argument("--max-requests", type=int, default=100)
        parser.add_argument("--source", default="kill_api")
        parser.add_argument("--write", action="store_true", help="Commit cursor and reports")

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
        policy, _ = CollectionPolicy.objects.get_or_create(
            name=name,
            defaults={
                "min_ship_rank": 4,
                "allowed_class_keys": [key for key, _, rank in DEFAULT_CLASSES if rank >= 4],
                "enabled": True,
            },
        )
        allowed = [key for key, _, rank in DEFAULT_CLASSES if rank >= 4]
        # Only repair the built-in preset.  A named custom policy is operator
        # configuration and must not be silently rewritten by every probe.
        if name == "battleship_plus" and (
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
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        client = self._client(options["client"])
        if options["write"]:
            policy = self._policy(options["policy"])
            cursor, _ = ProbeCursor.objects.get_or_create(name=options["cursor"])
            run = DiscoveryRunner(
                client,
                cursor=cursor,
                policy=policy,
                config=config,
                source=options["source"],
            ).run()
        else:
            # Policy, cursor, run and reports all execute in a rollback-only
            # transaction.  DiscoveryRunner uses its dedicated dry-run path so
            # the normal short-transaction lease is not committed underneath.
            with transaction.atomic():
                policy = self._policy(options["policy"])
                cursor, _ = ProbeCursor.objects.get_or_create(name=options["cursor"])
                run = DiscoveryRunner(
                    client,
                    cursor=cursor,
                    policy=policy,
                    config=config,
                    source=options["source"],
                ).run(dry_run=True)
                transaction.set_rollback(True)
        mode = "committed" if options["write"] else "dry-run"
        self.stdout.write(
            self.style.SUCCESS(
                f"{mode}: run={run.pk} status={run.status} requests={run.request_count} "
                f"reports={run.report_count} stop={run.stop_reason}"
            )
        )
