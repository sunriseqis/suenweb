# 开发计划（唯一进度来源）

最后更新：v2.0.0 已发布（main 推送 + v1.0/v2.0.0 tag + 签名版插件 2.0.4 分发）；NAS fpk 验证与 CI 首跑由用户真机完成（Docker 定稿/插件自托管下载/SPA 托管/CI 已完成；fnOS 包阻塞 D-2/D-3，镜像构建待有 Docker 的机器实测）。

## 里程碑

| 里程碑 | 范围 | 状态 |
|---|---|---|
| M1 地基 | 六表 + 迁移器 + 分组/链接 CRUD（同名合并、去重、排序、跨组移动）+ 访客只读鉴权 + npm run dev 可跑 + 冒烟测试 | **已完成** |
| M2 前端主线 | 设计系统落地（深浅双主题）+ 书签主页（分组导航 / 网格与列表 / 搜索 / 访客只读态）+ 登录与首设密码页 + 设置页骨架 + 链接编辑抽屉 + 跨组重复弹窗 | **已完成** |
| M3 插件快速收藏 | Firefox MV3 事件页 + Chrome 同步收藏、心跳、pending/ack | **已完成** |
| M4 导入导出 + 加密备份 | 导入预览与提交、书签导出、配置加密导出/导入、WebDAV 每日备份与轮转 | **已完成** |
| M5 扩展清单 | 插件侧清单上报、服务端比对与还原 | **已完成** |
| M6 治理工具与体验 | 死链检查、重复清理、图标缓存、移动端 | **已完成**（工具全交付；移动端响应式随 M2 Metro 布局已达标，360px 无横向滚动在 ui-check 验证） |
| M7 分发 | docker/ 定稿、fn/ 原生包、CI、部署文档 | **基本完成**：Docker 定稿+部署文档+插件自托管下载+SPA 托管+CI+fnOS 包工程全部就绪；待真机安装验证 fpk |

## M1 任务清单（全部完成）

- [x] 目录与文档骨架（server/web/fn/docker/docs/addons；docs/memory、plan、design）
- [x] server 骨架：package.json、config、pino、Fastify 装配、统一 { ok, data, error } 错误体
- [x] 数据层：data/worker.ts（唯一 sqlite 句柄，1 写 + 2 读）+ data/proxy.ts（异步代理、语句缓存、事务批量、崩溃重启）
- [x] 迁移器：schema_migrations + 0001_init.sql（groups/links/settings/extensions/backups/sessions）
- [x] 归一化：分组名 name_key、链接 url_normalized（domain/ 纯函数 + 单测）
- [x] 鉴权：setup / login / logout / status / change-password；scrypt 异步哈希 + 不透明会话 token（库内只存 SHA-256）+ 登录失败限速
- [x] 分组 CRUD（同名自动合并，返回 merged 标记）+ 排序 + 改名合并
- [x] 链接 CRUD（同组 url_normalized 去重合并）+ 排序 + 跨组移动（目标组重复则合并）
- [x] 公开读接口 GET /api/data（分组内嵌链接，一次往返）+ GET /api/settings 公开子集
- [x] 冒烟测试 15 条（node:test + fastify inject）全绿；tsc --noEmit 零错误
- [x] 压测脚本 npm run bench（延迟分位 + event loop 延迟）

## M1 验收记录（2026-10-23）

| 项 | 结果 |
|---|---|
| npm test | 15 pass / 0 fail（含同名合并、同组静默去重、跨组 409 弹窗与 allow/skip/ignore、忽略撤销、排序、跨组移动、改密踢会话、设置白名单、密码 6 位下限） |
| npm run typecheck | 0 error（strict + erasableSyntaxOnly） |
| npm run dev / npm start | 启动后 /api/health、/api/data、/api/auth/status、404 均正确 |
| 迁移升级路径 | 0001 已应用的旧库再次 db:migrate，正确补上 0002（dedupe_ignores + 索引） |
| npm run bench（300 请求 / 并发 20 / 200 条种子链接） | 232 qps，p50 70.6ms，p95 177.9ms，p99 322.6ms，event loop p99 31.3ms |

已知取舍：单进程下 p99 偏高（222 条读 + 每请求一次 session 查询）；M2/M6 再做查询合并与索引优化，暂不影响功能验收。

## M2 任务清单（全部完成）

- [x] 设计系统落地：docs/design/DESIGN-SYSTEM.md（令牌、排版、边框阴影、图案、两级动效、禁止项、技术映射）
- [x] 令牌层：web/src/styles/tokens.css（深浅两套五色；颜色字面值只出现于此）
- [x] 基础层：web/src/styles/app.css（图案分层、多层阴影、文字阴影、关键帧动画、焦点环、减弱动效）
- [x] 组件层：button / field / card / badge / overlay / toast / icons（原生 DOM + 类名变体表 + cn）
- [x] 书签主页：分组导航、网格与列表、搜索、游客只读条、拖拽排序、上移下移、空状态
- [x] 登录与首设密码页（满功率：漂浮几何装饰、巨型背景字、渐变流光标题）
- [x] 设置页：主题三态、降噪开关、默认视图、改密码、重复提示记录撤销、关于
- [x] 链接编辑抽屉 + 新建分组弹窗 + 删除确认 + 跨组重复三选弹窗
- [x] 字体自托管（@fontsource 拉丁子集 woff2），中文回退系统黑体
- [x] 无 emoji 落地：图标全部为内联 SVG；历史文档中的 emoji 也已清除
- [x] 自动化验收：web/scripts/ui-check.mjs（27 项样式与结构断言）+ ui-flow.mjs（交互全流程）

## M2 验收记录（2026-10-23）

| 项 | 结果 |
|---|---|
| tsc --noEmit（web） | 0 error |
| vite build | 通过：JS 41KB（gzip 14KB）、CSS 36KB（gzip 7.7KB）、7 个 woff2 拉丁子集 |
| ui-check.mjs | 27 项断言全过：深色 #0D0D1A / 浅色 #FFF7EE、撞色边框、双层阴影、Outfit 生效、半功率档内容卡无持续动画、装饰层动效保留、按钮均有可访问名称、移动端无横向滚动 |
| ui-flow.mjs | 全流程通过：登录、建组、收藏、跨组重复弹窗三选、忽略记录写入、主题切换持久化、ESC 关闭抽屉；除预期的 409 外无控制台错误 |

## M2 迭代 1（用户验收反馈，2026-10-23）

| 反馈 | 处理 |
|---|---|
| 卡片太大，收藏多了翻不完 | 尺寸同比例缩小：grid 1/2/3/4/5 列、gap-4、padding p-4、圆角 20px、阴影 5/10px、标题 text-base、描述 text-xs、图标 8px 方块 |
| 部分图标要斟酌（如设置） | 设置图标换成「三滑杆」形态（小尺寸更易辨识）；新增 lock-open 供编辑态使用 |
| 选中改色后阴影被抹掉、显得割裂 | 全站按钮加 `.pressable`：按下位移 3px 并保留 3/6px 两层阴影；分组 pill 选中态保留 shadow-multi-sm |
| 页面图标太多 | 顶栏只留品牌标；操作全部收进右下角自动隐藏胶囊：未登录仅「登录」，登录后「编辑锁 / 设置 / 登出」 |
| 编辑按钮要表达编辑态 | 编辑是锁状开关：锁定＝只读（不可编辑、不可拖动、无增删改入口）；解锁＝可拖动排序与增删改；退出登录强制归位只读 |

