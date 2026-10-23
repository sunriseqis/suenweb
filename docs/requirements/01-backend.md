# SuenWeb 现状功能需求清单 — 后端与数据层（01-backend）

> 任务性质：只读现状分析，未修改任何源码。分析范围 = 后端与数据层。
> 代码基线：`package.json` version 1.3.0；行号对应当前仓库文件。
> 已逐行通读：`src/index.ts`(1-1526)、`src/auth.ts`、`src/ai.ts`、`src/db.ts`、`src/wallpaper.ts`、`src/fonts.ts`、`src/icons.ts`、`src/bookmark_parser.ts`、`src/types.ts`、`src/extensions.ts`（结构化阅读 186KB 内嵌产物）、`schema.sql`、`wrangler.jsonc`、`package.json`、`scripts/deploy.js`、`DEPLOY_CLOUDFLARE.md`。
> 为确认「是否有调用方」，另对 `templates/index.html`、`public/index.html`、`extension/background.js` 做只读检索（不重复分析前端/插件自身 UI 需求）。

---

## 0. 技术栈与请求链路（事实基线）

| 项 | 现状 | 证据 |
|---|---|---|
| 运行时 | Cloudflare Workers，入口 `src/index.ts`，compatibility_date 2024-11-01，nodejs_compat | `wrangler.jsonc:4-6` |
| Web 框架 | Hono 4.x + hono/cors | `package.json:22-24`、`src/index.ts:1-2,34` |
| 数据库 | Cloudflare D1，binding `DB`，库名 suenweb-db | `wrangler.jsonc:16-22` |
| AI | Workers AI，binding `AI`（可选，Env.AI?） | `wrangler.jsonc:23-25`、`src/types.ts:3` |
| 静态资产 | ./public 目录，binding `ASSETS`，not_found_handling: none | `wrangler.jsonc:11-15` |
| 定时任务 | cron 40 18 * * *（UTC）= 北京时间每天 02:40 | `wrangler.jsonc:8-10` |
| 压缩 | fflate（仅用于在线生成插件 ZIP） | `package.json:22`、`src/extensions.ts:3` |
| 构建 | npm run build = tsc --noEmit（无打包、无测试、无 lint） | `package.json:16`、`tsconfig.json` |
| 请求链路 | cors(*) → 全局中间件（D1 绑定检查 + 首次请求懒建表）→ requireAuth（按路由）→ 业务 → app.get(*) 回落 ASSETS | `src/index.ts:37-79,1483-1489` |
| 部署 | scripts/deploy.js：同步 templates/static/extension 到 public、wrangler d1 list/create、改写 wrangler.jsonc 的 database_id、d1 execute --remote --file=./schema.sql、wrangler deploy | `scripts/deploy.js:63-177` |

**路由总数：66 条**（含 1 条全局 * 静态兜底）。其中 requireAuth 保护 44 条，公开 22 条。

---

## 1. 功能需求清单（按模块）

### 模块 A — 访问认证与安全

| 编号 | 功能名 | 现状行为（用户可感知） | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| A-01 | 密码状态探测 | 打开导航页先问「是否已设置访问密码」：未设置进入初始化引导，已设置弹登录框 | `GET /api/auth/status` `src/index.ts:238-241`；`getSetting` `src/db.ts:3-10` | 表 `settings`(key=`auth_password_hash`) | 公开接口，第三方可探测实例是否启用密码（低风险） |
| A-02 | 首次设置密码 | 首次访问可设置访问密码（≥6 位）；成功后立即获得登录态，无需再登录；已设置则返回 400 「密码已设置」 | `POST /api/auth/setup` `src/index.ts:243-261` | 写 `settings.auth_password_hash`、`auth_tokens`；读 `auth_rate` | `hashPassword` `src/auth.ts:5-28`；成功后清空该 IP 失败计数（258） |
| A-03 | 登录 | 输入密码登录，成功返回 token（30 天有效），失败提示「密码错误」 | `POST /api/auth/login` `src/index.ts:263-281` | `settings`、`auth_tokens`、`auth_rate` | token 只存哈希，见 A-09 |
| A-04 | 注销 | 点退出登录后当前会话 token 失效 | `POST /api/auth/logout` `src/index.ts:283-291` | `DELETE FROM auth_tokens WHERE token_hash=?` | **缺口**：只从 Authorization: Bearer 取 token，不走 cookie 分支；而 requireAuth 支持 cookie（`auth.ts:142-147`）→ 若改用 cookie 则注销无效。当前前端只用 localStorage+Bearer（`public/index.html:162,680`），故暂未暴露 |
| A-05 | 修改密码 | 设置页改密码：校验旧密码，新密码 ≥6 位；改完后其它设备登录态全部失效，当前请求换新 token | `POST /api/auth/change-password` `src/index.ts:293-309` | `settings`、全表 `auth_tokens` | `DELETE FROM auth_tokens`（306）无 WHERE = 全端下线，属设计意图但需明确告知 |
| A-06 | 登录失败限流/锁定 | 同 IP 15 分钟内连续失败 5 次 → 锁 30 分钟，返回 429「尝试次数过多，请 X 分钟后再试」 | `src/index.ts:193-233`（常量 193-195、isLoginLocked 201-210、recordLoginFailure 212-229、clientIp 197-199） | 表 `auth_rate(ip,fails,first_fail_ms,locked_until_ms)` | 锁定期内不再累加；**无清理策略**，随攻击 IP 无限增长；该表**不在 schema.sql**（仅运行时建，见 N-03） |
| A-07 | 鉴权中间件 | 未设密码时全站免登录；设密码后所有写接口与敏感读接口需有效 token；无效/过期返回 401「未授权，请先登录」或「登录已过期或无效」 | `requireAuth` `src/auth.ts:126-163`（Bearer 与 cookie suenweb_token，137-147） | `auth_tokens`、`settings` | **兼容逻辑风险**：token 校验失败后会把 token 当**明文密码**再验一次（`auth.ts:154-159`）→ 密码本身即可当万能 Bearer |
| A-08 | 口令哈希与校验 | 密码用 PBKDF2-SHA256（100000 次迭代、16 字节随机盐、256bit），存为 pbkdf2_sha256$iters$salt$key；同时兼容旧 64 位 hex SHA-256 | `src/auth.ts:5-28,30-69`（旧格式 34-37） | 字符串格式约束 | 旧哈希登录成功后不会升级为 PBKDF2（无重哈希逻辑）→ 待确认是否保留 |
| A-09 | 访问令牌生命周期 | 登录/设密签发 24 字节随机 hex token，DB 只存 sha256(token)，过期时间 = 签发 + 30 天 | `src/auth.ts:102-123` | `auth_tokens(token_hash,created_at,expires_at)` | 无过期 token 清理任务 → 表只增不减 |
| A-10 | 跨域策略 | 任意来源可调用 API（Allow-Origin: *，允许全部方法与请求头） | `src/index.ts:37-45` | — | 鉴权走 Bearer 头而非 cookie，CSRF 风险低；但外部页面可读取全部**公开**接口数据 |

