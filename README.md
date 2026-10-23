# SuenWeb 2.0

自托管书签服务：浏览器插件一键收藏 → 服务端统一存储 → 加密备份 / 导入导出 / 跨浏览器扩展清单还原。

## 目录

| 目录 | 职责 |
|---|---|
| server/ | 后端：Fastify 5 + node:sqlite（worker 内），零原生依赖 |
| web/ | 前端：Vite + TS + 原生 DOM |
| fn/ | 飞牛 fnOS 原生应用包 |
| docker/ | 容器化部署 |
| addons/ | 浏览器插件（Firefox 优先） |
| docs/ | 文档：摘要 / 需求 / 架构 / memory / plan / design |

## 快速开始（开发期统一 npm，不折腾容器）

    npm --prefix server install
    npm run dev          # 默认 http://127.0.0.1:8080
    npm test             # node:test + fastify inject
    npm run bench        # 低阻塞基线：p50/p95/p99 + event loop 延迟

首次启动后调用 POST /api/auth/setup 设置管理密码（该密码同时是备份口令）。

## 文档入口

先读 docs/README.md（摘要索引），再读 docs/memory/MEMORY.md（铁律与决策）与 docs/plan/PLAN.md（进度）。
