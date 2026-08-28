# SuenWeb — Cloudflare Workers 云端部署指南

本指南将带你将 **SuenWeb 个人导航页** 部署到 **Cloudflare Workers** 边缘云平台。

部署后你将获得：
- ⚡ **全球边缘 0ms 冷启动**：通过 Cloudflare 全球 CDN 网络加速访问。
- 💾 **Serverless 数据库**：采用 Cloudflare D1 (分布式 SQLite)，免维护，数据永久保存。
- 🤖 **内置免费 AI 模型**：直接使用 Cloudflare Workers AI（`@cf/meta/llama-3.1-8b-instruct` / `@cf/qwen/qwen1.5-7b-chat`），**完全无需申请任何第三方 API Key**，开箱即可一键批量补全书签描述。
- 💰 **100% 免费运行**：完美运行在 Cloudflare 免费套餐内（每天 10 万次请求 + 500 万行 D1 读取 + 10,000 Neurons Workers AI 免费额度）。

---

## 快速开始（5 分钟部署）

### 1. 准备工作

确保本地已安装 Node.js (v18+) 和 npm。

```bash
# 进入项目目录并安装依赖
cd suenweb
npm install
```

### 2. 登录 Cloudflare 账号

```bash
npx wrangler login
```
> 终端会自动弹出浏览器窗口，点击「Allow」授权即可。

---

### 3. 创建 Cloudflare D1 数据库

执行以下命令创建名为 `suenweb-db` 的 D1 数据库：

```bash
npx wrangler d1 create suenweb-db
```

命令输出示例如下：
```text
✅ Successfully created DB 'suenweb-db'
[[d1_databases]]
binding = "DB"
database_name = "suenweb-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

复制输出中的 `database_id`，打开项目根目录下的 **`wrangler.jsonc`**，将 `SUENWEB_D1_DATABASE_ID` 替换为你刚刚生成的真实 ID：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "suenweb-db",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" // 👈 替换这里
  }
]
```

---

### 4. 初始化云端数据库表结构

运行以下命令，将预设的数据表结构、内置字体与内置壁纸源导入到云端 D1 数据库中：

```bash
npm run db:setup:remote
```
*(此命令等同于 `npx wrangler d1 execute suenweb-db --remote --file=./schema.sql`)*

---

### 5. 一键部署到 Cloudflare Workers

```bash
npm run deploy
```

部署完成后，终端会输出你的专属访问地址，例如：
```text
Total Upload: ... KiB / gzip: ... KiB
Uploaded suenweb (... sec)
Deployed suenweb triggers (1.23 sec)
  https://suenweb.<你的用户名>.workers.dev
Current Version ID: ...
```

打开该网址，即可开始使用你的云端导航页！

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

---

## 双模部署支持（本地 Python 与 Cloudflare 云端）

SuenWeb 同时支持两种部署模式：

| 模式 | 运行环境 | 数据存储 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **Cloudflare Workers 版** | Node / Edge Worker | Cloudflare D1 (云端 SQLite) | 个人主力云端导航页，0 成本免运维，全球访问 |
| **Python FastAPI 版** | Python 3.10+ / Docker | 本地 `data/suenweb.db` | 家用 NAS、局域网内网服务器、离线环境 |

> 💡 **数据迁移**：无论使用哪种模式，均可通过导航页设置中的「**配置管理 -> 导出配置 / 导入配置**」将分组、链接、壁纸设置 100% 无损互相迁移！
