import pandas as pd
from sqlalchemy import create_engine

RESOURCE_FIELD_MAP = {
    "光泽合金": {
        "level": "p_gz",
        "cnt": "p_gz_cnt"
    },
    "光彩合金": {
        "level": "p_gc",
        "cnt": "p_gc_cnt"
    },
    "闪光合金": {
        "level": "p_sg",
        "cnt": "p_sg_cnt"
    },
    "浓缩合金": {
        "level": "p_ns",
        "cnt": "p_ns_cnt"
    },
    "精密合金": {
        "level": "p_jm",
        "cnt": "p_jm_cnt"
    },

    "杂色复合物": {
        "level": "p_zs",
        "cnt": "p_zs_cnt"
    },

    "纤维复合物": {
        "level": "p_xw",
        "cnt": "p_xw_cnt"
    },
    "透光复合物": {
        "level": "p_tg",
        "cnt": "p_tg_cnt"
    },

    "多样复合物": {
        "level": "p_dy",
        "cnt": "p_dy_cnt"
    },

    "光滑复合物": {
        "level": "p_gh",
        "cnt": "p_gh_cnt"
    },

    "晶体复合物": {
        "level": "p_jt",
        "cnt": "p_jt_cnt"
    },
    "黑暗复合物": {
        "level": "p_ah",
        "cnt": "p_ah_cnt"
    },
    "活性气体": {
        "level": "p_hxqt",
        "cnt": "p_hxqt_cnt"
    },
    "稀有气体": {
        "level": "p_xyqt",
        "cnt": "p_xyqt_cnt"
    },
    "重金属": {
        "level": "p_zhong",
        "cnt": "p_zhong_cnt"
    },
    "贵金属": {
        "level": "p_gjs",
        "cnt": "p_gjs_cnt"
    },
    "反应金属": {
        "level": "p_fy",
        "cnt": "p_fy_cnt"
    },
    "有毒金属": {
        "level": "p_yd",
        "cnt": "p_yd_cnt"
    },
    "工业纤维": {
        "level": "p_gyxw",
        "cnt": "p_gyxw_cnt"
    },
    "超张力塑料": {
        "level": "p_cqlsl",
        "cnt": "p_cqlsl_cnt"
    },
    "聚芳酰胺": {
        "level": "p_jfxa",
        "cnt": "p_jfxa_cnt"
    },
    "冷却剂": {
        "level": "p_lqj",
        "cnt": "p_lqj_cnt"
    },
    "凝缩液": {
        "level": "p_nsy",
        "cnt": "p_nsy_cnt"
    },
    "建筑模块": {
        "level": "p_jzmk",
        "cnt": "p_jzmk_cnt"
    },
    "基础金属": {
        "level": "p_jc",
        "cnt": "p_jc_cnt"
    },
    "纳米体": {
        "level": "p_nmt",
        "cnt": "p_nmt_cnt"
    },
    "硅结构铸材": {
        "level": "p_gjgzc",
        "cnt": "p_gjgzc_cnt"
    },
    "灵巧单元建筑模块": {
        "level": "p_lqdy",
        "cnt": "p_lqdy_cnt"
    },
    "重水": {
        "level": "p_zhongshui",
        "cnt": "p_zhongshui_cnt"
    },
    "悬浮等离子": {
        "level": "p_xfdlz",
        "cnt": "p_xfdlz_cnt"
    },
    "液化臭氧": {
        "level": "p_yhcy",
        "cnt": "p_yhcy_cnt"
    },
    "离子溶液": {
        "level": "p_lzry",
        "cnt": "p_lzry_cnt"
    },
    "同位素燃料": {
        "level": "p_twsrl",
        "cnt": "p_twsrl_cnt"
    },
    "等离子体团": {
        "level": "p_dlztt",
        "cnt": "p_dlztt_cnt"
    },
}

print(len(RESOURCE_FIELD_MAP))
# 创建SQLAlchemy连接引擎
engine = create_engine('mysql+mysqlconnector://root:Liangjialug39@3n45528l36.goho.co:41122/eve_echoes')

# 执行查询并将结果存储在DataFrame中
query = "SELECT r_id FROM region"
df = pd.read_sql(query, engine)
region_list = list(df['r_id'])


dfs = []

for resource_name in RESOURCE_FIELD_MAP:
    for i in region_list:
        query = (f"SELECT pr.p_region_id AS region_id, pr.p_constellation_id AS constellation_id, pr.p_solarSystem_id AS solar_system_id, p_title AS planet_id, "
                 f"{RESOURCE_FIELD_MAP[resource_name]['cnt']} AS resource_yield, "
                 f"{RESOURCE_FIELD_MAP[resource_name]['level']} AS resource_level, "
                 f"c.co_title AS constellation, c.co_safetyLvl AS constellation_security, "
                 f"r.r_title AS region, r.r_safetyLvl AS region_security, "
                 f"s.ss_title AS solar_system, s.ss_safetyLvl AS solar_system_security "
                 f"FROM planet_resource pr "
                 f"LEFT JOIN constellation c ON pr.p_constellation_id = c.co_id "
                 f"LEFT JOIN solarsystem s ON pr.p_solarSystem_id = s.ss_id "
                 f"LEFT JOIN region r ON pr.p_region_id = r.r_id "
                 f"WHERE pr.p_region_id = {i} AND {RESOURCE_FIELD_MAP[resource_name]['cnt']} IS NOT NULL "
                 f"ORDER BY {RESOURCE_FIELD_MAP[resource_name]['cnt']} DESC LIMIT 3"
                 )

        print(query)
        df = pd.read_sql(query, engine)
        df['resource_name'] = resource_name
        dfs.append(df)

# 使用 pd.concat() 函数将所有结果DataFrame上下拼接成一个新的DataFrame
result_df = pd.concat(dfs, ignore_index=True)
print(result_df)
result_df.to_sql("pre_search_by_planet_resource", engine, if_exists='append', index=False)
# 打印拼接后的结果DataFrame
print(result_df)