## M2 迭代 2（真实数据验收，2026-10-23）

| 反馈 | 处理 |
|---|---|
| 胶囊按钮点了没反应 | 根因是 el() 把 onClick 写成 HTML 属性（字符串），监听没挂上；已修 applyProps，并补 npm --prefix web run check:dom（happy-dom 冒烟，验证胶囊 / 导航 / 编辑按钮均可点） |
| 卡片仍然太大 | 恢复旧版分组模型：置顶组（type=fixed）用详情卡，普通组（type=tab）默认极小胶囊；组内可切 详情 / 紧凑 / 极小 三档，并可置顶或取消置顶 |
| 游客顶部提示条多余 | 删除；未登录只保留右下角胶囊里的「登录」 |
| 用真实书签验收密度 | 导入用户导出文件：11 个文件夹 / 94 条（2 个置顶组 15 条 + 9 个普通组 79 条），1080p 下约一屏多一点 |

## M2 迭代 3（色彩收敛，2026-10-23）

| 反馈 | 处理 |
|---|---|
| 卡片一多，页面颜色太花 | 引入内容区色彩预算：链接卡/行/胶囊改中性（细边框 + 无色阴影 + 去每卡图案），取消按卡片轮转的五色；每个分组只用一个强调色，且只出现在组标题圆点、选中态、hover、置顶区边框；导航 pill 与计数改中性，仅选中项用强调色。满功率配色保留在登录、设置、空状态 |
## M2 迭代 4（风格整体切换为 Metro 磁贴，2026-10-23）

| 项 | 处理 |
|---|---|
| 整体风格 | 令牌与基础样式重写为 Metro：炭黑/浅灰底 + 单一强调蓝、0 圆角、1px 线、无阴影/渐变/纹理/动效 |
| 磁贴 | 三尺寸：方 88px（`minmax(88px,1fr)`，标题居中 2-3 行）、行 36px（标题 + 域名）、宽 92px+（标题 2 行 + 域名 + 备注）；普通组默认方磁贴，置顶组默认宽磁贴 |
| 组件 | button 五变体改扁平（primary 强调填充 / secondary 细边 / outline / ghost / icon）；input 1px 边；弹窗与抽屉 1px 面板 + 2px 强调顶线；胶囊改细边条 |
| 登录页 | 去掉漂浮装饰、巨型背景字、渐变标题，改单面板 + 2px 强调顶线 |
| 验收 | tsc 0 error；check:dom 13 项全过；CSS 41KB → 28KB（gzip 8.2 → 6.4） |
## M2 迭代 5（展开式布局 + 网页搜索，2026-10-23）

| 项 | 处理 |
|---|---|
| 布局 | 去掉顶部分类 tab 切换；所有分组一页全部展开 |
| 置顶组 | 固定在顶部独立容器，不进 tab、不随 tab 切换移动 |
| 普通组 | 下方共用一条 sticky 页内 tab 条：点击平滑滚动定位，滚动时用 IntersectionObserver 联动高亮；内容不隐藏 |
| 搜索 | 搜索框改为网页搜索：引擎下拉（7 个）+ 回车开新标签；默认 Google，可切 Bing / DuckDuckGo / Brave / Startpage / Mojeek / Qwant；选择存 localStorage（sw.engine）。书签过滤改用浏览器原生查找 |
| 验收 | tsc 0 error；check:dom 18 项全过（含引擎数量 / 默认引擎 / URL 编码 / 隐私引擎 / 选择器渲染） |
## M2 迭代 6（有底布局 + 真 tab，2026-10-23）

| 项 | 处理 |
|---|---|
| 页面高度 | 新增 `.app-shell`（100dvh，纵向 flex）与 `.app-scroll`（内部滚动）；顶栏固定，内容区滚动，页面有底 |
| 顶栏 | 三段式：标题「书签」/ 居中 max-w-2xl 搜索框 / 右侧操作；删掉 counts 行 |
| 普通组 | 改为真 tab：只渲染当前 tab 的分组，其余不占空间；tab 条 sticky 在内容区顶部 |
| 置顶组 | 常驻顶部，不参与 tab，不受 tab 切换影响 |
| 清理 | 移除已失效的「降噪模式」（现在没有持续动画）与「默认视图」（密度改为按组记忆）两个控件及其 props |
| 验收 | tsc 0 error；check:dom 19 项全过（新增 tab 切换断言）；构建通过 |
## M2 迭代 7（去掉标题 + 默认引擎设置化，2026-10-23）

| 项 | 处理 |
|---|---|
| 顶栏 | 移除页面标题，只留居中搜索框（max 42rem）与右侧编辑操作 |
| 设置页 | 新增「默认搜索引擎」分区：7 个引擎按当前默认高亮，点击即固定为默认（写 sw.engine），并说明后四个不做画像 |
| 搜索框 | 仍可在输入框左侧临时切引擎，选择与设置页共用同一份存储 |
## M2 迭代 8（设置页重排 + 站点图标，2026-10-23）

| 项 | 处理 |
|---|---|
| 设置页 | 改为磁贴规格的扁平分区（编号 + 标题 + 说明 + 控件），去掉卡片包裹：外观 / 默认搜索引擎 / 站点图标 / 账号与口令 / 重复提示记录 / 关于 |
| 站点图标 | 新增 infra/iconCache.ts 与 GET /api/icon?domain=：磁盘缓存 30 天、200KB 上限、6s 超时、只认 http(s)；默认关闭，开启后才出网；访客只读缓存（ICON_NOT_CACHED）；抓取只由登录请求触发 |
| 磁贴 | 开启后三种磁贴右上角显示站点图标角标；取不到自动不显示，不影响布局 |
| 验收 | 服务端 17 tests 全过（新增两条图标用例）；web check:dom 19 项全过；构建通过 |
## M2 迭代 9（置顶自动分栏 / 图标多源缓存 / 磁贴放大，2026-10-23）

| 项 | 处理 |
|---|---|
| 置顶分栏 | 抄旧版 packMultiRows：`single` 独占整行；`multi` 按 3 列打包，4 个拆成 2+2，2 列/1 列自适应；编辑模式每组可切单列/并排（`layout_mode` 取值统一为 single/multi） |
| 图标缓存 | iconCache 升级为多源回退 + 负缓存：https favicon.ico → https apple-touch-icon.png → http favicon.ico → icons.duckduckgo.com；拒绝 text/html/text/plain；命中 30 天、负缓存 1 天；单源 3s 超时、200KB 上限 |
| 磁贴尺寸 | 方 88→116px、行 36→40px、宽 190→232px（高 104px）；标题 11→12/13/14px，域名 9→10/11px，行高与描边同步 |
| 验收 | 服务端 17 tests 全过；web check:dom 20 项全过（新增 layoutMode）；构建通过 |
## M3 插件快速收藏（已完成；2026-10-27 真机验收补全）

