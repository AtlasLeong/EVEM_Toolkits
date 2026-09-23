# 星海见闻一期：已确认设计

用户于 2026-09-22 确认“图文社区 + 结构化战报”，只本地实施和测试，不推送、不部署、不访问线上数据库。继续在现有隔离工作树中保留军团和战术板的未提交修改。

## 产品与界面

- 暖白、黑灰、低高度标题栏；星海见闻列表（全部/战报/趣闻/宣传）、详情、我的发布、独立编辑器、管理员审核。
- 列表搜索、分类与星域筛选、分页。详情正文/图片、双方损失、关联公开军团、分享链接。
- 战报双方名称自定义，按舰种/具体型号/损失数量录入；加行、复制、增减、清单粘贴预览确认；不要求写长文章。
- 舰船未知型号可保留未知或自填标记，已知型号使用本地 SWEET 218811 真实目录并记录版本。目录不声称当前国服完整。图片快照没有舰船美术，不造图冒充真实舰船。
- 双方损失与舰种数量由服务端重算；ISK 可选，空值表示未统计，与 0 有别。KM 仅作附件，首期无自动 OCR、无自动价格推算。
- 时间与星域/星座/星系可选，关联军团须已公开且仅表示关联，不宣称代表军团官方。
- 草稿保存、离开提醒、失败重试、按需预览、手机单列。图片沿用真实格式验证/重编码/像素与体积限制。
- 审核通过才公开。改稿不覆盖已发布版本；待审快照不可变，旧版继续显示。作者可撤回待审、重新修改；管理员可退回/通过并可隐藏已发布内容。
- 不做评论、点赞、关注、私信、视频、自动识别、装配模拟器。

## 架构、安全与本地运行

独立 Starsea app：Post / Revision / Asset / UploadAttempt，与军团内容和战术信息分开。复用 JWT 与可独立使用的图片净化函数，不让军团成员身份授予发帖特殊权限。作者拥有自己的草稿；仅 staff 审核；公开查询只读已通过版本。所有写操作验证版本，创建及上传按 request_id 幂等；输出纯文本，不接受 HTML。

独立本地设置从 CI 设置派生，绝不加载 production settings/.env；新 SQLite 和持久私有图片目录；前端独立 mode 固定回环 API。演示账号与种子仅在该设置下工作；不重置既有战术板。真实舰船快照只读打开，禁止提供原始包下载。

## API 合同（前后端并行边界）

前缀 `/api/starsea/`。分页 `{count,results}`，page_size=20。异常 `{detail}` 或字段错误；冲突 409。JSON 对象写入，拒绝未知/错误类型和超长输入。

`content`:
```
{kind:"battle"|"story"|"announcement", title:"", body:"", occurred_at:null,
 location:null|{region_id:integer,constellation_id:integer|null,solarsystem_id:integer|null},
 corporation_id:null|integer, images:[{id:integer,caption:""}],
 battle:null|{sides:[{name:"A方",isk_loss:null|decimalString,losses:[
  {ship_id:null|integer,ship_name:"",ship_class:"战列舰",quantity:1}
 ]},{name:"B方",isk_loss:null,losses:[]}]}}
```
Reads replace location with validated ID/name/security snapshot; ship rows include authoritative name/class/source_version for known IDs, and `is_custom` for self-filled IDs. Empty name with null ship_id means 未知型号. Limit 100 rows/side, quantity 1..100000, 12 images, title 120, body 20000, caption 240; ISK nonnegative decimal <= 10^15, max 2 decimals. Server ignores no arbitrary calculated totals: computes `summary={sides:[{name,total_ships,by_class:[{name,quantity}],isk_loss}]}`.

Entry shape `{id,author_name,created_at,published_at,is_listed,revision:{id,version,status,content,review_reason,updated_at},summary,corporation:null|{id,name}}`. Private entries add `published_revision_id`. Public responses never expose pending/private revision or rejection reason.

- GET `posts/?kind=&q=&region_id=&page=` / GET `posts/<id>/`: public approved only.
- POST `posts/ {request_id,content}`: authenticated create draft (blank permitted), return entry.
- GET `mine/?page=` / GET `posts/<id>/manage/`: owner or staff.
- POST `posts/<id>/draft/ {expected_revision_id,expected_version}`: owner; clone approved/rejected/withdrawn revision into fresh draft; existing draft returns same entry, pending must withdraw first.
- PATCH `posts/<id>/draft/ {expected_revision_id,expected_version,content}`: owner draft only, increments version, return entry.
- POST `posts/<id>/submit/` or `withdraw/` with expected_revision_id/version: submit validates publish requirements, withdraw returns editable draft; return entry.
- POST `posts/<id>/media/` multipart `file,request_id`: owner, return `{id,url,width,height}` (url private). GET `media/<asset_id>/`: anonymous only when referenced by visible published revision, otherwise owner/staff; private reads cache-control no-store.
- GET `capabilities/`: `{can_review:boolean}` authenticated.
- GET `reviews/?page=` / GET `reviews/<revision_id>/`: staff pending list / snapshot entry.
- POST `reviews/<revision_id>/decision/ {decision:"approve"|"reject",reason:"",expected_version}`: staff, pending only, cannot publish outdated non-working revision; return entry.
- POST `posts/<id>/visibility/ {is_listed:boolean,reason:""}`: staff hide/unhide approved publication, persist audit reason.
- GET `ships/?q=&ship_class=&page=`: `{count,results:[{id,name,ship_class,source_version}],source_version,notice}`. GET `locations/?kind=regions|constellations|systems&parent_id=&q=`: `{results:[{id,name,security}]}`. GET `corporations/?q=`: up to 30 visible published corporations `{results:[{id,name}]}`.

## 验收

真实 Django API：权限/草稿隔离/版本冲突/待审不可变/审核撤回/公开旧版不变/图片归属与清洗/限流配额/跨账号/XSS文本/未知型号/ISK空值/真实目录/地理父子关系/分页查询上界。
浏览器：三类投稿完整往返、战损表快捷操作和粘贴、目录选择、图片上传重试、离开提醒、手机布局、审核与分享。回归既有军团/战术板与导航；启动可实际登录测试的本地版本并给出账号与地址。真实 MySQL 并发和正式部署不在本次范围。
