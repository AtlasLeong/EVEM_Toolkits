from django.db import models


class BazaarBox(models.Model):
    id = models.IntegerField(primary_key=True, db_comment='箱子ID')
    bazaar_name = models.CharField(max_length=255, blank=True, null=True, db_comment='集市活动名称')
    box = models.CharField(max_length=128, blank=True, null=True, db_comment='幸运箱名称\r\n')
    basic_lucky = models.IntegerField(blank=True, null=True, db_comment='基础幸运值')
    chance1 = models.FloatField(blank=True, null=True, db_comment='概率1')
    carrier = models.CharField(max_length=60, blank=True, null=True, db_comment='航母幸运值')
    chance2 = models.FloatField(blank=True, null=True, db_comment='概率2')
    battleship = models.CharField(max_length=60, blank=True, null=True, db_comment='势力战列幸运值')
    chance3 = models.FloatField(blank=True, null=True, db_comment='概率3')
    plug_unit = models.CharField(max_length=60, blank=True, null=True, db_comment='旗舰插幸运值')
    chance4 = models.FloatField(blank=True, null=True, db_comment='概率4')
    field_integrate_unit = models.CharField(db_column='\r\nintegrate_unit', max_length=60, blank=True, null=True,
                                            db_comment='集成插幸运值')  # Field renamed to remove unsuitable characters.
    # Field renamed because it started with '_'.
    chance5 = models.FloatField(blank=True, null=True, db_comment='概率5')
    level4_unit = models.CharField(max_length=60, blank=True, null=True, db_comment='4级插幸运值')
    price = models.DecimalField(max_digits=20, decimal_places=2, blank=True, null=True, db_comment='价格')
    purchase_limit = models.IntegerField(blank=True, null=True, db_comment='购买限制')
    expected_value = models.FloatField(blank=True, null=True, db_comment='期望值')
    sprint = models.IntegerField(blank=True, null=True, db_comment='集市期数')
    average_expected = models.FloatField(blank=True, null=True, db_comment='平均每点期望幸运值花费红币')
    average_basic = models.FloatField(blank=True, null=True, db_comment='平均每点基础幸运值花费红币')
    picture_url = models.CharField(max_length=255, blank=True, null=True, db_comment='图片地址')
    unit = models.CharField(max_length=100, blank=True, null=True, db_comment='价格单位')

    class Meta:
        managed = False
        db_table = 'bazaar_box'
        db_table_comment = '泛星集市幸运箱数据'


class BazaarRank(models.Model):
    bazaar_name = models.CharField(max_length=255, blank=True, null=True)
    date = models.DateField(blank=True, null=True)
    rank = models.IntegerField(blank=True, null=True)
    score = models.IntegerField(blank=True, null=True)
    server = models.CharField(max_length=255)
    user_id = models.BigIntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'bazaar_rank'
        db_table_comment = '泛星集市国际服与国服排名'


class BazaarUser(models.Model):
    user_id = models.BigIntegerField(blank=True, null=True)
    user_name = models.CharField(max_length=255, blank=True, null=True)
    user_legion = models.CharField(max_length=255, blank=True, null=True)
    user_alliance = models.CharField(max_length=255, blank=True, null=True)
    rank_score1 = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'bazaar_user'
