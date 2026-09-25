from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Market', '0005_marketitem_market_bucket'),
    ]

    operations = [
        migrations.AddField(
            model_name='pricesnapshot',
            name='buy_prices',
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name='pricesnapshot',
            name='sell_prices',
            field=models.JSONField(default=list),
        ),
    ]
