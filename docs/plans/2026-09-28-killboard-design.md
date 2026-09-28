# 击毁情报板设计

## 目标

新增一个可持续扩展的 EVE 击毁情报模块：从已验证的击毁报告接口获取记录，使用连续 ID 探测逐步发现最新报告，按可配置的收录策略保留战列舰及以上目标，并在网页上提供列表、筛选、快速预览和完整详情。

## 范围与非目标

### 本期范围

- 保存击毁报告核心信息：`kill_id`、击毁时间、星系、被击毁舰船、舰船分类、损失金额、来源与采集状态。
- 保存参与者以及最后一击、最高伤害、伤害量和百分比；参与者数量只使用来源明确提供的数量，不用攻击记录条数推断。
- 保存装备明细。`d` 解释为已掉落数量，`x` 解释为已损毁数量；`c` 保留为未知字段，不参与掉落/损毁判断。
- 通过策略表配置舰船分类收录范围，初始预设为战列舰及更大型舰船，后续可添加其它舰船类型而不改表结构。
- 提供连续 ID 探测器：从游标或已知种子向前探测，遇到连续空洞后停止；遇到鉴权、限流、网络或格式错误时立即记录并停止本轮，不把异常当成“没有报告”。
- 提供只读击毁情报板 UI：全宽列表、分类/时间/星系/角色/军团筛选、行内快速预览和可分享的详情页。

### 非目标

- 本期不承诺全局最新报告的实时性；只有在来源覆盖和探测游标连续性得到验证后才可标记为“已同步”。
- 不把原始抓包文件、会话令牌、账号密码或完整未脱敏响应写入仓库、数据库公开接口或前端包。
- 不在前端根据缺失装备块推断“全部损毁”或“没有掉落”。缺少装备块只显示“装备明细未提供”。
- 不把攻击记录数量当作参与人数；攻击记录和 UI 参与者统计分别保存。

## 数据模型

新增 `Killboard` Django app，使用当前主库和现有 JWT 认证。

### `ShipClass`

- `key`：稳定机器键，例如 `frigate`、`cruiser`、`battleship`、`capital`。
- `label`：显示名。
- `rank`：从小到大排序。
- `enabled`：是否可选择。

### `CollectionPolicy`

- `name`、`enabled`、`min_ship_rank`、`allowed_class_keys`。
- 初始策略 `battleship_plus` 只包含战列舰、战列巡洋舰、无畏舰、航母、超级航母、泰坦和其它已映射的大型舰船。
- 策略用于采集保留；前端筛选不受策略限制，只筛已收录的数据。

### `KillReport`

- `kill_id`：唯一外部 ID。
- `ship_type_id`、`ship_name`、`ship_class_key`、`ship_class_label`。
- `system_id`、`system_name`。
- `victim_character_id`、`victim_name`、`victim_corporation_name`、`victim_alliance_name`。
- `kill_time_raw`、`kill_time_display`、`time_quality`（`source`/`converted`/`unknown`）。
- `isk_lost`、`participant_count`、`participant_count_source`。
- `source`、`parser_version`、`completeness`、`raw_hash`、`collected_at_ms`、`updated_at_ms`。
- 数据库唯一约束为 `kill_id`；完整度更高的后续记录可补全低完整度记录，低完整度记录不得覆盖完整字段。

### `KillParticipant`

- 外键 `report`。
- 角色、军团、联盟 ID/名称（字段缺失时允许为空）。
- `damage`、`damage_pct`、`is_final_blow`、`is_top_damage`、`source_index`。

### `KillItem`

- 外键 `report`。
- `type_id`、`name`、`slot`、`quantity_dropped`、`quantity_destroyed`、`quantity_unknown`。
- `status` 仅允许 `dropped`、`destroyed`、`mixed`、`unknown`；`c` 只能进入 `quantity_unknown`。

### `ProbeCursor` 与 `ProbeRun`

