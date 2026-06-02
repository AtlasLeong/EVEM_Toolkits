"""授权系统内置脚本与套餐初始清单。"""

DEFAULT_PLAN_CODE = 'default'
VIP_PLAN_CODE = 'vip'

SCRIPT_CATALOG = (
    ('ai_full_auto', '全自动际遇与AI', 10),
    ('ai_escape', '00地区自动挂AI', 20),
    ('ai_semi_escape', '00地区手动出站挂AI', 30),
    ('ai_enhance_991', '00地区自动挂AI-无人机增强', 40),
    ('dreadnoughts_pve', '无畏自动蹲地(不回站)', 50),
    ('task_receiver', '自动接取际遇任务', 60),
    ('lock_fire_991', '自动锁定并开火 991', 70),
    ('system_monitor', '星系监控-观察者', 80),
    ('ai_judge_991', '00地区AI警戒-991', 90),
    ('big_mining', '大鱼自动挖矿回站', 100),
)

# 当前按 AT_Simulation 打包器里的默认可见脚本初始化默认组。
DEFAULT_PLAN_SCRIPT_IDS = (
    'ai_escape',
    'ai_semi_escape',
    'task_receiver',
    'system_monitor',
    'big_mining',
)

