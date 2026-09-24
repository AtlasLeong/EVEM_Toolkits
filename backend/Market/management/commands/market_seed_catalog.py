"""Install selectable market item metadata without enabling collection."""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import models, transaction

from Market.models import MarketItem


DEFAULT_CATALOG = Path(__file__).resolve().parents[2] / 'data' / 'market_catalog.json'
KNOWN_CURRENCY = {'item_id': 28007000000, 'item_name': '伊甸币', 'market_group_name_3rd': '货币'}


def catalog_items(path, *, include_currency):
    try:
        with Path(path).open('r', encoding='utf-8') as source:
            rows = json.load(source)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CommandError('market catalog is unavailable or invalid') from exc
    if not isinstance(rows, list) or len(rows) > 10000:
        raise CommandError('market catalog must contain at most 10000 items')
    if include_currency:
        rows.append(KNOWN_CURRENCY)
    seen = set()
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise CommandError('market catalog row is invalid')
        item_id = row.get('item_id')
        name = row.get('item_name')
        category = row.get('market_group_name_3rd', '')
        category_id = row.get('category_id')
        subcategory_id = row.get('subcategory_id')
        if (
            type(item_id) is not int or not 1 <= item_id <= 2**63 - 1 or item_id in seen
            or not isinstance(name, str) or not 0 < len(name.strip()) <= 255
            or not isinstance(category, str) or len(category) > 120
            or (category_id is not None and (type(category_id) is not int or not 0 <= category_id <= 2**63 - 1))
            or (subcategory_id is not None and (type(subcategory_id) is not int or not 0 <= subcategory_id <= 2**63 - 1))
        ):
            raise CommandError('market catalog row is invalid')
        seen.add(item_id)
        result.append(MarketItem(
            id=item_id, name=name.strip(), category=category,
            category_id=category_id, subcategory_id=subcategory_id,
            scope='global', enabled=False,
        ))
    return result


class Command(BaseCommand):
    help = 'Seed disabled market catalog items; existing choices and prices are preserved.'

    def add_arguments(self, parser):
        parser.add_argument('--catalog', type=Path, default=None)

    def handle(self, *args, **options):
        custom = options['catalog']
        items = catalog_items(custom or DEFAULT_CATALOG, include_currency=custom is None)
        with transaction.atomic():
            MarketItem.objects.bulk_create(items, batch_size=500, ignore_conflicts=True)
            catalog_by_id = {item.pk: item for item in items}
            missing = MarketItem.objects.filter(pk__in=catalog_by_id).filter(
                models.Q(category_id__isnull=True) | models.Q(subcategory_id__isnull=True)
            ).only('id', 'category_id', 'subcategory_id')
            to_update = []
            for item in missing.iterator(chunk_size=500):
                catalog = catalog_by_id[item.pk]
                changed = False
                if item.category_id is None and catalog.category_id is not None:
                    item.category_id = catalog.category_id
                    changed = True
                if item.subcategory_id is None and catalog.subcategory_id is not None:
                    item.subcategory_id = catalog.subcategory_id
                    changed = True
                if changed:
                    to_update.append(item)
            if to_update:
                MarketItem.objects.bulk_update(to_update, ['category_id', 'subcategory_id'], batch_size=500)
        self.stdout.write(f'catalog processed: {len(items)}')
