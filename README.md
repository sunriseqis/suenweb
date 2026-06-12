# SuenWeb

自托管个人导航页。不花哨，能用。


## 功能

- 分组管理（固定组 + Tab 组），可拖拽排序，紧凑/详情/图标三种展示模式
- 固定组支持单列/多列自由排列，多列自动智能填充
- AI 批量补全图标和描述，已有内容跳过（需准备自己的LLM）
- 浏览器插件：右键收藏到指定分组，WebDAV 自动备份，新标签页自动跳转
- 壁纸系统：必应每日 + SteamGridDB 游戏壁纸 + 自定义源（赛博朋克、艾尔登法环、荒野大镖客等 15+ 款游戏 hero 图，[需要 API Key](https://www.steamgriddb.com/profile/preferences/api)）
- 字体系统：4 款内置中文字体，支持自定义 CDN
- 主题：5 种预设、8 种配色、4 种视觉风格、毛玻璃/图案/渐变/纯色背景
- 编辑锁模式，防误操作
- 书签导入导出（Netscape HTML），配置全量备份（JSON）
- 重复链接、失效链接检测清理
- 密码保护（PBKDF2-SHA256）

## 部署

`app.py` 就是入口，不需要构建。

### Docker

```bash
git clone https://github.com/sunriseqis/suenweb.git
cd suenweb
docker compose up -d
# http://localhost:5080
```

### 裸机
需求：Python 3.10+

```bash
git clone https://github.com/sunriseqis/suenweb.git
cd suenweb
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 -m uvicorn app:app --host 0.0.0.0 --port 5000
```


## 浏览器插件

Chrome / Edge（Manifest V3）和 Firefox。装完后：

- **右键收藏** — 在任意网页右键，选择「收藏到 SuenWeb」，指定分组即可
- **WebDAV 备份** — 自动把浏览器书签备份到坚果云等 WebDAV 服务
- **新标签页** — 可选，打开新标签直接跳转到 SuenWeb 主页

插件在设置页面下载。Firefox 版已签名可直接安装，Chrome/Edge 需要开发者模式加载。

## 开始使用

访问 http://your-server:5080
设置密码，导入收藏夹，配置插件。

## 技术栈

Python 3.12 + FastAPI + SQLite + 原生 HTML/CSS/JS，零框架依赖。

## License

MIT
