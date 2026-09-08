"""Read-only pending-migration gate for this project's app-level database router.

Run using the candidate release's Python with cwd set to its backend directory.
Unlike migrate --check, ignore migrations explicitly excluded from this database by
the configured router. Never apply/fake migrations or update migration records.
"""
import argparse
import os
from pathlib import Path
import sys


def pending_migrations(alias):
    from django.db import connections, router
    from django.db.migrations.executor import MigrationExecutor
    executor = MigrationExecutor(connections[alias])
    if executor.loader.detect_conflicts():
        raise RuntimeError('Conflicting migration leaves; resolve before deployment')
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    return [str(migration) for migration, backwards in plan
            if backwards or router.allow_migrate(alias, migration.app_label)]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', choices=('default', 'license'), required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(Path.cwd()))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'EVE_MDjango.settings')
    import django
    django.setup()
    pending = pending_migrations(args.database)
    if pending:
        raise SystemExit('Pending migrations for ' + args.database + ': ' + ', '.join(pending))
    print(args.database + ': no pending migrations allowed by the database router')
