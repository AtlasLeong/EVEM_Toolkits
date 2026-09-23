from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('TacticalCollaboration', '0003_connectionlease_socket_claim_count_and_more')]
    operations = [
        migrations.AddField(
            model_name='report', name='report_kind',
            field=models.CharField(max_length=16, default='fleet',
                                   choices=[('fleet', 'Fleet'), ('system_count', 'System enemy count')]),
        ),
    ]
