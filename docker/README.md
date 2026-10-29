# 部署指南

两种生产形态：**Docker**（通用自托管）与 **飞牛 fnOS 原生应用包**（见 fn/README.md，待官方文档核对后落地）。

## Docker（推荐）

前提：任意装了 Docker 的机器；构建上下文为仓库根目录。

```bash
# 构建并启动（数据落在 ./docker/data）
cd docker && docker compose up -d --build

# 查看健康
curl http://<机器IP>:8080/api/health
```

- 访问 http://<机器IP>:8080 即是导航页（前端由后端托管，无需单独的前端部署）
- 数据全部在容器 /data 卷（SQLite + 图标缓存 + 备份配置），升级只换镜像
- 走 HTTPS 反代时在 compose 里设置 `BASE_URL=https://book.example.com`（Cookie 会带 Secure）
- 服务端默认 `trustProxy: false`（没有前置反代的默认形态）：如部署在反向代理之后，需自行评估 `X-Forwarded-For` 信任问题——`req.ip` 会是反代地址，登录失败限速按该地址统计；确需透传真实客户端 IP 时应自行改 Fastify 的 trustProxy 配置并限制可信任的代理来源

### 镜像内容
- 后端源码 + 生产依赖（零原生模块，node:24-slim）
- 前端构建产物 public/（多阶段构建中由 vite 生成）
- 插件包构建产物 addons/dist/（供 /extension/download/* 自托管下载）

## 插件分发（OPS-02）

服务端自动托管 `addons/dist/` 里的产物：

- 下载列表：`GET /extension/download/list`
- 下载文件：`GET /extension/download/<name>.zip|.xpi|.crx`
- Firefox 开发者模式加载 xpi；Chrome/Edge 加载 zip 解压目录（裁决 30：AMO 正式签名仅发版人工一次）

## 备份

- Web 端「数据」页配置 WebDAV 后每日自动加密备份并轮转
- 换机迁移：导出加密 .swb1 → 新实例「还原加密配置」（需管理密码）

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| PORT | 8080 | 监听端口 |
| HOST | 0.0.0.0 | 监听地址 |
| DATA_DIR | ./data | 数据目录（SQLite/图标/缓存） |
| LOG_LEVEL | info | pino 级别 |
| SESSION_TTL_DAYS | 30 | 会话有效期 |
| BASE_URL | 空 | 反代 https 地址（影响 Cookie Secure） |
