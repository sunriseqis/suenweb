# SuenWeb 2.0 技术架构（v1 · 本地部署 + 低阻塞）

> 配套文档：[REQUIREMENTS.md](./REQUIREMENTS.md)（功能基线 v1.4）。本文只定「怎么搭」，功能口径以功能基线为准。

---

## 一、结论摘要（选型表）

| 层 | 选型 | 一句话理由 |
|---|---|---|
| 运行时 | **Node.js 22 LTS（ESM）** | 长驻进程、无 CPU 时长与子请求上限、可跑常驻定时任务、本地文件系统可用 |
| HTTP | **Fastify 5** | 全链路 async、schema 校验、流式响应、低内存开销、内置静态文件与限流钩子 |
| 数据库 | **SQLite（WAL）+ Node 内置 node:sqlite，运行在 worker_threads 内** | **零原生依赖**（无需 node-gyp/预编译二进制）；同步 API 只出现在 worker 线程，主线程仍不阻塞 |
| 迁移 | 轻量自研 migrator（SQL 文件 + schema_migrations 表） | 单一 DDL 来源，替代旧版「schema.sql + 运行时建表」双份 |
| 缓存 | 进程内 LRU（图标/设置）+ 磁盘缓存目录 | 避免重复外呼第三方 favicon |
| 实时 | **SSE**（Node 原生流），预留 WebSocket 升级位 | 插件只需单向事件，SSE 更简单且可自动重连 |
| 定时 | **node-cron**（进程内，带互斥锁与幂等键） | 每日备份等任务无需外部调度器 |
| WebDAV | webdav（npm，基于 fetch） | 备份目标的唯一外部依赖 |
| 加密 | node:crypto（PBKDF2 + AES-256-GCM，异步 API） | 备份口令 = 管理密码，见功能基线第九章 |
| 前端 | **Vite + TypeScript，原生 DOM 模块化（不引框架）** | 保留零框架体积，同时拿到类型、模块与构建产物 |
| 测试 | node:test + Fastify inject；前端 vitest | 零额外框架依赖，CI 秒级 |
| 打包分发 | Docker 镜像 + **fnOS 原生应用包**（非 Docker 转包） | 本地部署两形态，开发期只用 npm |

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
| **fnOS 原生应用包** | 飞牛 NAS 应用中心安装 | **原生应用**（非 Docker 转包）：包内自带运行时/启动脚本 + manifest 声明端口与数据目录 |

> 开发阶段不纠结 Docker：以 npm 为唯一验收路径；Docker 与 .fpk 在 M7 收尾期一次性打通。

---

## 四、低阻塞并发设计（本次「架构升级」的核心，8 条铁律）

1. **主线程禁止同步 I/O**：禁用 fs.*Sync 与任何同步 DB 调用；node:sqlite 的同步 API **只允许出现在数据 worker 内**，主线程只能通过消息通道访问，用 ESLint（no-sync / no-restricted-syntax + 目录级禁用）把关。
2. **SQLite 读写分离**：数据 worker 内 WAL + busy_timeout，写操作走**单写者队列（concurrency=1）**，读操作可在 worker 内并发处理，避免 SQLITE_BUSY 重试风暴；worker 崩溃由主线程自动重启并回放未完成任务。
3. **外部 HTTP 统一封装**：统一 fetch 包装器，默认超时 6s、并发上限 8（可配）、失败退避重试 1 次、结果进缓存。图标抓取/失效检测/WebDAV 全走它。
4. **CPU 重活下沉 worker_threads**：ZIP 打包、大对象加密、图片转码、超阈值批量解析进线程池，HTTP 线程只做 I/O 编排。
5. **流式优先**：导入用 multipart 流式解析边读边写；导出/下载/备份上传用 stream，不把整库塞进内存。
6. **后台任务与请求解耦**：备份、失效检测、批量操作写入 jobs 表由任务执行器异步消费，接口立即返回 job id；任务带幂等键与重试。
7. **背压与资源上限**：bodyLimit、requestTimeout、每 IP 限流；SSE 连接数上限与空闲清理；集合查询强制 limit/游标。
8. **优雅关闭**：SIGTERM → 停止接收 → 等在途请求（10s 超时）→ 停调度与 SSE → 关库；容器重启不产生半写状态。

**可测量目标**（M1 结束用 autocannon/k6 落基准）：读写混合 200 QPS 下 p95 ≤ 200ms；事件循环延迟 p99 ≤ 50ms；批量导入 5000 条 ≤ 20s。

---

## 五、目录结构（必守）

    suenweb/
      server/                 后端（Fastify 5 + node:sqlite，零原生依赖）
        src/
          server.ts           启动入口（读配置、跑迁移、注册路由、起调度器）
          app.ts              Fastify 实例装配
          config.ts           环境变量与默认值（启动即校验，失败即退出）
          data/
            worker.ts          SQLite 数据 worker（唯一持有 node:sqlite 句柄）
            proxy.ts           主线程异步代理（查询 / 事务批量 / 语句缓存 / 读写分流）
            migrate.ts         迁移器（写入 worker 内、启动时执行）
            migrations/        0001_init.sql ...
            repositories/      groups / links / settings / extensions / backups / sessions
          domain/              纯业务逻辑（归一化、合并策略；无 IO，易单测）
          http/
            routes/            auth, data, groups, links, settings, import, export, backup, extensions, sync, icon, events
            plugins/           auth-guard, rate-limit, error-handler
          infra/               logger / crypto / webdav / fetcher / icon / scheduler / jobs / cache
          workers/             worker_threads（zip / 加解密 / 解析 / 抓取）
        test/                  node:test + fastify inject
        package.json
      web/                     前端（Vite + TS + 原生 DOM；原型来自 docs/design）
      addons/                  浏览器插件（Firefox MV3 事件页为主，Chrome/Edge 同步支持）
      fn/                      飞牛 fnOS 原生应用包（manifest + 运行时 + fnpack 脚本）
      docker/                  Dockerfile / docker-compose.yml / .dockerignore
      docs/                    摘要索引 / 需求 / 架构 / memory / plan / design
      data/                    运行时数据（gitignore；容器挂载 /data）

