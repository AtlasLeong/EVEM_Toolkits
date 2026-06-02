from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='Plan',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=50, unique=True)),
                ('name', models.CharField(max_length=100)),
                ('grant_all_scripts', models.BooleanField(default=False)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'license_plan',
                'ordering': ['id'],
            },
        ),
        migrations.CreateModel(
            name='ScriptProduct',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('script_id', models.CharField(max_length=100, unique=True)),
                ('display_name', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('sort_order', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'license_script_product',
                'ordering': ['sort_order', 'id'],
            },
        ),
        migrations.CreateModel(
            name='ValidationLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=255)),
                ('pc_identifier', models.CharField(blank=True, max_length=255, null=True)),
                ('source', models.CharField(max_length=20)),
                ('is_valid', models.BooleanField(default=False)),
                ('message', models.CharField(blank=True, max_length=255, null=True)),
                ('ip_address', models.CharField(blank=True, max_length=64, null=True)),
                ('user_agent', models.CharField(blank=True, max_length=255, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'license_validation_log',
                'ordering': ['-created_at', 'id'],
            },
        ),
        migrations.CreateModel(
            name='LicenseActivationCode',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=255, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('expires_at', models.DateTimeField()),
                ('pc_identifier', models.CharField(blank=True, max_length=255, null=True)),
                ('last_used', models.DateTimeField(blank=True, null=True)),
                ('remark', models.CharField(blank=True, max_length=255, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='activation_codes', to='License.plan')),
            ],
            options={
                'db_table': 'license_activation_code',
                'ordering': ['-created_at', 'id'],
            },
        ),
        migrations.CreateModel(
            name='PlanScript',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sort_order', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='License.plan')),
                ('script', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='License.scriptproduct')),
            ],
            options={
                'db_table': 'license_plan_scripts',
                'ordering': ['sort_order', 'id'],
                'unique_together': {('plan', 'script')},
            },
        ),
        migrations.AddField(
            model_name='plan',
            name='scripts',
            field=models.ManyToManyField(related_name='plans', through='License.PlanScript', to='License.scriptproduct'),
        ),
        migrations.CreateModel(
            name='ActivationCodeExtraScript',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sort_order', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('activation_code', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='License.licenseactivationcode')),
                ('script', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='License.scriptproduct')),
            ],
            options={
                'db_table': 'license_activation_extra_scripts',
                'ordering': ['sort_order', 'id'],
                'unique_together': {('activation_code', 'script')},
            },
        ),
        migrations.AddField(
            model_name='licenseactivationcode',
            name='extra_scripts',
            field=models.ManyToManyField(related_name='extra_activation_codes', through='License.ActivationCodeExtraScript', to='License.scriptproduct'),
        ),
    ]

