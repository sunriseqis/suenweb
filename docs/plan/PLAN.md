# 开发计划（唯一进度来源）

最后更新：M1 完成。

## 里程碑

| 里程碑 | 范围 | 状态 |
|---|---|---|
| M1 地基 | 六表 + 迁移器 + 分组/链接 CRUD（同名合并、去重、排序、跨组移动）+ 访客只读鉴权 + npm run dev 可跑 + 冒烟测试 | **已完成** |
| M2 前端主线 | 书签页、分组导航、编辑、搜索、响应式（接用户原型） | 待用户原型 |
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

## 待确认（需用户裁决或外部核实；D-1 已关闭）

| 编号 | 问题 | 现状 |
|---|---|---|
| D-1 | 链接去重范围 | **已裁决（v1.6）**：同组静默去重、跨组 409 弹窗放行、忽略后不再提示 |
| D-2 | 飞牛原生包 manifest 字段与数据目录规范 | 需按官方文档核对，不许编造 |
| D-3 | 飞牛包内 Node 运行时交付方式（内置运行时 vs SEA 单文件） | M7 前定 |

## 下一步

1. 等前端原型落到 docs/design/prototypes，确定字段与交互后再开 M2（web/ 接 Vite 代理到 127.0.0.1:8080）。
2. M3 插件开工前先定「收藏 → 落库 → 回写书签」的时序（SYNC-03 不许先 ack）。
