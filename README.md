# SuenWeb

轻量自托管个人导航页，搭配浏览器插件实现收藏夹云端同步。

## 特性

- **📑 书签管理** — 分组 + 链接拖拽排序，支持跨组移动和紧凑/详情/图标展示模式
- **🔄 浏览器插件同步** — Chrome / Edge / Firefox 插件，收藏夹实时双向同步
- **🖼️ 壁纸系统** — 必应每日壁纸 + SteamGridDB 游戏壁纸 + 自定义 API 源，支持随机/上一条/下一条切换
- **🔤 字体系统** — 内置汇文明朝体/京华老宋体/LXGW WenKai/抖音美好体，支持自定义 CDN 字体
- **🤖 AI 功能** — LLM 自动生成链接描述、链接有效性检测
- **🔒 密码保护** — Bearer Token 认证，保护个人数据
- **📤 导入导出** — 支持 Netscape HTML 书签导入预览、重复跳过和导出
- **🎨 主题定制** — 毛玻璃效果、网格/点阵图案、渐变色方案、纯色背景，以及时间天气组件风格
- **📡 SSE 实时推送** — 网页端变更实时通知浏览器插件
- **🏷️ 图标自动获取** — 多源 favicon 抓取 + SQLite 缓存
- **🧹 维护工具** — URL 级重复链接检查、图标刷新、操作日志

## 快速开始

### 环境要求

- Docker & Docker Compose
- Git

### 部署

```bash
# 1. 克隆仓库
git clone https://github.com/sunriseqis/suenweb.git
cd suenweb

# 2. 启动服务
docker compose up -d

# 3. 浏览器访问
# http://localhost:5080
```

首次访问时设置访问密码即可开始使用。数据库和所有数据存储在 `data/` 目录中。

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TZ` | 时区 | `Asia/Shanghai` |
| `PIP_INDEX_URL` | pip 镜像源 | 清华镜像 |

认证 token 存储在 SQLite 中，容器重启后不会因为内存清空而失效。

### 端口

默认映射 `5080:5000`，可根据需要修改 `docker-compose.yml` 中的端口映射。

### 反向代理

**先验证直连可用：** `curl http://localhost:5080/health` 应返回 `{"status":"ok"}`。

然后将反代上游指向容器：

| 场景 | 上游地址 |
|------|----------|
| 反代在同一台宿主机 | `http://127.0.0.1:5080` |
| 反代在同一 docker-compose 内 | `http://suenweb:5000` |
| 反代在另一 docker-compose（需加入同一网络） | `http://suenweb:5000` |

**跨 compose 方案：** 在反代的 compose 中加入外部网络 `suenweb-net`，并在 suenweb 的 compose 中将网络设为 `external: true`。

**关键：SSE 必须禁用缓冲和延长超时。**

Nginx:
```nginx
location / {
    proxy_pass http://suenweb:5000;          # 按上表替换
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;                     # SSE 实时推送
    proxy_read_timeout 86400s;               # 不超时断开
}
```

Caddy:
```
example.com {
    reverse_proxy suenweb:5000 {
        flush_interval -1
    }
}
```

## 浏览器插件

插件支持 Chrome / Edge（Manifest V3）和 Firefox。

### 安装方式

1. 启动 SuenWeb 服务后，访问 `http://your-server:5080`
2. 登录后在设置中找到插件下载入口，下载对应浏览器版本的 zip 包
3. Chrome/Edge：打开 `chrome://extensions`，开启「开发者模式」，加载已解压的扩展程序
4. Firefox：直接安装提供的 `.xpi` 文件

### 直接下载

- Chrome/Edge: `http://your-server:5080/extension/download/chrome`
- Firefox: `http://your-server:5080/extension/download/firefox`

插件配置服务器地址后，点击同步即可将浏览器收藏夹导入 SuenWeb；网页端的变更也会自动推送到插件。