### 模块 B — 导航数据：分组与链接（核心）

| 编号 | 功能名 | 现状行为（用户可感知） | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| B-01 | 读取全部导航数据 | 首页一次拿到全部分组与全部链接并渲染（标签组/固定组、紧凑/详情/仅图标、单列/多列） | `GET /api/data` `src/index.ts:314-317`；聚合 `getAllData` `src/db.ts:41-63` | `groups_table`、`links`；返回 groups[ ] 内嵌 links[ ] | **公开接口（无鉴权）**：未设密码时全站书签对外可读；即便设了密码该接口仍匿名可读 → 需裁决 |
| B-02 | 新建分组 | 新建标签式/固定式分组，自动排到末尾，默认图标 [默认图标] | `POST /api/groups` `src/index.ts:319-339` | `groups_table(name,icon,type,sort_order)`；sort_order=MAX+1（327-328） | 无分组名唯一约束；同名分组会引发按名匹配的歧义（见 B-07/E-01） |
| B-03 | 编辑分组 | 可改组名、图标（内置 SVG/emoji）、显示模式（compact/grid/icon）、固定组单列或多列、排序号 | `PUT /api/groups/:gid` `src/index.ts:341-358` | 白名单字段（346）：name,icon,type,display_mode,layout_mode,sort_order | 逐字段单独 UPDATE（N 次往返）；返回更新后整行 |
| B-04 | 删除分组 | 删除分组，其下链接一并删除 | `DELETE /api/groups/:gid` `src/index.ts:360-370` | links.group_id 外键 ON DELETE CASCADE（`schema.sql:32`） | 依赖 D1 外键实际生效（代码未显式保障）；若不生效会留孤儿链接 → 待确认 |
| B-05 | 新建链接 | 新增书签：可给 group_id，或只给 group_name（不存在则自动建组，含 group_type）；新链接排到组末尾 | `POST /api/links` `src/index.ts:372-421`（按名建组 381-396） | `links(...)`、`groups_table`；新链接固定 synced_to_browser=0（413） | 插件右键收藏正走此接口（`extension/background.js` 中 POST /api/links） |
| B-06 | 编辑链接 | 可改标题、URL、描述、图标、图标类型、所属分组、排序 | `PUT /api/links/:lid` `src/index.ts:423-440` | 白名单字段（428） | **疑似 Bug**：改标题/URL 时**不重置 synced_to_browser=0**，插件无法感知已有链接被改，与 B-05/B-09 语义相反 |
| B-07 | 删除链接 | 删除某条书签；若该组因此变空，则连同分组一起删除 | `DELETE /api/links/:lid` `src/index.ts:442-464` | `links`、`groups_table` | **Bug 风险**：空组判定与删除**都按 group 名**（454-458），存在同名分组时会误删/漏删；notifyChange(group_deleted) 也只带 name |
| B-08 | 分组排序 | 拖拽调整分组顺序，服务端按传入 id 顺序重写 sort_order | `POST /api/reorder/groups` `src/index.ts:466-481` | db.batch（475） | 日志只记 ids，无回滚 |
| B-09 | 链接排序/跨组移动 | 拖拽调整组内顺序或拖到另一个组；被移动链接标记为待同步到浏览器 | `POST /api/reorder/links` `src/index.ts:483-502` | links.group_id,sort_order,synced_to_browser=0（494） | 只处理传入 ids，未传的链接保持不变 |
| B-10 | 写操作留痕与广播 | 每次增删改都写一条变更事件（供实时推送）与一条操作日志（供审计） | `notifyChange`/`logAction` 调用点：336-337,355-356,367,393-394,418-419,437-438,452-461,478-479,499-500,544-545；实现 `src/db.ts:19-39` | `event_log(kind,payload,created_ms)`、`operation_log(action,target,detail)` | 两者均 try/catch 吞异常（不影响主流程）；event_log 无清理机制 |

### 模块 C — 数据清理工具与审计查询

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| C-01 | 重复书签检测 | 扫描全库，按归一化 URL 聚类，列出重复组与冗余条数 | `GET /api/tools/duplicates` `src/index.ts:507-533`；归一化 `normalizeUrl` `src/db.ts:65-77`（去 www.、去尾部斜杠、host 小写） | 全表读 links JOIN groups_table | 纯 JS 聚类、全量加载；http 与 https、hash 不同会被视为不同（search 参与 key）→ 漏报 |
| C-02 | 批量删除重复 | 勾选后一次性删除 | `POST /api/tools/duplicates/delete` `src/index.ts:535-547` | DELETE ... WHERE id IN (...) | 返回的 deleted = 传入 ids 数量，与实际删除行数无关 |
| C-03 | 操作日志查看 | 设置页可看最近操作记录（默认 50 条，最多 200） | `GET /api/ops/logs` `src/index.ts:549-565` | `operation_log` | detail 解析失败静默为空对象；无分页、无按 action 过滤 |

### 模块 D — 设置与配置导入导出

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| D-01 | 读取设置 | 匿名访客只拿到 21 个公共外观/小组件设置；已登录拿到全部设置（剔除所有 auth_ 前缀） | `GET /api/settings` `src/index.ts:570-596`（公共白名单 580-586、登录分支 578） | `settings` | 白名单含 theme（581）但 PUT 禁止写（见 D-02）；未返回 llm_* 与 steamgriddb_api_key，符合预期 |
| D-02 | 保存设置 | 设置面板任何改动都 PUT 一次，服务端只接受 24 个白名单键，其余静默忽略 | `PUT /api/settings` `src/index.ts:598-617` | `settings` | **Bug**：白名单缺 theme（600-608）→ 旧键 theme 永远写不进；同时又保留 ai_provider/ai_model 但后端从不读取 → 死设置。返回恒为 ok:true，无校验反馈 |
| D-03 | 全量配置导出 | 导出 JSON（version 1）：settings（不含密码哈希）+ 分组与链接 + 自定义壁纸源 + 自定义字体 + 扩展清单 | `buildExportPayload` `src/index.ts:619-641`、`GET /api/config/export` 643-645 | settings/groups_table/links/wallpapers/fonts/ext_repo | 插件 WebDAV 备份的应用数据快照来源；wallpapers/fonts 只导 category != builtin（628-629） |
| D-04 | 全量配置导入 | 上传 version 1 JSON 覆盖式恢复：settings 逐项写入；分组与链接先清空再重建（id 全变）；壁纸/字体追加；扩展清单 upsert | `POST /api/config/import` `src/index.ts:647-747`（清空 665-666、跳过密码 658） | 同上 | **破坏性**：只校验 version，不校验结构；groups 为空数组时不清空（安全），非数组则静默跳过；导入后链接 synced_to_browser 默认 1（697）→ 不会重推浏览器 |
| D-05 | 导出为浏览器书签 | 下载标准 Netscape Bookmark HTML（文件名 suenweb_bookmarks.html），可导入任何浏览器 | `GET /api/export` `src/index.ts:952-978` | getAllData + escapeHtml/escapeAttr（`src/db.ts:79-90`） | 每条 ICON 为空串；不导出 ADD_DATE（时间元信息丢失） |

