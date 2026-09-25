from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Market', '0004_marketitem_category_ids'),
    ]

    operations = [
        migrations.AddField(
            model_name='marketitem',
            name='market_bucket',
            field=models.CharField(db_index=True, default='other', max_length=16),
        ),
    ]
