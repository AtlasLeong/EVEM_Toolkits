"""Persist recovery state without requiring new columns from older writers."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('Market', '0010_unplanned_item_limit_null')]

    operations = [
        migrations.AddField(
            model_name='marketconfig',
            name='batch_recovery_success_count',
            field=models.PositiveSmallIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='marketconfig',
            name='batch_recovery_probe_attempted',
            field=models.BooleanField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='marketconfig',
            name='batch_recovery_success_at_ms',
            field=models.BigIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='collectionrun',
            name='batch_recovery_probe',
            field=models.BooleanField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='marketitem',
            name='manufacturing_coverage_seeded',
            field=models.BooleanField(null=True, blank=True),
        ),
    ]
