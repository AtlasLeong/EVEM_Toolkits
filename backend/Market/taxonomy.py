"""Stable market buckets used by the public terminal and collector.

The upstream catalog has many official category/group ids.  The terminal only
needs three operator-facing buckets for the first market release, so the
mapping lives here instead of being duplicated in the API and seed command.
"""

from __future__ import annotations

from typing import Any


BUCKET_CURRENCY = 'currency'
BUCKET_PLANETARY = 'planetary'
BUCKET_MINERALS = 'minerals'
BUCKET_OTHER = 'other'

PRIMARY_BUCKETS = (BUCKET_CURRENCY, BUCKET_PLANETARY, BUCKET_MINERALS)
BUCKET_CHOICES = (
    (BUCKET_CURRENCY, '货币 · 伊甸币'),
    (BUCKET_PLANETARY, '行星资源'),
    (BUCKET_MINERALS, '矿物'),
    (BUCKET_OTHER, '其他'),
)
BUCKET_LABELS = dict(BUCKET_CHOICES)

EDEN_CURRENCY_ITEM_ID = 28_007_000_000
MINERAL_SUBCATEGORY_ID = 1_200_000
MINERAL_GROUP_NAMES = frozenset({'矿物', '矿物-复数'})

try:
    from PlanetaryResource.planetDBmap import RESOURCE_FIELD_MAP
except (ImportError, ModuleNotFoundError):  # pragma: no cover - defensive for tooling
    RESOURCE_FIELD_MAP = {}

PLANETARY_RESOURCE_NAMES = frozenset(RESOURCE_FIELD_MAP)


def classify_item(
    *,
    item_id: int | None,
    name: str = '',
    category: str = '',
    category_id: int | None = None,
    subcategory_id: int | None = None,
) -> str:
    """Return the operator-facing bucket for one catalog row.

    Classification deliberately prefers stable item ids/names over the broad
    upstream category id.  Planetary materials and minerals currently share
    the same upstream category, so using ``category_id`` alone would merge the
    two groups.
    """

    if item_id == EDEN_CURRENCY_ITEM_ID or name.strip() == '伊甸币':
        return BUCKET_CURRENCY
    if name.strip() in PLANETARY_RESOURCE_NAMES:
        return BUCKET_PLANETARY
    if subcategory_id == MINERAL_SUBCATEGORY_ID or category.strip() in MINERAL_GROUP_NAMES:
        return BUCKET_MINERALS
    return BUCKET_OTHER


def bucket_label(bucket: str) -> str:
    return BUCKET_LABELS.get(bucket, BUCKET_LABELS[BUCKET_OTHER])


def is_primary_bucket(bucket: Any) -> bool:
    return bucket in PRIMARY_BUCKETS