### 模块 E — 书签同步（浏览器插件 / HTML 导入）

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| E-01 | 批量导入书签 | 支持三种入口：JSON body 的 folders 数组；multipart 上传 HTML/JSON 书签文件（自动识别 Netscape HTML 或 Chrome JSON）。按文件夹名匹配或新建分组，按归一化 URL 去重，只插新增，返回 ok 与 imported 条数 | `POST /api/sync` `src/index.ts:752-823`（JSON 757-759、文件 760-767、按名建组 779-790、去重 792-812） | groups_table(is_imported=1)、links(is_imported=1, synced_to_browser=1)、sync_state | 逐条 INSERT 无 batch（N 次往返）；同名分组被合并、嵌套层级被拍平 |
| E-02 | 导入预览 | 上传书签文件后先预览文件夹列表与总条数，不写库 | `POST /api/import/preview` `src/index.ts:825-835` | `parseBookmarks` `src/bookmark_parser.ts:14-38` | 前端在 `templates/index.html:850` 调用 |
| E-03 | 书签文件解析 | 自动判别格式：含 DT/DL/DOCTYPE 走 Netscape HTML；以花括号开头且含 roots 或 checksum 走 Chrome JSON；否则报「不支持的书签文件格式」 | `src/bookmark_parser.ts:14-38`（HTML 40-92、Chrome 94-150、Chrome 时间戳 152-165） | 返回 ParsedFolder = name/icon/bookmarks(title,url,icon,add_date) | HTML 用正则逐 DT 匹配，嵌套文件夹层级丢失，书签归入最近的 H3；空文件夹被过滤（91） |
| E-04 | 同步状态面板 | 显示上次同步时间、来源、总链接/分组数、待推送条数 | `GET /api/sync/status` `src/index.ts:862-877` | `sync_state`、links.synced_to_browser | **listeners: 0 是硬编码常量**（875）→ 假字段 |
| E-05 | 插件心跳 | 插件每次同步周期上报一次，更新 last_sync_at 且来源写 plugin | `POST /api/sync/heartbeat` `src/index.ts:879-884` | `sync_state` | last_sync_from 取值不统一：E-01 写 extension（816），此处写 plugin（881） |
| E-06 | 待同步链接拉取 | 插件拉取 synced_to_browser=0 的链接，写入浏览器「其他书签/SuenWeb 同步」目录 | `GET /api/sync/pending` `src/index.ts:886-892` | links JOIN groups_table | 无分页无上限，链接多时一次全量返回 |
| E-07 | 同步确认 | 插件把已写入浏览器的链接 id 批量置 synced_to_browser=1 | `POST /api/sync/ack` `src/index.ts:894-902` | `links` | 单条 IN 更新，无条数上限 |
| E-08 | 删除已导入书签 | （设计意图）按 URL 删除一条导入来源的书签 | `DELETE /api/sync/bookmark?url=` `src/index.ts:837-860` | links(is_imported=1) | **疑似死接口**：全仓库无调用方（前端与插件均不用）；实现为读出所有 is_imported 链接逐条 normalizeUrl 比较（843-854），O(n) 全表扫描且只删第一条 |

### 模块 F — 实时变更推送

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| F-01 | SSE 事件流 | 插件建立长连接，先收 hello，之后每 5 秒推送增量变更事件（link_created/link_updated/link_deleted/group_deleted/sync_imported 等），并持续发 heartbeat 注释保活；插件据此触发自动 WebDAV 备份与重同步 | `GET /api/events/stream` `src/index.ts:904-947`（起点取 MAX(id) 906-907、setInterval 5s 917-936） | `event_log`；消费方 `extension/background.js` 的 connectSSE | **高风险**：① ReadableStream 未实现 cancel，客户端断开后 interval 不停止；② 每连接每 5s 查一次 D1；③ event_log 无 TTL/裁剪 → 无限增长，且每次 LIMIT 50 在积压时会**丢事件**；④ 需 Authorization 头，浏览器原生 EventSource 不可用，只能 fetch 流式读（插件确实如此） |

### 模块 G — 壁纸

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| G-01 | 取当前壁纸 | 页面加载询问当前该用哪张壁纸；无缓存值时当场解析一张并记住 | `GET /api/wallpaper` `src/index.ts:983-992` | wallpaper_state.current_url、settings.background_type | 公开接口；全局单例（wallpaper_state WHERE id=1）→ 假定单用户 |
| G-02 | 壁纸源列表 | 设置页展示全部壁纸源（含内置 17 个）、轮播间隔、当前索引、SteamGridDB Key 配置状态（Key 掩码前 4 后 4） | `GET /api/wallpaper/sources` `src/index.ts:994-1010`（掩码 1007） | wallpapers、wallpaper_state、settings.wallpaper_interval/background_type/steamgriddb_api_key | 公开接口回显「是否已配置 SGDB Key」（1008），轻微信息外泄 |
| G-03 | 新增壁纸源 | 自定义壁纸：填名称 + 图片 URL（source_type=url）或 Steam AppID（source_type=steamgriddb） | `POST /api/wallpaper/source` `src/index.ts:1012-1029` | wallpapers(name,url,category=custom,enabled=1,sort_order,source_type) | 无 URL 合法性校验；category 硬编码 custom |
| G-04 | 删除壁纸源 | 删除自定义源；内置源拒绝并提示「内置源不可删除」 | `DELETE /api/wallpaper/source/:sid` `src/index.ts:1031-1040` | wallpapers.category | 保护依据是 category=builtin（1036），与 source_type 无关 |
| G-05 | 启用/停用壁纸源 | 开关某个源是否参与轮播 | `PUT /api/wallpaper/source/:sid` `src/index.ts:1042-1049` | wallpapers.enabled | 只支持改 enabled，不能改名/改 URL/排序 → 能力缺口（若 UI 有编辑入口则后端不支持，待确认） |
| G-06 | 手动换壁纸 | 点下一张/上一张/随机，立即换图并持久化 | `POST /api/wallpaper/refresh` `src/index.ts:1051-1056`（direction 取 next/prev/random） | `fetchWallpaperUrl` `src/wallpaper.ts:6-65` | 轮转语义见 G-08 |
| G-07 | SteamGridDB 连通性测试 | 设置页填 Key 后可测试连接，返回成功与匹配游戏数，或 401/403/超时原因 | `POST /api/wallpaper/sgdb-test` `src/index.ts:1058-1077` | 外部 steamgriddb API v2 search/autocomplete | 用固定关键字 Cyberpunk 测试；仅测连通不落库 |
| G-08 | 壁纸解析引擎 | 按源类型逐个尝试，成功即记住索引并返回 URL：SteamGridDB 取 hero 图（优先 material/blurred/alternate，24h 内用缓存随机选）；Bing 每日图按 idx 轮转（n=8）；其它 URL 直接探测是否为图片 | `src/wallpaper.ts:6-65`（轮转 18-25、SGDB 32-42、bing 43-51、generic 52-61、bing 解析 67-96、SGDB 98-145、通用探测 147-164） | wallpapers、wallpaper_state、steamgriddb_cache(game_id,image_url,style,fetched_at)、settings.steamgriddb_api_key | ① 循环内每源都查一次 getSetting（33）；② Bing 判定靠 source.url 是否含 bing.com 硬编码（43）；③ 全部失败返回空串但索引已推进；④ 内置 17 源全失败时单请求最多 17 次外部 fetch；⑤ 非 steamgriddb 一律走通用探测，需完整 GET 才判断 |

