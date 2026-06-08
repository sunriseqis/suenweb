# SuenWeb

轻量自托管个人导航页，搭配浏览器插件实现收藏夹云端同步。

## 特性

- **📑 书签管理** — 分组 + 拖拽排序，支持紧凑/详情两种展示模式
- **🔄 浏览器插件同步** — Chrome / Edge / Firefox 插件，收藏夹实时双向同步
- **🖼️ 壁纸系统** — 必应每日壁纸 + SteamGridDB 游戏壁纸 + 自定义 API 源，支持随机/上一条/下一条切换
- **🔤 字体系统** — 内置汇文明朝体/京华老宋体/LXGW WenKai/抖音美好体，支持自定义 CDN 字体
- **🤖 AI 功能** — LLM 自动生成链接描述、链接有效性检测
- **🔒 密码保护** — Bearer Token 认证，保护个人数据
- **📤 导入导出** — 支持 Netscape HTML / Chrome JSON 格式的书签导入导出
- **🎨 主题定制** — 毛玻璃效果、网格/点阵图案、渐变色方案、纯色背景
- **📡 SSE 实时推送** — 网页端变更实时通知浏览器插件
- **🏷️ 图标自动获取** — 多源 favicon 抓取 + SQLite 缓存

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
| `SECRET_KEY` | Flask 密钥 | 自动生成 |
| `TZ` | 时区 | `Asia/Shanghai` |
| `PIP_INDEX_URL` | pip 镜像源 | 清华镜像 |

设置 `SECRET_KEY` 可避免容器重启后 session 失效：

```yaml
environment:
  - SECRET_KEY=your-secure-random-key
  - TZ=Asia/Shanghai
```

### 端口

默认映射 `5080:5000`，可根据需要修改 `docker-compose.yml` 中的端口映射。

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
| `/api/export` | GET | 是 | 导出为 Netscape HTML |
| `/api/settings` | GET/PUT | 部分 | 读取/更新设置 |
| `/api/wallpaper` | GET | 否 | 获取当前壁纸 |
| `/api/wallpaper/refresh` | POST | 是 | 切换壁纸 |
| `/api/fonts` | GET/POST | 部分 | 字体管理 |
| `/api/ai/describe` | POST | 是 | AI 生成链接描述 |
| `/api/ai/check` | POST | 是 | 检测链接有效性 |
| `/api/events/stream` | GET | 是 | SSE 实时事件流 |
| `/api/icon/proxy` | GET | 否 | Favicon 代理 |

认证方式：请求头 `Authorization: Bearer <密码>`

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

- **后端**: Python 3.12 + Flask 3.1
- **数据库**: SQLite（自动建表 + 迁移）
- **前端**: 原生 HTML/CSS/JS，毛玻璃 + 网格图案 + 渐变背景
- **部署**: Docker + docker-compose，官方 `python:3.12-slim` 镜像
- **运行**: Gunicorn (2 workers)
- **书签解析**: BeautifulSoup4 + 正则回退
- **浏览器插件**: Manifest V3 (Chrome/Edge) + Manifest V2 (Firefox)

## 目录结构

```
suenweb/
├── app.py                 # Flask 主应用
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
