# 项目记忆（长期，跨会话必读）

最后更新：v2.0.0 收口（版本统一、文档按实现回写、fpk 与 CI 已验证）。历史：M7 基本完成（含 fnOS 原生包工程）；D-1/D-2/D-3 全部关闭。fn 打包所有坑照搬 SuenMusic 审计结论（.bin 软链死链/TRIM 硬闸/升级停进程/守护残留/.env 放 etc）（操作日志不做 / 插件自托管分发 / 图标刷新 / 反向删除同步不做）。本文件只写「不该被重新讨论」的东西。

## 〇-2、M4 关键实现决策（2026-10-27）

| 项 | 决策 |
|---|---|
| 备份文件格式 | SWB1：魔数 SWB1 + salt(16) + iv(12) + AES-256-GCM 密文 + tag(16)；密钥 PBKDF2-SHA256 120k 迭代 |
| 两套加密口径 | ① 配置导出/导入（.swb1 交给用户保管）：密钥=管理密码派生（IMP-06 契约）② WebDAV 自动备份：密钥=服务端随机 32 字节存 settings，下载还原需验管理密码（BAK-07 口令门槛）。原因：服务端只有 scrypt 哈希，无法用管理密码明文做每日任务的加密钥 |
| 轮转范围 | 只轮转 suenweb-backup-auto-*，manual 备份永不自动删 |
| 导入语义 | HTML 解析层合并同名文件夹；跨组重复 allow/skip 两档；整批事务提交 |
| 内部设置键 | webdav.* 与 backup.* 与 auth.* 同级，getAll() 一律过滤，绝不外发 |

## 〇、v1.7 增量裁决（2026-10-23 旧版对比后）

| 项 | 决策 |
|---|---|
| 操作日志 | 不做（单用户自部署，无审计需求） |
| 插件分发 | 服务端自托管下载 + 开发者模式加载为主；AMO 正式签名仅发版时人工一次，不做自动签名回传流水线 |
| 图标手动刷新 | 提供（写接口清缓存并重抓，登录才可用） |
| WebDAV 备份 | 仅服务端做（裁决 9 不变），插件侧直备不保留 |
| 反向删除同步 | 不做：插件只新增（服务端→浏览器单向）；删除只在 Web 前端操作，浏览器书签不回删 |

## 一、项目铁律

1. **目录铁律**：仓库顶层只有六个有序目录 —— server（后端）、web（前端）、fn（飞牛）、docker（容器）、docs（文档）、addons（插件）。新代码不得在顶层另开目录。
2. **文档铁律**：记忆类文档只写 docs/memory，计划类文档只写 docs/plan，原型 / 图标 / 视觉稿只写 docs/design；docs/README.md 是根摘要索引，任何文档增删改都必须同步更新它。
3. **需求编号即契约**：任务、PR、验收一律引用 REQUIREMENTS.md 的编号（NAV / AUTH / CAP / SYNC / IMP / BAK / EXT / UI / TOOL / OPS）。功能要增删，先改需求文档并追加裁决记录，再动代码。
4. **零原生依赖**：数据库用 Node 内置 node:sqlite，npm ci 不得触发任何编译。禁止引入 better-sqlite3 / sqlite3 / argon2 / sharp 等需要本地构建的包。
5. **主线程零同步 I/O**：node:sqlite 的同步 API 只允许出现在 server/src/data/worker.ts 内，主线程只能走 data/proxy.ts 的异步代理。
6. **读公开、写鉴权**：所有 GET 对外可读（访客只读），所有写操作必须持有效会话。
7. **产物不入库**：插件构建产物、前端构建产物、data/ 运行时数据、任何密钥与证书，一律 gitignore。
8. **禁止 emoji**：界面、文档、提交信息、代码注释一律不得出现 emoji。装饰需求用内联 SVG 几何图形或色块实现（设计原稿里的 emoji 撒点已按此改写）。

## 二、已锁定决策（下表全部已定，不再讨论）