### 模块 H — 字体

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| H-01 | 字体列表 | 设置页列出全部字体（内置 4 款中文网络字体 + 自定义），并回传当前生效的正文字体/标题字体/英文正文/代码字体/字号 | `GET /api/fonts` `src/index.ts:1082-1093` | fonts、settings.font_body/font_title/font_body_en/font_code/font_size | 公开接口 |
| H-02 | 新增自定义字体 | 填名称、font-family、CDN CSS URL、语言即可添加 | `POST /api/fonts` `src/index.ts:1095-1116` | fonts(name,family,cdn_url,language,category=custom,sort_order) | 无 URL/域名校验 |
| H-03 | 删除字体 | 删除自定义字体；内置字体拒绝 | `DELETE /api/fonts/:fid` `src/index.ts:1118-1127` | fonts.category=builtin | 无日志 |
| H-04 | 字体 CSS 代理 | 前端 link 到 /api/font-css/{id}.css：服务端实时回源 CDN CSS，把相对 url() 改写为本站 /api/font-woff?family={id}&file={name}，剥掉 local() 与 format()，缓存 1 小时 | `GET /api/font-css/:fid.css` `src/index.ts:1129-1145`；改写 `src/fonts.ts:3-13`；回源 15-24 | fonts.cdn_url；外部 fontsapi.zeoseven.com | 每次请求实时回源（无服务端缓存，只靠浏览器 1h）；回源失败返回 502 注释文本 |
| H-05 | 字体文件代理 | 前端请求字体文件时由 Workers 代理回源 woff2（family 实为字体 id，file 为文件名），缓存 1 天 | `GET /api/font-woff?family=&file=` `src/index.ts:1147-1169`；回源 `src/fonts.ts:26-38` | fonts.cdn_url | 有路径穿越防护（1150 拦截两点、正反斜杠）；Content-Type 固定 font/woff2（CDN 给 woff/ttf 会错）；参数名 family 与语义（id）不符 |

### 模块 I — 图标（favicon 代理 + 内置图标集）

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| I-01 | 站点图标代理 | 每个链接图标走 /api/icon/proxy?domain=xxx：先查 D1 缓存（7 天内），未命中则并发尝试 ① 显式 url ② https://域名/favicon.ico ③ favicon.vemetric.com ④ a.favicon.im；2.5s 超时、过滤 HTML/纯文本、要求 >60 字节；命中后 base64 落 D1 并返回（浏览器缓存 1 天）；全失败返回内置占位 SVG | `GET /api/icon/proxy` `src/index.ts:1174-1210`；核心 `proxyFavicon` `src/icons.ts:30-96`（缓存 32-44、源列表 46-52、抓取 54-73、并发 76-93）；占位图 `src/icons.ts:25-28` | `icon_cache(domain,content,content_type,source_url,updated_at)` | ① url 参数任意 → **开放代理/SSRF 面**（仅靠 content-type 与长度过滤）；② source_url 固定写第一源（86）；③ 缓存键只有 domain，不同路径图标互相覆盖；④ 判断 x-negative 但从不写负缓存（35）→ 死逻辑，失败站点每次重嗅探；⑤ btoa(String.fromCharCode(...)) 大图标有栈溢出风险（83） |
| I-02 | 强制刷新图标 | 设置页可对单个链接刷新图标：删除缓存并记日志，下次渲染重新嗅探 | `POST /api/icon/refresh` `src/index.ts:1212-1228` | icon_cache、operation_log | 只删缓存不预热；未校验 domain 归属 |
| I-03 | 内置图标集 | 图标选择器列出 104 个内置线性图标（/static/icons/{name}.svg） | `GET /api/builtin-icons` `src/index.ts:1230-1236`；清单 `src/icons.ts:1-23` | — | 已核对：清单 104 项，static/icons 与 public/static/icons 各 104 个 svg；公开接口；SVG 由静态资源直出 |

### 模块 J — 浏览器插件分发

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| J-01 | 下载 Chrome 插件（CRX） | 点下载 Chrome 插件得到 suenweb.crx（随 Worker 打包的已签名产物） | `GET /extension/download/crx` `src/index.ts:1242-1250`；`/extension/download/chrome` 1252-1260 | CRX_B64（约 46KB base64）；EXTENSION_ID = hijkkdiladajgimbobmilgmpohbdeoif（`src/extensions.ts:16`） | **重复实现**：crx 与 chrome 两条路由代码与响应完全一致 |
| J-02 | 下载 Chrome 插件源码包 | 得到 suenweb-extension-chrome.zip（manifest + background.js + popup.html/js + 4 个图标，运行时用 fflate 现场打包） | `GET /extension/download/zip` `src/index.ts:1263-1271`；打包 `createExtensionZip` `src/extensions.ts:28-48` | MANIFEST_CHROME/BACKGROUND_JS/POPUP_HTML/POPUP_JS/ICON_*_B64/ICON_SVG | 每次请求重新 zipSync（无缓存），CPU 浪费 |
| J-03 | 下载 Firefox 插件（XPI） | 得到 suenweb-firefox.xpi（MV2 清单，gecko id sunriseqis@aliyun.com） | `GET /extension/download/firefox` `src/index.ts:1274-1282`；`/extension/download/xpi` 1284-1292 | XPI_B64（约 45KB base64）、MANIFEST_FIREFOX | **重复实现**：firefox 与 xpi 完全一致 |
| J-04 | 插件构建产物内嵌 | 整个插件源码以字符串常量内嵌在 TS（186KB），文件头注明 AUTO-GENERATED，由 scripts/pack-extension.mjs 从 extension/ 目录生成 | `src/extensions.ts:1-2`；`package.json:14-15`（pack:ext / sync:ext）；源目录 extension/{background.js,popup.html,popup.js,manifest.json,manifest_firefox.json,icons/,suenweb.crx,suenweb-firefox.xpi,key.pem} | — | 技术债：源码双份（extension/ 与内嵌常量）无一致性校验；改插件须手工跑打包脚本；key.pem 私钥在工作目录内 |

