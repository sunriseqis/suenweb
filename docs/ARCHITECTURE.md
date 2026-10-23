# SuenWeb 2.0 技术架构（v1 · 本地部署 + 低阻塞）

> 配套文档：[REQUIREMENTS.md](./REQUIREMENTS.md)（功能基线 v1.4）。本文只定「怎么搭」，功能口径以功能基线为准。

---

## 一、结论摘要（选型表）

| 层 | 选型 | 一句话理由 |
|---|---|---|
| 运行时 | **Node.js 22 LTS（ESM）** | 长驻进程、无 CPU 时长与子请求上限、可跑常驻定时任务、本地文件系统可用 |
| HTTP | **Fastify 5** | 全链路 async、schema 校验、流式响应、低内存开销、内置静态文件与限流钩子 |
| 数据库 | **SQLite（WAL）+ 异步驱动（默认 @libsql/client）** | 单文件零运维；驱动异步原生，主线程不做阻塞调用 |
| 迁移 | 轻量自研 migrator（SQL 文件 + schema_migrations 表） | 单一 DDL 来源，替代旧版「schema.sql + 运行时建表」双份 |
| 缓存 | 进程内 LRU（图标/设置）+ 磁盘缓存目录 | 避免重复外呼第三方 favicon |
| 实时 | **SSE**（Node 原生流），预留 WebSocket 升级位 | 插件只需单向事件，SSE 更简单且可自动重连 |
| 定时 | **node-cron**（进程内，带互斥锁与幂等键） | 每日备份等任务无需外部调度器 |
| WebDAV | webdav（npm，基于 fetch） | 备份目标的唯一外部依赖 |
| 加密 | node:crypto（PBKDF2 + AES-256-GCM，异步 API） | 备份口令 = 管理密码，见功能基线第九章 |
| 前端 | **Vite + TypeScript，原生 DOM 模块化（不引框架）** | 保留零框架体积，同时拿到类型、模块与构建产物 |
| 测试 | node:test + Fastify inject；前端 vitest | 零额外框架依赖，CI 秒级 |
| 打包分发 | Docker 镜像 + fnOS .fpk（fnpack） | 本地部署两形态，开发期只用 npm |

---

## 二、为什么退出 Cloudflare Workers（阻塞与限制清单）

| 旧约束 | 影响 | 本地化后的处理 |
|---|---|---|
| 每请求子请求数上限（免费 50） | 图标抓取、失效检测、批量导入随时撞墙 | 进程内并发池（默认 8~16）+ 超时 + 缓存，无硬上限 |
| CPU 时间上限 | 导出/加密/打包大对象会被掐断 | CPU 重活下沉 worker_threads，可长时间运行 |
| 无长驻后台任务 | 每日备份只能靠 cron trigger，SSE 靠轮询 | 进程内 cron + 常驻 SSE 连接管理 |
| D1 全局锁 + 逐条往返 | 批量导入/排序现场是逐条 INSERT/UPDATE | SQLite WAL + 单写队列 + 事务批处理 |
| 无本地文件系统 | 插件产物被迫 base64 内嵌进 TS（186KB） | 直接读磁盘，产物由构建生成、不入库 |
| isolate 冷启动重入 | 建表自举挂在每个 isolate 首次请求 | 启动时一次性迁移 |

---

## 三、运行形态（三套；开发只走 npm）

| 形态 | 用途 | 启动方式 |
|---|---|---|
| **开发/测试** | 日常开发与全部测试环境 | **npm run dev**（tsx watch），数据落在 ./data |
| **Docker** | 通用自托管（NAS/服务器/云主机） | docker compose up -d（镜像含构建产物，/data 卷持久化） |
| **fnOS 应用包** | 飞牛 NAS 应用中心安装 | .fpk 包（同一镜像 + manifest 声明端口/卷/图标） |

> 开发阶段不纠结 Docker：以 npm 为唯一验收路径；Docker 与 .fpk 在 M7 收尾期一次性打通。

---

## 四、低阻塞并发设计（本次「架构升级」的核心，8 条铁律）

1. **主线程禁止同步 I/O**：禁用 fs.*Sync、禁用同步 DB 驱动（better-sqlite3 默认同步 API 不直接用），用 ESLint（no-sync / no-restricted-syntax）把关。
2. **SQLite 读写分离**：WAL + busy_timeout；所有写操作走**单写者队列（concurrency=1）**，读操作并发不限，避免 SQLITE_BUSY 重试风暴。
3. **外部 HTTP 统一封装**：统一 fetch 包装器，默认超时 6s、并发上限 8（可配）、失败退避重试 1 次、结果进缓存。图标抓取/失效检测/WebDAV 全走它。
4. **CPU 重活下沉 worker_threads**：ZIP 打包、大对象加密、图片转码、超阈值批量解析进线程池，HTTP 线程只做 I/O 编排。
5. **流式优先**：导入用 multipart 流式解析边读边写；导出/下载/备份上传用 stream，不把整库塞进内存。
6. **后台任务与请求解耦**：备份、失效检测、批量操作写入 jobs 表由任务执行器异步消费，接口立即返回 job id；任务带幂等键与重试。
7. **背压与资源上限**：bodyLimit、requestTimeout、每 IP 限流；SSE 连接数上限与空闲清理；集合查询强制 limit/游标。
8. **优雅关闭**：SIGTERM → 停止接收 → 等在途请求（10s 超时）→ 停调度与 SSE → 关库；容器重启不产生半写状态。

**可测量目标**（M1 结束用 autocannon/k6 落基准）：读写混合 200 QPS 下 p95 ≤ 200ms；事件循环延迟 p99 ≤ 50ms；批量导入 5000 条 ≤ 20s。

