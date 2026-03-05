# This is an auto-generated Django model module.
# You'll have to do the following manually to clean this up:
#   * Rearrange models' order
#   * Make sure each model has one field with primary_key=True
#   * Make sure each ForeignKey and OneToOneField has `on_delete` set to the desired behavior
#   * Remove `managed = False` lines if you wish to allow Django to create, modify, and delete the table
# Feel free to rename the models, but don't rename db_table values or field names.
from django.db import models


# 行星资源表的对应模型，该表由ieve提供
class PlanetResource(models.Model):
    p_id = models.CharField(max_length=255, blank=True, null=True)
    p_region = models.ForeignKey('Region', models.DO_NOTHING, blank=True, null=True, db_comment='星域id')
    p_constellation = models.ForeignKey('Constellation', models.DO_NOTHING, blank=True, null=True, db_comment='星座id')
    p_solarsystem = models.ForeignKey('Solarsystem', models.DO_NOTHING, db_column='p_solarSystem_id', blank=True,
                                      null=True, db_comment='星系id')  # Field name made lowercase.
    p_type = models.CharField(max_length=30, blank=True, null=True, db_comment='星球类型')
    p_title = models.CharField(max_length=30, blank=True, null=True, db_comment='星球编号')
    p_desc = models.CharField(max_length=255, blank=True, null=True, db_comment='星球描述')
    p_gz = models.CharField(max_length=50, blank=True, null=True, db_comment='光泽合金产出等级')
    p_gz_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='光泽合金产量')
    p_gc = models.CharField(max_length=50, blank=True, null=True, db_comment='光彩合金产出等级')
    p_gc_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='光彩合金产量')
    p_sg = models.CharField(max_length=50, blank=True, null=True, db_comment='闪光合金产出等级')
    p_sg_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='闪光合金产量')
    p_ns = models.CharField(max_length=50, blank=True, null=True, db_comment='浓缩合金产出等级')
    p_ns_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='浓缩合金产量')
    p_jm = models.CharField(max_length=50, blank=True, null=True, db_comment='精密合金产出等级')
    p_jm_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='精密合金产量')
    p_zs = models.CharField(max_length=50, blank=True, null=True, db_comment='杂色复合物产出等级')
    p_zs_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='杂色复合物产量')
    p_xw = models.CharField(max_length=50, blank=True, null=True, db_comment='纤维复合物产出等级')
    p_xw_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='纤维复合物产量')
    p_tg = models.CharField(max_length=50, blank=True, null=True, db_comment='透光复合物产出等级')
    p_tg_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='透光复合物产量')
    p_dy = models.CharField(max_length=50, blank=True, null=True, db_comment='多样复合物产出等级')
    p_dy_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='多样复合物产量')
    p_gh = models.CharField(max_length=50, blank=True, null=True, db_comment='光滑复合物产出等级')
    p_gh_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='光滑复合物产量')
    p_jt = models.CharField(max_length=50, blank=True, null=True, db_comment='晶体复合物产出等级')
    p_jt_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='晶体复合物产量')
    p_ah = models.CharField(max_length=50, blank=True, null=True, db_comment='黑暗合金产出等级')
    p_ah_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='黑暗合金产量')
    p_hxqt = models.CharField(max_length=50, blank=True, null=True, db_comment='活性气体产出等级')
    p_hxqt_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='活性气体产量')
    p_xyqt = models.CharField(max_length=50, blank=True, null=True, db_comment='稀有气体产出等级')
    p_xyqt_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='稀有气体产量')
    p_jc = models.CharField(max_length=50, blank=True, null=True, db_comment='基础金属产出等级')
    p_jc_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='基础金属产量')
    p_zhong = models.CharField(max_length=50, blank=True, null=True, db_comment='重金属产出等级')
    p_zhong_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='重金属产量')
    p_gjs = models.CharField(max_length=50, blank=True, null=True, db_comment='贵金属产出等级')
    p_gjs_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='贵金属产量')
    p_fy = models.CharField(max_length=50, blank=True, null=True, db_comment='反应金属产出等级')
    p_fy_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='反应金属产量')
    p_yd = models.CharField(max_length=50, blank=True, null=True, db_comment='有毒金属产出等级')
    p_yd_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='有毒金属产量')
    p_gyxw = models.CharField(max_length=50, blank=True, null=True, db_comment='工业纤维产出等级')
    p_gyxw_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='工业纤维产量')
    p_cqlsl = models.CharField(max_length=50, blank=True, null=True, db_comment='超张力塑料产出等级')
    p_cqlsl_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='超张力塑料产量')
    p_jfxa = models.CharField(max_length=50, blank=True, null=True, db_comment='聚芳酰胺产出等级')
    p_jfxa_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='聚芳酰胺产量')
    p_lqj = models.CharField(max_length=50, blank=True, null=True, db_comment='冷却剂产出等级')
    p_lqj_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='冷却剂产量')
    p_nsy = models.CharField(max_length=50, blank=True, null=True, db_comment='凝缩液产出等级')
    p_nsy_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='凝缩液产量')
    p_jzmk = models.CharField(max_length=50, blank=True, null=True, db_comment='建筑模块产出等级')
    p_jzmk_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='建筑模块产量')
    p_nmt = models.CharField(max_length=50, blank=True, null=True, db_comment='纳米体产出等级')
    p_nmt_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='纳米体产量')
    p_gjgzc = models.CharField(max_length=50, blank=True, null=True, db_comment='硅结构铸材产出等级')
    p_gjgzc_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='硅结构铸材产量')
    p_lqdy = models.CharField(max_length=50, blank=True, null=True, db_comment='灵巧建筑模块产出等级')
    p_lqdy_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='灵巧建筑模块产量')
    p_zhongshui = models.CharField(max_length=50, blank=True, null=True, db_comment='重水产出等级')
    p_zhongshui_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='重水产量')
    p_xfdlz = models.CharField(max_length=50, blank=True, null=True, db_comment='悬浮等离子产出等级')
    p_xfdlz_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='悬浮等离子产量')
    p_yhcy = models.CharField(max_length=50, blank=True, null=True, db_comment='液化臭氧产出等级')
    p_yhcy_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='液化臭氧产量')
    p_lzry = models.CharField(max_length=50, blank=True, null=True, db_comment='离子溶液产出等级')
    p_lzry_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='离子溶液产量')
    p_twsrl = models.CharField(max_length=50, blank=True, null=True, db_comment='同位素燃料产出等级')
    p_twsrl_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='同位素燃料产量')
    p_dlztt = models.CharField(max_length=50, blank=True, null=True, db_comment='等离子体团产出等级')
    p_dlztt_cnt = models.CharField(max_length=50, blank=True, null=True, db_comment='等离子体团产量')
    p_creationdate = models.CharField(db_column='p_creationDate', max_length=100, blank=True, null=True,
                                      db_comment='创建日期')  # Field name made lowercase.
    p_creationuser_id = models.CharField(db_column='p_creationUser_id', max_length=100, blank=True, null=True,
                                         db_comment='创建者id')  # Field name made lowercase.
    p_updatedate = models.CharField(db_column='p_updateDate', max_length=255, blank=True, null=True,
                                    db_comment='更新日期')  # Field name made lowercase.
    p_updateuser_id = models.CharField(db_column='p_updateUser_id', max_length=100, blank=True, null=True,
                                       db_comment='更新者id')  # Field name made lowercase.
    p_sortorder = models.CharField(db_column='p_sortOrder', max_length=20, blank=True,
                                   null=True)  # Field name made lowercase.

    class Meta:
        managed = False
        db_table = 'planet_resource'


