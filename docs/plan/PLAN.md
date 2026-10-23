# 开发计划（唯一进度来源）

最后更新：M1 完成。

## 里程碑

| 里程碑 | 范围 | 状态 |
|---|---|---|
| M1 地基 | 六表 + 迁移器 + 分组/链接 CRUD（同名合并、去重、排序、跨组移动）+ 访客只读鉴权 + npm run dev 可跑 + 冒烟测试 | **已完成** |
| M2 前端主线 | 设计系统落地（深浅双主题）+ 书签主页（分组导航 / 网格与列表 / 搜索 / 访客只读态）+ 登录与首设密码页 + 设置页骨架 + 链接编辑抽屉 + 跨组重复弹窗 | **已完成** |
| M3 插件快速收藏 | Firefox MV3 事件页 + Chrome 同步收藏、心跳、pending/ack | 未开始 |
| M4 导入导出 + 加密备份 | 导入预览与提交、书签导出、配置加密导出/导入、WebDAV 每日备份与轮转 | 未开始 |
| M5 扩展清单 | 插件侧清单上报、服务端比对与还原 | 未开始 |
| M6 治理工具与体验 | 死链检查、重复清理、图标缓存、移动端 | 未开始 |
| M7 分发 | docker/ 定稿、fn/ 原生包、CI、部署文档 | 未开始 |

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
## 待确认（需用户裁决或外部核实；D-1 已关闭）

| 编号 | 问题 | 现状 |
|---|---|---|
| D-1 | 链接去重范围 | **已裁决（v1.6）**：同组静默去重、跨组 409 弹窗放行、忽略后不再提示 |
| D-2 | 飞牛原生包 manifest 字段与数据目录规范 | 需按官方文档核对，不许编造 |
| D-3 | 飞牛包内 Node 运行时交付方式（内置运行时 vs SEA 单文件） | M7 前定 |

## 下一步

1. 等前端原型落到 docs/design/prototypes，确定字段与交互后再开 M2（web/ 接 Vite 代理到 127.0.0.1:8080）。
2. M3 插件开工前先定「收藏 → 落库 → 回写书签」的时序（SYNC-03 不许先 ack）。