- [x] 后端同步底座：`POST /api/sync/heartbeat`、`GET /api/sync/status`、`GET /api/sync/pending`、`POST /api/sync/ack`、`GET /api/events/stream`（SSE + 25s 心跳）
- [x] 事件总线：写操作成功后由 `onResponse` 钩子广播 `links-changed`/`groups-changed`，无需逐路由 emit
- [x] `links` 新链接与改 URL/标题默认回到 `pending`（保证插件能回写）
- [x] 扩展骨架 `addons/`：MV3 事件页 + 弹窗 + 设置页 + 右键菜单 + 5 分钟 alarm 同步 + 打包脚本
- [x] 网页端接 SSE 自动刷新：web/src/lib/live.ts（指数退避重连，500ms 变更合并；groups-changed 也转发到流内）；登录后建立连接、登出断开
- [x] 扩展图标补 PNG：16/32/48/96/128 五档齐备（make-icons.mjs 生成，Chrome 兼容）；AMO 签名按裁决 30 仅发版人工一次
- [x] 首启引导：onInstalled 时未配置则自动打开设置页（setupDone 标记防重复）
- [x] 插件接 SSE 实时同步：links-changed 即时拉 pending，断线指数退避（上限 5 分钟）；5 分钟 alarm 兜底不变
- [x] 服务端 SSE 补转发 groups-changed；新增 test/sse.test.ts（事件流集成测试）

## M3 验收记录（2026-10-27）

| 项 | 结果 |
|---|---|
| 服务端 npm test | 20 pass / 0 fail（新增 SSE 集成测试：订阅流后建组/建链，links-changed 与 groups-changed 均到达） |
| web tsc --noEmit | 0 error |
| web vite build | 通过 |
| web check:dom | 全过，failed 0 |
| 端到端冒烟 | 真实监听端口 + fetch 流式读 SSE：建组与建链事件 400ms 内到达订阅端（SMOKE_OK） |
| addons 语法 | background.js / options.js / popup.js node --check 全过 |

## 2026-10-23 旧版对比裁决（v1.7）

对照旧版（github.com/sunriseqis/suenweb）缺项，用户裁决：

| 项 | 裁决 | 落点 |
|---|---|---|
| 操作审计日志 | 不做（单用户自用，无审计需求） | TOOL-04 从需求移除（裁决 29） |
| 插件分发 | 做，服务端自托管下载；不做自动签名回传，AMO 签名仅发版人工执行一次 | OPS-02 已有，M7 落地；评估结论：自动回传流程重、收益低，开发者模式加载为主（裁决 30） |
| 图标手动刷新 | 做 | TOOL-05 新增（裁决 31），M6 |
| 插件侧 WebDAV 直备 | 按新裁决，仅服务端备份 | 无需改动（裁决 9） |
| 反向删除同步 | 不做：插件只新增，删除从 Web 前端操作（仅影响服务端，浏览器书签不回删） | SYNC-06 撤销（裁决 32） |

## M4 导入导出 + 加密备份（已完成，2026-10-27）

- [x] IMP-01/02 导入：Netscape HTML 解析（同名文件夹合并、归一化去重、非法 URL 计数）+ 预览/提交两段式接口；跨组策略 allow/skip
- [x] IMP-03 导出：/api/export/bookmarks 标准 Netscape HTML（attachment 下载，往返验证通过）
- [x] IMP-04/05/06 加密配置导出/导入：SWB1 格式（魔数+salt+iv+AES-256-GCM），PBKDF2-SHA256(120k) 派生密钥；导出需管理密码、导入双验证（密码 + GCM）、未确认不落库
- [x] BAK-01/03/04/05/06 WebDAV：极简客户端（PROPFIND/PUT/GET/DELETE/MKCOL + 重定向检测）；备份列表/立即备份/还原（需管理密码）；保留份数轮转（只轮转 auto，manual 不动）
- [x] BAK-02/07 每日自动备份：每小时检查跨天执行，未配置则零动作；备份密钥 = 服务端随机 32 字节存 settings（单机部署，口令门槛由管理密码把关），配置时校验管理密码
- [x] Web 端数据管理页（#/data，胶囊「数据」进入）：导入预览/提交、双路导出、还原二次确认、WebDAV 配置+测试+立即备份+备份列表

## M4 验收记录（2026-10-27）

| 项 | 结果 |
|---|---|
| 服务端 npm test | 26 pass / 0 fail（新增 6 条：SWB1 加密往返/篡改检测、HTML 解析同名合并、导入预览+提交去重、导入导出接口、加密配置导出导入覆盖恢复、WebDAV stub 全链路含轮转） |
| web tsc / build / check:dom | 0 error，构建通过（JS 52.7KB），断言全过 |
| 安全要点 | 密文不含明文 URL（测试断言）；密码错误拒绝且不改数据（测试断言）；webdav.*/backup.* 为内部键，任何响应不外发 |

## M5 扩展清单（已完成，2026-10-27）

- [x] EXT-01 插件采集上报：management API 读取已装扩展（排除自身、排除 dev 项），随每次同步静默上报（全量替换 by browser）；选项页有手动「备份扩展清单」按钮
- [x] EXT-02 云端清单：GET /api/extensions 按浏览器分组返回；数据管理页新增「扩展清单」分区（浏览器小标题 + 每条名称/版本/商店页链接/删除）
- [x] EXT-03 一键还原：插件「还原扩展」比对已装（management.getAll），缺失项批量打开商店页（上限 10），回显「已装 X · 打开 Y · 未打开 Z」
- [x] EXT-04 商店链接规则：服务端 domain/stores.ts 单点实现（AMO slug 直链 / GUID 走搜索 / Chrome Web Store / Edge）；插件与网页各持同一形态的轻实现

## M5 验收记录（2026-10-27）

| 项 | 结果 |
|---|---|
| 服务端 npm test | 28 pass / 0 fail（新增 EXT 测试：上报替换、非法浏览器拒绝、跨浏览器同名、删除单条、商店链接规则） |
| web typecheck / build / check:dom | 0 error，构建通过，断言全过 |
| addons 语法 + 打包 | node --check 全过；pack 产物目录 dist/ 就绪（本机无 zip，按提示手动打 zip 即可） |
| Firefox 实测 | 待用户真机验证（Firefox 为主力浏览器，验收标准要求实测通过） |

## M6 治理工具（已完成，2026-10-27）

- [x] TOOL-02 重复清理：GET /api/tools/duplicates（全库按 url_normalized 聚类，跨组才列出）+ POST delete（keepIds 语义：要删除的 id 列表）
- [x] TOOL-03 失效检测：POST /api/tools/check-links（批量 GET 探活 6s 超时、并发 ≤16、结果存 settings 的 tools.dead_links 键 供复查）+ GET 读上次结果 + POST dead-links/delete
- [x] TOOL-05 图标手动刷新：POST /api/tools/icon-refresh；IconCache.purge 清正负缓存后立即重抓；抓取未开启时只清缓存
- [x] 数据管理页新增三个分区：重复链接清理（聚类展示+一键保留首条）、失效链接检测（探活+删全部失效）、站点图标刷新（域名输入）

## M6 验收记录（2026-10-27）

| 项 | 结果 |
|---|---|
| 服务端 npm test | 31 pass / 0 fail（新增 3 条：重复聚类与删除、图标刷新校验、死链检测保存与删除） |
| web typecheck / build / check:dom | 0 error，JS 58.6KB，断言全过 |
| 移动端 | ui-check 的「移动端无横向滚动」断言在 M2 已建立并持续通过 |