# 星域表模型
class Region(models.Model):
    r_id = models.CharField(primary_key=True, max_length=255, db_comment='星域ID')
    r_title = models.CharField(max_length=255, blank=True, null=True, db_comment='星域名称')
    r_titleen = models.CharField(db_column='r_titleEn', max_length=255, blank=True, null=True,
                                 db_comment='星域英文名称')  # Field name made lowercase.
    r_desc = models.CharField(max_length=800, blank=True, null=True, db_comment='星域描述')
    r_safetylvl = models.CharField(db_column='r_safetyLvl', max_length=255, blank=True, null=True,
                                   db_comment='星域安等')  # Field name made lowercase.
    r_creationdate = models.CharField(db_column='r_creationDate', max_length=255, blank=True,
                                      null=True)  # Field name made lowercase.
    r_creationuser_id = models.CharField(db_column='r_creationUser_id', max_length=255, blank=True,
                                         null=True)  # Field name made lowercase.
    r_updatedate = models.CharField(db_column='r_updateDate', max_length=255, blank=True,
                                    null=True)  # Field name made lowercase.
    r_updateuser_id = models.CharField(db_column='r_updateUser_id', max_length=255, blank=True,
                                       null=True)  # Field name made lowercase.
    r_sortorder = models.CharField(db_column='r_sortOrder', max_length=255, blank=True,
                                   null=True)  # Field name made lowercase.

    class Meta:
        managed = False
        db_table = 'region'
        db_table_comment = '星域表'


# 星系表模型
class Constellation(models.Model):
    co_id = models.CharField(primary_key=True, max_length=255, db_comment='星座ID')
    co_region = models.ForeignKey(Region, models.DO_NOTHING, blank=True, null=True, db_comment='所属星域ID')
    co_title = models.CharField(max_length=255, blank=True, null=True, db_comment='星座名称')
    co_titleen = models.CharField(db_column='co_titleEn', max_length=255, blank=True, null=True,
                                  db_comment='星座英文名称')  # Field name made lowercase.
    co_desc = models.CharField(max_length=800, blank=True, null=True, db_comment='星座描述')
    co_safetylvl = models.CharField(db_column='co_safetyLvl', max_length=255, blank=True, null=True,
                                    db_comment='星座安等')  # Field name made lowercase.
    co_creationdate = models.CharField(db_column='co_creationDate', max_length=255, blank=True,
                                       null=True)  # Field name made lowercase.
    co_creationuser_id = models.CharField(db_column='co_creationUser_id', max_length=255, blank=True,
                                          null=True)  # Field name made lowercase.
    co_updatedate = models.CharField(db_column='co_updateDate', max_length=255, blank=True,
                                     null=True)  # Field name made lowercase.
    co_updateuser_id = models.CharField(db_column='co_updateUser_id', max_length=255, blank=True,
                                        null=True)  # Field name made lowercase.
    co_sortorder = models.CharField(db_column='co_sortOrder', max_length=255, blank=True,
                                    null=True)  # Field name made lowercase.

    class Meta:
        managed = False
        db_table = 'constellation'
        db_table_comment = '星座表'


