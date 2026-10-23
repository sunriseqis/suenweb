# 项目记忆（长期，跨会话必读）

最后更新：M1 完成 + v1.6 去重/密码口径（后端可运行）。本文件只写「不该被重新讨论」的东西。

## 一、项目铁律

1. **目录铁律**：仓库顶层只有六个有序目录 —— server（后端）、web（前端）、fn（飞牛）、docker（容器）、docs（文档）、addons（插件）。新代码不得在顶层另开目录。
2. **文档铁律**：记忆类文档只写 docs/memory，计划类文档只写 docs/plan，原型 / 图标 / 视觉稿只写 docs/design；docs/README.md 是根摘要索引，任何文档增删改都必须同步更新它。
3. **需求编号即契约**：任务、PR、验收一律引用 REQUIREMENTS.md 的编号（NAV / AUTH / CAP / SYNC / IMP / BAK / EXT / UI / TOOL / OPS）。功能要增删，先改需求文档并追加裁决记录，再动代码。
4. **零原生依赖**：数据库用 Node 内置 node:sqlite，npm ci 不得触发任何编译。禁止引入 better-sqlite3 / sqlite3 / argon2 / sharp 等需要本地构建的包。
5. **主线程零同步 I/O**：node:sqlite 的同步 API 只允许出现在 server/src/data/worker.ts 内，主线程只能走 data/proxy.ts 的异步代理。
6. **读公开、写鉴权**：所有 GET 对外可读（访客只读），所有写操作必须持有效会话。
7. **产物不入库**：插件构建产物、前端构建产物、data/ 运行时数据、任何密钥与证书，一律 gitignore。

## 二、已锁定决策

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
| 浏览器 | Firefox 为主（MV3 事件页），Chrome/Edge 同步支持；不做 MV2 |
| 外观个性化 | UI-01~04 推迟 P3，M1–M6 不做 |
| AI | 全部移除，无 /api/ai/*、无 llm_* 配置 |

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
- 手写 JSON Schema 时 type 的值必须带引号（'integer' 写成 integer 就静默失效）。
- node:sqlite 的同步 API 与 worker 通信都要有超时：proxy 侧单次调用 20s、exec/batch 60s，worker 崩溃最多重启 5 次。
- 新增表必须写新迁移文件（0002_xxx），不要改 0001：已部署实例靠 schema_migrations 只跑未应用的版本，改旧文件不会重跑。
- .gitignore 里写 data/ 会匹配任意层级的 data 目录（曾把 server/src/data 整层忽略掉），运行时数据必须写成 /data/。

## 五、悬而未决

详见 docs/plan/PLAN.md 的「待确认」表（D-1 去重范围、D-2 飞牛 manifest 规范、D-3 包内 Node 运行时交付方式）。