### 模块 K — 浏览器扩展清单备份（ext_repo）

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| K-01 | 查询已备份扩展清单 | 设置页/插件展示「我装了哪些浏览器扩展」（按浏览器分组、名字排序） | `GET /api/extensions` `src/index.ts:1297-1310` | ext_repo(ext_id,name,version,url,browser,updated_at) | **读接口里做写操作**：每次 GET 都 DELETE 重复行并 CREATE UNIQUE INDEX（1298-1305），自愈式迁移，读放大 |
| K-02 | 上报/覆盖扩展清单 | 插件一键上报本机扩展列表；同一浏览器类型全量替换（先删该浏览器所有行再插入，最多 100 条）；未给 url 时按规则推导商店链接 | `POST /api/extensions` `src/index.ts:1312-1343`（全量替换 1317、上限 1319、URL 推导 1324-1329、db.batch 1338） | ext_repo UNIQUE(ext_id,browser) | 超过 100 条静默截断；删与插非事务；推导链接指向 crxsoso 镜像（第三方镜像站可用性风险）；name 截断 120 字符 |
| K-03 | 删除单条扩展记录 | 列表里可删除某条记录 | `DELETE /api/extensions/:eid` `src/index.ts:1345-1350` | ext_repo.id | 无日志、无变更广播（与其它写接口不对称） |

