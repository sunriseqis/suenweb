# SuenWeb

自托管个人导航页。不花哨，能用。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sunriseqis/suenweb)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1%20Database-FAAD3F?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Workers AI](https://img.shields.io/badge/AI-Workers%20AI%20(Free)-green)](https://developers.cloudflare.com/workers-ai/)


## 功能

- **云端与本地双部署**：支持部署到 **Cloudflare Workers (D1 + 免费 Workers AI)**，也支持 Docker / Python 本地部署
- **内置免费 AI 补全**：**无需任何 API Key**，开箱即用一键为书签智能生成中文简短描述
- 分组管理（固定组 + Tab 组），可拖拽排序，紧凑/详情/图标三种展示模式
- 固定组支持单列/多列自由排列，多列自动智能填充
- 浏览器插件：右键收藏到指定分组，WebDAV 自动备份，新标签页自动跳转
- 壁纸系统：必应每日 + SteamGridDB 游戏壁纸 + 自定义源
- 字体系统：4 款内置中文字体，支持自定义 CDN
- 主题：5 种预设、8 种配色、4 种视觉风格、毛玻璃/图案/渐变/纯色背景
- 编辑锁模式，防误操作
- 书签导入导出（Netscape HTML），配置全量备份（JSON）
- 重复链接、失效链接检测清理
- 密码保护（PBKDF2-SHA256）

## 预览
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-50-03%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-50-15%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-50-38%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-51-06%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)

## 部署

### 方式一：Cloudflare Workers 云端一键部署（推荐，0 元免维护）

详见完整部署指南：[DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md)

```bash
# 1. 安装依赖
npm install

# 2. 全自动一键部署（自动同步静态资产、创建D1数据库并发布到Cloudflare）
npm run setup
```

> 💡 **自动同步**：项目已配置 GitHub Actions 工作流，在 GitHub 仓库中添加 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 后，每次 `git push` 将自动同步代码与资产到 Cloudflare！

### 方式二：Docker 本地部署

```bash
git clone https://github.com/sunriseqis/suenweb.git
cd suenweb
docker compose up -d
# 访问 http://localhost:5080
```

### 方式三：裸机 Python 部署
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
- **WebDAV 备份** — 自动把应用书签备份到坚果云等 WebDAV 服务，最大备份数2.
- **新标签页** — 可选，打开新标签直接跳转到 SuenWeb 主页

插件在设置页面下载。Firefox 版已签名可直接安装，Chrome/Edge 需要开发者模式加载。

## 技术栈

- **云端**：Cloudflare Workers + Cloudflare D1 + Workers AI + Hono
- **本地**：Python 3.12 + FastAPI + SQLite
- **前端**：原生 HTML5 / CSS3 / JavaScript，零重型框架依赖

## License

MIT