## 真机验收反馈（2026-10-27）

| 反馈 | 处理 |
|---|---|
| Qwant 引擎跳转异常 | 移除（引擎清单 7→5，裁决 23 口径同步更新） |
| Mojeek 报「automated queries」反爬墙 | 移除（同上） |
| 密码无法登录 | 系因后端误启空实例导致混淆；已重置为 123456 并清除空实例 |
| 站点图标太小 | 宽磁贴 13→20px、行/方磁贴 12→18px |
| 导入后不弹窗 | toast-root 缺定位样式（M2 遗留），已补右下角固定样式 |
| 编辑任何链接 500 | **真 bug**：links.update 的 SQL 缺引号（sync_state = pending → 'pending'），M1 起就存在但无 PUT 回归测试；已修 + 补 test/linkUpdate.test.ts 回归（32 tests 全绿） |
| 缺自定义图标 | 编辑/新建抽屉新增「自定义图标 URL」字段（icon_type=url），渲染优先于自动 favicon；内网自部署应用可手动贴图标 |
| 磁贴空白多/字小/图标小/备注溢出 | 三磁贴布局重设计：图标进内容流（宽 28px / 行 20px / 方 24px），字号整体 +1~2px，备注收进 flex 列两行截断 |
| 移除行磁贴 | 编辑工具只留 宽磁贴/方磁贴 两档；库里 display_mode='list' 的组渲染时映射为宽磁贴（显示模式仍持久化原值，不迁移数据） |

## M3 插件真机验收补全（2026-10-27）

对照 CAP/SYNC 需求逐项核对后发现四项缺口，已全部补齐：

- [x] SYNC-03 心跳：5 分钟 alarm 里同步上报 heartbeat（此前 api.js 有封装但从未调用，导航页在线状态永远不更新）
- [x] CAP-02 记住上次分组：popup 保存 lastGroupId 到 storage，打开时自动选中
- [x] CAP-04 跨组重复确认：popup 遇 409（CROSS_GROUP_DUPLICATE）弹 confirm 显示已存在分组，确认后带 on_duplicate=allow 二次提交；call() 透传 error.details
- [x] CAP-05 新标签页跳转：background 监听 tabs.onCreated，识别浏览器默认新标签页（about/chrome/edge 系列）后重定向到导航页；设置页开关（默认关）
- [x] 端到端验证：首藏 pending → 跨组 409（details 带源分组名）→ allow 放行 → pending 取件 ack → 心跳，全链路 200

## 前端插件入口（2026-10-27 补）

- [x] 构建机已安装 zip；addons/dist 现有 suenweb-addon-0.1.0.xpi/.zip，数据页插件分区已显示真实下载按钮

- [x] 数据页最上方新增「浏览器插件」分区：调 /extension/download/list 列出 .xpi/.crx/.zip 下载按钮 + Firefox/Chrome 安装指引；无产物时显示打包指引
- [x] Dockerfile 插件产物改在独立构建阶段打包（装 zip），运行镜像自带 dist，开箱即有下载

## 设置页重排 v6（2026-10-27 完成）

按 docs/design/SETTINGS-REDESIGN-preview.md 落地：

- [x] 合并设置页与数据页：#/settings 两 Tab（通用 / 数据），左侧垂直 Tab（窄屏顶部横滚），hash 记忆（#/settings/general | /data），旧 #/data 跳转兼容
- [x] 通用 Tab 4 卡片：设置（主题/搜索引擎/图标，全内联分段按钮零弹窗）、账号（改密码/登出，改密进弹窗）、功能（图标刷新弹窗 + 插件状态行 + 插件下载 + 扩展清单内联）、关于
- [x] 数据 Tab 4 卡片：书签（导入/导出）、配置（导入/导出，密码进弹窗）、链接（检查重复/检查失效，全弹窗）、备份（状态内联 + 配置/立即备份/备份[列表+还原合一弹窗]）
- [x] 新增 pages/toolDialogs.ts：9 个复用工具弹窗（导入书签/导出配置/还原配置/检查重复/检查失效/WebDAV 配置/备份列表/改密码/图标刷新），页面输入框全部清零
- [x] 服务端新增 POST /api/config/restore-snapshot（WebDAV 备份解密后的快照直接还原，密码再验证）
- [x] 胶囊入口合并：「数据」入口取消，右下角只剩 登录/编辑锁·设置·登出
- [x] 旧 pages/data.ts 删除；验收：tsc 0 error、build 通过（JS 62KB）、check:dom 全过、服务端 32 tests 全绿

## 设置页真机反馈（2026-10-27）

- [x] 插件登录 NetworkError（第一轮）：服务端无 CORS → 加 @fastify/cors，preflight 204 通过
- [x] 插件登录 NetworkError（第二轮，真因）：服务端日志显示请求根本没到达 = 浏览器端拦截。两处修：
      ① baseUrl 无协议时 fetch 被当相对路径（moz-extension://uuid/IP:port/...）→ api.js/background.js 统一 normalizeBaseUrl 自动补 http://
      ② Firefox MV3 的 host 权限是「用户授予」制，未授予时跨域 fetch 直接 NetworkError → manifest 加 optional_host_permissions，登录时在用户手势里 permissions.request 主动申请，失败给中文指引
      ③ 新增「测试连接」分步诊断按钮（地址/权限/网络/版本），多行状态显示（ui.css status white-space: pre-line）
      ④ 插件版本 0.1.0 → 0.1.3，dist 已重新打包
- [x] 第四轮（no-cors 也不通）→ 查旧版仓库（/tmp/suenweb-old/extension/manifest_firefox.json）发现旧版对 Firefox 用 **MV2 manifest**（host 权限写进 permissions: ["*://*/*"]，安装即授予），Chrome 才用 MV3。这正是 Firefox MV3 host 权限 opt-in 的坑。
      **改为双包**：addons/manifest_firefox.json（MV2，Firefox .xpi）+ manifest.json（MV3，Chrome/Edge .zip）；pack.mjs 双阶段打包；background.js 的 setBadge 兼容 browser.action / browser.browserAction；版本 0.1.4
      注：此改动偏离需求裁决「不做 MV2」——理由：Firefox 上 MV3 host 权限是用户 opt-in，permissions.contains 报 true 但请求仍被拦（实测），MV2 是 Firefox 官方仍支持的可行路径，旧版亦如此。已同步待回写 REQUIREMENTS。
- [x] 第三轮（诊断已给出「权限已授予 + 网络不通」）：服务端侧完整复验通过（无 Origin 200 / 带 moz-extension Origin 反射 200 / 预检 204 / 跨源 POST 到达）。
      结论：请求在浏览器端就没发出。插件 0.1.3 增加 no-cors 探测以区分「网络层不通」与「权限/CORS 被拦」，并把 error.name 一并显示；manifest host 权限从 <all_urls> 改为具体 http(s)://*/* 并同步 optional。</summary>

