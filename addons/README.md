# addons/ 浏览器插件（快速收藏）

Firefox 为首要目标（MV3 事件页），Chrome / Edge 同源一套代码。

## 现在的功能

- 工具栏弹窗：显示当前页标题与网址，选分组后一键收藏。
- 右键菜单「收藏到 SuenWeb」：直接收进第一个置顶分组。
- 每 5 分钟自动同步：把服务端 `pending` 的书签写进浏览器书签（`其他书签 / SuenWeb / 分组名`），**写成功才 ack**，失败回报 `ok=false`。
- 账户：设置页填服务端地址 + 管理密码 → 换 token 存本地（**不存密码**）。

## 本地加载（Firefox）

1. 打开 `about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选 `addons/manifest.json`。
2. 点扩展图标 → 「设置」→ 填服务端地址（如 `http://192.168.89.10:8080`）与管理密码 → 登录并保存。
3. 回到任意页面点扩展图标 → 选分组 → 收藏；稍等即可在书签里看到 `SuenWeb/分组名`。

## 本地加载（Chrome / Edge）

1. `chrome://extensions` → 打开开发者模式 → 「加载已解压的扩展程序」→ 选 `addons/`。
2. 同上配置并收藏。

## 打包

```
npm --prefix addons run pack   # 产物在 addons/dist（不入库）
```

Firefox 永久安装需要签名（AMO）或开发者版关闭签名校验；临时载入不需要。

## 与服务端的约定

- 认证：`Authorization: Bearer <token>`，token 由 `/api/auth/login` 签发。
- 收藏：`POST /api/links`，新链接默认 `sync_state=pending`。
- 回写：`GET /api/sync/pending` → 写浏览器书签 → `POST /api/sync/ack { ids, ok }`。
- 状态：`GET /api/sync/status`；心跳：`POST /api/sync/heartbeat`。
- 事件：`GET /api/events/stream`（SSE），网页端用它自动刷新。

## 已知限制

- 图标目前是 SVG（Firefox 可用；Chrome 可能要 PNG，M7 再补）。
- 只做单向回写（服务端 → 浏览器），浏览器里手动删改不会同步回服务端。