### 模块 L — AI 能力（免费 Workers AI + 自定义 LLM）

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| L-01 | AI 补全分组图标 | 对图标为空或 [默认图标] 的分组调用大模型，从 104 个内置图标中挑一个写回分组 | `POST /api/ai/suggest-icons` `src/index.ts:1355-1395`；实现 `suggestGroupIcons` `src/ai.ts:294-374` | groups_table.icon、settings.llm_*、env.AI | 请求体的 llm_* 优先于库内设置（1362-1366）；非法图标名被过滤（364）；全无效返回 502 与中文提示；成功写日志（1393） |
| L-02 | AI 生成链接描述（单条/批量） | 单条：给某条书签生成 ≤15 字中文描述并写回；批量：给所有描述为空的链接（可按分组筛选）成批生成，每批 10 条 | `POST /api/ai/describe` `src/index.ts:1397-1455`（单条 1416-1427、批量 1430-1454）；实现 `src/ai.ts:32-103,108-196` | links.description、settings.llm_*、env.AI | 逐条 UPDATE（1447-1452）N 次往返；**不重置 synced_to_browser**（描述不同步到浏览器）；批量按批内序号回填 id，依赖模型遵守约定，失败回退正则逐行 + 域名启发式 |
| L-03 | 链接可用性巡检 | 一键体检全部或选定分组链接，返回 total/working/broken 与逐条状态码与错误原因（超时/协议不支持/HTTP xxx） | `POST /api/ai/check` `src/index.ts:1457-1478`；实现 `checkLinksHealth` `src/ai.ts:379-458` | links JOIN groups_table | 名义在 /api/ai/* 下但**与 AI 无关**（命名误导）；先 HEAD 再 GET 兜底、6s 超时、8 并发分批；结果**不落库**，每次全量重跑；链接多时可能触 Workers 子请求上限（待确认） |
| L-04 | AI 供应商降级链 | 用户可感知的自动化：优先自定义 OpenAI 兼容端点 → 免费 Workers AI（llama-3.1-8b）→ 失败再试中文 Qwen1.5-7b → 都不行用内置域名启发式（GitHub/B站/知乎/V2EX/掘金/Google/Bing/百度/YouTube/X/Notion/Cloudflare 等 12 条固定文案，否则截断标题） | `src/ai.ts:43-102`（自定义 44-47、主模型 50-78、Qwen 兜底 82-98、启发式 102）、`src/ai.ts:201-224`（/chat/completions）、269-289（启发式表） | env.AI、外部自定义 LLM、settings.llm_* | 有超时保护（runWithTimeout 17-27，6s/8s/20s）；ai_provider/ai_model 设置项**完全不参与决策**；描述后处理上限 30 字（237）与提示词 15 字不一致 |

### 模块 M — 运维：健康检查、日志、变更事件、定时备份

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| M-01 | 健康检查 | /health 返回 status ok 与时间戳，且**绕过**数据库初始化中间件（不碰 D1） | `src/index.ts:188`；放行 52-55 | — | 用于探活/监控 |
| M-02 | 操作审计日志 | 所有管理写操作留痕（create/update/delete/reorder/import/backup_extensions/refresh_icon/ai_suggest_icons 等），含 action/target/detail JSON | `logAction` `src/db.ts:19-28`；调用点 336,355,367,393,418,437,452,478,499,544,744,818,1224,1340,1393 | `operation_log` | 无清理策略；异常吞掉不影响主流程 |
| M-03 | 变更事件 | 每次数据变化写事件供 SSE 推送 | `notifyChange` `src/db.ts:30-39`；kind 全集：group_created/updated/deleted、groups_reordered、link_created/updated/deleted、links_reordered、duplicates_deleted、sync_imported、extensions_backed_up | `event_log` | 无清理策略（见 F-01） |
| M-04 | 每日自动备份 | 每天 02:40（北京）导出全量配置快照：若绑定 R2（BACKUP_DB）则写 R2 并只留最近 30 份；否则写 D1 backups 表并留最近 30 行；失败仅打日志 | cron `wrangler.jsonc:9`；runBackup `src/index.ts:1498-1516`（BACKUP_KEEP=30 在 1496、R2 分支 1503-1511、D1 分支 1513-1515）；scheduled 1518-1526 | env.BACKUP_DB（R2，**wrangler.jsonc 未声明**）、表 `backups`；payload = buildExportPayload | ① BACKUP_DB 在 `types.ts:5` 声明但 wrangler 无 r2_buckets → 实际永远走 D1；② **没有任何接口能读/恢复 backups 表**（无 /api/backups）→ 备份写了但用户取不出，恢复实际依赖插件 WebDAV；③ 全库 JSON 单行写入 D1，有行大小限制风险（待确认） |

### 模块 N — 系统地基：兜底、绑定检测、数据库自举

| 编号 | 功能名 | 现状行为 | 证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| N-01 | 静态资源兜底 | 非 API 路由先交给 ASSETS 取文件，404 则返回纯文本 Not Found | `src/index.ts:1483-1489` | binding `ASSETS` | 无 history fallback（not_found_handling: none），刷新子路径会 404 |
| N-02 | D1 未绑定友好报错 | 忘记绑定数据库时 /api/* 返回 500 并给中文操作指引（去控制台加 DB 绑定） | `src/index.ts:57-68` | — | 非 API 路径不拦截 |
| N-03 | 数据库自举/迁移 | 每个 isolate 首次请求自动：① 给老库补 groups_table.layout_mode；② 建 auth_rate/backups/ext_repo 等后加表；③ 若 settings 表不存在则整套建表 + 种子（17 内置壁纸源、4 内置字体、17 默认设置） | 中间件 `src/index.ts:51-79`（_tablesEnsured 在 50）；`ensureDatabaseTables` 81-183 | 全部表 | 技术债核心：**DDL 双份**（schema.sql 与 81-183 各一份且已漂移）；迁移探测靠 SELECT 报错即 ALTER（83-91）；异常只 warn 不阻断 |

---

## 2. 数据模型（D1 / SQLite，共 15 张表）

| 表 | 定义位置 | 作用 | 主键/唯一键 |
|---|---|---|---|
| settings | `schema.sql:3-6`；运行时 `index.ts:110` | 全部键值配置（单表 K/V） | key |
| groups_table | `schema.sql:8-18`；`index.ts:111-121` | 导航分组 | id AUTOINCREMENT |
| links | `schema.sql:20-33`；`index.ts:122-135` | 导航书签 | id |
| sync_state | `schema.sql:35-39` | 单行：上次同步时间/来源 | id 固定 1 |
| auth_tokens | `schema.sql:41-45` | 登录令牌哈希 | token_hash（sha256 hex） |
| event_log | `schema.sql:47-52` | 变更事件（SSE 数据源） | id |
| operation_log | `schema.sql:54-60` | 操作审计 | id |
| wallpapers | `schema.sql:62-71` | 壁纸源（内置 17 + 自定义） | id |
| wallpaper_state | `schema.sql:73-79` | 单行：当前壁纸与索引 | id 固定 1 |
| fonts | `schema.sql:81-90` | 字体源（内置 4 + 自定义） | id |
| icon_cache | `schema.sql:92-98` | favicon base64 缓存 | domain |
| steamgriddb_cache | `schema.sql:100-106` | SGDB hero 图 URL 缓存（24h） | (game_id,image_url) |
| ext_repo | `schema.sql:108-117` | 浏览器扩展清单备份 | id + UNIQUE(ext_id,browser) |
| auth_rate | **仅** `src/index.ts:95,138` | 登录失败计数与锁定 | ip |
| backups | **仅** `src/index.ts:96,139` | D1 版每日备份快照 | id |

> [注意] auth_rate、backups **不在 schema.sql**，只由运行时 ensureDatabaseTables 创建。手工执行 schema.sql 的新库在首次请求前缺这两张表。

### 2.1 关键字段与关系

- links.group_id → groups_table.id，ON DELETE CASCADE（`schema.sql:32`，运行时同）。
- links：icon_type 默认 auto；is_imported(0/1) 表示由导入产生；synced_to_browser(0/1) 表示是否已推送或已存在于浏览器（新建=0、导入=1、ack 后=1、重排后=0）。
- groups_table：type 取 tab 或 pinned（默认 tab）；display_mode 取 compact/grid/icon；layout_mode 取 single/multi（仅 pinned 组使用，前端 `public/index.html:524-525,757`）；is_imported 同义。
- wallpapers.source_type 取 url 或 steamgriddb；category 取 builtin 或 custom（删除保护的依据）。
- fonts.category 取 builtin 或 custom；cdn_url 为 CSS 地址，woff2 由同目录相对路径推导（`fonts.ts:27-29`）。
- icon_cache.content 为 base64 文本（非 BLOB）；content_type 存在 x-negative 负缓存约定但从未写入。
- 单行表 sync_state / wallpaper_state 用 id=1 加 INSERT OR IGNORE 种子（`schema.sql:126-127`）。
- 索引：idx_links_group_id、idx_links_synced、idx_links_imported、idx_event_log_id（`schema.sql:120-123`），运行时另补 idx_ext_repo_uniq（`index.ts:1304`）。

### 2.2 种子数据（schema.sql）

- 17 个内置壁纸源：Bing 每日 + 16 个 Steam AppID（`schema.sql:154-171`）。
- 4 个内置中文字体（zeoseven CDN，`schema.sql:174-178`）。
- 17 个默认 settings（`schema.sql:130-151`）。

---

## 3. 设置项（settings key）清单

> 三个口径不一致，是重构必须收敛的点：**公开可读 21 项**（`index.ts:580-586`）、**可写 24 项**（`index.ts:600-608`）、**种子 17 项**（`schema.sql:130-151` 与 `index.ts:150` 两份还不一致）。

| key | 种子默认 | 用途（用户可感知） | 后端读取点 | 可写 | 备注 |
|---|---|---|---|---|---|
| auth_password_hash | 空串 | 访问密码哈希；空 = 无需登录 | `index.ts:239,247,267,300`；`auth.ts:128,156` | 仅 A-02/A-05 | 读设置/导出/导入均剔除 auth_ 前缀（578,623,658） |
| theme | purple | 旧版主题名 | 仅公开白名单（581） | **不可写** | **死设置**：PUT 白名单无此项；前端改用 color_scheme，CSS 仅留 legacy 注释（`static/css/style.css:410-416`） |
| color_scheme | purple | 配色方案（ocean/forest/sunset/mono/rose 等） | 前端消费 | 是 | 实际生效的主题 |
| accent_color | #7c6ff7 | 强调色 | 前端消费 | 是 | — |
| style | glass | 卡片风格 | 前端消费 | 是 | — |
| bg_solid_color | #0d0e14 | 纯色背景色 | 前端消费 | 是 | — |
| pattern | grid | 背景纹理 | 前端消费 | 是 | 后端不解析 |
| glass_intensity | 1 | 毛玻璃强度 | 前端消费 | 是 | — |
| background_type | gradient | 背景类型（渐变/壁纸/纯色） | `index.ts:990,998`（随壁纸接口返回） | 是 | — |
| wallpaper_interval | 900 | 壁纸轮播间隔（秒） | `index.ts:997,1004` | 是 | 后端只回传，定时在前端 |
| steamgriddb_api_key | 空串 | SteamGridDB API Key（明文存库） | `wallpaper.ts:33`；`index.ts:1000` | 是 | 公开接口返回掩码（1007） |
| weather_city | Beijing | 天气小组件城市 | 前端消费（天气由前端直连 wttr.in） | 是 | 后端不调天气 API |
| clock_format | 24h | 时钟 12/24 小时制 | 前端消费 | 是 | — |
| clock_size | medium | 时钟尺寸 | 前端消费 | 是 | 有种子，后端不读 |
| weather_size | medium | 天气组件尺寸 | 前端消费 | 是 | 有种子，后端不读 |
| widget_style | bar | 小组件样式 | 前端消费 | 是 | 有种子，后端不读 |
| search_engines | **无种子** | 启用的搜索引擎集合（逗号分隔） | 前端消费（默认 google,bing,baidu,duckduckgo 写在 `index.html:2293`） | 是 | 白名单有、种子无 → 新库首屏依赖前端兜底 |
| search_default | **无种子** | 默认搜索引擎 | 前端消费 | 是 | 同上 |
| font_body / font_title / font_body_en / font_code | 空串（四处种子口径不一） | 正文字体/标题字体/英文字体/代码字体（存字体标识） | `index.ts:1087-1090` | 是 | font_body_en 在 schema.sql 无种子、`index.ts:150` 四个都无 |
| font_size | 14 | 基础字号 | `index.ts:1091` | 是 | — |
| llm_url | **无种子** | 自定义 OpenAI 兼容 API 地址（Ollama/vLLM 等） | `index.ts:1359,1402` → `ai.ts:44,131,316` | 是 | 明文存库；请求体可覆盖 |
| llm_key | **无种子** | 自定义 LLM API Key（明文） | 同上 | 是 | 不在公开白名单（580-586），匿名不可见 |
| llm_model | **无种子** | 模型名；以 @cf/ 开头才被当作 Workers AI 模型 | `ai.ts:52,138,323` | 是 | 非 @cf/ 时回落 llama-3.1-8b |
| ai_provider | free | 名义上的 AI 供应商选择 | **无任何读取点** | 是 | **死设置**（仅种子 + 白名单） |
| ai_model | free-auto | 名义上的 AI 模型 | **无任何读取点** | 是 | **死设置** |

---

## 4. 第三方外部依赖（后端出网）

| # | 依赖 | 用途 | 证据 | 风险/备注 |
|---|---|---|---|---|
| 1 | Cloudflare Workers AI（binding AI）：@cf/meta/llama-3.1-8b-instruct、@cf/qwen/qwen1.5-7b-chat | 生成书签描述、推荐分组图标 | `src/ai.ts:54,84,140,325`；`wrangler.jsonc:23-25` | 依赖套餐 Neuron 配额；binding 缺失时静默降级到启发式 |
| 2 | 任意 OpenAI 兼容 /chat/completions | 用户自带 LLM | `src/ai.ts:203-215` | 明文 Key；无域名白名单（可指向内网 → SSRF 面） |
| 3 | https://cn.bing.com/HPImageArchive.aspx（内置源 idx=0 且 n=8） | Bing 每日壁纸 | `schema.sql:155`；`src/wallpaper.ts:43,73,91` | 依赖对方响应格式；拼 https://cn.bing.com 前缀 |
| 4 | https://www.steamgriddb.com/api/v2（heroes/steam/{appid}、search/autocomplete/{q}） | 游戏 hero 壁纸 | `src/wallpaper.ts:4,115`；`src/index.ts:1064` | 需用户自备 API Key；风格过滤 material/blurred/alternate |
| 5 | https://fontsapi.zeoseven.com/{id}/main/result.css 及其引用 woff2 | 4 款内置中文字体 | `schema.sql:175-178`；`src/fonts.ts:15-38` | 每次请求实时回源；对方不可用则字体 502 |
| 6 | 目标站点 /favicon.ico、favicon.vemetric.com、a.favicon.im | 站点图标抓取 | `src/icons.ts:49-51` | 第三方图标服务可用性影响命中率 |
| 7 | 任意用户填写 URL（壁纸通用源探测 GET、链接健康巡检 HEAD→GET、图标代理 url 参数） | 壁纸可用性判定、书签体检、自定义图标 | `src/wallpaper.ts:147-164`；`src/ai.ts:406-418`；`src/index.ts:1174-1210` | **出网面最大处**：三处均接受用户可控 URL 且无域名限制 |
| 8 | crxsoso.com、addons.mozilla.org、chromewebstore.google.com | 仅生成扩展商店链接字符串（不发请求） | `src/index.ts:1324-1329` | 镜像站长期可用性风险 |
| 9 | WebDAV 服务器 | 插件侧备份/恢复（**后端不参与**） | `extension/background.js`（backupToWebDAV / listBackups / restoreBackup） | 不属后端依赖，但恢复链依赖它 |
| 10 | wttr.in 天气 | 天气小组件（**前端直连，后端不参与**） | `templates/index.html` 中 wttr.in | 后端只有 weather_city 设置，无天气代理接口 |

---

## 5. 定时 / 后台任务

| # | 任务 | 触发 | 行为 | 证据 |
|---|---|---|---|---|
| 1 | 每日配置备份 | Cron 40 18 * * *（UTC）= 北京 02:40 | 导出全量配置 JSON；R2 优先（无 binding 时退化 D1 backups），保留 30 份；失败仅打日志 | `wrangler.jsonc:8-10`；`src/index.ts:1498-1526` |
| 2 | 懒初始化建表/迁移 | 每个 isolate 首个请求（/health 除外） | 建表、补列、灌种子（幂等 IF NOT EXISTS / INSERT OR IGNORE） | `src/index.ts:50-79,81-183` |
| 3 | SSE 轮询循环 | 每个活跃 SSE 连接内 | 每 5s 查 event_log 增量并推送，附心跳注释 | `src/index.ts:915-936` |
| 4 | 扩展清单自愈 | 每次 GET /api/extensions | 去重 + 建唯一索引 | `src/index.ts:1298-1305` |
| 5 | （插件侧，非后端）看门狗与自动备份 | alarms 每 5 分钟 | 重连 SSE、比对 total_links 触发 WebDAV 备份、拉 pending 链接 | `extension/background.js`（WATCHDOG_MIN=5） |

---

## 6. 已知技术债 / 重复实现 / 明显 Bug

**P0（错误行为或数据风险）**

1. **DDL 双份且已漂移**：schema.sql 与 ensureDatabaseTables（`index.ts:81-183`）各维护一套建表语句；auth_rate/backups 只在代码里；种子 settings 两处不一致（schema.sql 有 ai_provider/ai_model/font_body/font_title/font_code，`index.ts:150` 没有）。
2. **按名字识别分组**：groups_table 无 UNIQUE(name)，但 B-07（空组删除）、B-05（按名建组）、E-01（导入匹配组）全按 name 处理 → 同名分组误删/串数据。
3. **PUT /api/links/:lid 不重置 synced_to_browser**（`index.ts:428-432`），与 B-05/B-09 语义相反 → 插件不同步被修改的链接。
4. **POST /api/auth/logout 只认 Bearer**（`index.ts:284-289`），而 requireAuth 允许 cookie 鉴权 → cookie 登录态无法注销（当前前端未用 cookie，属潜在坑）。
5. **token 等于密码的兼容分支**（`auth.ts:154-159`）：知道密码即可当万能 Bearer 调用 API，且注销对密码路径无效。
6. **SSE 泄漏与事件丢失**：ReadableStream 未实现 cancel，setInterval 无法清除（`index.ts:909-938`）；event_log 无 TTL，表无限增长，且 LIMIT 50 在积压时丢事件。
7. **备份不可恢复**：backups 表只写不读，无 /api/backups；R2 binding 未配置（wrangler.jsonc 无 r2_buckets，`types.ts:5` 有类型）→ M-04 实际退化为 D1 单行 JSON。
8. **/api/icon/proxy 是开放抓取代理**（`index.ts:1174-1210` + `icons.ts:54-73`）：url 可控、无域名白名单，仅靠 content-type 与长度过滤；同类问题见 llm_url（`ai.ts:203`）与壁纸通用源（`wallpaper.ts:147`）。