## API 概览

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/auth/status` | GET | 否 | 检查是否已设密码 |
| `/api/auth/setup` | POST | 否 | 初始设置密码 |
| `/api/auth/login` | POST | 否 | 登录获取 token |
| `/api/data` | GET | 否 | 获取所有分组和链接 |
| `/api/groups` | POST | 是 | 创建分组 |
| `/api/links` | POST | 是 | 创建链接 |
| `/api/sync` | POST | 是 | 同步浏览器书签 |
| `/api/import/preview` | POST | 是 | 导入前预览新增和重复数量 |
| `/api/sync/status` | GET | 是 | 获取同步状态 |
| `/api/sync/heartbeat` | POST | 是 | 插件心跳 |
| `/api/export` | GET | 是 | 导出为 Netscape HTML |
| `/api/reorder/groups` | POST | 是 | 保存分组拖拽排序 |
| `/api/reorder/links` | POST | 是 | 保存链接排序和跨组移动 |
| `/api/tools/duplicates` | GET | 是 | 按完整 URL 检查重复链接 |
| `/api/ops/logs` | GET | 是 | 查看操作日志 |
| `/api/settings` | GET/PUT | 部分 | 未登录只返回非敏感显示设置，登录后返回完整设置；更新需认证 |
| `/api/wallpaper` | GET | 否 | 获取当前壁纸 |
| `/api/wallpaper/refresh` | POST | 是 | 切换壁纸 |
| `/api/fonts` | GET/POST | 部分 | 字体管理 |
| `/api/ai/describe` | POST | 是 | AI 生成链接描述 |
| `/api/ai/check` | POST | 是 | 检测链接有效性 |
| `/api/events/stream` | GET | 是 | SSE 实时事件流 |
| `/api/icon/proxy` | GET | 否 | Favicon 代理 |
| `/api/icon/refresh` | POST | 是 | 刷新指定站点图标缓存 |

认证方式：登录后使用返回的 token，请求头为 `Authorization: Bearer <token>`。为兼容旧版插件，服务端仍临时接受密码作为 Bearer 值。

## 壁纸源配置

内置壁纸源：

| 名称 | 类型 | 需要 API Key |
|------|------|-------------|
| 必应每日 | Bing API | 否 |
| 赛博朋克2077 | SteamGridDB | 是 |
| 艾尔登法环 | SteamGridDB | 是 |
| 荒野大镖客2 | SteamGridDB | 是 |
| +13 款 3A 游戏 | SteamGridDB | 是 |

使用 SteamGridDB 壁纸需要 [注册获取 API Key](https://www.steamgriddb.com/profile/preferences/api)，在设置中填入即可。必应每日壁纸无需配置。

也支持添加自定义壁纸 API 源（返回图片直链或 JSON 的接口均可）。

## 技术栈

- **后端**: Python 3.12 + FastAPI
- **数据库**: SQLite（自动建表 + 迁移）
- **前端**: 原生 HTML/CSS/JS，毛玻璃 + 网格图案 + 渐变背景
- **部署**: Docker + docker-compose，官方 `python:3.12-slim` 镜像
- **运行**: Uvicorn
- **书签解析**: BeautifulSoup4 + 正则回退
- **实时推送**: SSE + SQLite 事件轮询，支持多 worker 场景
- **浏览器插件**: Manifest V3 (Chrome/Edge) + Manifest V2 (Firefox)，内置 `browser` / `chrome` API 兼容层

## 目录结构

```
suenweb/
├── app.py                 # FastAPI 主应用
├── bookmark_parser.py     # 书签文件解析器
├── requirements.txt       # Python 依赖
├── docker-compose.yml     # Docker 部署
├── templates/
│   └── index.html         # 前端页面
├── static/
│   ├── css/style.css      # 样式
│   ├── favicon.png        # 站点图标
│   └── icons/             # SVG 图标库 (100+)
├── extension/             # 浏览器插件源码
│   ├── manifest.json      # Chrome/Edge MV3
│   ├── manifest_firefox.json
│   ├── background.js      # Service Worker
│   ├── popup.html / .js   # 弹出窗口
│   └── suenweb-firefox.xpi # Firefox 已签名包
└── data/                  # 运行时数据 (自动生成)
    └── suenweb.db         # SQLite 数据库
```

## License

MIT
