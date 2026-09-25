from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Market', '0003_marketitem_last_attempt_at_ms_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='marketitem',
            name='category_id',
            field=models.BigIntegerField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name='marketitem',
            name='subcategory_id',
            field=models.BigIntegerField(blank=True, null=True),
        ),
    ]
