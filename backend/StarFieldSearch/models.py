# This is an auto-generated Django model module.
# You'll have to do the following manually to clean this up:
#   * Rearrange models' order
#   * Make sure each model has one field with primary_key=True
#   * Make sure each ForeignKey and OneToOneField has `on_delete` set to the desired behavior
#   * Remove `managed = False` lines if you wish to allow Django to create, modify, and delete the table
# Feel free to rename the models, but don't rename db_table values or field names.
from django.db import models


# 星域表模型
class Region(models.Model):
    r_id = models.CharField(primary_key=True, max_length=255, db_comment='星域ID')
    r_title = models.CharField(max_length=255, blank=True, null=True, db_comment='星域名称')
    r_titleen = models.CharField(db_column='r_titleEn', max_length=255, blank=True, null=True, db_comment='星域英文名称')
    r_desc = models.CharField(max_length=800, blank=True, null=True, db_comment='星域描述')
    r_safetylvl = models.CharField(db_column='r_safetyLvl', max_length=255, blank=True, null=True, db_comment='星域安等')
    r_creationdate = models.CharField(db_column='r_creationDate', max_length=255, blank=True, null=True)
    r_creationuser_id = models.CharField(db_column='r_creationUser_id', max_length=255, blank=True, null=True)
    r_updatedate = models.CharField(db_column='r_updateDate', max_length=255, blank=True, null=True)
    r_updateuser_id = models.CharField(db_column='r_updateUser_id', max_length=255, blank=True, null=True)
    r_sortorder = models.CharField(db_column='r_sortOrder', max_length=255, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'region'
        db_table_comment = '星域表'


# 星系表模型
class Constellation(models.Model):
    co_id = models.CharField(primary_key=True, max_length=255, db_comment='星座ID')
    co_region = models.ForeignKey(Region, models.DO_NOTHING, blank=True, null=True, db_comment='所属星域ID')
    co_title = models.CharField(max_length=255, blank=True, null=True, db_comment='星座名称')
    co_titleen = models.CharField(db_column='co_titleEn', max_length=255, blank=True, null=True, db_comment='星座英文名称')
    co_region_title = models.CharField(max_length=80, blank=True, null=True)
    co_desc = models.CharField(max_length=800, blank=True, null=True, db_comment='星座描述')
    co_safetylvl = models.CharField(db_column='co_safetyLvl', max_length=255, blank=True, null=True, db_comment='星座安等')
    co_creationdate = models.CharField(db_column='co_creationDate', max_length=255, blank=True, null=True)
    co_creationuser_id = models.CharField(db_column='co_creationUser_id', max_length=255, blank=True, null=True)
    co_updatedate = models.CharField(db_column='co_updateDate', max_length=255, blank=True, null=True)
    co_updateuser_id = models.CharField(db_column='co_updateUser_id', max_length=255, blank=True, null=True)
    co_sortorder = models.CharField(db_column='co_sortOrder', max_length=255, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'constellation'
        db_table_comment = '星座表'


# 星座表模型
class Solarsystem(models.Model):
    ss_id = models.CharField(primary_key=True, max_length=255, db_comment='星系ID')
    ss_region = models.ForeignKey(Region, models.DO_NOTHING, blank=True, null=True, db_comment='所属星域ID')
    ss_constellation = models.ForeignKey(Constellation, models.DO_NOTHING, blank=True, null=True, db_comment='所属星座ID')
    ss_title = models.CharField(max_length=255, blank=True, null=True, db_comment='星系名称')
    ss_titleen = models.CharField(db_column='ss_titleEn', max_length=255, blank=True, null=True, db_comment='星系英文名称')
    ss_desc = models.CharField(max_length=800, blank=True, null=True, db_comment='星系描述')
    ss_safetylvl = models.CharField(db_column='ss_safetyLvl', max_length=255, blank=True, null=True, db_comment='星系安等')
    ss_creationdate = models.CharField(db_column='ss_creationDate', max_length=255, blank=True, null=True)
    ss_creationuser_id = models.CharField(db_column='ss_creationUser_id', max_length=255, blank=True, null=True)
    ss_updatedate = models.CharField(db_column='ss_updateDate', max_length=255, blank=True, null=True)
    ss_updateuser_id = models.CharField(db_column='ss_updateUser_id', max_length=255, blank=True, null=True)
    ss_sortorder = models.CharField(db_column='ss_sortOrder', max_length=255, blank=True, null=True)
    ss_cntstation = models.CharField(db_column='ss_cntStation', max_length=255, blank=True, null=True)
    ss_ismarket = models.CharField(db_column='ss_isMarket', max_length=255, blank=True, null=True)
    ss_constellation_title = models.CharField(max_length=80, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'solarsystem'
        db_table_comment = '星座表'
