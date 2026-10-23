from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('Market', '0012_enable_manufacturing_leaves')]
    operations = [migrations.AddField(
        model_name='marketitem', name='collection_priority',
        field=models.BooleanField(blank=True, default=False, null=True),
    )]