# 星座表模型
class Solarsystem(models.Model):
    ss_id = models.CharField(primary_key=True, max_length=255, db_comment='星系ID')
    ss_region = models.ForeignKey(Region, models.DO_NOTHING, blank=True, null=True, db_comment='所属星域ID')
    ss_constellation = models.ForeignKey(Constellation, models.DO_NOTHING, blank=True, null=True,
                                         db_comment='所属星座ID')
    ss_title = models.CharField(max_length=255, blank=True, null=True, db_comment='星系名称')
    ss_titleen = models.CharField(db_column='ss_titleEn', max_length=255, blank=True, null=True,
                                  db_comment='星系英文名称')  # Field name made lowercase.
    ss_desc = models.CharField(max_length=800, blank=True, null=True, db_comment='星系描述')
    ss_safetylvl = models.CharField(db_column='ss_safetyLvl', max_length=255, blank=True, null=True,
                                    db_comment='星系安等')  # Field name made lowercase.
    ss_creationdate = models.CharField(db_column='ss_creationDate', max_length=255, blank=True,
                                       null=True)  # Field name made lowercase.
    ss_creationuser_id = models.CharField(db_column='ss_creationUser_id', max_length=255, blank=True,
                                          null=True)  # Field name made lowercase.
    ss_updatedate = models.CharField(db_column='ss_updateDate', max_length=255, blank=True,
                                     null=True)  # Field name made lowercase.
    ss_updateuser_id = models.CharField(db_column='ss_updateUser_id', max_length=255, blank=True,
                                        null=True)  # Field name made lowercase.
    ss_sortorder = models.CharField(db_column='ss_sortOrder', max_length=255, blank=True,
                                    null=True)  # Field name made lowercase.
    ss_cntstation = models.CharField(db_column='ss_cntStation', max_length=255, blank=True,
                                     null=True)  # Field name made lowercase.
    ss_ismarket = models.CharField(db_column='ss_isMarket', max_length=255, blank=True,
                                   null=True)  # Field name made lowercase.

    class Meta:
        managed = False
        db_table = 'solarsystem'
        db_table_comment = '星座表'


# 行星价格表模型
class PlResourcePrice(models.Model):
    resource_name = models.CharField(max_length=50, blank=True, null=True)
    resource_type = models.CharField(max_length=50, blank=True, null=True)
    resource_price = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'pl_resource_price'


# 提前存储搜索的行星资源表模型，用于只搜索星域或只搜索行星资源时使用
class PreSearchPlanetary(models.Model):
    region = models.ForeignKey('Region', models.DO_NOTHING, blank=True, null=True)
    region_ps_name = models.CharField(db_column='region', max_length=255, blank=True,
                                      null=True)  # Field renamed because of name conflict.
    region_security = models.CharField(max_length=255, blank=True, null=True)
    constellation = models.ForeignKey('Constellation', models.DO_NOTHING, blank=True, null=True)
    constellation_ps_name = models.CharField(db_column='constellation', max_length=255, blank=True,
                                             null=True)  # Field renamed because of name conflict.
    constellation_security = models.CharField(max_length=255, blank=True, null=True)
    solar_system = models.ForeignKey('Solarsystem', models.DO_NOTHING, blank=True, null=True)
    solar_system_ps_name = models.CharField(db_column='solar_system', max_length=255, blank=True,
                                            null=True)  # Field renamed because of name conflict.
    solar_system_security = models.CharField(max_length=255, blank=True, null=True)
    planet_id = models.CharField(max_length=15, blank=True, null=True)
    icon = models.CharField(max_length=255, blank=True, null=True)
    resource_name = models.CharField(max_length=255, blank=True, null=True)
    resource_yield = models.FloatField(blank=True, null=True)
    resource_level = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'pre_search_planetary'


# 用户保存行星资源方案表模型
class PlanetaryProgramme(models.Model):
    programme_id = models.AutoField(primary_key=True)
    user_id = models.BigIntegerField(blank=True, null=True)
    user_name = models.CharField(max_length=255, blank=True, null=True)
    programme_name = models.CharField(max_length=255, blank=True, null=True)
    programme_desc = models.CharField(max_length=255, blank=True, null=True)
    programme_element = models.JSONField(blank=True, null=True)
    create_time = models.DateTimeField(blank=True, null=True)
    last_update_time = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'planetary_programme'


class UserPrePrice(models.Model):
    user_id = models.IntegerField(blank=True, null=True)
    user_name = models.CharField(max_length=100, blank=True, null=True)
    pre_price_element = models.JSONField(blank=True, null=True)
    last_update = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'user_pre_price'