- 游标保存 `last_success_id`、`last_success_kill_time`、`consecutive_empty_count` 和 `next_probe_id`。
- 运行保存起止时间、请求数、报告数、空响应数、停止原因、错误代码和使用的策略。
- 所有探测结果分类为 `report`、`empty`、`unauthorized`、`rate_limited`、`network_error`、`malformed`，并保留最少的诊断摘要。

## 采集与探测流程

1. 从游标或管理员配置的种子开始，先以步长 1 探测邻近 ID，确认来源连续性。
2. 连续成功后允许步长指数增长（1、10、100），每次跳跃都必须用邻居回探确认；不使用不受约束的全量扫描。
3. 默认达到连续空响应阈值后停止本轮，并将最后一个成功 ID 写回游标。空响应阈值、最大请求数和单轮上限来自配置并有硬上限。
4. 每次响应先经过严格解码和大小/标签/属性数量限制，再进入领域解析器。解析失败不会写入半成品报告。
5. 用来源报告时间校验方向；时间逆序、跨度异常或 ID 跳跃过大时标记为 `needs_review`，不自动推进游标。
6. 收到鉴权、限流或网络错误时立即结束本轮，保留停止原因；下一轮从安全游标继续。
7. 通过 `CollectionPolicy` 判断是否持久化。被策略过滤的记录只记录计数，不保存完整参与者和装备明细。

## 解析规则

- 仅接受协议已验证的击毁响应包装和受限的 XML-like `kill_blob`。
- 最大响应体、最大 blob、最大标签数、最大属性数和最大递归深度均有常量限制。
- 禁止重复属性、未知危险实体和未允许的控制字符；数值字段采用明确的整数/小数解析。
- 时间原文缺少时区时保留 `kill_time_raw`，展示层明确标记时区质量，不在解析器中强行猜测。
- 参与者数量优先使用来源显式数量；没有显式数量时显示“来源未提供”，不由攻击块条数补算。
- 装备状态按 `d`/`x` 映射，`c` 显示为待核验；装备块缺失显示“装备明细未提供”。

## API

- `GET /api/killboard/reports/`：分页列表，支持 `ship_class`、`system`、`character`、`corporation`、`from`、`to`、`q`。
- `GET /api/killboard/reports/<kill_id>/`：详情、参与者、装备与数据质量标记。
- `GET /api/killboard/filters/`：返回当前已启用舰船分类和可用时间范围。
- `GET /api/killboard/status/`：只读采集状态，不暴露凭据、原始响应或账号信息。
- 管理端探测/策略接口保持单独权限，首版仅供后续后台接入；公开列表和详情必须只读。

## 前端信息架构

- 新增 `/killboard` 页面并接入 `AppShell` 导航。
- 顶部显示同步状态、最后采集时间、当前收录策略和筛选条件。
- 主区采用“列表 + 右侧快速预览”布局，列表保持完整宽度，点击行不离开页面。
- 快速预览展示舰船、时间、星系、金额、参与者摘要、装备掉落/损毁徽标和数据质量提示。
- 详情页展示完整参与者和装备表，允许未来增加其它舰船类别；不依赖固定列数。
- 保持现有深色科幻控制台风格，小外边距/边框，正文不小于 16px；加载使用局部骨架，不整页闪烁。

## 测试与验收

- 解析器单测覆盖：已知响应包装、空响应、重复属性、超长 blob、时间缺时区、`d/x/c` 状态、缺失装备块。
- 探测器单测覆盖：连续报告、连续空洞停止、跳跃回探、鉴权/限流/网络错误停止、时间逆序不推进、请求上限。
- API 单测覆盖：分页/筛选/详情、错误字段隐藏、未授权管理接口拒绝。
- 前端测试覆盖：列表筛选、行内预览、装备状态徽标、空数据与采集中状态、路由懒加载和无整页闪烁。
- 先跑新增测试，再跑后端 `manage.py test` 和前端测试/构建；使用 `git diff --check`。
- 上线前只导入脱敏/合成测试数据，生产账号和会话通过服务器密钥管理注入，不提交仓库。

