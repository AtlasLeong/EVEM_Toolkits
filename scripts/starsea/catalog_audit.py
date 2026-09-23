"""Audit the pinned local ship source without downloads or database mutations.

Usage: python scripts/starsea/catalog_audit.py --db ABSOLUTE_PATH_TO_echoes.db
The CLI forcibly selects isolated CI settings, never production settings/.env.
It prints a compact JSON report and never writes or copies source data.
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from collections import Counter
from contextlib import closing
from pathlib import Path


def _digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def audit_catalog(path):
    from django.test import override_settings
    from Starsea import catalog

    path = Path(path)
    if not path.is_absolute() or str(path).startswith(('//', '\\\\')):
        raise ValueError('An absolute local source path is required.')
    path = path.resolve(strict=True)
    before = _digest(path)
    if before != catalog.PINNED_SHA256:
        raise ValueError('Source SHA-256 does not match the pinned snapshot.')
    # Reconstruct candidates independently: scan only the category range, then
    # perform Python integer-category/market membership checks rather than the
    # application SQL joins. No publication-state inference is made.
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA trusted_schema=OFF')
        version = db.execute('PRAGMA user_version').fetchone()[0]
        integrity = [row[0] for row in db.execute('PRAGMA integrity_check')]
        if version != catalog.PINNED_USER_VERSION or integrity != ['ok']:
            raise ValueError('Source version or integrity check failed.')
        category = list(db.execute('SELECT id, sourceName, nameKey, marketGroupId, published '
                                   'FROM items WHERE id >= 10000000000 AND id < 11000000000 ORDER BY id'))
        markets = {row['id'] for row in db.execute('SELECT id FROM market_group')}
        groups = {row['id']: dict(row) for row in db.execute(
            'SELECT id, localisedNameIndex, sourceName FROM "groups"')}
        candidates = [row for row in category if row['id'] // 1_000_000_000 == 10
                      and row['marketGroupId'] in markets
                      and row['marketGroupId'] // 100_000 == 1000
                      and row['id'] // 1_000_000 in groups]
        keys = {row['nameKey'] for row in candidates}
        keys.update(groups[row['id'] // 1_000_000]['localisedNameIndex'] for row in candidates)
        localized = {}
        # Batch queries support SQLite builds with the conservative 999 limit.
        ordered_keys = sorted(keys)
        for offset in range(0, len(ordered_keys), 500):
            batch = ordered_keys[offset:offset + 500]
            placeholders = ','.join('?' for _ in batch)
            localized.update({row['id']: dict(row) for row in db.execute(
                'SELECT id, source, zhcn, zh FROM localised_strings WHERE id IN (' + placeholders + ')', batch)})

    expected = []
    direct_zhcn = 0
    for row in candidates:
        names = localized.get(row['nameKey'], {})
        group = groups[row['id'] // 1_000_000]
        group_names = localized.get(group['localisedNameIndex'], {})
        name = next((value.strip() for value in
                     (names.get('zhcn'), names.get('zh'), names.get('source'), row['sourceName'])
                     if isinstance(value, str) and value.strip()), '')
        ship_class = next((value.strip() for value in
                           (group_names.get('zhcn'), group_names.get('zh'), group_names.get('source'), group['sourceName'])
                           if isinstance(value, str) and value.strip()), '')
        direct_zhcn += bool(names.get('zhcn', '').strip())
        expected.append({'id': row['id'], 'name': name, 'ship_class': ship_class,
                         'source_version': catalog.SOURCE_VERSION})

    with override_settings(STARSEA_SHIP_DB=str(path)):
        first = catalog.search_ships()
        actual = list(first['results'])
        page = 2
        while len(actual) < first['count']:
            rows = catalog.search_ships(page=page)['results']
            if not rows:
                raise ValueError('Catalog pagination ended before the reported count.')
            actual.extend(rows)
            page += 1
    if actual != expected or first['count'] != len(expected):
        raise ValueError('Application catalog differs from the independently reconstructed source.')
    after = _digest(path)
    if before != after:
        raise ValueError('Source changed during the audit.')
    name_counts = Counter(row['name'] for row in expected)
    controls = ('小鹰级', '海燕级', '巨鸟级守卫型', '乌鸦级', '马克瑞级', '凤凰级', '尼铎格尔级', '蜕升者级')
    return {
        'source_version': catalog.SOURCE_VERSION,
        'sha256': before,
        'user_version': version,
        'integrity_check': integrity,
        'category_10_count': len(category),
        'catalog_count': len(actual),
        'excluded_category_10_count': len(category) - len(actual),
        'direct_zhcn_count': direct_zhcn,
        'duplicate_names': {name: count for name, count in name_counts.items() if count > 1},
        'ship_classes': dict(sorted(Counter(row['ship_class'] for row in actual).items())),
        'published_distribution': dict(Counter(str(row['published']) for row in candidates)),
        'control_names_found': [name for name in controls if name in name_counts],
        'api_matches_source': True,
        'source_unchanged': True,
        'notice': catalog.NOTICE,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True, help='Absolute path to the existing pinned SQLite snapshot.')
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[2] / 'backend'
    sys.path.insert(0, str(backend))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'EVE_MDjango.ci_settings'
    import django
    django.setup()
    try:
        report = audit_catalog(args.db)
    except (OSError, ValueError, sqlite3.Error) as exc:
        parser.exit(1, 'Catalog audit failed: %s\n' % exc)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
