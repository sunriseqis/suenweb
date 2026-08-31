# SuenWeb

自托管个人导航页。不花哨，能用。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1%20Database-FAAD3F?logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Workers AI](https://img.shields.io/badge/AI-Workers%20AI%20(Free)-green)](https://developers.cloudflare.com/workers-ai/)


## 功能

- **云端与本地双部署**：支持部署到 **Cloudflare Workers (D1 + 免费 Workers AI)**，也支持 Docker / Python 本地部署（已归档至 `legacy-python` 标签）
- **内置免费 AI 补全**：**无需任何 API Key**，开箱即用一键为书签智能生成中文简短描述
- 分组管理（固定组 + Tab 组），可拖拽排序，紧凑/详情/图标三种展示模式
- 固定组支持单列/多列自由排列，多列自动智能填充
- 浏览器插件：右键收藏到指定分组，WebDAV 自动备份，新标签页自动跳转
- 壁纸系统：必应每日 + SteamGridDB 游戏壁纸 + 自定义源
- 字体系统：4 款内置中文字体，支持自定义 CDN
- 主题：5 种预设、8 种配色、4 种视觉风格、毛玻璃/图案/渐变/纯色背景
- 编辑锁模式，防误操作
- 登录限速（失败过多自动锁定），防暴力破解
- 每日自动备份（保留 30 份，支持 R2 异地容灾）
- 书签导入导出（Netscape HTML），配置全量备份（JSON）
- 重复链接、失效链接检测清理
- 密码保护（PBKDF2-SHA256）

## 预览
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-50-03%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-50-15%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-50-38%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)
![image](https://github.com/sunriseqis/suenweb/blob/a963342886158f6a7349143fd49ea05ef8990a9a/img/Screenshot%202026-06-12%20at%2015-51-06%20SuenWeb%20%C2%B7%20%E5%AF%BC%E8%88%AA%E9%A1%B5.png)

## 部署

### 方式一：Cloudflare Workers 云端部署（控制台 UI 操作，0 元免维护）

全程在 Cloudflare 控制台点选完成，无需命令行。分四步，前两步只需做一次。

**第 0 步：注册 workers.dev 子域（新账号一次性）**

控制台 → **Workers 和 Pages** → 概览页右侧 **子域 (Subdomain)** → 注册一个子域名称。

> ⚠️ 不注册的话，部署会显示成功，但**不会分配任何访问地址**。

**第 1 步：创建 D1 数据库并初始化（一次性）**

1. 控制台 → **存储和数据库** → **D1 SQL 数据库** → **创建**，名称填 `suenweb-db`
2. 进入数据库详情页，复制页面上的 **数据库 ID (Database ID)**
3. 切换到数据库的 **控制台 (Console)** 标签，把仓库根目录 `schema.sql` 的全部内容粘贴进去，点击执行——完成建表和内置壁纸/字体的初始化

**第 2 步：把数据库 ID 写入仓库（一次性）**

1. 编辑仓库根目录的 `wrangler.jsonc`，将 `"database_id": "SUENWEB_D1_DATABASE_ID"` 的占位符替换为第 1 步复制的真实 ID
2. 提交并推送到 `main` 分支

**第 3 步：连接 GitHub 仓库，自动构建部署**

1. 控制台 → **Workers 和 Pages** → **创建** → **导入现有 Git 仓库**
2. 授权 GitHub 后选择 `sunriseqis/suenweb`，点击 **开始设置**
3. 项目名称填 `suenweb`（若提示名称已被占用，先删除账号里同名的旧 Worker，或改用其他名称）
4. 构建命令留空，部署命令保持默认 `npx wrangler deploy`——Worker 入口、静态资产、D1、Workers AI 绑定都会自动从 `wrangler.jsonc` 读取挂载
5. 点击 **创建并部署**，等待构建完成

**部署完成后**

- 打开 Worker 概览页的 **访问 (Visit)** 按钮，地址为 `https://<项目名>.<你的子域>.workers.dev`
- 日常更新：`git push` 到 `main` 即自动重新构建发布，无需任何手动操作

> 🌐 进阶操作（绑定自定义域名、免费 AI 说明）见 [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md)。国内直连建议绑定自定义域名（`workers.dev` 域名在大陆被阻断，自有域名可正常访问）。
>
> 🛟 **自动备份**：每天自动全量备份（设置、分组、链接、壁纸、字体）。默认存 30 份；如需异地容灾，在 Cloudflare 创建 R2 桶并在 Worker 绑定中添加 R2（变量名 `BACKUP_DB`），备份会自动改存 R2。
>
> 📦 旧版 Docker / Python 部署已归档：`git checkout legacy-python` 可获取完整旧版。

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