---

## 五、目录结构（拟）

    suenweb/
      src/
        server.ts            启动入口（读配置、跑迁移、注册路由、起调度器）
        app.ts               Fastify 实例装配
        config/              环境变量与默认值（zod 校验）
        data/
          client.ts          SQLite 连接与单写队列
          migrations/        0001_init.sql ...
          repositories/      groups / links / settings / extensions / backups / sessions
        domain/              纯业务逻辑（无 IO，易单测）
        http/
          routes/            auth, groups, links, settings, importExport, backup, extensions, sync, icon, events
          plugins/           auth-guard, rate-limit, error-handler
        infra/
          crypto.ts          PBKDF2 / AES-256-GCM（备份加解密）
          webdav.ts          WebDAV 客户端与连通测试
          fetcher.ts         统一出网（超时/并发/重试/白名单）
          icon.ts            favicon 抓取与缓存
          scheduler.ts       node-cron + 互斥
          jobs.ts            后台任务执行器
          logger.ts          pino
          cache.ts           LRU
        workers/             worker_threads（zip/加密/解析）
      web/                   前端（Vite + TS）源码
      public/                前端构建产物（生成，不入库）
      packaging/
        docker/              Dockerfile, docker-compose.yml
        fpk/                 manifest 模板 + repack.sh（fnpack build）
      data/                  运行时数据（gitignore，容器挂载 /data）
      docs/

---

## 六、npm 脚本约定（开发期唯一入口）

| 脚本 | 作用 |
|---|---|
| npm run dev | tsx watch 启动服务（默认 http://127.0.0.1:8080） |
| npm run db:migrate | 执行未应用的迁移 |
| npm run db:reset | 清库重建 + 种子（仅开发） |
| npm run build | 后端 tsc → dist；前端 vite build → public |
| npm start | node dist/server.js（生产启动，容器内使用） |
| npm test / test:watch | node:test（后端）+ vitest（前端） |
| npm run lint | eslint + tsc --noEmit |
| npm run pack:ext | 生成插件 xpi/zip/crx（产物不入库） |
| npm run pack:fpk | 构建镜像并打 .fpk（仅 M7） |

---

## 七、配置（环境变量，zod 校验后注入）

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| PORT | 否 | 8080 | 监听端口 |
| DATA_DIR | 否 | ./data | 数据目录（SQLite / 图标缓存 / 临时备份） |
| SESSION_SECRET | **是** | — | 会话与签名密钥 |
| BACKUP_WRAP_KEY | 否 | — | 包裹备份派生密钥；缺省按功能基线第九章的降级方案 |
| BASE_URL | 否 | 自动推断 | 生成绝对链接 |
| TZ | 否 | Asia/Shanghai | 定时任务时区 |
| LOG_LEVEL | 否 | info | pino 日志级别 |
| OUTBOUND_CONCURRENCY | 否 | 8 | 出网并发上限 |

---

## 八、部署形态细节

### 8.1 Docker

- 多阶段构建：builder（npm ci + build）→ runtime（node:22-slim，非 root，仅带 dist / public / package.json）。
- 唯一持久化点：**卷 /data**（SQLite 文件 + 图标缓存 + 临时备份）。
- compose 提供：端口映射、卷、环境变量、restart: unless-stopped、healthcheck（GET /health）。

### 8.2 fnOS 应用包（.fpk）

- **格式与工具（已核实）**：.fpk 由官方工具 **fnpack** 打包（fnpack build）；本质是**双层压缩包**，外层为 manifest 等元数据，内层为应用包内容；应用主体以 **Docker 镜像**交付，因此 fnOS 形态与 Docker 形态共用同一镜像。
- **发布流程**：构建镜像（amd64/arm64）→ 导出/推送 → manifest 版本号递增 → fnpack build 产出 .fpk。
- **M7 前需以官方文档核对**：manifest 字段名与必填项、端口/卷/图标声明写法、多架构支持方式、应用中心提交流程（可参考社区实现 fn-fpk-builder-skill、live-complie 的打包脚本）。
- **目录约定**：packaging/fpk 放 manifest 模板与 repack.sh，版本号取自 package.json。

---

## 九、与功能基线的映射

| 功能域 | 架构支撑 |
|---|---|
| NAV 书签核心 | Fastify routes + repositories + SQLite 索引（url_normalized、groups.name UNIQUE） |
| AUTH 访客只读 | auth-guard 插件：读路由公开、写路由鉴权 |
| CAP/SYNC 插件联动 | /api/sync/* + SSE 事件流；插件侧不变，仅改服务地址 |
| IMP 导入导出 | multipart 流式解析 + 统一 crypto（口令 = 管理密码） |
| BAK 加密备份 | scheduler + webdav + crypto + 保留份数轮转，均走 jobs 异步执行 |
| EXT 扩展清单 | 普通 CRUD + 商店链接规则单点实现 |
| OPS 部署运维 | 本文第三 / 六 / 八章 |

---

## 十、待定事项（不影响 M1 开工）

1. 数据库驱动：默认 @libsql/client（异步原生）；若希望零原生依赖，可改 better-sqlite3 + worker 线程封装。
2. 前端构建：默认 Vite + TS + 原生 DOM；若接受轻量框架，可换 Svelte/Preact 进一步压缩状态管理代码量。
3. 实时通道：默认 SSE；若将来要做多端协同编辑再换 WebSocket。
4. 是否需要 PostgreSQL 兼容：当前单文件 SQLite 已足够，需要多实例共享再上 PG。
