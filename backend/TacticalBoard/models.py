from django.db import models


# Create your models here.

class BoardConstellations(models.Model):
    constellation_id = models.IntegerField(primary_key=True)
    region = models.ForeignKey('BoardRegions', models.DO_NOTHING)
    name = models.CharField(max_length=255)
    x = models.FloatField(blank=True, null=True)
    y = models.FloatField(blank=True, null=True)
    z = models.FloatField(blank=True, null=True)
    zh_name = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'board_constellations'


class BoardRegions(models.Model):
    region_id = models.IntegerField(primary_key=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    zh_name = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'board_regions'


class BoardStargates(models.Model):
    stargate_id = models.IntegerField(primary_key=True)
    system = models.ForeignKey('BoardSystems', models.DO_NOTHING)
    name = models.CharField(max_length=255)
    type_id = models.IntegerField(blank=True, null=True)
    destination_system_id = models.IntegerField(blank=True, null=True)
    destination_stargate_id = models.IntegerField(blank=True, null=True)
    x = models.FloatField(blank=True, null=True)
    y = models.FloatField(blank=True, null=True)
    z = models.FloatField(blank=True, null=True)


    class Meta:
        managed = False
        db_table = 'board_stargates'


class BoardSystems(models.Model):
    system_id = models.IntegerField(primary_key=True)
    constellation = models.ForeignKey(BoardConstellations, models.DO_NOTHING)
    name = models.CharField(max_length=255)
    security_class = models.CharField(max_length=10, blank=True, null=True)
    security_status = models.FloatField(blank=True, null=True)
    star_id = models.IntegerField(blank=True, null=True)
    x = models.FloatField(blank=True, null=True)
    y = models.FloatField(blank=True, null=True)
    z = models.FloatField(blank=True, null=True)
    zh_name = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'board_systems'
