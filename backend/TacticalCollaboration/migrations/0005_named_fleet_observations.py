import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('TacticalCollaboration', '0004_report_report_kind')]
    operations = [
        migrations.AlterField(
            model_name='report', name='report_kind',
            field=models.CharField(max_length=16, default='fleet', choices=[
                ('fleet', 'Fleet'), ('system_count', 'System enemy count'),
                ('fleet_intel', 'Named fleet observation'),
            ]),
        ),
        migrations.AddField(
            model_name='report', name='fleet_name',
            field=models.CharField(max_length=80, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='report', name='linked_force',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='observations', to='TacticalCollaboration.force'),
        ),
        migrations.AddField(
            model_name='force', name='source_report',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='+', to='TacticalCollaboration.report'),
        ),
    ]
