# SuenWeb Docker 部署指南

## 快速开始

### 1. 准备数据目录

**重要**：容器以非 root 用户（uid 10001）运行，挂载目录必须有正确权限：

```bash
mkdir -p data
sudo chown -R 10001:10001 data
# 或者
chmod 777 data
```

### 2. 使用 Docker Compose（推荐）

```bash
cd docker
docker compose up -d
```

### 3. 使用 Docker 命令

```bash
docker run -d \
  --name suenweb \
  -p 8080:8080 \
  -v $(pwd)/data:/data \
  ghcr.io/sunriseqis/suenweb:latest
```

## 权限问题排查

如果遇到 `unable to open database file` 错误：

```bash
# 停止容器
docker compose down

# 修复权限
sudo chown -R 10001:10001 ./data

# 重新启动
docker compose up -d
```

## 本地构建

如需本地构建镜像：

```bash
cd docker
# 编辑 docker-compose.yml，注释 image 行，启用 build 行
docker compose up -d --build
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TZ` | `Asia/Shanghai` | 时区 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `NODE_ENV` | `production` | 运行环境 |
| `BASE_URL` | 空 | 走 https 反代时填写，Cookie 才会带 Secure |

## 数据持久化

数据存储在 `./data` 目录，包括：
- `suenweb.db` — SQLite 数据库
- `icons/` — 图标缓存

## 健康检查

```bash
curl http://localhost:8080/api/health
```

## 更新

```bash
cd docker
docker compose pull
docker compose up -d
```
