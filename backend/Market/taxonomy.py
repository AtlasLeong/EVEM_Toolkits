"""Stable market buckets used by the public terminal and collector.

The upstream catalog has many official category/group ids.  The terminal uses
a small set of operator-facing buckets, so the
mapping lives here instead of being duplicated in the API and seed command.
"""

from __future__ import annotations

from typing import Any


BUCKET_CURRENCY = 'currency'
BUCKET_PLANETARY = 'planetary'
BUCKET_MINERALS = 'minerals'
BUCKET_INTERMEDIATE = 'intermediate'
BUCKET_COMPONENTS = 'components'
BUCKET_STRUCTURES = 'structures'
BUCKET_OTHER = 'other'

PRIMARY_BUCKETS = (
    BUCKET_CURRENCY,
    BUCKET_PLANETARY,
    BUCKET_MINERALS,
    BUCKET_INTERMEDIATE,
    BUCKET_COMPONENTS,
    BUCKET_STRUCTURES,
)
BUCKET_CHOICES = (
    (BUCKET_CURRENCY, '货币 · 伊甸币'),
    (BUCKET_PLANETARY, '行星资源'),
    (BUCKET_MINERALS, '矿物'),
    (BUCKET_INTERMEDIATE, '中间产物'),
    (BUCKET_COMPONENTS, '组件'),
    (BUCKET_STRUCTURES, '受损结构'),
    (BUCKET_OTHER, '其他'),
)
BUCKET_LABELS = dict(BUCKET_CHOICES)

EDEN_CURRENCY_ITEM_ID = 28_007_000_000
MINERAL_SUBCATEGORY_ID = 1_200_000
INTERMEDIATE_SUBCATEGORY_ID = 1_200_012
BLUEPRINT_CATEGORY_ID = 1_700
# Building components share broad building subcategories with unrelated items.
# Use exact component groups rather than one manufacturing subcategory.
COMPONENT_GROUP_NAMES = frozenset({
    '高级舰船组件-复数',
    '个人堡垒组件-复数',
    '铁壁升级组件-复数',
    '建筑基础组件-复数',
    '旗舰组件-复数',
    '无人机组件-复数',
})
STRUCTURE_ITEM_IDS = frozenset(
    base + offset
    for base in (44_000_000_000, 44_010_000_000, 44_020_000_000, 44_030_000_000)
    for offset in (4, 11, 12, 15)
)
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
    if item_id in STRUCTURE_ITEM_IDS and category_id != BLUEPRINT_CATEGORY_ID:
        return BUCKET_STRUCTURES
    if category_id != BLUEPRINT_CATEGORY_ID and category.strip() in COMPONENT_GROUP_NAMES:
        return BUCKET_COMPONENTS
    # Blueprint rows may reuse the manufacturing subcategory id, but they
    # belong to the blueprint catalogue rather than the tradeable materials.
    if subcategory_id == INTERMEDIATE_SUBCATEGORY_ID and category_id != 1700:
        return BUCKET_INTERMEDIATE
    if subcategory_id == MINERAL_SUBCATEGORY_ID or category.strip() in MINERAL_GROUP_NAMES:
        return BUCKET_MINERALS
    return BUCKET_OTHER


def bucket_label(bucket: str) -> str:
    return BUCKET_LABELS.get(bucket, BUCKET_LABELS[BUCKET_OTHER])


def is_primary_bucket(bucket: Any) -> bool:
    return bucket in PRIMARY_BUCKETS
