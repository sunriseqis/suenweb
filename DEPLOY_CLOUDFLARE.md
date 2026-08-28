# SuenWeb — Cloudflare Workers 云端资产同步与一键部署指南

本指南将带你将 **SuenWeb 个人导航页** 及其全部前端静态资产一键同步并部署到 **Cloudflare Workers** 边缘云平台。

部署后你将获得：
- ⚡ **全球边缘 0ms 冷启动**：通过 Cloudflare 全球 CDN 网络加速访问。
- 💾 **Serverless 数据库**：采用 Cloudflare D1 (分布式 SQLite)，免维护，数据永久保存。
- 🤖 **内置免费 AI 模型**：直接使用 Cloudflare Workers AI（`@cf/meta/llama-3.1-8b-instruct` / `@cf/qwen/qwen1.5-7b-chat`），**完全无需申请任何第三方 API Key**，开箱即可一键批量补全书签描述。
- 💰 **100% 免费运行**：完美运行在 Cloudflare 免费套餐内（每天 10 万次请求 + 500 万行 D1 读取 + 10,000 Neurons Workers AI 免费额度）。

---

## 方式一：全自动一键部署（最简单，1 分钟搞定）

本项目内置了自动化部署脚本，可自动同步所有静态资产、自动创建 D1 数据库、自动更新配置并部署到 Cloudflare：

```bash
# 1. 克隆项目并安装依赖
git clone https://github.com/sunriseqis/suenweb.git
cd suenweb
npm install

# 2. 运行一键全自动部署
npm run setup
```

脚本将自动执行以下全套流程：
1. 自动同步 HTML、CSS、图标及浏览器插件至 `public` 静态资产目录。
2. 自动检测并唤起 Cloudflare 登录授权。
3. 自动检测/创建 Cloudflare D1 数据库并绑定 ID 到 `wrangler.jsonc`。
4. 自动导入 `schema.sql` 完成数据库表与内置字体/壁纸初始化。
5. 自动一键发布至 Cloudflare Workers 并输出你的在线访问网址！

---

## 方式二：GitHub Actions 自动同步部署（推送代码自动同步）

如果你希望每次向 GitHub 推送代码或资产时自动部署到 Cloudflare，只需配置一次 GitHub Secrets：

1. 打开你的 GitHub 仓库（`https://github.com/sunriseqis/suenweb`）。
2. 进入 **Settings** -> **Secrets and variables** -> **Actions**。
3. 点击 **New repository secret** 添加以下 Secret：
   - **`CLOUDFLARE_API_TOKEN`**：你的 Cloudflare API Token（在 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 点击「Create Token」-> 使用「Edit Cloudflare Workers」模板生成）。
   - **`CLOUDFLARE_ACCOUNT_ID`**：你的 Cloudflare Account ID（在 Cloudflare 控制台 Workers & Pages 右侧侧边栏复制）。
4. 今后只要你执行 `git push`，GitHub Actions 就会全自动编译并无缝将最新代码与资产同步发布到 Cloudflare Workers！

---

## 方式三：分步手动部署

如果你更喜欢手动逐步执行：

```bash
# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 D1 数据库
npx wrangler d1 create suenweb-db

# 3. 将生成的 database_id 填入 wrangler.jsonc 中

# 4. 初始化云端数据库
npm run db:setup:remote

# 5. 发布部署
npm run deploy
```

---

## 绑定自定义域名（可选）

如果你拥有自己的域名，可轻松绑定到 Workers：

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages** -> 点击 **suenweb**。
3. 进入 **Settings (设置)** -> **Domains & Routes (网域和路由)**。
4. 点击 **Add (添加)** -> 选择 **Custom Domain (自定义网域)**，输入你的二级域名（例如 `nav.yourdomain.com`），点击保存即可自动配置 SSL 证书。

---

## 免费 AI 模型使用说明

改造后的 SuenWeb **默认全面启用免费 AI 描述生成功能**：

1. 打开导航页 -> 点击右上角齿轮⚙️「设置」-> 切换到「**智能**」选项卡。
2. 页面默认提示 **✨ 默认已启用免费 AI 模型（无需任何 API Key，开箱即用）**。
3. 勾选需要补全描述的分组，点击「**一键智能补全描述**」即可自动为缺少描述的书签生成精炼中文摘要。
4. *（高级选项）*：若需连接自己搭建的 Ollama 或第三方 OpenAI 兼容 API，可展开「高级选项」填入自定义 API Key 与地址。
