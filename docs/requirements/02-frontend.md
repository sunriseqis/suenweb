# SuenWeb — Web 前端现状功能需求清单（02-frontend）

> 角色：需求分析师（前端范围）｜任务：只读现状梳理，供后续重构裁决
> 通读范围：templates/index.html（2471 行，全文分段读完）、static/css/style.css（1727 行，全文读完）、public/index.html 与 templates/index.html 全文比对、src/index.ts 的 app.get('*') 与前端实际调用的全部 API 端点
> 证据格式：文件:行号（index.html 指 templates/index.html；style.css 指 static/css/style.css）

---

## 0. 关键前置结论（务必先看）

### 0.1 页面是「静态文件直出」，不是 Worker 动态渲染模板

证据链：

1. src/index.ts:1483-1489 —— 兜底路由 app.get('*') 只做一件事：c.env.ASSETS.fetch(c.req.raw)，取不到再返回 404 文本；**没有任何读取 templates/index.html、没有模板渲染、没有 HTML 注入**。
2. wrangler.jsonc —— assets.directory = ./public，binding = ASSETS，not_found_handling = none。即 ASSETS 绑定就是 public/ 目录。
3. public/index.html 与 templates/index.html **完全一致**（diff 无输出，md5 均为 82827aaccabb51ceef5876fa21d6d763）。static/css/style.css 与 public/static/css/style.css 也完全一致（md5 a5da425f…）。
4. scripts/deploy.js:76-82 —— 部署脚本把 templates/index.html 复制为 public/index.html，把 static/ 复制为 public/static/，把 extension/ 复制为 public/extension/。
5. .github/workflows/build-extension.yml:9 —— CI 监听 templates/** 变更。

结论：**templates/ 是唯一「人类编辑源」，public/ 是构建产物（但被提交进仓库）**。运行时是 Cloudflare Assets 静态直出，前端是纯静态单文件 SPA（结构+样式+脚本全在一个 HTML 内，脚本 159-2469 行，约占全文 93%）。重构时应保留 templates → public 的构建语义，或改为真正的单一来源（当前「两份文件必须手工同步」是明确技术债，见 §6 债-01）。

### 0.2 前端技术形态

- 无框架、无构建、无模块化：全部为全局函数 + 全局变量（State、_widgetCfg、_isGuest、_editMode 等），脚本用 var/function 写 ES5 风格（index.html:159-2469）。
- 样式：单份 CSS，8 配色 × 4 视觉风格 × 4 背景模式，全部由 body 上的 data-* 属性驱动（style.css:68-467）。
- 状态：服务端为唯一真源（D1），前端每次写操作后 refresh() 全量拉取 /api/data 重渲染（index.html:482-503）；无本地缓存、无乐观更新（仅 toggleGroupType/deleteGroup 做乐观更新，772-791）。
- 鉴权：Bearer Token 存 localStorage 键 suenweb_token（index.html:162），编辑锁存 suenweb_edit_mode（2402）。

---

## 1. 功能需求清单（按模块）

### A. 页面骨架与初始化

| 编号 | 功能名 | 现状行为（用户可感知） | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| A-01 | 单页三段式布局 | 页面自上而下：Hero（时间天气+搜索）→ 固定组区 → 标签栏 → 标签内容区；底部右下角悬浮操作按钮组（FAB） | index.html:31-95；style.css:542-551（.app max-width 1280px）、554-600（.fab-actions 悬停才显现） | 无 | FAB 默认 opacity:0，靠 ::before 130×240 热区 hover 触发（style.css:565-576）；触屏 @media (hover:none) 常显（578-581）。可发现性偏弱 |
| A-02 | 背景三层 + 内容层 | 三个绝对定位背景层（图案/渐变/壁纸）互斥显示，内容浮于其上 | index.html:12-15；style.css:419-467 | body[data-bg-type] | 第 4 模式「纯色」不用独立层，直接改 body.background（index.html:1722、2051） |
| A-03 | 启动初始化顺序 | 打开页面：拉设置 → 应用图案/配色/风格/背景 → 渲染搜索引擎与时钟 → 拉字体列表并应用 → 判断登录态决定进「登录页 / 访客看板 / 首次设置密码」→ 绑定全部事件 | index.html:2426-2468（init）；2468 readyState 兜底立即执行 | GET /api/settings（无 token 只能拿公开键，src/index.ts:570-596）、GET /api/fonts、GET /api/data、GET /api/auth/status | 初始化期间 mainContainer 为 display:none（index.html:32），无骨架屏/加载态；所有子请求失败都静默 catch |
| A-04 | 全量重渲染模型 | 任何增删改成功后 refresh()=loadData()+renderAll()，整块重绘 pinnedArea/tabBar/tabContentArea | index.html:482-503、493-503 | GET /api/data → groups[{...,links[]}]（src/index.ts:314-317、src/db.ts:41-63） | 重绘导致「当前选中标签重置为第一个标签」（见 C-06）、输入焦点丢失 |
| A-05 | 空状态引导（Onboarding） | 无任何分组时，不显示固定区/标签栏/内容区，改为显示三选一引导卡：安装插件（zip/crx/xpi 三个下载入口）/ 上传书签文件 / 手动创建第一个分组 | index.html:55-86、493-499；style.css:1036-1074 | GET /extension/download/zip、/crx、/firefox（src/index.ts:1242-1296） | 「手动创建」按钮带 auth-only，未登录访客看不到；上传入口 id=bookmarkFileInput（76） |
| A-06 | 访客可读看板 | 已设密码但未登录时，仍可直接浏览全部导航数据（只读），点击右下角登录按钮才弹出密码框 | index.html:2418-2423（showGuestDashboard）、2445-2449；style.css:1652-1659 | GET /api/data（无鉴权，src/index.ts:314） | 数据完全公开是产品决策，重构时需用户裁决是否保留 |
| A-07 | 快捷操作按钮组 | 右下角 4 个圆钮：登录（访客可见）/设置/编辑模式开关/退出登录（登录后可见） | index.html:90-95；style.css:584-600 | 无 | 设置按钮悬停有旋转 35° 动效（style.css:600） |
| A-08 | 单例弹层体系 | 全局只有一个通用弹窗容器（modalCard）、一个居中设置弹窗、两个图标选择器、一个 toast 容器 | index.html:97-156 | 无 | 双套图标选择器与双套弹层显示机制并存（内联 style 切换 vs .open 类），见 §6 债-05 |

### B. 认证与权限

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| B-01 | 首次设置密码 | 数据库无密码时进入「欢迎使用 SuenWeb」，输入至少 6 位密码 → 创建并直接进入编辑模式 | index.html:682-719（showAuth）、703-716；677-678；18-29（DOM） | GET /api/auth/status → has_password；POST /api/auth/setup → token | 前端只校验长度≥6（705），强度策略由后端定；成功后自动 setEditMode(true)（709） |
| B-02 | 登录 | 已有密码时标题变「欢迎回来」，输密码登录；Enter 可提交；忙时按钮变「...」并禁用 | index.html:691-717；679（doLogin） | POST /api/auth/login → token | token 写入 localStorage |
| B-03 | 退出登录 | 点击退出 → 调登出接口 → 清本地 token → 整页 reload | index.html:2456、680（doLogout） | POST /api/auth/logout（需鉴权，src/index.ts:283） | 草率但可靠：reload 清空所有内存态 |
| B-04 | 修改密码 | 安全页填旧密码+新密码（≥6 位），保存后提示「密码已更新」并沿用返回的新 token | index.html:1881-1896；UI 1543-1551 | POST /api/auth/change-password → ok+token（src/index.ts:293-309，服务端清空全部旧 token） | 提示语告知「插件也需更新密码」（1545） |
| B-05 | 访客只读模式 | 未登录时隐藏：分组操作按钮、链接编辑钮、添加链接/标签/分组按钮、拖拽手柄、显示模式标签；置 body.guest-mode | index.html:2410-2417；style.css:1652-1659 | — | 客户端隐藏，非服务端强制（写接口本身有 requireAuth） |
| B-06 | 编辑锁（浏览/编辑模式） | 登录后可切换「编辑模式」；退出编辑时 body.browse-mode 隐藏全部编辑控件与拖拽手柄；状态持久化到 localStorage | index.html:2401-2409（setEditMode）、93（按钮）、2453（点击绑定）；style.css:1661-1670 | localStorage: suenweb_edit_mode | 与 B-05 是两套并行机制，样式类不同、语义重叠（guest-mode vs browse-mode） |
| B-07 | 401/令牌失效降级 | 带 token 拉数据失败时静默降级为访客看板，不提示原因 | index.html:2442-2444、725-729 | GET /api/data | 无「登录已过期」提示；重构成明确提示 + 跳登录 |
| B-08 | 顶层密码兜底 | 极端情况下若服务端登录/初始化未返回 token，前端把用户输入的明文密码当 token 使用 | index.html:678-679（State.token = r.token || pw） | POST /api/auth/* | 明显安全隐患/兜底残留，建议删除 |

### C. 分组（Group）管理

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| C-01 | 新建固定组 / 标签组 | 弹窗填写组名（必填）+ 选择图标（默认书签图标，可清空）；创建后整页刷新并提示 | index.html:732-751（addGroup）、540（+ 添加固定组）、560（+ 新增标签）、82（空状态入口） | POST /api/groups {name,icon,type}（src/index.ts:319-339） | 前端做同名去重校验（742），但后端无唯一约束；两条入口共用同一函数，仅 type 不同 |
| C-02 | 编辑分组 | 弹窗可改组名、图标、显示模式（紧凑/详情/仅图标）；固定组额外可改「排列方式（单列/多列）」 | index.html:752-771；520/577（编辑按钮） | PUT /api/groups/:gid {name,icon,display_mode,layout_mode}（src/index.ts:341-358，字段逐个 UPDATE） | 无颜色/备注/描述等扩展字段 |
| C-03 | 删除分组 | 卡片/标签上的删除按钮 → confirm 确认 → 乐观从本地移除并重绘 → 调接口，失败则回滚重拉 | index.html:782-791、520（删除）、559（tab 上 ✕）、759（编辑弹窗内删除） | DELETE /api/groups/:gid（src/index.ts:360-370） | 三处入口，行为一致；标签上 ✕ 与标签点击共用一个元素，靠 e.target.dataset.action 判断不切标签（581） |
| C-04 | 固定 ↔ 标签互转 | 固定组上「解固」、标签组上「固定」按钮，一键切换 type，乐观更新 + 失败回滚 | index.html:772-781、520/577 | PUT /api/groups/:gid {type} | 转换不改变 sort_order，位置可能在另一区里错位 |
| C-05 | 固定组区渲染 | 固定组按 layout_mode 分两类：single 组各自独占一行；multi 组按 packMultiRows 规则并排（1/2/3/4→[2,2]/≥3 每行 3 个） | index.html:522-542、543-554；style.css:805-827 | groups[].layout_mode | 行内列数由 JS 算出行数组后生成 cols-N 类（537），CSS 仅有 cols-1/2/3（821-823）；n=5 时生成 [3,2] |
| C-06 | 标签栏渲染与切换 | 标签按顺序渲染，永远第一个标签默认高亮，点击切换 .active（显示/隐藏 .tab-content） | index.html:555-589、579-588 | groups[].type==='tab' | 每次重渲染都回到第 1 个标签（i===0?'active':''），用户当前标签丢失；且 renderTabs 在 tab-content 里再画一遍组标题+编辑/固定按钮（577），与标签栏/卡片头重复 |
| C-07 | 固定组与标签去重显示 | 标签区渲染时排除「已存在于固定区的同 id 或同名组」 | index.html:500-502（renderAll 过滤） | — | 按 name 去重的历史兼容逻辑，说明曾允许同名重复数据；重构可简化 |
| C-08 | 分组内链接区渲染 | 每个组按 display_mode 渲染三种链接容器：compact=胶囊链接（固定组用 .pin-link，标签组用 .grid-link 单行标题）、grid=卡片（图标+标题+两行描述）、icon=方形图标块 | index.html:504-521、561-578；style.css:952-1021 | groups[].links[] | 标签组的 compact 模式实际渲染成 grid-link（只显示标题），与固定组 compact 视觉不同（572-575 vs 516-518）：同名模式两种外观 |
| C-09 | 组内"添加链接"按钮 | 每组底部（固定组）或末尾（标签组）一个虚线按钮 | index.html:520、577 | — | 文案不同：固定组「+ 添加链接」，标签组「+ 添加」 |

### D. 链接（Link）管理

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| D-01 | 新增链接 | 弹窗填标题（必填）、URL（必填）、描述、图标（可留空自动获取，带「内置」「在线」两个图标入口）；保存后刷新提示 | index.html:792-804 | POST /api/links {group_id,title,url,description,icon,icon_type}（src/index.ts:372-421） | 新增弹窗没有「刷新图标」和 AI 生成描述，与编辑弹窗能力不对等 |
| D-02 | 编辑链接 | 弹窗可改所属组（下拉全部组）、标题、URL、描述（带 AI「补全生成/重新生成」）、图标；底部按钮：删除/刷新（图标缓存）/取消/保存 | index.html:811-843 | PUT /api/links/:lid（src/index.ts:423-440）；POST /api/icon/refresh {url}（1212） | 改所属组是跨组移动的第二种方式（另一种是拖拽） |
| D-03 | 删除链接 | 弹窗内删除按钮 confirm 后删除 | index.html:829 | DELETE /api/links/:lid（442-464） | 后端副作用：删掉某组最后一个链接时，服务端会按组名把整组一并删除（src/index.ts:453-460），前端未提示 |
| D-04 | 链接图标渲染策略 | 按 icon_type 与 icon 值决定：emoji 文本 / /static/icons 内置 svg（反色滤镜）/ http 外链图标（走 /api/icon/proxy?url=）/ 无图标则由域名走 /api/icon/proxy?domain=；图片加载失败隐藏图片并显示兜底 span | index.html:429-442；style.css:1007-1008 | GET /api/icon/proxy（src/index.ts:1174） | 兜底 span 是空的（437/440），失败时无占位图标，视觉上"消失" |
| D-05 | 图标类型推断 | 前端按字符串猜类型：空→auto；/static/icons/ 或 http 开头→url；其余→emoji | index.html:805-810 | icon_type 字段 | 把"内置 svg"也标成 url，语义混乱（应为 builtin） |
| D-06 | 链接打开行为 | 全部链接 target=_blank + rel=noopener noreferrer，href 经 safeHref 白名单（仅 http/https/mailto/ftp）过滤，非法则 # | index.html:180、509/513/517/566/570/574 | — | 安全处理到位，但 javascript: 会静默变 # 无提示 |
| D-07 | 标题/描述转义 | 标题、描述、组名渲染前做 HTML 转义（escHtml）；属性值用 escAttr | index.html:178-179 | — | escAttr 不转义 < >，仅用于双引号属性场景，可接受 |

### E. 展示模式与布局

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| E-01 | 三种展示模式（紧凑/详情/仅图标） | 每组独立设置 display_mode；卡片头右侧显示当前模式的中文小标签（紧凑/详情/图标） | index.html:505-519、562-576、758；style.css:928-932 | groups[].display_mode：compact/grid/icon，默认 compact（src/index.ts:116、505） | 模式标签在访客/浏览模式下隐藏（style.css:1658、1668） |
| E-02 | 仅图标模式 | 链接渲染为正方形容器内的图标，无标题文字（title 属性悬停可见） | index.html:507-510、564-567；style.css:957-961、965-980 | display_mode='icon' | 依赖图标可用性，缺图标时几乎不可辨识（无兜底字母） |
| E-03 | 详情模式 | 图标 + 标题 + 描述（描述 2 行截断），右上角悬停出现编辑小按钮 | index.html:511-514、568-571；style.css:993-1021 | display_mode='grid' | 最小宽度 160px 自适应列（954），移动端 140px（1712） |
| E-04 | 固定组单列/多列 | 固定组可设 layout_mode=single（独占整行）或 multi（与其它 multi 组并排，行内 2~3 列）；≤900px 时多列自动堆叠 | index.html:524-539、543-554、758；style.css:811-827 | groups[].layout_mode，默认 single | single/multi 两个容器顺序不参与拖拽，视觉顺序＝先全部 single 再按 multi 行，与拖拽直觉可能不一致 |
| E-05 | 布局持久化 | 模式与布局都存数据库 groups 表（不在 settings） | src/index.ts:116-117；schema.sql:8-18 | groups_table.display_mode / layout_mode | 无"每行固定列数""跨列"等更细控制 |

### F. 拖拽排序

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| F-01 | 组排序拖拽 | 登录+编辑模式下，组卡片/标签可整体拖动，放到另一组位置上即交换顺序并立刻保存 | index.html:605-645（initDragAndDrop）、647-655（dropGroup）、520/559（drag-group） | POST /api/reorder/groups {ids}（src/index.ts:466-481） | 单一全局 sort_order 同时管理固定组与标签组，跨区拖拽语义模糊；拖拽手柄（⋮⋮）只是装饰——实际整卡可拖（style.css:1672-1683） |
| F-02 | 链接排序 / 跨组移动 | 链接可在组内重排，也可拖到其它组的链接区（跨组移动），落点决定插入位置 | index.html:657-674、626/637（.link-drop-zone 命中） | POST /api/reorder/links {group_id, ids}（src/index.ts:483-502，会同时改 group_id） | 跨组时发两次请求（目标组全量 + 源组全量，673），非原子；失败只 toast 并 refresh |
| F-03 | 拖拽视觉反馈 | 拖动元素 opacity .45 + 虚线描边；落点区 outline 2px 强调 | style.css:1684-1695 | — | drag-over 类只加不清（dragleave 依赖冒泡），偶发残留 |
| F-04 | 拖拽开关 | 访客或非编辑模式下 dragstart 直接 return；draggable 属性按是否访客渲染 | index.html:607、509/513/517 等（draggable 由 ! _isGuest 决定） | — | draggable 只判访客不判编辑模式，浏览模式下光标仍是可拖形，拖了没反应 |

### G. Hero 小组件：时钟 / 日期 / 天气

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| G-01 | 实时时钟 | 每秒刷新 HH:MM，支持 24 小时制 / 12 小时制 | index.html:36、2370-2378、2435（setInterval 1000）、1422（设置项） | settings.clock_format: 24h/12h | 每秒执行 updateClock 并连带 applyWidgetChrome() 重设属性（2377），无谓开销 |
| G-02 | 日期显示 | 中文长日期（2025年1月1日星期三） | index.html:37、2375-2376 | — | 与 12/24 小时制设置无关 |
| G-03 | 天气 | 显示天气图标 + 温度 + 城市名；城市可在设置里改（默认 Beijing）；失败显示「加载失败」 | index.html:40、2388-2398、1808-1809（改城市后立即重拉） | 浏览器直连第三方 https://wttr.in/{city}?format=j1（2392）；weatherCode→emoji 映射表（2394） | 只启动时拉一次，无定时刷新、无缓存、无重试；城市为空回落 Beijing；天气图标是硬编码 emoji 表 |
| G-04 | 时间天气组件样式（4 种） | 可选「信息长条 / 居中大卡 / 紧凑胶囊 / 极简文字」，整块 Hero 布局随之变化（含时钟字号、分割线、内边距） | index.html:33、1416-1419、2380-2386；style.css:683-749 | settings.widget_style：bar/stacked/pill/minimal | 旧值 center-card 兼容映射为 stacked（2300）；pill 模式隐藏日期（style.css:719）；body 上也镜像一份 data-widget-style 用于 FAB 定位（2385、style.css:749） |

### H. 搜索

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| H-01 | 关键词搜索 | 输入关键词按 Enter，新标签页打开对应引擎结果页（无历史、无联想） | index.html:44、2362-2367 | 引擎 URL 模板 _ENGINE_MAP（2335-2341） | 空关键词直接 return（2364） |
| H-02 | 多引擎切换 | 搜索框右侧引擎按钮组，点击切换当前引擎（高亮）并自动聚焦输入框，同时把该引擎写为默认 | index.html:45、2343-2350、2351-2361 | settings.search_engines（逗号分隔）、search_default | 内置 5 个：google/bing/baidu/duckduckgo/yandex；未知名会被过滤（2304-2306） |
| H-03 | 引擎启用与首选设置 | 小组件页勾选启用哪些引擎（至少留 1 个，全不选强制回 google），并可指定首选引擎（下拉只列已启用项） | index.html:1430-1438、1810-1831 | PUT /api/settings {search_engines, search_default} | 每次改选都重新调用 initSearch()（1827/1830），而它每次都重复给 searchInput 绑 keydown → 反复调整后按一次 Enter 可能连开多个标签页（真实 bug） |
| H-04 | 搜索框外观 | 放大镜图标 + 透明输入框 + 右侧引擎胶囊组；≤480px 隐藏引擎选择 | style.css:650-676、1724 | — | 无搜索历史、无快捷键（如 / 聚焦） |

### I. 背景与壁纸

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| I-01 | 四种背景模式（纯色/渐变/图案/壁纸，四选一） | 设置页四张预览卡切换；切换时联动显示对应子面板（图案/纯色色板/壁纸） | index.html:1237-1356、1698-1715、2049-2056 | settings.background_type | 模式互斥；渐变模式带 24s 缓动位移动画（style.css:439-448） |
| I-02 | 纯色背景自定义 | 取色器 + 十六进制输入双向同步，「应用」后立即改 body 背景并保存 | index.html:1256-1262、1717-1732 | settings.bg_solid_color（默认 #0d0e14） | 只在 solid 模式生效；预设切换会重置 body.background（2052） |
| I-03 | 图案样式（网格/圆点/斜线/无） | 4 张图案卡选择，仅图案模式可见 | index.html:1265-1283、1734-1743；style.css:425-436 | settings.pattern | gradient 模式下图案强制关闭（style.css:461） |
| I-04 | 壁纸源列表（必应 + SteamGridDB + 自定义） | 壁纸面板列出：必应每日（单行开关，标「当前」）、SteamGridDB 游戏源（可折叠，显示启用数，支持全启用/全禁用/单个开关/删除）、自定义源（名称 + AppID 或图片 URL + 类型下拉，添加） | index.html:1286-1332、2058-2134、2137-2152、2154-2157 | GET /api/wallpaper/sources → sources[]+interval+current_index+脱敏 key+configured（src/index.ts:994-1010）；POST/PUT/DELETE /api/wallpaper/source(/:id) | 必应源靠 name.includes('必应') 识别（2072），源改名即崩溃（bingSrc.enabled 取 null 抛错，被外层 try 转成「加载失败」）；自定义类型只有 steamgriddb/url |
| I-05 | SteamGridDB API Key 管理 | 输入 Key →「测试」走服务端探活并提示 →「保存」写设置，回填脱敏显示（前4后4） | index.html:1325-1333、1776-1799 | POST /api/wallpaper/sgdb-test（src/index.ts:1058-1077）；PUT /api/settings {steamgriddb_api_key} | 测试成功分支找 #sgdbStatus（1783），该元素在页面不存在 → 死代码；2128 同 |
| I-06 | 壁纸轮播 | 可选 15 分钟 / 30 分钟 / 1 小时 / 永不；非「永不」时前端 setInterval 定时拉下一张 | index.html:1335-1352、1748-1759、2019-2020、2022-2029 | settings.wallpaper_interval（秒，9999=永不）；POST /api/wallpaper/refresh {direction} | 定时器只在前端生命周期有效（关页即停）；「永不」= 9999 魔法值 |
| I-07 | 手动换壁纸 | 面板内「上一张 / 刷新 / 下一张」三按钮，点击期间禁用防连点 | index.html:1348-1352、1761-1766 | POST /api/wallpaper/refresh {direction} | 「刷新」与「下一张」行为完全相同（都传 next，1762 vs 1766），功能重复 |
| I-08 | 壁纸应用方式 | 先 new Image() 预加载，成功才设 backgroundImage（带 t=时间戳破缓存），失败 opacity 归 0；壁纸层固定 brightness(.55) saturate(1.1) 压暗保证文字可读 | index.html:2040-2047；style.css:450-457 | GET /api/wallpaper → url+background_type（src/index.ts:983-992） | url 未转义直接拼进 CSS（2044），含 ) 或引号会破坏样式（低危）；切到壁纸模式才加载（2054） |
| I-09 | 背景与主题解耦 | 背景模式/图案存 settings，与配色/风格独立，但预设（J-04）会一次性同时改三者 | index.html:1044-1076 | — | — |

### J. 主题：配色 / 视觉风格 / 预设 / 强调色

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| J-01 | 8 套配色方案 | 卡片选择「紫罗兰/海洋蓝/青碧/森林绿/日落橙/黑白灰/玫瑰红/琥珀金」，切换即时生效并保存 | index.html:1202-1235、1032-1041、1599-1614；style.css:68-288、213-240 | settings.color_scheme；body[data-scheme] | 每套方案定义 accent + bg/elevated/card/hover + glass + border 六组变量；mono 另有 4 风格交叉特例 |
| J-02 | 自定义强调色 | 取色器 + hex 输入 + 应用/重置；应用时按色相就近映射到最接近方案（沿用其表面色），并覆盖 --accent 系列变量 | index.html:1224-1234、1615-1634、1114-1148、1150-1161 | settings.accent_color（空=方案默认） | 自定义色会让预设高亮失效（_matchPreset 直接 return null，1082） |
| J-03 | 4 种视觉风格 | 「极简 / Bento / 毛玻璃 / 新粗野」四张预览卡切换，联动圆角、边框粗细、阴影、模糊、间距、图标尺寸、标题字重 | index.html:1361-1378、1673-1683；style.css:301-408 | settings.style；body[data-style] | 毛玻璃是真 backdrop-filter blur(20px)（style.css:307、831）；brutal 用硬阴影 4px 4px（386-387） |
| J-04 | 5 套一键预设 | 点预设卡同时应用「配色 + 风格 + 背景模式」三件套，并同步所有相关卡片选中态 | index.html:1178-1200、1044-1050、1052-1076、1586-1597 | 写 3~4 个 settings 键（style/background_type/color_scheme/accent_color） | 预设不含字体、图案，与「一键换肤」直觉有差距；ocean-breeze 会切壁纸模式并触发网络加载（1059） |
| J-05 | 风格/配色与 CSS 变量体系 | 全部视觉由 CSS 变量驱动，JS 只改 body 的 data-* 与少量 :root 变量 | style.css:17-60、301-408；index.html:1114-1139 | — | 强项设计，重构建议保留；但 --glass-intensity 只有内联声明（index.html:10），CSS 无引用 → 死变量 |
| J-06 | 遗留主题属性 | CSS 里遗留 [data-theme="..."] 空规则 6 条 | style.css:410-416 | — | 纯死代码；前端已无写 data-theme 的地方 |

### K. 字体与字号

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| K-01 | 全局字体选择 | 布局页一个下拉：系统默认 / 内置字体列表 / 「+ 自定义字体」（选它才展开新增面板） | index.html:1380-1406、2160-2181、1637-1654 | GET /api/fonts → fonts[]+font_*（src/index.ts:1082-1092） | 只保留一个全局项（原 font_title/font_body_en/font_code 三分工被合并，见 2310-2312 兜底读取） |
| K-02 | 添加自定义字体 | 填显示名称 + CSS font-family + CDN URL（woff2 或 Google Fonts css），保存后自动选中并应用 | index.html:1396-1405、1655-1672 | POST /api/fonts {name,family,cdn_url,language}（src/index.ts:1095） | 无 URL 可用性校验；保存即持久化，无一键撤销 |
| K-03 | 自定义字体删除 | 面板内列出已添加的自定义字体标签，✕ 删除 | index.html:1404、2175-2179、2183-2186 | DELETE /api/fonts/:fid（src/index.ts:1118） | 删掉正在用的字体后 _widgetCfg.font_body 仍指向不存在的字体（无回退） |
| K-04 | 字号滑块（12–18px） | 拖动即时预览，松手保存；整页按 --text-base 等比缩放 | index.html:1387-1395、1685-1695；style.css:32-41 | settings.font_size；:root --text-base | 只影响字号 scale，不影响间距 |
| K-05 | 字体应用实现 | 写入 --font-body/title/code 三变量 + body inline fontFamily/fontSize，并注入一段带 !important 的 style 覆盖 input/button 等；字体经服务端代理 /api/font-css/{id}.css 引入 | index.html:2188-2223 | GET /api/font-css/:fid.css、/api/font-woff（src/index.ts:1129-1173） | 每次重建 style 节点（旧的会 remove），但 link#font-link-{id} 从不清理，换字体后旧字体 css 仍挂载；!important 选择器清单硬编码（2204），新增组件易漏 |

### L. 设置面板框架

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| L-01 | 居中弹窗 + 左侧 8 项导航 | 居中大弹窗（880×620），左侧导航：预设/配色/背景/布局/小组件/书签/智能/安全；右侧标题 + 内容滚动区 + 关闭按钮 | index.html:97-119；style.css:1128-1260 | — | ≤900px 导航转顶部横向换行（style.css:1701-1708） |
| L-02 | 面板切换与重渲染 | 切 tab 时整块重建 settingsBody 的 HTML 再重新绑定事件；进入背景页延时 100ms 加载壁纸源 | index.html:1019-1029、1163-1170、1172-1575、1577-1995 | — | 切 tab 即重建 DOM → 未保存输入（SGDB Key、密码）切走即丢；事件用 onclick 覆盖式绑定 |
| L-03 | 关闭方式 | 右上 ✕、点遮罩空白、Esc 三种关闭 | index.html:114、2454-2455、422-428 | — | Esc 优先级：图标选择器 > 通用弹窗 > 设置面板 |
| L-04 | 设置读写通道 | 两条并行写法：saveSetting(单键) 与 saveWidgetCfg(批量多键)，都是 fire-and-forget（失败静默） | index.html:2011-2015 | PUT /api/settings（后端白名单 23 键，src/index.ts:598-617） | 关键 bug：saveWidgetCfg 每次都把 font_title/font_body_en/font_code 以空串提交（2013），改任一小组件设置就会清空这三项历史值；失败无提示 |

### M. 书签导入 / 导出

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| M-01 | 导入浏览器书签 HTML | 书签页「导入 HTML」→ 选文件 → 先调预览 → 弹窗显示"将导入 N 条/新增/跳过重复"与每组明细（最多 8 组）→ 确认后上传入库 → 提示新增数量 → 刷新 | index.html:1451-1460、1836-1846、844-867、76（空状态同源入口） | POST /api/import/preview（multipart）→ 后端实际返回 {total, folders:[{name,bookmarks}]}（src/index.ts:825-835）；POST /api/sync（multipart）→ {ok, imported}（752-823） | 接口契约不匹配（明显 bug）：前端读 p.groups/p.new/p.duplicate（851-857），后端只给 total 与 folders → 预览必显"新增 undefined、跳过重复 undefined"且明细为空；导入本身走 /api/sync 正常 |
| M-02 | 导出书签 HTML | 书签页「导出 HTML」→ 下载 suenweb_bookmarks.html | index.html:1455、893-907 | GET /api/export（需鉴权，src/index.ts:952） | blob + 临时 a 元素下载，1s 后 revoke |
| M-03 | 重复判定口径 | 界面文案明确「按完整 URL 判重，不按域名合并」 | index.html:1453、855、873 | src/db.ts:65-77（去 www、去尾斜杠、保留 query） | 与用户直觉有偏差，需产品裁决 |
| M-04 | 导入数据特征 | 导入的组标记 is_imported=1、链接 synced_to_browser=1 | src/index.ts:786-810 | — | 前端无任何区分/展示，用户不可见 |

### N. 重复链接工具

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| N-01 | 查重与批量清理 | 书签页「查重」→ 无重复则 toast「没有发现重复链接」；有则弹窗按 URL 分组列出，每组第一个固定「保留」（禁选），其余默认勾选为「删除」→ 确认后批量删除并刷新 | index.html:1457、869-891、1847-1848 | GET /api/tools/duplicates（src/index.ts:507-534，返回 total_groups+groups）；POST /api/tools/duplicates/delete {ids}（535-548） | 前端判 d.total_duplicates（872），后端只返回 total_groups → 疑似"有重复也提示没有重复"（待确认 §7-1）；保留哪条由后端 id 升序决定，用户不可选 |

### O. 链接健康检查（失效链接工具）

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| O-01 | 批量检测失效链接 | 智能页勾选分组 →「检测」→ 显示"✅正常 / ❌失效 / 共N"，逐条列出失效链接（标题/所属组/访问/错误原因），可勾选后一键批量删除 | index.html:1526-1536、1869-1870、2264-2290 | POST /api/ai/check {group_ids} → {total,working,broken,results:[{id,title,url,group,ok,status,error}]}（src/index.ts:1457-1478；src/ai.ts:379-430） | 放在「智能」页却完全不用 AI，仅 HTTP HEAD/GET 探活（6s 超时）；删除是逐条 DELETE /api/links/:id 循环（2285），非原子；每条删除都会触发后端"组空即删组"副作用 |
| O-02 | 分组多选辅助 | 「全选 / 反选」按钮 + 已选数量回显到按钮文案 | index.html:1517-1534、1996-2010 | — | 智能页两块（补全、检测）共用同一套多选助手，靠前缀区分 |

### P. 配置备份与恢复

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| P-01 | 导出全部配置 | 安全页「导出配置」→ 下载 suenweb_config_YYYY-MM-DD.json | index.html:1554-1570、1899-1913 | GET /api/config/export → {version:1,exported_at,settings,groups,wallpapers,fonts,extensions}（src/index.ts:619-645） | 导出含敏感项（llm_key、steamgriddb_api_key），仅排除 auth_password_hash（623）；无加密、无提示 |
| P-02 | 导入配置（带预览） | 选 .json → 校验 version===1 → 显示导出时间与 settings/分组/链接/壁纸源/字体/插件数量 + 黄色警告「导入将覆盖现有分组和链接」→ 确认导入 → 提示导入的分组/链接数 → 刷新 | index.html:1915-1994 | POST /api/config/import（647+，先 DELETE links/groups_table 再重建） | 覆盖式导入无二次确认弹窗（只有文案警告）；无回滚、无自动备份提醒 |
| P-03 | 导入后的收尾 | 成功后 refresh() 并调用 loadSettings() 重新加载设置 | index.html:1973-1978 | — | loadSettings 函数全文不存在（仅此一处调用，1978）→ 抛 ReferenceError 被外层 catch 捕获，成功导入后用户仍看到红色错误 toast（明显 bug） |

### Q. AI 智能补全

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| Q-01 | 免配置 AI 说明与自定义 LLM | 智能页强调「默认已启用免费 Workers AI，无需 Key」；高级折叠面板可填自定义 OpenAI 兼容 API 地址/密钥/模型，保存后生效 | index.html:1493-1512、1871-1878 | PUT /api/settings {llm_url,llm_key,llm_model}；后端默认走 c.env.AI（src/index.ts:1355-1410、src/ai.ts） | 三字段明文存 settings，导出配置会带出密钥 |
| Q-02 | 批量补全组图标 + 链接描述 | 勾选分组 →「补全 N 组」→ 先图标、后描述两段串行，结果汇总成一行状态，最后刷新数据 | index.html:1514-1524、1866-1868、2226-2251 | POST /api/ai/suggest-icons {llm_*,group_ids} → {message,updated}（src/index.ts:1355-1395）；POST /api/ai/describe {llm_*,group_ids} → {message,count}（1397-1455） | 只补"缺图标/缺描述"的项（后端 WHERE icon 为空 / description 为空），已有内容一律跳过；无进度条、无逐条结果、无撤销 |
| Q-03 | 单条链接 AI 生成描述 | 编辑链接弹窗「补全生成 / 重新生成」→ 生成描述并回填描述框（保存后落库） | index.html:828、831；2253-2262 | POST /api/ai/describe {link_id} → {description}（src/index.ts:1415-1427） | 后端生成时已直接 UPDATE links.description（1425），前端只回填输入框，用户"取消"也改不了已写库数据（行为不一致） |

### R. 浏览器插件下载与云端插件库

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| R-01 | 插件下载入口（两处） | ① 空状态引导卡：Chrome/Edge (.zip 解压加载)、Edge/其它 (.crx)、Firefox (.xpi)；② 书签页「浏览器插件」块：Chrome/Edge zip + Firefox xpi 两个大按钮 + crx 小链接 + Chrome 安装说明 | index.html:65-69、1472-1483；style.css:1533-1542 | GET /extension/download/zip、/crx、/firefox（src/index.ts:1242-1296，后端动态打包） | 无独立"扩展下载页"，全部内嵌在设置/空状态；两处文案与按钮数量不一致 |
| R-02 | 云端已备份插件列表 | 列出插件备份：名称 + 版本 + 更新时间；同名插件按 Chrome/Firefox 合并一行，右侧 🟢/🦊 分别跳对应商店（未备份一侧灰显不可点），并有删除按钮 | index.html:1485-1489、930-984、957-962、920-928 | GET /api/extensions → extensions[]（src/index.ts:1297-1310）；DELETE /api/extensions/:id（1345） | 合并行删除只删一侧：delId 取 chrome.id 优先（966），Firefox 行残留（bug）；条目数徽标按合并后行数计（952） |
| R-03 | 商店跳转规则 | 有 Web Store ID（32 位 a-p）→ 用库里 url 或 crxsoso 详情页；Firefox → AMO 按名搜索；其它 → Chrome 商店按名搜索 | index.html:920-928 | — | 与服务端写库时生成逻辑重复（src/index.ts:1324-1329），双份实现 |
| R-04 | 插件在线状态 | 显示「插件在线（N）/ 离线」与「上次通讯」 | index.html:1445-1449、1850-1861 | GET /api/sync/status → {last_sync_at,last_sync_from,total_links,total_groups,pending_sync,listeners}（src/index.ts:862-877） | 后端 listeners 硬编码 0（875），前端按 listeners>0 判在线（1855）→ 永远显示「离线」，功能实际不可用 |
| R-05 | 备份/同步状态摘要 | 显示「分组：N · 链接：N · 待插件同步：N · 上次通讯 · 来源」 | index.html:1462-1465、1859-1860 | 同上 | 无手动触发同步按钮；pending_sync 无解释入口 |

### S. 图标选择（内置 / 在线）

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| S-01 | 内置图标选择器 | 弹窗 8 列网格展示全部内置 SVG，顶部按名称搜索过滤，点击选中，确定后回填输入框并就地显示预览 | index.html:143-156、352-419；style.css:864-927 | GET /api/builtin-icons → icons[{name,path}]（src/index.ts:1230-1238） | 首次拉取后缓存到 window._builtinIcons（360-370）；内置图标共 104 个 SVG（static/icons/）；有「加载中/加载失败/无图标」三态 |
| S-02 | 在线图标选择器 | 另一套弹窗：选图标 API（vemetric / favicon.im / 自定义前缀）+ 填目标域名 → 实时预览并显示生成的图标 URL → 确定回填 | index.html:128-140、207-345 | 生成的是第三方 favicon 服务地址，实际取图由 /api/icon/proxy 代理（D-04） | 与 S-01 完全独立两套实现（DOM、样式、开关机制都不同），可合并为一个选择器两个 tab |
| S-03 | 图标预览联动 | 组/链接图标输入框旁预览小方块随选择即时更新 | index.html:326-330、380-383、445-450 | — | 预览写死 filter:invert(1)，只适配深色主题 |
| S-04 | 清空图标 | 编辑组弹窗 ✕ 把图标置空并回显默认书签图标 | index.html:445-450、735/758 | — | 仅组有；链接无「清空图标」（只能手删输入框） |
| S-05 | 组图标渲染兜底 | 组图标支持 emoji 或 /static/icons 路径；空或旧值 📁 统一显示默认书签 SVG；加载失败自动替换默认图标 | index.html:443-444、451-457 | — | — |

### T. 操作日志与统计

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| T-01 | 操作日志列表 | 书签页底部显示最近 30 条操作（动作名 + 目标 + 时间），空则「暂无操作记录」，失败「加载失败」 | index.html:1467-1470、909-918 | GET /api/ops/logs?limit=30 → logs[]（src/index.ts:549-565） | detail 字段前端完全未用；无分页、无筛选、无清空 |
| T-02 | 日志覆盖范围 | 服务端记录：建/改/删组、建/改/删链接、排序、导入、AI 补全 | src/index.ts:336/355/367/418/437/452/478/499/818/1393 | operation_log 表（schema.sql:54-60） | 前端不感知哪些操作会记 |
| T-03 | 无实时事件推送 | 后端提供 SSE /api/events/stream 与 event_log，但前端从未连接（无 EventSource） | src/index.ts:904；index.html 全文无 events/stream 引用 | — | 多端/插件改动后网页不会自动刷新，需手动刷新；"后端已就绪、前端未接"的空白点 |

### U. 通知 / 空状态 / 加载态 / 错误提示

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| U-01 | Toast 轻提示 | 底部居中弹一条彩色提示（success 绿/error 红/info 蓝），2.5s 淡出、3s 后移除 DOM | index.html:169-177；style.css:1630-1649 | — | 只有 3 种类型；toggleSGDB 用了错拼类型 'err'（2140），会得到无样式 toast |
| U-02 | 通用弹窗 | 居中卡片弹窗，自动聚焦第一个可交互元素，支持点遮罩关闭、Esc 关闭 | index.html:181-194、426、2464；style.css:1553-1585 | — | HTML 由字符串拼接（大量内联 style），与 CSS 设计系统脱节 |
| U-03 | 空状态 | ①无任何分组→Onboarding 三选一；②插件备份列表空→提示去插件点「插件备份」；③图标选择器空/失败；④操作日志空/失败 | index.html:493-499、55-86、953-955、391/360-367、913/917 | — | 覆盖较全 |
| U-04 | 加载态 | 基本只有文字占位「加载中…」「检查中…」「...」按钮态；无骨架屏、无 spinner、无整体加载遮罩 | index.html:361、1291、1306、1447、1464、1469、1488、706、2234 | — | 数据加载期间 Hero/卡片空白或显示旧数据 |
| U-05 | 错误提示 | 表单类错误进 toast；登录类错误显示在 authError 行内；接口失败大多静默（空 catch），如设置保存失败、壁纸加载失败 | index.html:470/477（api 抛错）、489-491（loadData 吞错）、2012-2015（保存静默）、2028/2037（壁纸静默） | — | 失败静默面过大：改设置没保存成功用户完全无感；重构建议统一错误通道 |

### V. 键盘与可访问性

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| V-01 | Esc 关闭层叠弹窗 | 按 Esc 依序关闭：图标选择器 → 通用弹窗 → 设置面板 | index.html:421-428 | — | 仅此一个全局快捷键；无搜索聚焦键（/ 或 Ctrl+K）、弹窗内无 Enter 提交 |
| V-02 | 局部 Enter 提交 | 登录框 Enter = 点登录按钮；搜索框 Enter = 新开结果页 | index.html:717、2362-2363 | — | 其它弹窗（新建组/链接）不支持 Enter 提交 |
| V-03 | 语义与焦点 | 主区块有 role/aria-label；设置弹窗有 aria-modal；:focus-visible 统一描边；尊重 prefers-reduced-motion | index.html:32-55、98；style.css:535-539 | — | 图标选择器与通用弹窗缺 role=dialog/aria-modal；动态渲染的 grid 链接无 aria；整体"基本可用、细节不足" |

### W. 移动端适配

| 编号 | 功能名 | 现状行为 | 实现位置证据 | 依赖 | 备注 |
|---|---|---|---|---|---|
| W-01 | 响应式断点 | 4 档：≤900px（设置弹窗转纵向、多列固定组堆叠、选择器 2 列）、≤768px（内边距收紧、链接卡 140px、设置行纵排）、≤720px（Hero 单列、FAB 缩小）、≤480px（隐藏引擎栏、天气字号缩小） | style.css:751-762、824-827、1700-1727 | — | 无平板横屏专门优化；断点分散在 4 处 |
| W-02 | 触屏 FAB 常显 | @media (hover:none) 时 FAB 组常驻可点，避免依赖 hover | style.css:578-581 | — | — |
| W-03 | 移动端触控交互缺口 | 排序依赖 HTML5 原生 drag&drop（dragstart/dragover/drop） | index.html:605-645 | — | 触屏浏览器对 HTML5 DnD 支持极差，移动端基本无法拖拽排序，也无"上移/下移"备选 |
| W-04 | 视口与安全区 | 有 viewport meta（width=device-width, initial-scale=1.0），无 viewport-fit=cover / safe-area-inset 适配 | index.html:5 | — | 刘海屏/底部手势条下 FAB 可能贴边（22px 内边距，待真机确认） |

---

## 2. 数据模型（前端实际消费的字段）

> 前端不直接访问数据库，全部经 API；下列为前端读取/写入的字段集合。

### 2.1 groups_table（分组）

| 字段 | 类型/取值 | 前端用途（证据） |
|---|---|---|
| id | int | 一切操作的标识（data-id / data-group-id，520/559 等） |
| name | text | 展示、同名去重校验（742、500-501） |
| icon | text（emoji 或 /static/icons/*.svg） | 组图标（451-457）；新建默认空串（740），后端默认 📁（src/index.ts:323） |
| type | 'pinned' / 'tab'（默认 tab） | 分固定区/标签区（500-502）、互转（772-781） |
| display_mode | 'compact' / 'grid' / 'icon'（默认 compact） | 三态展示（505-519、562-576）、编辑项（758） |
| layout_mode | 'single' / 'multi'（默认 single） | 固定组单列/多列（524-539、758） |
| sort_order | int | 全局唯一排序序列，拖拽写回（466-481） |
| links[] | 嵌套数组 | 组内链接（后端组装，src/db.ts:41-63） |

关系：1 group → N links（links.group_id 外键）。注意后端在「删除某组最后一个链接」时会连带删除该组（src/index.ts:453-460），因此"空组"几乎不可存在。

### 2.2 links（链接）

| 字段 | 类型/取值 | 前端用途 |
|---|---|---|
| id / group_id | int | 标识 / 归属组（拖拽改归属，668-673） |
| title / url | text | 展示与跳转（safeHref 白名单，180） |
| description | text | 详情模式第二行、AI 生成（573、828） |
| icon | text | 三类：emoji / /static/icons/x.svg / http(s) URL（429-442） |
| icon_type | 'auto' / 'url' / 'emoji' | 前端猜值写入（805-810） |
| sort_order | int | 组内顺序（672-673） |

### 2.3 其他间接依赖表（经 API）

| 表 | 前端触点 |
|---|---|
| settings | 全部外观/组件/LLM/安全配置（§3） |
| wallpapers + wallpaper_state | 壁纸源列表、当前索引、轮播（994-1056） |
| fonts | 字体下拉与自定义字体（1082-1128） |
| ext_repo | 云端已备份插件（1297-1353） |
| operation_log | 操作日志（549-565） |
| sync_state | 插件通讯状态（862-877） |
| icon_cache / steamgriddb_cache | 由 /api/icon/proxy 与壁纸服务内部使用，前端不感知 |
| auth_tokens | 前端只持有 token 字符串 |

---

## 3. settings 键清单（前端读写）

| key | 用途 | 前端写入处 | 前端读取处 | 备注 |
|---|---|---|---|---|
| color_scheme | 8 套配色之一 | 1114-1139、applyPreset | 2316 | 与 accent_color 组合决定最终强调色 |
| accent_color | 自定义强调色 #rrggbb（空=方案默认） | 1114-1139 | 2317 | 非空时预设高亮失效（1082） |
| style | 视觉风格 glass/minimal/bento/brutal | 1055、1680 | 2318 | — |
| background_type | solid/gradient/pattern/wallpaper | 1057、1706 | 2314 | 与 body data-bg-type 同步 |
| pattern | grid/dots/diagonal/none | 1741 | 2431 | 只在 pattern 模式可见 |
| bg_solid_color | 纯色背景色，默认 #0d0e14 | 1724 | 2315 | — |
| weather_city | 天气城市，默认 Beijing | 2013（saveWidgetCfg） | 2299 | 改名后立即 fetchWeather |
| clock_format | 24h / 12h | 2013 | 2298 | 命名不一致：写 clock_format，内存字段叫 _widgetCfg.clock |
| widget_style | bar/stacked/pill/minimal | 2013 | 2300（center-card→stacked 兼容） | — |
| search_engines | 启用引擎，逗号分隔 | 1825 | 2301（过滤未知引擎） | 至少 1 个，空则回退 google |
| search_default | 首选引擎 | 2013、2360（点引擎即存） | 2302 | — |
| llm_url / llm_key / llm_model | 自定义 OpenAI 兼容 LLM | 2013、1872-1878 | 2307-2309 | 明文存储，导出配置会带出 |
| font_body | 全局字体 family（唯一字体项） | 1650、1666、2013 | 2310-2312（兼容读三个旧键） | 三分工已合并 |
| font_title / font_body_en / font_code | 旧的三类字体 | 2013 每次被以空串覆盖 | 2310-2312 | bug 源：任何小组件设置变更都会清空这三项 |
| font_size | 全页基础字号 12–18px | 2013、1694 | 2313 | 驱动 --text-base |
| wallpaper_interval | 轮播间隔秒（900/1800/3600/9999） | 1753 | 2330-2331 | 9999 = 永不 |
| steamgriddb_api_key | SteamGridDB API Key | 1793 | 不直接读（用 /api/wallpaper/sources 脱敏值） | 明文存储 |
| glass_intensity | 玻璃强度 | 前端从不写 | 前端从不读 | 死配置：只有 body 内联 --glass-intensity:1（index.html:10），CSS 无引用；后端仍在白名单/公开键（src/index.ts:581、601） |
| theme | 旧主题键 | 从不写 | 从不读 | 死配置（src/index.ts:581；CSS 有 [data-theme] 空规则 style.css:410-416） |
| weather_size / clock_size | 天气/时钟字号 | 从不写 | 从不读 | 死配置（src/index.ts:582、602）；字号实际由 font_size + widget_style 控制 |
| ai_provider / ai_model | AI 提供商/模型 | 从不写 | 从不读 | 死配置（src/index.ts:603） |
| auth_password_hash | 密码哈希 | 前端从不接触 | — | 服务端专用（导出时排除，src/index.ts:623） |

补充：PUT /api/settings 只接受后端白名单内 23 个键（src/index.ts:600-608），白名单外的键会被静默丢弃。新增配置项必须同步改后端，否则前端"保存成功"实则丢失。

---

## 4. 第三方外部依赖

| 依赖 | 用途 | 调用方/证据 | 风险备注 |
|---|---|---|---|
| wttr.in（?format=j1） | 天气数据 | 浏览器直连（index.html:2392） | 免费公共实例，可能限速/超时/被墙；无缓存与降级；暴露用户 IP 与城市 |
| favicon.vemetric.com、a.favicon.im | 在线图标 URL 模板（仅拼串，不直接请求） | index.html:197-201；取图走 /api/icon/proxy（1174） | 第三方可用性依赖；自定义前缀模式允许任意域名（边界由服务端代理决定） |
| Google / 必应 / 百度 / DuckDuckGo / Yandex | 搜索跳转（仅 URL 模板替换） | index.html:2335-2341、2366 | 无 API/无 Key |
| Chrome Web Store / Firefox AMO / crxsoso.com | 已备份插件的商店跳转 | index.html:920-928（与服务端 1324-1329 重复） | crxsoso 为第三方镜像，可用性有风险 |
| SteamGridDB API | 游戏壁纸源 | 服务端 /api/wallpaper/sgdb-test（src/index.ts:1058-1077）与 wallpaper.ts | 需用户自备 Key |
| Bing 每日壁纸 | 内置壁纸源 | 服务端 wallpaper.ts（前端只显示开关，2082-2089） | 内置源不可删除（src/index.ts:1036） |
| Workers AI（及可选 OpenAI 兼容 API） | 图标建议 / 描述生成 | 服务端 src/ai.ts | 前端只传 llm_* 配置 |
| 用户自填字体 CDN（woff2 / Google Fonts CSS） | 自定义字体 | index.html:1396-1405；经 /api/font-css 代理（1129） | 无校验、无体积限制提示 |
| 自打包 zip/crx/xpi | 插件分发（无商店上架） | src/index.ts:1242-1296 | 需手动安装，有浏览器安全提示 |

---

## 5. 定时 / 后台任务

| 任务 | 触发 | 证据 | 与前端相关 |
|---|---|---|---|
| 每日数据备份（R2 BACKUP_DB，回退 D1 backups 表，保留 30 份） | Cloudflare Cron，wrangler.jsonc triggers.crons = "40 18 * * *" | wrangler.jsonc；src/index.ts:1496-1525 | 否（前端无入口、无提示、无手动备份按钮） |
| 时钟刷新 | 前端 setInterval 1000ms | index.html:2435 | 是 |
| 壁纸轮播 | 前端 setInterval（按 wallpaper_interval） | index.html:2019-2020 | 是（关页即停；页面隐藏时仍在跑） |
| 天气刷新 | 仅启动时一次，无定时 | index.html:2435（fetchWeather 只在 init 调用） | 是 |
| 插件心跳 / 事件通知 | 后端 notifyChange 写 event_log；/api/sync/heartbeat | src/index.ts:879-884、904-951 | 否（前端不订阅 SSE，见 T-03） |

---

## 6. 已知技术债（按严重度）

- 债-01 templates/index.html 与 public/index.html 是两份必须手工/脚本同步的重复文件（当前 md5 相同）。真源在 templates/，但 wrangler dev / 静态托管读 public/（wrangler.jsonc assets）。改错文件会出现"改了没生效"。2471 行单文件同时承载结构 + 3000 行级脚本，是重构第一优先。
- 债-02 配置导入后调用不存在的 loadSettings()（index.html:1978，全文无定义）→ 成功导入后必现错误 toast。
- 债-03 书签导入预览接口契约不匹配：前端读 groups[]/new/duplicate（851-857），后端返回 total/folders[]（src/index.ts:825-835）→ 预览永远 undefined 且明细为空。
- 债-04 查重结果字段不匹配：前端判 d.total_duplicates（872），后端返回 total_groups + groups（src/index.ts:527-534）→ 疑似"有重复也提示没有重复"（待确认）。
- 债-05 两套图标选择器（内置 143-156 / 在线 128-140，逻辑 352-419 / 207-345）功能高度重叠，DOM/开关机制/样式各自实现；弹层显隐也有两套（inline style vs .open 类）。
- 债-06 两套保存通道 saveSetting（单键，2015）与 saveWidgetCfg（批量，2011-2014）语义重叠，后者用空串覆盖 font_title/font_body_en/font_code；失败全静默。
- 债-07 重复绑定导致多开标签：initSearch（2351-2368）每次调用都给 #searchInput 增一个 keydown 监听，而它在 1827/1830/2434 被反复调用 → 改过搜索引擎后按一次 Enter 会打开多个结果页。
- 债-08 插件在线状态永远"离线"：/api/sync/status 的 listeners 硬编码 0（src/index.ts:875），前端据 listeners>0 判断（1855）。
- 债-09 已备份插件合并行删除只删一侧（index.html:966 delId chrome 优先），Firefox 记录残留。
- 债-10 编辑链接 AI 描述前后端语义不一致：后端已落库（src/index.ts:1425），前端只回填输入框（831），"取消"也改不了数据。
- 债-11 删除最后一个链接会连带删组（src/index.ts:453-460），前端无提示，与"空组可存在"直觉冲突。
- 债-12 分组排序只有一个全局 sort_order，固定区与标签区共用序列，且固定区内部再按 single/multi 分桶渲染（524-539）→ 拖拽顺序与视觉顺序可能不一致；拖拽手柄是装饰（整卡可拖）。
- 债-13 标签切换状态不稳定：每次 renderAll 都回到第 1 个标签（559/561 的 i===0?'active':''）。
- 债-14 重复渲染：renderTabs 在 tab-content 里再画一次组名标题（577），与标签栏/卡片头重复。
- 债-15 移动端无法拖拽排序：依赖 HTML5 DnD（605-645），无触屏方案与"上移/下移"备选。
- 债-16 死代码清单：formatInterval（2018）从未调用；#sgdbStatus（1783、2128）元素不存在；CSS 的 [data-theme] 6 条空规则（410-416）、.accent-grid/.accent-swatch（1262-1280）、.wp-summary（1496）、.style-desc（1420）无使用者；settings 键 theme/glass_intensity/weather_size/clock_size/ai_provider/ai_model 前端从不读写；State.settings（163）从未赋值，State.syncStatus 只写不读（488）。
- 债-17 敏感信息明文：llm_key、steamgriddb_api_key 明文存 settings 且随"导出配置"导出（src/index.ts:619-641 只排除 auth_password_hash）；SGDB Key 保存后回填脱敏串（1796-1797），再次保存有把含 **** 的串写回库的风险（待确认服务端是否原样保存）。
- 债-18 内联样式与会话式 HTML 拼接泛滥：设置/弹窗几乎全部用 JS 拼 HTML + 内联 style（793、828、1290-1322），与 style.css 的 token 体系脱节，硬编码颜色（#f87171、#a78bfa 等）不随主题变化（877、2234、2248、2277）。
- 债-19 无框架/无模块化：约 2300 行全局脚本，靠全局变量耦合（State、_widgetCfg、_isGuest、_editMode、_fontList、_wpTimer、_dragState、_suppressSettingSave…），可测试性为零。
- 债-20 无 SSE/无自动刷新：后端 /api/events/stream 已实现（src/index.ts:904-951）但前端未接，多端/插件同步后页面不自动更新。
- 债-21 错误静默面积过大：saveSetting/saveWidgetCfg/refreshWallpaper/loadWallpaper/loadData 失败全不提示（2012-2015、2028、2037、489-491）。
- 债-22 每秒 updateClock 都调 applyWidgetChrome()（2377），每秒重设 DOM 属性，页面隐藏时仍运行。
- 债-23 商店跳转规则双份实现（前端 920-928 / 后端 1324-1329），修改需两处同步。

---

## 7. 待确认（需产品/后端确认，当前无足够代码证据）

1. /api/tools/duplicates 是否返回 total_duplicates：src/index.ts:527-534 只见 total_groups/groups，需确认是否有其他版本补了该字段（影响 N-01 的判断逻辑）。
2. 访客可读全部导航数据（/api/data 无鉴权）是否为有意设计（A-06），重构是否保留。
3. /api/sync/status.listeners 是否计划接入真实在线数（R-04），或改为"最近心跳时间差"判定。
4. SGDB API Key 保存后回填脱敏串、再次保存是否会污染真实 Key（债-17）。
5. 删除组内最后一个链接即删组（债-11）是否为有意行为。
6. 「刷新」与「下一张」壁纸按钮是否应合并（I-07）。
7. 天气是否改为服务端代理（避免浏览器直连 wttr.in 的可用性与隐私问题）。
8. public/ 是否继续提交进仓库（当前构建产物入库，与 templates/ 双份维护）。