- [x] 备份卡片按钮定稿（方案 A 两按钮 + 配置）：[ 配置 ]【弹窗】· [ 上传备份 ]（直接执行）· [ 还原备份 ]【弹窗】列表+选中+密码+确认；openBackupListDialog 只读弹窗已删除
- [x] 点「数据」Tab 跳回首页：currentRoute() 只认 '#/settings' 精确匹配，#/settings/data 落到默认 '#/'；已改为 startsWith 匹配 + boot 时从 hash 解析 Tab

- [x] 点「数据」Tab 跳回首页：currentRoute() 只认 '#/settings' 精确匹配，#/settings/data 落到默认 '#/'；已改为 startsWith 匹配 + boot 时从 hash 解析 Tab

## 插件交互重构（2026-10-27 · 0.1.6 → 0.2.4）

- [x] 0.2.4 设置页两态精简：
      未登录 → 服务端地址输入框 + 管理员密码输入框 + [登录] [测试]
      已登录 → 当前服务器地址一行 + [登出] + [插件备份] [插件还原] + 首页开关（打开新标签页显示 SuenWeb）
      登录后自动隐藏输入区；登出（清除 token、保留地址）后回到输入区并同步让 background 清空 popup
      测试按钮只打 /api/health，结果一行显示「连通 · 版本」或「不通 · 原因」

## 插件交互重构（0.1.6 → 0.2.3）

- [x] 0.2.3 修「扩展清单完全一致却打开全部商店页」：restoreExtensions 的 missing 判断用了 `entry.installed`，而服务端返回条目根本没有该字段 → 全部算缺失。改为与 management.getAll() 的 id 集合比对：
      installed = 服务端清单中本机已装的条数；missing = 本机未装的条数。实测：清单 3 条 / 已装 2 条 → 缺失 1（修复前会算成 3）
- [x] 顺手删掉 restoreExtensions 里无用的 /api/data 请求

## 插件交互重构（0.1.6 → 0.2.2）

- [x] 0.2.2 按用户要求精简 popup：只剩「页面名 / 后端地址 / 分组网格 / 心跳」四块，删掉所有说明文字、「同步本地书签」按钮、「诊断」按钮；右上保留「设置」
- [x] 移除全部右键菜单（页面右键的「收藏到 SuenWeb → 分组」与插件图标右键的「配置/诊断」都删了），background 中 contextMenus 代码清空，两份 manifest 移除 contextMenus 与 notifications 权限
- [x] 收藏结果不再弹系统通知，改为 popup 内一行状态后自动关闭
- [x] 自动同步（5 分钟 alarm）与未登录点图标直接开设置页 保留

## 插件交互重构（0.1.6 → 0.2.1）

- [x] 0.2.1 修真因：「去登录 / 重试 / 分组区」三块同时可见。原因是 CSS `.login-guide { display: grid }` 覆盖了 `[hidden]` 的默认 `display: none`，JS 设 hidden 无效。补 `[hidden] { display: none !important; }` 后互斥生效
      （此前 0.1.9/0.2.0 一直在改 JS 的互斥逻辑，实际是样式层问题）

## 插件交互重构（0.1.6 → 0.2.0）

- [x] 0.2.0 修「登录成功但状态仍显示未配置 / popup 仍说没连接」：
      ① options 的「当前状态」行只在页面加载时算一次，登录成功后不刷新 → 抽出 refreshState()，登录尝试前后、成功后都调用；token 旁显示字符数便于确认真的写进去了
      ② popup 判断登录态改为双保险：storage 原始值 + background config 查询，任一已配置即视为已配置
      ③ 未配置时精确说明缺哪一项（有地址缺 token / 有 token 缺地址 / 两者都缺）
      ④ 「去登录 / 重试」互斥早已在 0.1.9 修，0.2.0 继续保证三块互斥

## 插件交互重构（0.1.6 → 0.1.9）

- [x] 0.1.9 修 UI 状态复位：「去登录」与「重试」会同时显示（showLoginGuide/showRetry 未互相隐藏）；分组区正常显示时给一行提示「点了分组就收藏」
- [x] 真机确认 MV2 包解决了网络层问题：诊断输出「站点权限已授予 + 网络通（HTTP 200，服务端 2.0.0-m1）」，此前 MV3 包必然 NetworkError
- [x] 剩余动作仅为完成一次登录（此前登录都因权限被拦，token 从未写入 → popup 显示去登录属正确状态）

## 插件交互重构（0.1.6 → 0.1.8）

- [x] 0.1.8 修「已登录却显示去登录」：
      ① popup 不再自己读 storage 判断登录态，改向 background 要 config（单一真相源），避免两边判断不一致
      ② 错误分流：UNAUTHENTICATED → 「登录已失效，重新登录」；其它错误 → 「连不上 <地址>：原因」+ 重试按钮，不再误导成去登录
      ③ 未配置时说明到底缺什么（地址未填 / 地址已存但未登录）
      ④ 设置页顶部新增「当前状态」行：已连接 <地址> · 已登录 / 未登录 / 未配置，用户可直接确认真实状态
      ⑤ background 的 message 回包补 code/details，popup 才能区分 401 与网络错误
- [x] 左键两态最终形态：未登录点图标 → 直接打开设置页登录；已登录点图标 → 分组网格，点分组即收藏（无需二次点击）
- [x] 右键插件图标：配置 SuenWeb / 服务器诊断（诊断项打开设置页并自动跑分步诊断）

## 插件交互重构（0.1.6）

按用户意见把「右键分层选分组」改成「点图标一键收藏」：

- [x] popup 重写为分组一键收藏：顶部显示当前页，下面分组按钮网格（名称 + 链接数，上次用过的组高亮），**点分组即收藏并关闭**，不需要再点「收藏」
- [x] 未登录时点图标不弹 popup，直接打开设置页（browserAction.setPopup({popup:''}) + onClicked → openOptionsPage），登录成功后自动恢复 popup
- [x] 右键插件按钮：两个菜单项「配置 SuenWeb」「服务器诊断」（contexts 按 MV2 browser_action / MV3 action 自适应）；诊断项打开设置页并自动跑一次分步诊断（storage 标记 autoDiagnose）
- [x] 页面右键「收藏到 SuenWeb → 分组子项」保留（CAP-01 需求，作为补充入口）
- [x] 安装后引导登录沿用：未配置时 onInstalled 自动打开设置页
- [x] 版本 0.1.6，双包重打

## 插件右键分组子菜单（CAP-01）

- [x] 右键菜单改为「收藏到 SuenWeb」父项 + **逐分组子项**（实时取 /api/data；置顶组在前、组内按 sort_order；超 30 组截断并提示）
- [x] 子项标题带该组链接数：`分组名（N）`
- [x] 右键在链接上 → 收藏**链接本身**（info.linkUrl/linkText），否则收藏当前页
- [x] 四种异常态分支：未登录 / 登录失效 / 连不上服务端 / 还没有分组，各自给出可点击的引导项（打开设置或导航页）
- [x] 收藏结果用 notifications 通知（成功显示标题+分组，失败显示原因）；两份 manifest 加 notifications 权限
- [x] 菜单刷新时机：安装 / 启动 / 5 分钟 alarm / SSE links-changed 与 groups-changed / 配置保存 / 每次收藏后
- [x] 顺手补 MV3 manifest 缺的 management 权限（扩展清单采集此前会静默返回空）
- [x] 版本 0.1.5，双包重打（FF MV2 .xpi / Chrome MV3 .zip）；服务端选定分组收藏链路过测（201 + 计数 +1）

