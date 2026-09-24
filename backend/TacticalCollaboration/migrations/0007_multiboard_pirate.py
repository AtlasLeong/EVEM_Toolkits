from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def preserve_legacy_war_boards(apps, schema_editor):
    Organization = apps.get_model('TacticalCollaboration', 'Organization')
    Board = apps.get_model('TacticalCollaboration', 'Board')
    Report = apps.get_model('TacticalCollaboration', 'Report')
    Force = apps.get_model('TacticalCollaboration', 'Force')
    db = schema_editor.connection.alias
    for organization in Organization.objects.using(db).iterator():
        board = Board.objects.using(db).create(
            organization_id=organization.pk, name='战争沙盘', kind='war', is_default=True,
            region_ids=organization.region_ids, border_hops=organization.border_hops,
            scope_version=organization.scope_version,
        )
        Report.objects.using(db).filter(organization_id=organization.pk).update(board_id=board.pk)
        Force.objects.using(db).filter(organization_id=organization.pk).update(board_id=board.pk)


class Migration(migrations.Migration):
    dependencies = [
        ('TacticalCollaboration', '0006_organization_state_version'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name='Board',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80)),
                ('kind', models.CharField(choices=[('war', 'War'), ('pirate', 'Pirate')], max_length=8)),
                ('is_default', models.BooleanField(default=False)),
                ('region_ids', models.JSONField(default=list)),
                ('border_hops', models.PositiveSmallIntegerField(default=0)),
                ('scope_version', models.PositiveIntegerField(default=1)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='boards', to='TacticalCollaboration.organization')),
            ],
        ),
        migrations.AddConstraint(
            model_name='board',
            constraint=models.UniqueConstraint(fields=('organization', 'name'), name='tactical_board_org_name_unique'),
        ),
        migrations.AddField(
            model_name='report', name='board',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to='TacticalCollaboration.board'),
        ),
        migrations.AddField(
            model_name='force', name='board',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, to='TacticalCollaboration.board'),
        ),
        migrations.RunPython(preserve_legacy_war_boards),
        migrations.CreateModel(
            name='PirateSighting',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.PositiveIntegerField(default=1)),
                ('character_name', models.CharField(max_length=120)),
                ('ship_type', models.CharField(max_length=120)),
                ('normalized_name', models.CharField(max_length=2560)),
                ('normalized_ship', models.CharField(max_length=2560)),
                ('location_kind', models.CharField(max_length=16)),
                ('location_id', models.PositiveIntegerField()),
                ('location_name', models.CharField(max_length=255)),
                ('observed_at', models.DateTimeField()),
                ('activity_start_utc', models.CharField(blank=True, max_length=5, null=True)),
                ('activity_end_utc', models.CharField(blank=True, max_length=5, null=True)),
                ('notes', models.CharField(blank=True, max_length=1000)),
                ('status', models.CharField(default='active', max_length=12)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ('board', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='sightings', to='TacticalCollaboration.board')),
            ],
        ),
        migrations.AddIndex(
            model_name='piratesighting',
            index=models.Index(fields=['board', 'author', 'status'], name='tactical_pirate_visible'),
        ),
    ]