**P1（功能残缺 / 明显浪费 / 一致性差）**

9. 设置白名单三处不一致（见第 3 节）：theme 可读不可写；ai_provider/ai_model 可写但无读取；search_engines/search_default/llm_* 无种子；font_body_en 种子缺失。
10. **死接口** DELETE /api/sync/bookmark（`index.ts:837-860`）：全仓库无调用方，实现为全表读出逐条比较。
11. **重复路由**：/extension/download/crx 与 /chrome 相同（1242-1260）；/firefox 与 /xpi 相同（1274-1292）。
12. **读接口写库**：GET /api/extensions 每次执行 DELETE 与 CREATE INDEX（1298-1305）。
13. **无事务的先删后插**：POST /api/extensions（1317-1338）、POST /api/config/import（665-666 清空后逐条插入）。
14. **N 次数据库往返**：白名单字段逐字段 UPDATE（`index.ts:346-350,428-432`）、导入逐条 INSERT（668-703,774-814）、AI 描述逐条 UPDATE（1447-1452）、/api/sync 逐条 INSERT（807-810）→ 应改 batch 或单条 SQL。
15. **全量加载无分页**：getAllData（`db.ts:41-63`）被 /api/data、/api/export、/api/config/export、每日备份共用；/api/sync/pending、/api/ai/check、/api/tools/duplicates 也全量。
16. **listeners 硬编码 0**（`index.ts:875`）；last_sync_from 取值不统一（extension 与 plugin，816 与 881）。
17. **icon_cache 负缓存是死逻辑**（`icons.ts:35` 判断 x-negative 但全代码不写入）；source_url 记错源（86）；btoa 展开大数组有栈风险（83）。
18. **extensions.ts 186KB 内嵌产物**（46KB CRX + 45KB XPI + 图标 base64 + 插件源码字符串），需手工跑 scripts/pack-extension.mjs 再部署，与 extension/ 源目录无一致性校验；EXTENSION_ID 被 import 但**未使用**（`index.ts:32`）；extension/key.pem 私钥在目录内。
19. **AI 命名与结构混乱**：POST /api/ai/check 实为链接健康检查（与 AI 无关）；AIConfig 三字段与 ai_provider/ai_model 表达同一意图却互不相干；提示词要求 15 字而后处理上限 30 字（`ai.ts:237`）。
20. **单例全局状态**：wallpaper_state / sync_state 固定 id=1，多端共享同一当前壁纸（自托管单用户可接受，但重构需明确）。
21. **无清理策略的表**：event_log、operation_log、auth_rate、auth_tokens（过期 token）、icon_cache（只过滤不删除）→ 长期运行持续累积。
22. **package.json 描述过时**：「Cloudflare Workers + Python FastAPI」（`package.json:4`），代码已无 Python。
23. **scripts/deploy.js 脆弱点**：正则改写 wrangler.jsonc 的 database_id（138-143）；public 目录不存在时 copyFileSync 抛错（78-80 未先 mkdir）；d1 execute 失败被当成已执行过继续部署（154-156）。
24. **零测试零 lint**：build 仅 tsc --noEmit（`package.json:16`），无单测、无 CI 校验插件产物一致性。
25. **公开接口面**：GET /api/wallpaper/sources 暴露 SGDB Key 是否存在（1008）；/api/fonts、/api/builtin-icons、/api/wallpaper* 均无鉴权（信息量与设计意图待裁决）。