## 审查修复批次 1（2026-10-28 · 全部验收通过）

| 端 | 代理 | 项 | 验收 |
|---|---|---|---|
| 插件 | d36e063f | S5 browser 兜底 / S3 书签 URL 幂等 / M1 alarm 重连 / M5 manifest 清理 | ✅ 13/13 |
| fn | 566a23ae | S9 sha256 校验链 / S10 flock 防双实例 | ✅ 14/14 |
| 前端 | 8e9fe924 | S8 safeHref / S11 refresh 代数 / S12 live 静默 | ✅ 12/12 |
| 后端 | 2d995d6f | S1 删除语义 / S2 单事务 / S4 multipart / S6 webdav / S7 trustProxy | ✅ 静态 12/13 + 36/36 测试（S2「未过」系验收脚本 grep 误报，代码走读确认事务分支正确） |

**批次 1 结论：12 项严重缺陷全部修复并验收。服务端测试 36/36（新增 4 条：原子性失败注入 / multipart 等价 / 302 拒绝 / 越界删除拒绝）。**

## CAP-05 第三轮：恢复旧版双监听（2026-10-29 · 插件 2.0.4 · 已签名）

**AMO 签名通过**：2.0.4 签名版 xpi（26549 bytes）已入服务端分发（/extension/download/），前端显示为「Firefox 签名版 (.xpi)」；未签名调试版并列展示为「Firefox 调试版 (.xpi)」。

用户反馈 override 方案「新窗口无效」。分析：
- 2.0.2/2.0.3 的 chrome_settings_overrides 有死锁缺陷——用户在 override 页点过「恢复默认」后 Firefox 永久记住选择，插件 override 失效且无法恢复
- 旧版（suenmusic 同款）用 onCreated+onUpdated **双监听**：onCreated 抓 Ctrl+T，onUpdated 补新窗口首标签的 pendingUrl 漏触发
- [x] 删除 chrome_settings_overrides（两份 manifest），删除 newtab.html/js
- [x] 恢复双监听 + REDIRECT_LOCK 防循环；about:blank（用户主动行为）不再拦截
- [x] 版本 2.0.4，双包重打，已推送
- 已知取舍：插件开启时用户改 Firefox 新标签页设置会被插件覆盖（所有新标签页插件共性）；关闭开关即恢复浏览器默认

## 插件下载规则修正（2026-10-29）

**用户裁定**：Firefox 入口必须恒在——有签名包下载签名包，没有就下载未签名调试包。此前"有签名就藏调试包"导致 Firefox 入口消失，错误。
- [x] 删除过滤逻辑，展示全部产物；按钮文案标注「Firefox 签名版 (.xpi)」/「Firefox 调试版 (.xpi)」
- [x] dist 常备 2.0.3 调试包；已推送 main/beta

## 新标签页兜底（2026-10-29 · 插件 2.0.3）

用户反馈「新窗口打开应用前端无效」——2.0.2 的 override 跳转在某些场景（新窗口首标签、存储读取时序）可能失败。
- [x] newtab.js 兜底：跳转失败 1.5 秒后提示「自动跳转失败」，并常驻「手动打开 SuenWeb」链接（跳转前即渲染，不依赖跳转成功）
- [x] 关闭态区分：开关关闭显示设置入口（不再误导）
- [x] 版本 2.0.3，双包重打，已推送
- 需用户确认：装 2.0.3 后「新窗口」场景是否正常；若仍无效请提供浏览器控制台输出

## CI 第三轮：发行标题/说明字面值（2026-10-29）

用户实测：发行标题 "SuenWeb vsuenweb-v1"、说明 "SuenWeb v vX.Y.Z"——RAW_VER 提取在 Actions 环境失败（node -p 转义链路不可靠）且无 set -e，失败后 TAG 落到字面兜底。
- [x] RAW_VER 改 `grep + sed`（纯 shell，无 node/转义），仓库根实测输出 2.0.0
- [x] prep run 块加 set -e（失败即停，不再产出半截 tag）
- [x] v2.0.0 tag 重打触发

## AMO 签名版 2.0.2 分发（2026-10-29）

- [x] 用户提交 2.0.2 并获签名版 xpi（27493 bytes，签名链齐全），入 addons/dist
- [x] 未签名调试包（firefox.xpi）从 dist 移除，不再提供下载
- [x] 前端插件下载过滤：只展示签名版（chrome zip 保留——Chrome 无签名机制）
- [x] 已推送 main/beta

## CAP-05 重构：声明式新标签页（2026-10-29 · 插件 2.0.2）

**用户实测反馈**：原 tabs.onCreated 劫持会覆盖 Firefox 自带的「新标签页设置」——用户改浏览器默认无效（插件每次都把 about:newtab 重定向）。
- [x] 改为声明式 `chrome_settings_overrides.newtab`（MV2/MV3 双 manifest）——Firefox 新标签页右上角出现「恢复默认」控件，用户可一键还原，插件不再代码对抗
- [x] 扩展内新增 newtab.html/js：读 newtabEnabled 开关决定跳转 baseUrl 或显示关闭态（提供浏览器默认链接 + 设置入口）
- [x] 删除 background.js 的 tabs.onCreated 劫持代码
- [x] options 开关文案更新；版本 2.0.2，双包重打，已推送 main/beta/tag

## AMO 签名完成（2026-10-29）

- [x] **AMO 签名通过**：用户提交 2.0.0 并拿到签名版 xpi（mozilla.rsa/cose 签名链齐全）
- [x] 签名版已入 addons/dist（suenweb-addon-2.0.0-firefox-signed.xpi）并通过 /extension/download/ 分发（200，26198 bytes）
- [x] build-fn.mjs 打包注释更新：产物含 AMO 签名版
- 注：Firefox 用户现在两条安装路径都可——① AMO 签名版（自动更新）② 开发者模式加载未签名 .xpi

## AMO 签名修复（2026-10-29 · 插件 2.0.1）

第一轮修掉 data_collection / min_version / request 警告后，AMO 再报 **附加组件 ID 不匹配**（suenweb@local vs AMO 刊登的 sunriseqis@aliyun.com——那是旧版 SuenWeb Sync 的 id）。
- [x] Firefox manifest gecko.id 改为 `sunriseqis@aliyun.com`（对齐 AMO 现有刊登，作为其 2.0.1 升级版提交）
- [x] web-ext lint 复核：0 errors / 0 notices / 0 warnings
- 注：gecko.id 承载的是 AMO 刊登身份，与项目名无冲突；MV2 包无 contextMenus/notifications 权限

用户提交 AMO 签名被三个警告拦截，全部修掉并经 addons-linter 验证 **0 errors / 0 notices / 0 warnings**：

- [x] 补 `browser_specific_settings.gecko.data_collection_permissions: { required: ["none"] }`（AMO 新规必填；旧版 suenmusic 同款写法）
- [x] `strict_min_version` 115.0 → 128.0（Android 115 不支持 permissions.request）
- [x] `ensureHostPermission` 对无 request API 的环境（Android MV2）安全放行——MV2 包 host 权限安装即授予，不再 false 阻断登录
- [x] 版本 2.0.1，双包重打；web-ext lint 实测通过
- [x] 第二轮：strict_min_version 128 → **142.0**（data_collection_permissions 需桌面 140+/Android 142+；与旧版 suenmusic 实证值一致）。lint 复核 0/0/0