| 领域 | 决策 |
|---|---|
| 部署 | 本地部署两种形态：Docker、飞牛 fnOS **原生应用**（包内自带 Node 运行时，不是 Docker 镜像转包）。开发与测试一律 npm，不折腾容器 |
| 后端 | Node 22.5+（推荐 24 LTS）+ Fastify 5，ESM + 原生 TS 类型擦除，不打包（npm run dev/start 直接跑 .ts） |
| 数据库 | 单文件 SQLite + WAL；1 个写 worker + 2 个读 worker，读并行、写串行；读连接 query_only |
| 前端 | Vite + TS + 原生 DOM（不引框架），实时更新走 SSE |
| 鉴权 | 会话 token 为不透明随机串，库内只存 SHA-256；管理密码用 scrypt（异步）哈希存 settings。不需要 SESSION_SECRET（已取消） |
| 密码策略 | **最短 6 位**，只卡长度；不强制复杂度、不设过期、不锁账号 |
| 备份口令 | 等于管理密码，不设独立 token，不存在无口令分支；换密码后下一次备份用新密钥覆盖 |
| 服务端备份 | 配了 WebDAV 才每日自动加密上传，没配就不做；保留份数按设置轮转 |
| 分组重名 | 归一化（trim + 空白折叠 + 大小写不敏感 + NFKC）后唯一，重名自动合并（改名撞名也合并，链接随之迁移，重复 URL 丢弃） |
| 链接去重 | url_normalized：协议主机小写、去默认端口、去尾斜杠、去跟踪参数（utm_*、fbclid 等）、丢 hash、query 排序；**同组重复静默合并**；**跨组重复返回 409，由前端弹窗让用户放行**（on_duplicate=allow/ignore/skip）；用户选 ignore 写入 dedupe_ignores，同一 (URL, 分组) 不再提示，可撤销 |
| 插件交互 | **点图标即用**：未登录点图标开设置页；已登录点图标弹分组网格，点组即收藏并关闭。设置页两态（未登录=地址+密码+登录/测试；已登录=地址+登出/插件备份/插件还原+首页开关）。**没有任何右键菜单**，故无 contextMenus / notifications 权限 |
| 设置页 | 设置与数据合并为 `#/settings` 两 Tab（通用/数据）+ 8 卡片；**所有输入框进弹窗**，页面只有按钮、开关、只读列表；胶囊「数据」入口已取消 |
| AMO 签名 | gecko.id=sunriseqis@aliyun.com（对齐旧刊登）、strict_min_version=142.0（data_collection 需 140+/142+）、data_collection_permissions.required=["none"]；**签名版 xpi 与未签名调试版并存分发**，前端按钮标注签名/调试；Firefox MV3 host 权限 opt-in 会静默拦请求（实测），Firefox 侧永用 MV2 |
| 插件交互 | 点图标即用：未登录开设置页、已登录分组网格点组即收藏；设置页两态；**无右键菜单**；新标签页 onCreated+onUpdated 双监听（override 会被用户恢复默认永久锁死，弃用） |
| AMO 签名版分发 | **fnOS 端口必须支持自定义**（产品方向）：安装/升级向导 wizard_port 强制覆盖 etc/.env；main/upgrade/uninstall 全链路读 .env 取真实端口；manifest.service_port 是静态默认值（fnOS 限制，用户改端口后 checkport 可能判异常——已知平台限制） |
| 版本 | 全项目统一 **2.0.0**：server / web / addons（含两份 manifest）/ fn manifest |
| 浏览器 | Firefox 为主（**MV2 包**，host 权限写 permissions 安装即授予），Chrome/Edge 用 MV3 包；双包由 addons/scripts/pack.mjs 产出。Firefox MV3 的 host 权限是用户 opt-in，会导致「权限显示已授予但请求被拦」，故 Firefox 侧用 MV2 |
| 外观个性化 | 背景/壁纸/字体的个性化选项仍推迟 P3；但**视觉风格本身**按上面第 3 行采用 Maximalism/Dopamine，深浅两套主题随 M2 一起交付 |
| 前端设计系统 | **Metro / 磁贴**（docs/design/DESIGN-SYSTEM.md v2）：0 圆角 + 1px 线 + 无阴影渐变，**全站单一强调色**，磁贴三尺寸；强调色只表达可交互/选中/当前。v1 的 Maximalism 已存档为 DESIGN-SYSTEM-dopamine.md，不再执行 |
| 前端技术 | Vite + TS + Tailwind v4 + 原生 DOM 渲染函数 + 类名变体表；不引 React/shadcn |
| 主题与动效 | 主题三态（跟随系统/浅/深）+ 动效两级（满功率：登录/引导/设置；半功率：书签主界面）+ 降噪模式开关；均存本地，尊重 prefers-reduced-motion |
| 字体 | Outfit + DM Sans + Bungee 自托管 woff2（仅拉丁子集，@fontsource）；中文回退系统黑体，中文标题禁用三层文字阴影 |
| 图标 | 内联 SVG symbol 精灵（Lucide 图形），零运行时依赖、离线可用；禁止 emoji 装饰 |
| AI | 全部移除，无 /api/ai/*、无 llm_* 配置 |
| 搜索引擎 | 内置 5 个：Google / Bing / DuckDuckGo / Brave / Startpage。Qwant（跳转异常）与 Mojeek（反爬墙「automated queries」）经真机验证不可用，已移除不再回加 |

## 三、接口与数据约定（M1 已落地，改要同步文档）

- 认证前缀 /api/auth/*：setup、login、logout、status、change-password；浏览器用 Cookie sw_session，插件用 Authorization: Bearer <token>。
- 返回体一律 { ok, data } / { ok: false, error: { code, message, details? } }；错误码为机器可读大写下划线。
- 读写拆分：GET /api/data 一次往返返回「分组内嵌链接」；写接口全部 preHandler: requireAuth。
- 去重：POST /api/links 支持 on_duplicate（prompt 默认 / allow / ignore / skip）；GET · POST · DELETE /api/dedupe/ignores 管理「不再提示」记录（按 URL + 分组粒度）。
- settings 表 value 为 JSON 文本；内部键 auth.* / backup.* / webdav.* 永不出现在响应里，前端只可写白名单键（getPublic / WRITABLE_SETTING_KEYS 同源）。

## 四、已知坑（踩过，别再踩）

- 旧版插件「先 ack 再写书签」，写失败就丢书签：同步必须以浏览器写入成功为前提才算完成（SYNC-03）。
- 旧版导入预览字段与后端不一致：预览与提交必须共用同一份字段契约。
- 旧版备份「设置里能调保留份数但代码没实现」：保留策略必须有实现与测试。
- 旧版插件产物 4 份副本 + key.pem 入库：构建生成、单一真源、产物 gitignore。
- settings 的 value 是 JSON 文本：服务端取内部值必须用 getValue（会 JSON.parse），直接用 getRaw 会拿到带引号的字符串，导致密码校验永远失败。
- node:sqlite 的 prepare().run/all/get 参数必须收窄成 SQLInputValue，bind 里要把 undefined→null、boolean→0/1、Date→ISO。
- el() 传 onClick 曾静默失效：applyProps 把它当普通属性 setAttribute 成字符串，按钮点不动。现在只有 on* 且值是函数才挂 addEventListener；新增交互后跑 npm --prefix web run check:dom（happy-dom，无需浏览器）回归。
- 胶囊容器 pointer-events-none 时必须给内层 pointer-events-auto，否则整块点穿。
- 手写 JSON Schema 时 type 的值必须带引号（'integer' 写成 integer 就静默失效）。
- node:sqlite 的同步 API 与 worker 通信都要有超时：proxy 侧单次调用 20s、exec/batch 60s，worker 崩溃最多重启 5 次。
- 新增表必须写新迁移文件（0002_xxx），不要改 0001：已部署实例靠 schema_migrations 只跑未应用的版本，改旧文件不会重跑。
- .gitignore 里写 data/ 会匹配任意层级的 data 目录（曾把 server/src/data 整层忽略掉），运行时数据必须写成 /data/。

## 六、前端实现约定（M2 落地）

- 技术栈：Vite 6 + TS + Tailwind v4（@tailwindcss/vite 插件）+ 原生 DOM 渲染函数 + 类名变体表，不引 React/shadcn。
- 令牌只在 web/src/styles/tokens.css：--c-* 定义深浅两套，@theme 映射成 Tailwind 颜色名（bg / fg / surface / muted / line / accent / secondary / tertiary / quaternary / quinary / ink）。组件里禁止硬编码颜色。
- 图案、阴影、文字阴影、动效在 web/src/styles/app.css 里是工具类：pattern-dots / pattern-stripes / pattern-checker / pattern-mesh、shadow-multi(-lg)、glow(-lg)、ts-1 / ts-2 / ts-3 / ts-mega / ts-cn、bg-riot(-2/-3)、panel、anim-*。
- 中文标题只用 ts-cn（单层），三层以上文字阴影只允许英文与数字。
- 动效分级靠 html 上的 data-tier（full / half）与 data-calm（true / false）：半功率档下 .anim-* 只对带 data-decor 的装饰元素生效；降噪模式与 prefers-reduced-motion 全部停帧。
- 主题与动效偏好存 localStorage：sw.theme（system / light / dark）、sw.tier、sw.calm；不进服务端 settings（多设备各自决定，访客也能切）。
- 图标是 web/src/ui/icons.ts 的内联 SVG 表；禁止 emoji。
- 品牌标是 Metro 磁贴版：强调蓝直角方块 + 白色书签 + 一块 55% 白小方砖；应用内用单色版（currentColor），favicon 与扩展用满色版；PNG 五档由 addons/scripts/make-icons.mjs 生成（无依赖）。
- 交互：链接拖拽（桌面 HTML5 DnD）+ 上移下移按钮；编辑用右侧抽屉（移动端全宽）；跨组重复走 409 后三选弹窗（allow / ignore / skip）。
- 页面级操作只在右下角胶囊（web/src/ui/capsule.ts）里：未登录 1 个「登录」，登录后 3 个（编辑锁 / 设置 / 登出）。顶栏只留品牌标，不要再往顶栏加图标。
- 编辑态是 `state.editing`（默认 false = 锁定只读）：`editable = authed && editing`，只有 editable 时才有拖动、增删改按钮与「加一条」入口；锁定时连拖拽都不绑定。退出登录会强制 `editing = false`。
- 布局外壳：html/body 100%，.app-shell 固定 100dvh + .app-scroll 内部滚动（页面有底，不无限向下）；顶栏不滚动。
- 普通组是真 tab（只渲染当前组），置顶组常驻顶部不进 tab。
- 书签页展开口径（已修正为真 tab）：不按分类做路由切页；置顶组固定顶部独立成块、不进 tab；普通组共用页内 sticky tab 条（滚动定位 + 联动高亮），内容始终全展开。
- 搜索框是网页搜索而非书签过滤：引擎在 web/src/ui/websearch.ts 定义（google / bing / duckduckgo / brave / startpage / mojeek / qwant），默认 google，选择存 sw.engine；新增引擎只改这一处。
- 色彩预算：书签页一页一个主色（按组轮转，只用于组标题圆点 / 选中态 / hover / 置顶区边框），链接卡与胶囊一律中性（border-fg/10~15、无彩色阴影、无每卡图案）。新增列表类组件先守这条，再谈风格。
- 卡片密度：桌面 1/2/3/4/5 列（sm/lg/xl/2xl），gap-4，卡片 padding p-4、圆角 20px、阴影走 `.shadow-multi-sm`（5/10px）。改密度只动 surfaces.card 与 bookmarks 的 class，不要在页面里散落写死尺寸。
- 按钮统一 `.pressable`：按下时 `translate(3px,3px)` 且阴影收到 3/6px，**不允许 shadow-none**；选中态（如分组 pill、主题按钮）保留 `shadow-multi-sm`。- 验收脚本：web/scripts/ui-check.mjs（样式与结构断言）、ui-flow.mjs（交互全流程），需要 puppeteer 与本地 chromium，不列为默认依赖。

## 五、悬而未决

详见 docs/plan/PLAN.md 的「待确认」表（D-1 去重范围、D-2 飞牛 manifest 规范、D-3 包内 Node 运行时交付方式）。
