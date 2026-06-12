# SuenWeb

自托管个人导航页。不花哨，能用。

## 和别的导航页有什么不一样

大多数导航页就是个静态书签列表。SuenWeb 多做了几件事：

- **AI 批量补全** — 选几个分组，一键让 LLM 填充所有空图标和空描述。100+ SVG 图标库自动匹配，已有内容跳过
- **固定组自由排版** — 单列独占一行，或多列并排，多个多列组自动按 3/2/2 填充，不用手动调
- **浏览器右键收藏** — 装插件后右键直接把当前页面收藏到 SuenWeb 指定分组，附带 WebDAV 自动备份
- **SteamGridDB 游戏壁纸** — 赛博朋克、艾尔登法环、荒野大镖客等 15+ 款游戏 hero 图。使用 SteamGridDB 壁纸需要 [注册获取 API Key](https://www.steamgriddb.com/profile/preferences/api)，在设置中填入即可。
- **配置全量备份** — 分组、链接、壁纸、字体、设置，一个 JSON 文件完整导入导出

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
