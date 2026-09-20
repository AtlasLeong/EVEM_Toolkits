from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('Community', '0002_mediauploadattempt_and_more')]

    operations = [
        migrations.AddField(
            model_name='claim', name='proposed_name',
            field=models.CharField(blank=True, max_length=80, null=True),
        ),
        migrations.AddField(
            model_name='claim', name='proposed_short_name',
            field=models.CharField(blank=True, max_length=20, null=True),
        ),
    ]
