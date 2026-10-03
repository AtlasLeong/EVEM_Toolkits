from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('Killboard', '0007_probeevent')]
    operations = [
        migrations.AddField(model_name='probecursor', name='strategy_state',
                            field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name='proberun', name='diagnostics',
                            field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name='probeevent', name='diagnostics',
                            field=models.JSONField(blank=True, default=dict)),
    ]
