from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('TacticalCollaboration', '0005_named_fleet_observations')]
    operations = [migrations.AddField(
        model_name='organization', name='state_version',
        field=models.PositiveIntegerField(default=1),
    )]