---

## 六、npm 脚本约定（开发期唯一入口）

| 脚本 | 作用 |
|---|---|
| npm run dev | node --watch 启动后端（原生 TS 类型擦除，无需构建），默认 http://127.0.0.1:8080 |
| npm run db:migrate | 执行未应用的迁移 |
| npm run db:reset | 清库重建 + 种子（仅开发） |
| npm run build | 后端无需构建（直接跑 TS）；前端 vite build → public（生成物不入库） |
| npm start | 生产启动（容器与飞牛原生包共用同一启动约定） |
| npm test / test:watch | node:test + fastify inject（后端）；前端测试随 web 成型后补 |
| npm run lint | eslint + tsc --noEmit |
| npm run pack:ext | 生成插件 xpi/zip/crx（产物不入库） |
| npm run pack:fpk | 打飞牛原生应用包（fn/，仅 M7） |

---

## 七、配置（环境变量，zod 校验后注入）

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| PORT | 否 | 8080 | 监听端口 |
| DATA_DIR | 否 | ./data | 数据目录（SQLite / 图标缓存 / 临时备份） |
| HOST | 否 | 0.0.0.0 | 监听地址；容器与飞牛内需 0.0.0.0，本机开发可用 127.0.0.1 |
| BACKUP_WRAP_KEY | 否 | — | 包裹备份派生密钥；缺省按功能基线第九章的降级方案 |
| BASE_URL | 否 | 自动推断 | 生成绝对链接 |
| TZ | 否 | Asia/Shanghai | 定时任务时区 |
| LOG_LEVEL | 否 | info | pino 日志级别 |
| OUTBOUND_CONCURRENCY | 否 | 8 | 出网并发上限 |

说明：**不再需要 SESSION_SECRET** —— 会话为不透明随机 token，服务端只存其 SHA-256 哈希，Cookie 无需签名密钥；管理密码用 scrypt 哈希存 settings 表。

---

## 八、部署形态细节

### 8.1 Docker

- 多阶段构建：builder（npm ci + 前端 build）→ runtime（node:24-slim，非 root，只带 server/src、public、package.json）。
- 文件位置：docker/Dockerfile、docker/docker-compose.yml、docker/.dockerignore（构建上下文为仓库根）。
- 唯一持久化点：**卷 /data**（SQLite 文件 + 图标缓存 + 临时备份）。
- compose 提供：端口映射、卷、环境变量、restart: unless-stopped、healthcheck（GET /health）。

### 8.2 fnOS 原生应用包（非 Docker 转包）

- **定位**：fnOS 形态是**原生应用**，由系统直接拉起 Node 服务进程，**不是把 Docker 镜像转成 .fpk**。因此两种形态各自独立构建，但共享同一份源码与同一套启动约定。
- **运行时交付**：包内自带按架构匹配的 Node 运行时（amd64 / arm64 各一份），或使用 Node SEA 打成单文件可执行；启动脚本负责指定数据目录、端口与日志位置。不依赖 NAS 上预装 Node。
- **与 Docker 形态的差异**：Docker 用镜像层隔离、卷挂载 /data；原生应用用系统路径（应用私有数据目录）持久化，SQLite 文件与图标缓存放该目录，升级时保留。
- **打包工具**：仍以官方 fnpack 产出安装包（fnpack build），但包内容为原生应用而非镜像。
- **M7 前必须以官方「原生应用」文档核对**：manifest 中应用类型/启动命令/端口与反代的声明写法、应用私有数据目录的规范路径、运行用户与权限、日志目录约定、多架构分发方式、应用中心提交流程。核对项逐条落到 packaging/fpk 的 README，未确认前不写死字段名。
- **目录约定**：fn/ 放 manifest 模板、启动/停止脚本、fnpack 打包脚本（版本号取自 package.json），核对结论也回填到 fn/README.md。

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

已定：
- **数据库：零原生依赖** → node:sqlite（Node 内置）+ worker_threads 承载，npm 安装不需要编译工具链。
- **前端：Vite + TypeScript + 原生 DOM**（不引框架）。
- **实时：SSE**（预留 WebSocket 升级位）。

仍待核对：
1. fnOS **原生应用**的官方打包规范（manifest 字段、启动方式、数据目录、端口/反代、权限、多架构）。
2. 原生应用包内 Node 运行时的分发方式：随包携带（体积大、离线可用）还是 SEA 单文件（体积小、构建复杂）。建议先随包携带，稳定后再评估 SEA。
3. 是否需要 PostgreSQL 兼容：当前单文件 SQLite 已足够，需要多实例共享再上 PG。
