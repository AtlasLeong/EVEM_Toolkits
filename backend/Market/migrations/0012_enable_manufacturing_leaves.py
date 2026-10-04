"""Enable the explicitly approved missing default-manufacturing purchase leaves."""

from django.db import migrations


# Fixed approval scope; do not derive a broader collection set from live recipes.
MANUFACTURING_LEAF_ITEM_IDS = (
    10100000107,
    10100000206,
    10100000307,
    10100000406,
    10100000407,
    42001000034,
    42001000035,
    50012100000,
    50012100001,
    50012100002,
    51021000100,
    51021000200,
    51021000300,
    51021000400,
    51022000100,
    51022000200,
    51022000300,
    51022000400,
)


def enable_manufacturing_leaves(apps, schema_editor):
    MarketItem = apps.get_model('Market', 'MarketItem')
    # One update records exactly which existing disabled rows this migration owns.
    # Keep names, attempt/error metadata, immutable snapshots and latest pointers.
    MarketItem.objects.using(schema_editor.connection.alias).filter(
        pk__in=MANUFACTURING_LEAF_ITEM_IDS, enabled=False,
    ).update(enabled=True, manufacturing_coverage_seeded=True)


def restore_manufacturing_leaves(apps, schema_editor):
    MarketItem = apps.get_model('Market', 'MarketItem')
    # Already-enabled rows were never marked and must stay enabled on reversal.
    MarketItem.objects.using(schema_editor.connection.alias).filter(
        pk__in=MANUFACTURING_LEAF_ITEM_IDS, manufacturing_coverage_seeded=True,
    ).update(enabled=False, manufacturing_coverage_seeded=None)


class Migration(migrations.Migration):

    dependencies = [
        ('Market', '0011_market_batch_recovery'),
    ]

    operations = [
        migrations.RunPython(
            enable_manufacturing_leaves, restore_manufacturing_leaves,
        ),
    ]