## CI 发布失败两轮修复（2026-10-29）

**第一轮**：图标 ENOENT（fn/app/ui/images CI 无目录）→ mkdir 修复。
**第二轮**：发布到 suenapp 失败——「Found release SuenMusic v2.0.0」：
- suenapp 仓已有 suenmusic 发的 v2.0.0 tag/release → tag 冲突
- GITHUB_TOKEN 无跨仓写权限
修复：
- [x] 发布 tag 加前缀 `suenweb-v2.0.0`（release name SuenWeb v2.0.0）
- [x] token 仅用 SUENAPP_TOKEN（需用户在 GitHub 配置：有 suenapp 写权限的 PAT）

**用户待办**：GitHub 本仓 Settings → Secrets → Actions → 新建 `SUENAPP_TOKEN`（classic PAT，勾 repo 权限），然后重跑 workflow。

## CI 首跑修复（2026-10-29）

GitHub Actions 首跑失败：图标写入 ENOENT——`fn/app/ui/images` 在 CI 全新 checkout 不存在（gitignore 排除了 fn/app/*，本地目录是历史构建残留所以没暴露）。
- [x] build-fn.mjs 图标写入前 `mkdir -p fn/app/ui/images`
- [x] 本地以全新 clone 模拟 CI 环境（无 fn/app、无 output）构建成功，产物 47.16 MB
- [x] v2.0.0 tag 重打（旧 tag 指向失败提交）→ Actions 自动重跑

## 发布推送（2026-10-29）

- [x] 用户裁定：删除远端门禁 ci.yml——提交前本地跑（typecheck/test/build/check:dom/check:ui），推到远端再跑无意义且门禁红也不挡发布流水线；远端只留 build-fnos.yml 发布线

- [x] build-fnos.yml 重写为 **suenapp 公共仓发布模式**（对齐 suenmusic 实证）：本仓将转私有，fpk + checksums.txt 推送到 sunriseqis/suenapp 的 Release；tag 触发或手动；token 走 GH_RELEASE_TOKEN/SUENAPP_TOKEN/GITHUB_TOKEN 链

- [x] 已知坑记录：public/ 是 gitignore 的构建产物，git 切分支会清空它——本地服务器启动前若 404 先 npm --prefix web run build（Docker/fpk 形态不受影响，构建阶段会生成）

- [x] 远端 main → **v1.0 分支 + v1.0 tag**（旧版快照，2f6bd74）
- [x] beta（v2.0.0 全量工作，含审查修复 69 项、设置页重排、fnOS 包、AMO 签名插件）fast-forward 到 **main** 并推送（b17dfd7）
- [x] **v2.0.0 tag** 打在 main
- [x] 铁律修复：output/fpk 产物曾被误提交，已从 main 移除并 gitignore；fn/app 装配产物、.pack 临时目录一并排除
- 提醒：push v2.0.0 tag 会触发 build-fnos workflow（需 GitHub Actions 首跑验证）

## 审查修复批次 3（2026-10-28 · 全部验收通过，69 项审查清零）

**最终门禁**：server typecheck+44 测试 ✓ / web typecheck+build+check:dom+check:ui ✓ / addons 语法 x3+打包 ✓ / fn bash -n x9+build-fn --check ✓

| 端 | 验收 |
|---|---|
| 插件 | ✅ 16/16 |
| 后端 | ✅ 9/9（44/44 测试） |
| 前端 | ✅ 14/14（四道门禁） |
| fn/CI | ✅ 15/15 |

**审查总账（docs/dev/REVIEW-2026-10-28.md）**：69 项发现（严重 12 / 中 31 / 低 26）全部修复并逐项独立验收，累计 79 个验收断言点。历史修复无复发。

| 端 | 代理 | 项 |
|---|---|---|
| 后端 | 900a6d1d | L18 LIMIT trunc / L19 404 回显 / L20 secureCookies 注释 / L21 scheduler tz / L22 esc 单引号 / L23 rate-limit cleanup / L24 inflight 实例化 | ✅ 9/9（44/44 测试全绿） |
| 前端 | 6f6639aa | L12 --c-overlay / L13 reorder 报错回滚 / L14 iconFailedHosts 入 sessionStorage / L15 死代码 / L16 groupSelect 样式 / L17 replaceWith→store / L18 live 401 停止重连 | ✅ 14/14（四道门禁实跑全绿） |
| fn/CI | d7284519 | L9 env 循环简化 / L10 fd 噪音 / L11 无 timeout 探测 / L12 打包 smoke / L13 CI permissions+env+checksums / L14 缓存 .ok 核对 | ✅ 15/15 |
| 插件 | 497fa684 | L1 badge 统一 pending / L2 扩展上报 hash 去重 / L3 api.js 死代码 / L4 connectEvents catch / L5 syncPending 互斥 / L6 fileURLToPath | ✅ 16/16 |

## 审查修复批次 2（2026-10-28 · 全部验收通过，批次收口）

**后端 16/16 源码核对 + 44/44 测试全绿。** 代理 05dd449a 中途挂掉但修复已完成（遗留 3 个测试自身 bug 由我修正：M6 断言 url_normalized 尾斜杠错误、M11 用 inject 订阅 SSE 流会挂起改为 fetch+abort 读首块、M12 断言错把 CORRUPT_BACKUP 业务错当 200）。

**全端最终门禁**：server typecheck ✓ / web typecheck+build+check:dom+check:ui ✓ / addons 语法 x3 ✓ / fn bash -n ✓ / build-fn --check ✓

**批次 1+2 总账**：严重 12 项 + 中项 31 项中已修 27 项（后端 11 中 + 前端 8 中 + fn 4 中 + 插件 4 中 = 27，另有严重 12）。剩余 4 项中项（fn M4 manifest 动态端口、前端低优先 2 项并档、插件 L2/L3 低项顺带）与 26 项低项留待下版本。



| 端 | 代理 | 项 |
|---|---|---|
| 后端 | 05dd449a | M6 原子去重 / M7 worker 重置 / M8 保留旧 key / M9 SSRF 黑名单 / M10 静态跳过 / M11 SSE 鉴权(跨端) / M12 bodyLimit / M13 pbkdf2 异步 / M14 socket 泄漏 / M15 白名单注释 / M16 注释取舍 | ✅ 16/16 源码核对 + **44/44 测试全绿**（代理挂前已完成全部修复，遗留 3 个测试 bug 由我修正：M6 断言 url_normalized 尾斜杠、M11 inject 挂起改流式读取、M12 断言 CORRUPT_BACKUP） |
| 前端 | efbc8f5c | M4 store 浅比较 / M5 favicon 单请求 / M6 弹窗防重 / M7 Esc 栈 / M8 aria-live / M9 ui-check 重写 / M10 html prop 收紧 / M11 busy 丢输入 | ✅ 16/16 独立复核通过（新增 check:ui 门禁 20 条断言全绿；typecheck/build/check:dom 实跑） |
| fn | bc76266b | M3 回调读 .env / M5 图标 try-finally / M6 ETC_DIR 告警 / M8 start 失败告警 | ✅ 10/10 |
| 插件 | 7bf156ee | M2 退避复位 / M3 saveLink 失败闭环 / M4 restore scheme 校验 / M5 manifest 复核 | ✅ 11/11 |

| 端 | 代理 | 项 | 验收 |
|---|---|---|---|
| 插件 | d36e063f | S5 browser 兜底 / S3 书签 URL 幂等 / M1 alarm 重连 / M5 manifest 清理 | ✅ 13/13 独立复核通过 |
| fn | 566a23ae | S9 sha256 校验链+curl -f+.ok / S10 flock 防双实例 | ✅ 14/14 独立复核通过（含 flock 互斥动态实测；fnpack sha256=72d2a409… 实值核对一致） |
| 后端 | 2d995d6f | S1 删除语义 / S2 单事务 / S4 multipart / S6 webdav / S7 trustProxy | ✅ 静态 12/13 + 36/36 测试全绿（新增 4 条用例：原子性失败注入 / multipart 等价 / 302 拒绝 / 越界删除拒绝；代码走读确认逐条 db.run 仅在非事务分支，事务模式分组 INSERT 带确定性 id 进同一 batch） |
| 前端 | 8e9fe924 | S8 safeHref / S11 refresh 代数 / S12 live 静默 | ✅ 12/12 独立复核通过（含 dom-check 新增 javascript: 断言；三道门禁实跑全绿） |

## M7 进行中（2026-10-27）

- [x] OPS-02 插件自托管下载：GET /extension/download/list 与 /extension/download/:file（zip/xpi/crx，产物 addons/dist 构建生成不入库；缺失时返回打包指引）
- [x] 后端托管前端产物：@fastify/static 挂 public/（repoRoot 由 config.ts 按源码位置推导，不再依赖 cwd）；GET / 与非 /api GET 404 均回 SPA index；/api 404 保持结构化 JSON
- [x] Docker 定稿：三阶段构建（web build → 后端 prod deps → 运行镜像含 public 与 addons 产物）；healthcheck 打 /api/health；compose 精简（镜像名 2.0.0，数据卷 ./data）
- [x] 部署文档 docker/README.md（构建命令、插件分发、备份迁移、环境变量表）；docs/README 同步
- [x] 环境校验：静态/回退/结构化 404/health 全过；服务端 32 tests 全绿
- [ ] 本机无 docker daemon，镜像构建实测需在带 Docker 的机器执行
- [x] fnOS 原生包：D-2/D-3 按 SuenMusic 实证方案关闭（用户指路 suenmusic 工作区）——fn/manifest、config（privilege/resource data-share）、wizard（端口向导）、cmd 全套生命周期脚本（守护+PID双校验+日志轮转+TRIM硬闸）、scripts/build-fn.mjs（六步构建：版本注入/图标/Node运行时/装配含前端陈旧检测与 .bin 死链规避/插件打包/fnpack）、.github/workflows/build-fnos.yml（tag 触发）
- [x] D-2 关闭：manifest 字段照 suenmusic 实证（appname/version/platform=x86/os_min_version/source/maintainer/desktop_uidir/desktop_applaunchname/service_port/checkport/ctl_stop/disable_authorization_path）
- [x] D-3 关闭：运行时交付 = 包内自带 Node 22.14.0 linux-x64 独立二进制（npmmirror 缓存下载），非 SEA
- [x] CI（OPS-05）：.github/workflows/ci.yml —— server typecheck+test、web typecheck+build+dom-check、插件语法+打包、零原生依赖门禁

## v2.0.0 收口（2026-10-28）

### 版本统一
server / web / addons（两份 manifest + package.json）/ fn manifest 全部 **2.0.0**；APP_VERSION 同步。

### 文档按实现回写（不再采纳旧描述）
- CAP-01/02/03/04 改为实际交互（点图标→分组网格→点组即收藏；无右键菜单）
- 兼容口径由「Firefox MV3」改为「Firefox MV2 包 + Chrome/Edge MV3 包」
- M3 验收标准改写
- BAK-07 改为实际实现：服务端随机 32 字节备份密钥存 settings，还原时管理密码作访问门槛；用户导出/导入的 .swb1 才是管理密码派生
- 新增裁决 34（插件交互最终形态）、35（设置页结构）；REQUIREMENTS 升 v1.8

### fpk 实体验证（本机模拟 fnOS 布局，用包内自带运行时启动）
| 检查项 | 结果 |
|---|---|
| 构建 | output/suenweb-v2.0.0.fpk，47.03 MB，SHA256 d6067d8f… |
| 包内运行时 | bin/node v24.18.1 |
| 包内 manifest | appname/version/service_port=8080/checksum 正常 |
| 软链 | 0 条；node_modules/.bin 已剔除 |
| 启动 | 用包内 node + app/server 启动，/api/health 200，version 2.0.0 |
| 前端托管 | GET / 200 且返回 SPA；GET /settings 200 |
| 插件下载 | /extension/download/list 列出 2.0.0 双包；下载 xpi 200，content-type application/x-xpinstall，17KB |
| 首启状态 | 全新数据目录 initialized=false（引导设密流程正常） |

### 验证中发现并修掉的两个真 bug
1. **包内 Node 22 无法直接跑 .ts**（ERR_UNKNOWN_FILE_EXTENSION）→ 运行时升到 Node 24.18.1，并在 cmd/main 补 `--experimental-strip-types`（兼容 22/24）
2. **包内前端不被托管**：服务端静态目录写死 `repoRoot/public`，而包内是 `app/web/dist` → 新增 `WEB_ROOT` 配置（默认仍是 public，Docker 不受影响），cmd/main 导出 `WEB_ROOT=${APP_DIR}/web/dist`
3. 顺带：插件下载产物此前没打进 fpk → build-fn 增加复制 `addons/dist` 到 `app/addons/dist`

### CI 验证（本地按 workflow 逐步跑）
10/10 步通过：server npm ci(dry-run)/typecheck/test、web npm ci(dry-run)/typecheck/build/check:dom、addons 三文件语法+打包、零原生依赖 grep 门禁。

### 仍需真机完成
- NAS 上安装 fpk（本次是模拟布局运行，未走 fnOS 安装器与 TRIM_* 环境）
- GitHub Actions 首次真实触发

## 待确认（全部关闭）

| 编号 | 问题 | 现状 |
|---|---|---|
| D-1 | 链接去重范围 | **已裁决（v1.6）**：同组静默去重、跨组 409 弹窗放行、忽略后不再提示 |
| D-2 | 飞牛原生包 manifest 字段与数据目录规范 | **已关闭**：按 SuenMusic 实证方案落地（用户 2026-10-27 指路），字段与目录见 fn/README.md |
| D-3 | 飞牛包内 Node 运行时交付方式 | **已关闭**：包内自带独立 Node 22 二进制（bin/node），非 SEA |

## 下一步

1. 等前端原型落到 docs/design/prototypes，确定字段与交互后再开 M2（web/ 接 Vite 代理到 127.0.0.1:8080）。
2. M3 插件开工前先定「收藏 → 落库 → 回写书签」的时序（SYNC-03 不许先 ack）。