---

## 7. 待确认项（无法从代码定论）

1. theme 设置是否仍有旧前端缓存或外部脚本依赖？代码侧已无消费方。
2. weather_size / clock_size / widget_style / pattern / glass_intensity 前端是否真在读（后端只存储转发）——需前端分析确认。
3. D1 外键在生产是否实际生效（决定 B-04/B-07 是否留孤儿数据）。
4. is_imported（组与链接双份）与 synced_to_browser 的真实产品语义：是否仍需双向同步，还是重构后改为单向导出？
5. DELETE /api/sync/bookmark 是否曾供旧版插件使用（当前无调用方），可否删除。
6. /api/data 匿名可读是否符合预期（导航页本身是否要对公网公开）。
7. 是否计划启用 R2（BACKUP_DB）承载备份；若否，backups 表与 M-04 需重新设计并补恢复入口。
8. 用户量级：链接数上百后，/api/ai/check 每链接一次出网会触 Workers 子请求上限（免费 50/请求），需确认套餐限额。
9. 旧版 SHA-256 密码哈希是否仍有存量用户需兼容（`auth.ts:34-37`）。
10. wallpapers 是否需要改名/改 URL/排序能力（当前 PUT 只支持 enabled）。
11. extension/key.pem 是否已进版本库（影响 CRX 签名可复现性）。
12. 备份 payload 单行写入 D1 在真实数据量下是否触达行大小限制。
