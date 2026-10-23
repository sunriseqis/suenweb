# 03 — 浏览器插件与构建发布链：现状功能需求清单

> 分析范围：`extension/`（源）、`public/extension/`（产物/副本）、`scripts/pack-extension.mjs`、`scripts/sync-extensions.mjs`、`.github/workflows/build-extension.yml`、`src/extensions.ts`（内嵌产物）、popup UI
> 阅读方式：background.js 1243 行全文逐段通读（1–100 / 100–400 / 400–700 / 700–1000 / 1000–1243），popup.html 277 行、popup.js 324 行全文通读，其余文件全文通读。
> 标注约定：行为描述 = 用户可感知行为；证据 = 文件:行号；「待确认」= 代码无法单方面确认的推断。
> 本文件只记录现状，不含改造建议（改造由用户裁决）。

---

## 0. 一句话结论

插件 = **Chrome MV3 / Firefox MV2 双版共用同一份 background.js + popup**，提供 6 组能力：① 右键菜单把当前页收藏进服务端分组；② 新标签页替换为自建导航页；③ WebDAV 三类快照备份 + 还原；④ 浏览器已装扩展清单备份/还原；⑤ 与后端 `/api/sync/*` 的待同步队列（pending→ack）、心跳、SSE 实时联动；⑥ 定时看门狗（5 分钟）。
构建链 = `extension/*`（唯一源）→ `pack-extension.mjs` → crx/xpi/zip + 内嵌 base64 到 `src/extensions.ts` → Worker 通过 `/extension/download/*` 分发。

---

# 一、功能需求清单

## 模块 CM｜右键菜单收藏（Context Menu → Server）

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| CM-01 | 右键菜单动态分组子菜单 | 用户任意网页右键可见「收藏到 SuenWeb」父项，展开后是服务端当前所有分组名；服务端不可达时退化为本地浏览器书签文件夹名；两者皆空时只显示一条「收藏到 SuenWeb (暂无分组)」。菜单在插件启动、每次同步完成、配置变更后重建 | background.js:832-867、791-808、813-830、870；重建触发点 :655 / :1050 / :1230 / :1238 | GET `${serverUrl}/api/data`（无鉴权）→ `data.groups[].name`；`browser.bookmarks.getTree()` | 每次重建先 `removeAll()`；菜单项 id 为 `bm-${groupName}`（:861）→ 组名重复/含特殊字符会 id 冲突；组名本身以 `bm-` 开头会被 `mid.replace('bm-','')` 截断（:876）。**每次同步（含 5 分钟看门狗）都 GET /api/data + removeAll 重建 = 高频冗余 + 菜单闪烁风险（过度设计）** |
| CM-02 | 右键收藏当前页到指定分组 | 选中某分组子项后，当前页 URL+标题写入服务端该分组（`group_type` 固定 `pinned`），分组不存在由后端自动创建 | background.js:872-915、888-900 | POST `${serverUrl}/api/links`，Bearer token，body `{group_name, group_type:'pinned', title, url}`；后端 src/index.ts:372 | **失败只 console.warn，用户完全无感知**（无通知/无角标变化），会误以为收藏成功 |
| CM-03 | 收藏后自动触发 WebDAV 备份 | 右键收藏结束后（与 CM-02 成败无关）排队一次 WebDAV 备份，3 秒内多次收藏合并为一次 | background.js:913、208-218 | 同 WD 模块 | 需 `webdavUrl && webdavUser`，未配置则静默跳过；未配置服务端时也会只做 WebDAV 侧备份 |

## 模块 PS｜待同步队列与 ack（server → browser bookmarks）

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| PS-01 | 拉取待同步链接并写入书签 | 每次同步检查向服务端要「尚未同步到浏览器」的链接，去重后写入「其他书签 / SuenWeb 同步」文件夹（不存在则创建），用户能在书签里看到 | background.js:578-617（调用 :652） | GET `/api/sync/pending` → `{links:[{id,group_id,title,url,icon_type,description,group_name,group_type}], count}`（src/index.ts:886） | 去重仅比对本次快照内已有 url（:588-596）；`icon_type`/`description`/`group_name` 被丢弃 → **分组结构不还原，全部平铺进一个文件夹（信息丢失）** |
| PS-02 | 批量 ack 标记已同步 | 拉取完成后把全部 pending id 一次性回执，服务端标记 `synced_to_browser=1`，此后不再下发 | background.js:609-612；后端 src/index.ts:894 | POST `/api/sync/ack {ids}`；`links.synced_to_browser` | **明显 bug 风险**：单条书签创建失败被 `catch {}` 吞掉（:604）但仍被 ack → 永久丢失且不再下发；ack 本身失败则整批下次重复下发（仅 url 去重兜底） |

## 模块 SY｜同步检查 / 心跳 / SSE 实时联动

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| SY-01 | 统一同步检查入口（单飞） | 手动/启动/看门狗/SSE 触发都走同一函数，并发调用被合流 | background.js:620-666（`_syncInFlight`） | — | `source` 仅用于日志；返回 `{ok:true}` / `{ok:false,error}` 未被告警使用 |
| SY-02 | 心跳上报 | 每次同步检查上报一次心跳（与是否配 WebDAV 无关），导航页仪表盘因此显示插件在线 | background.js:628-631 | POST `/api/sync/heartbeat`（src/index.ts:879，写 `sync_state.last_sync_at / last_sync_from='plugin'`） | 约 5 分钟一次写 D1（写放大）；多设备共写 `sync_state id=1` 互相覆盖 |
| SY-03 | 链接数变化触发自动备份 | 读服务端 `total_links` 与本地记住的「上次已备份链接数」比较，不同则做完整 WebDAV 备份；成功才更新记忆值（失败下轮重试） | background.js:633-650、641-646 | GET `/api/sync/status` → `{total_links,total_groups,pending_sync,last_sync_at,...}`（src/index.ts:862）；storage `lastBackupCount` | 仅按总数判断：删一条加一条（总数不变）不会触发；状态查询异常被 `catch {}` 静默（:649） |
| SY-04 | SSE 实时事件流 | 配置服务器后保持长连接；导航页增改删时插件立即收到事件并触发同步检查；连接成功角标紫点「实时」、popup 圆点变绿；断线 10 秒重连 | background.js:671-745、748-756、759-767、701 | GET `/api/events/stream`（SSE，src/index.ts:904）；`event: change`，data `{kind,payload,ts}`；处理 kind：`link_created/link_updated/link_deleted/group_deleted` → runSync；`sync_imported` → 仅日志 | 无 `Last-Event-ID`，断线期间事件丢失（靠 5 分钟看门狗兜底）；`setBadgeTitle` 为 Firefox 专有，Chrome 抛错被吞；MV3 SW 休眠会断连，仅靠 alarm 重连 |
| SY-05 | 看门狗定时器 | 每 5 分钟唤醒：SSE 断开则重连 + 执行一次同步检查 | background.js:79-80（`SYNC_ALARM='suenweb-sync-watchdog'`、`WATCHDOG_MIN=5`）、770-780 | `chrome.alarms` | 周期硬编码，用户不可配 |
| SY-06 | 状态回传 popup | popup 打开时向后台要状态显示推送连接；SSE 连接/断开时后台主动广播 | background.js:1028-1039、748-756、754；popup.js:141-148、315-321 | 消息协议见附录 B | — |

## 模块 WD｜WebDAV 备份（含保留份数问题）

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| WD-01 | 手动一键备份 | popup「备份」：三类内容打包上传 WebDAV，成功提示「备份成功：应用全量数据 + 书签 (N) + 扩展列表」，部分成功提示「部分失败…」，失败列出原因 | popup.js:152-171；background.js:317-332 → 220-314 | 三类文件见 WD-02/03/04；返回 `{ok, partial, appName, bmName, extName, errors[], count}` | 按钮仅在 WebDAV 已配置时可用（popup.js:120-121）；无进度/无取消 |
| WD-02 | 备份「应用全量数据」JSON | 上传服务端导出快照（分组/链接/设置/壁纸/字体/扩展库），文件名 `suenweb-app-YYMMDD-HHMMSS.json` | background.js:250-267；`/api/config/export`（src/index.ts:643） | GET `/api/config/export`（requireAuth） | 未配置服务器/令牌时该文件被跳过（不报错）；**文件名秒级唯一 → 每次自动备份新增文件，目录无限膨胀** |
| WD-03 | 备份浏览器书签（Netscape HTML） | 全部书签导出为标准 NETSCAPE-Bookmark-file-1 HTML 上传，文件名 `suenweb-bookmarks-YYMMDD-{书签数}.html` | background.js:270-284、144-150、526-540、152-159 | `browser.bookmarks.getTree()`；`dateAdded/dateGroupModified` 转秒级 ADD_DATE/LAST_MODIFIED | 同日同数量 → **覆盖同一文件（丢历史）**；数量变化 → 新增文件（目录增长） |
| WD-04 | 备份已装扩展清单（JSON） | 上传 `{browser, exported_at, extensions:[{ext_id,name,version,url}]}`，文件名 `suenweb-extensions-YYMMDD.json`（每日覆盖） | background.js:287-303、944-963、192 | `browser.management.getAll()` | 与 EX 模块（写 `/api/extensions` 入 D1）**功能重复：扩展清单存两份** |
| WD-05 | 目录解析与回退写入 | 地址不以 `/SuenWeb` 结尾时自动建 `SuenWeb` 子目录（MKCOL）并在其中写；写入失败（404/409/非 2xx）回退写用户填的根地址；被重定向视为失败并提示「请检查 WebDAV 地址是否精确到目录」 | background.js:230-249、180-206、171-178（401/403/404/409/507 中文映射） | WebDAV `MKCOL`/`PUT`；HTTP Basic（:161-169，UTF-8 经 `unescape(encodeURIComponent())`） | 回退策略导致**同一账号文件可能分散两个目录**，还原靠双目录探测（:352-369）弥补 |
| WD-06 | 备份时间记录 | 任一类文件上传成功即把时间写 `lastBackupAt`，popup 显示「上次 3分钟前」 | background.js:305-311；popup.js:124-125、57-64 | storage `lastBackupAt`（ISO） | 部分失败（只成功书签）也刷新 → 用户误以为已完整备份（误导） |
| WD-07 | **备份保留份数（retention）** | **现状：不存在**。无「保留 N 份 / 删除旧备份 / 轮转清理」逻辑，也无对应设置项；WebDAV 目录只不断累积 `suenweb-*` | 全库检索 `retention / 保留 / prune / keepBackups / maxBackups` 无相关命中（仅命中无关的书签去重 UI：public/index.html:877）；文件名规则见 background.js:255/274/291 | — | **用户关注的「保留份数」当前完全未实现（待确认：废弃需求 or 计划未落地）**；唯一「天然去重」是 WD-03/WD-04 的同名覆盖 |
| WD-08 | WebDAV 连接测试 | popup「测试」先保存三项配置再实测：PROPFIND 探连通/认证 → MKCOL 建目录 → PUT `.suenweb-test` 再 DELETE；返回「连接成功 / 连接正常但无法写入: 原因 / 认证失败」 | popup.js:300-312；background.js:1077-1134 | 同上 | **先 updateConfig 落盘再测试**（popup.js:301-303）→ 没点「保存」也已改写配置（副作用）；405 视为可用 |

## 模块 RS｜备份列表与还原

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| RS-01 | 列出云端备份 | 点「还原」弹内嵌选择器，列出 WebDAV 上所有 `suenweb-` 开头 html/json，带分类标签（[全量] 应用全量数据 / [书签] 浏览器书签 / [扩展] 扩展备份）、大小、修改时间，按时间倒序 | popup.js:174-204；background.js:335-410（PROPFIND Depth:1 + 正则解析 href/getlastmodified/getcontentlength） | WebDAV `PROPFIND Depth:1`（body :343-349）；返回 `{backups:[{name,href,category,label,date,size,_date}], activeDir}` | 手写正则解析 DAV XML（:374-375）；主目录 404 回退根目录（:358-369） |
| RS-02 | 还原「应用全量数据」 | 选中应用备份 → 下载 → 直接 POST 服务端导入，提示「应用全量还原成功：N 组，M 链接」 | background.js:413-461、444-461；popup.js:209-217 | POST `/api/config/import`（body 必须 `version:1`，src/index.ts:647；返回 `imported:{groups,links,...}`） | **全量覆盖式导入**（后端先 `DELETE FROM links`），**无二次确认弹窗** |
| RS-03 | 还原「扩展清单」 | 选中扩展备份 → 下载 JSON → POST 覆盖服务端扩展库，提示「扩展列表还原成功：N 个插件」 | background.js:463-479 | POST `/api/extensions {browser, extensions}`（src/index.ts:1312 覆盖该 browser 全行） | 只回写服务端表，**不会在浏览器安装扩展**，提示语易误解 |
| RS-04 | 还原「浏览器书签」 | 选中书签 HTML → 解析所有 `<A HREF>` → 在「其他书签」下新建「SuenWeb 恢复」文件夹逐条创建，提示条数 | background.js:481-483、486-503、514-524 | 正则解析 Netscape HTML；`browser.bookmarks.create` | 无去重/无增量/无嵌套还原（全平铺）；每次还原都新建同名文件夹；单条失败 `catch {}` 静默 |
| RS-05 | 还原选择器交互 | 列表项可点选高亮，「确认还原」选择后才可用，「取消」收起 | popup.js:196-227 | — | **明显 bug**：`restoreBackup` 内部**重新 listBackups 再按 index 取**（background.js:416-421），目录变化时索引错位 → 还原错文件 |

## 模块 EX｜浏览器扩展清单备份/还原（ext_repo）

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| EX-01 | 采集已安装扩展 | 采集除自己外、类型为 extension 的插件；Chrome 下跳过 dev/builtin；生成 `{ext_id,name,version,url}` 并按名排序 | background.js:944-963、923-926、940-942 | `management.getAll()`（需 `management` 权限） | 依赖高敏感权限；Firefox 未过滤 installType |
| EX-02 | 一键备份插件清单到服务端 | popup「备份」→ 上传清单，提示「已备份 N 个插件」，卡片显示数量与上次时间 | popup.js:230-240；background.js:965-981 | POST `/api/extensions`（src/index.ts:1312，按 browser 先删后插，最多 100 条，自动生成商店检索 URL） | 与 WD-04 重复（同一数据两条通路） |
| EX-03 | 一键还原插件清单（打开安装页） | 与服务端清单比对并统计已装；缺失的**最多打开 10 个标签页**到安装/搜索页，提示「已装 X · 打开 Y 个安装页 · 未打开 Z」 | popup.js:242-255；background.js:983-1025、921（`RESTORE_MAX_TABS=10`） | GET `/api/extensions` → `{extensions:[{ext_id,name,version,url,browser}]}` | **能力边界：无法真正安装扩展**，只能开商店页（浏览器限制）；按当前浏览器重算 URL（:1008-1018） |
| EX-04 | 商店链接生成规则 | Chrome：32 位 `a-p` 真 ID → crxsoso 镜像详情页，否则 Chrome Web Store 搜索；Firefox：一律 AMO 搜索 | background.js:918-920、931-938 | 外部站点见附录 C | 依赖第三方镜像；后端 src/index.ts:1320-1325 有**同样的规则实现**（重复实现，两处需同步维护） |

## 模块 NT｜新标签页替换

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| NT-01 | 「设为新标签」开关 | popup 顶部开关，打开提示「已设为新标签页」，关闭提示「已恢复默认新标签」；未配置服务器时开关禁用 | popup.html:167-174；popup.js:85-90、127-130；background.js:1053-1056 | storage `newtabEnabled`（布尔） | 前后台**双写同一键**（popup.js:87 与 :1054），无害重复；语义是「拦截」而非 `chrome_url_overrides` |
| NT-02 | 新建标签页跳转到导航页 | 开启后新建标签页/点到新标签页时自动跳到配置的服务器地址 | background.js:1157-1202、1139、1205-1225 | `tabs.update(tabId,{url:serverUrl})`；需 `tabs` 权限 | URL 白名单（:1141-1155）：`chrome://newtab(/)`、`chrome://new-tab-page(/)`、`chrome-search://local-ntp*`、`edge://newtab(/)`、`about:newtab`、`about:home`；重定向后 1.5s 内不再触发（:1199）；MV3 SW 休眠期 `onCreated` 可能漏事件（待确认） |
| NT-03 | 空 URL 兜底取回 | 新标签事件拿不到 URL 时主动 `tabs.get(tabId)` 读 `pendingUrl/url` 再判断 | background.js:1173-1185 | `tabs.get` | 回调内无条件引用全局 `chrome.runtime.lastError`（:1177、:1192）→ **Firefox（`browser.*`）下可能 `chrome` 未定义**（待确认） |

## 模块 CF｜配置、登录态与消息协议

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| CF-01 | 服务端配置（地址 + 访问密码） | 填地址与导航页密码 → 「保存」先换 token 再落盘，提示「配置已保存」；已存过密码时输入框留空并提示「已保存；修改时输入访问密码」 | popup.js:258-275、102-109；background.js:1040-1052、565-575 | POST `/api/auth/login {password}` → `{ok, token}`（src/index.ts:263）；storage `serverUrl`、`authToken` | `loginServer` 返回 `data.token || password`（:574）→ 响应无 token 时**把明文密码当 token 存下**（潜在 bug）；token 明文存 storage |
| CF-02 | 服务端连通性测试 | popup「测试」→ 直接 GET `/api/sync/status`，成功「连接成功 · N 个链接」，失败「服务器无响应/无法连接」 | popup.js:276-288 | GET `/api/sync/status` | 绕过后台直接 fetch，与 background 的 apiFetch 双份实现（重复） |
| CF-03 | WebDAV 配置 | 地址/用户名/密码三字段，保存提示「WebDAV 配置已保存」 | popup.js:289-299 | storage `webdavUrl`/`webdavUser`/`webdavPass` | 「保存」**同时把服务地址与 token 一起写回**（:295-296），两卡耦合；`webdavPass` 明文回填 input（:108） |
| CF-04 | 配置缓存与跨上下文同步 | 后台缓存配置对象；popup 改配置后经 `storage.onChanged` 同步缓存（并规范化尾斜杠） | background.js:83-100、102-110、115-128 | storage.local | `cfg()` 白名单不含 `lastBackupAt/lastExtBackupAt/lastExtBackupCount`（popup 直读 storage 暂不出错），新增键易漏 |
| CF-05 | popup 状态面板 | 显示连接圆点、服务地址/未配置、推送「已连接/断开」、WebDAV 已配置、上次备份相对时间、已备份插件数/上次时间；每 8 秒刷新 | popup.html:158-273；popup.js:93-149、323-324 | — | 8 秒轮询 + getStatus；popup 关闭即停 |

## 模块 PB｜权限声明与 Chrome/Firefox 差异

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| PB-01 | Chrome MV3 清单 | MV3、`service_worker`、`action.default_popup`、图标 16/48/128 | extension/manifest.json:1-25 | permissions `bookmarks, storage, alarms, contextMenus, tabs, management`；host_permissions `<all_urls>`；version `1.3.0` | `<all_urls>` + `management` + `tabs` 属**敏感权限组合**（审核/信任成本高）；`<all_urls>` 实际用于任意站点右键与自建服务器 fetch |
| PB-02 | Firefox MV2 清单 | 同一份代码以 MV2 运行：`background.scripts`、`browser_action`、`menus`、`*://*/*` 并入 permissions；含 gecko id `sunriseqis@aliyun.com`、`strict_min_version 142.0`、`data_collection_permissions.required:["none"]` | extension/manifest_firefox.json:1-31 | — | **仍用 MV2**（Firefox 已进入 MV2 退场期）→ 长期可用性风险（待确认最终策略）；`data_collection_permissions` 已适配合规要求 |
| PB-03 | 跨浏览器 API 兼容层 | background 自带 `browser.*` 垫片（回调→Promise、统一 onMessage sendResponse）；popup 另有简化版垫片 | background.js:14-77、785；popup.js:4-30 | — | **两份垫片重复且能力不同**（popup 版无 bookmarks/alarms）；`p()` 里 `fn.length <= args.length` 判定（:30）跨浏览器行为不一致 |
| PB-04 | 角标状态 | 连接成功角标显示紫点，title「SuenWeb Sync · 实时」 | background.js:759-767、701 | `action.setBadgeText/setBadgeBackgroundColor/setBadgeTitle` | `setBadgeTitle` 仅 Firefox 有；断开后**角标不清理**（仍紫点）→ 图标状态不可信 |
| PB-05 | 单语言 | 全部文案硬编码简体中文，无 `_locales`/i18n | manifest 无 `default_locale` | — | 无法多语言上架 |

## 模块 BD｜打包与发布链

| 编号 | 功能名 | 现状行为描述 | 实现位置证据 | 数据结构/接口依赖 | 备注 |
|---|---|---|---|---|---|
| BD-01 | 打包三件套 | 一次命令产出 Chrome CRX3、Firefox XPI、Chrome 源码 ZIP、Firefox 源码 ZIP，并同时写入 `extension/` 与 `public/extension/` | scripts/pack-extension.mjs:29-64、151-169 | `fflate` zipSync；`npm run pack:ext` / `sync:ext`（package.json:14-15，两者都指向 pack-extension.mjs） | ZIP 内含 manifest/background/popup/icons(png×3+svg)，**不含 key.pem**（正确） |
| BD-02 | CRX3 签名与固定扩展 ID | RSA2048 手写 CRX3 protobuf 头并签名；扩展 ID = 公钥 SHA-256 前 16 字节按 a–p 映射；当前 ID `hijkkdiladajgimbobmilgmpohbdeoif` | scripts/pack-extension.mjs:86-147、109、138-146、189；src/extensions.ts:17 | 私钥来源：`process.env.CRX_PRIVATE_KEY` 或 `extension/key.pem`（:67-83） | **严重风险**：`extension/key.pem` 私钥已入库（`.gitignore` 未排除，`git ls-files` 可见）→ 同 ID 扩展可被伪造；CI 未配 secret 会**自动生成新私钥 → 扩展 ID 变化**（:74-82），已装用户失联 |
| BD-03 | 内嵌资源生成（Worker 分发） | 打包时把 manifest/background/popup/icons/CRX/XPI 全部转 base64 常量写入 `src/extensions.ts`，Worker 无需静态文件即可下载 | scripts/pack-extension.mjs:171-227；src/extensions.ts（186,615 字节） | Worker 使用点 src/index.ts:32、1242-1295 | 已核对：内嵌 BACKGROUND_JS/POPUP_JS/POPUP_HTML/两份 MANIFEST/ICON_SVG 与 `extension/` 源**逐字节一致**，CRX_B64/XPI_B64 与产物一致（当前 IN_SYNC），但无自动校验步骤 |
| BD-04 | 下载分发接口 | 导航页「获取插件」提供 5 个下载地址：`.crx` / `/chrome` / `/zip` / `/firefox` / `/xpi` | src/index.ts:1242-1295；页面入口 templates/index.html:66-68（public/index.html 同内容） | 直接返回内嵌字节，无鉴权/无版本号/无缓存头 | crx、xpi 各有两条等价路由（冗余）；无 `ETag/Cache-Control`，每次全量下发 ~34KB |
| BD-05 | CI 自动打包并回写产物 | push main 且改动 `extension/**`、`scripts/**`、`templates/**`（或手动）：装依赖 → 跑 pack-extension.mjs（注入 `CRX_PRIVATE_KEY`）→ 把 crx/xpi/zip + src/extensions.ts + public/index.html 提交回 main（`[skip ci]`） | .github/workflows/build-extension.yml:3-10、29-51 | secrets `CRX_PRIVATE_KEY` | ① 提交列表含 `public/index.html`，但打包脚本**从不生成该文件**（幽灵步骤）；② 产物入库闭环；③ 无 lint/typecheck/test（仅 `npm ci`）；④ `[skip ci]` + paths 触发共同避免死循环（正确） |
| BD-06 | **源/产物关系结论** | `extension/` = **唯一真源**；`public/extension/` = **产物仓库 + 源码副本**；`src/extensions.ts` = **产物内嵌副本**（base64，构建时重生成） | md5 校验：`extension/background.js` 与 `public/extension/background.js` 等 5 对文件**完全一致**；`extension/suenweb.crx` 与 `public/extension/suenweb.crx` 一致；`extension/suenweb-firefox.xpi` = `public/extension/suenweb-extension-firefox.zip`（XPI 即 zip） | — | **结论：存在重复提交**——(a) `public/extension/` 内 5 个源副本无任何读取方（Worker 用内嵌 base64）；(b) crx/xpi 在 `extension/` 与 `public/extension/` 各一份；(c) XPI 与 Firefox ZIP 是同一字节两个文件名；(d) `src/extensions.ts` 再存一份 base64。同一扩展资产在仓库共有 **4 份** |
| BD-07 | 死代码 / 孤儿脚本 | `scripts/sync-extensions.mjs`（61 行）生成**缺少 `CRX_B64`/`XPI_B64`/`EXTENSION_ID` 的** src/extensions.ts；`scripts/pack-extension.py` 是第三套实现；两者**均无调用方** | scripts/sync-extensions.mjs:19-58；`npm run sync:ext` 实际执行 pack-extension.mjs（package.json:15）；全库 grep `pack-extension` 仅命中 workflow / package.json / 自身 | — | **明显 bug**：若直接 `node scripts/sync-extensions.mjs`，生成的 extensions.ts 缺 `getExtensionCrx/getExtensionXpi/EXTENSION_ID` → `src/index.ts:32` 导入失败、编译/部署中断；`pack-extension.py` 是否已漂移待确认 |

---

# 二、数据模型

## 2.1 插件侧（无数据库，全部为 `chrome.storage.local` 平面键）

| 键 | 类型 | 用途 | 证据 |
|---|---|---|---|
| `serverUrl` | string（已去尾斜杠） | SuenWeb 服务端基址 | background.js:87-89 |
| `authToken` | string | Bearer 令牌（登录换取；明文） | background.js:90；popup.js:265-267 |
| `lastSync` | ISO string | 上次同步检查时间 | background.js:91、654 |
| `lastError` | string/null | 上次同步错误（成功时置 null） | background.js:92、654 |
| `webdavUrl` | string（去尾斜杠） | WebDAV 目录基址 | background.js:93 |
| `webdavUser` | string | WebDAV 用户名 | background.js:94 |
| `webdavPass` | string | WebDAV 密码（**明文**） | background.js:95 |
| `lastBackupCount` | number | 上次成功备份时的服务端 `total_links`（变化检测基线） | background.js:96、641-645 |
| `lastBackupAt` | ISO string | 上次任一 WebDAV 文件上传成功时间 | background.js:307；popup.js:95 |
| `newtabEnabled` | boolean | 是否拦截新标签页并跳转 | background.js:97、1054 |
| `lastExtBackupAt` | ISO string | 上次扩展清单备份时间 | background.js:979 |
| `lastExtBackupCount` | number | 上次备份扩展数量 | background.js:979 |

缓存对象 `_cachedCfg`（background.js:83-100）是上述键的白名单式内存投影。

## 2.2 插件依赖的服务端数据

| 资源/表 | 关键字段 | 插件如何使用 | 证据 |
|---|---|---|---|
| `groups_table` | `id, name, type` | 右键菜单分组名来源 | background.js:796-799；src/index.ts:314 |
| `links` | `id, group_id, title, url, icon_type, description, synced_to_browser` | 右键收藏写入；待同步下发与 ack（0→1） | background.js:888-900、582、609-612；src/index.ts:372、886、894 |
| `sync_state`（单行 id=1） | `last_sync_at, last_sync_from` | 心跳写入；插件在线状态 | background.js:628-631；src/index.ts:879 |
| `ext_repo` | `ext_id, name, version, url, browser, updated_at`（唯一索引 `(ext_id,browser)`） | 扩展清单备份/还原 | background.js:969-981、986-996；src/index.ts:1297-1345 |
| `event_log` | `id, kind, payload, created_ms` | SSE `change` 事件来源（link_created/link_updated/link_deleted/group_deleted/sync_imported/extensions_backed_up） | background.js:720-731；src/index.ts:904+ |
| 配置导出包 | `version:1, settings, groups, links, wallpapers, fonts, extensions` | WebDAV「应用全量数据」JSON 内容与还原入参 | background.js:251-267、448-453；src/index.ts:643-655 |

## 2.3 插件在 WebDAV 上的「文件模型」

| 文件名模式 | 内容 | 生成/覆盖规则 | 证据 |
|---|---|---|---|
| `suenweb-app-YYMMDD-HHMMSS.json` | `/api/config/export` 完整快照 | **每次备份新增文件（秒级唯一）** | background.js:255 |
| `suenweb-bookmarks-YYMMDD-{count}.html` | Netscape 书签 HTML | 同日同数量覆盖；数量变化新增 | background.js:274 |
| `suenweb-extensions-YYMMDD.json` | `{browser, exported_at, extensions[]}` | 每日一个，重复备份覆盖 | background.js:291 |
| `.suenweb-test` | 连接测试临时文件 | PUT 后立即 DELETE | background.js:1102-1121 |
| 目录 | `${webdavUrl}/SuenWeb`（用户已指向 `/SuenWeb` 则直接用） | MKCOL 自动创建；失败回退根目录 | background.js:238-249 |

**无保留份数/轮转策略**（见 WD-07）。

---

# 三、设置项（settings key）清单及用途

> 插件没有独立设置页，全部设置分散在 popup 两张卡片 + 一个开关；均存 `storage.local`（非服务端 settings）。

| 分组 | 设置项 | UI 位置 | 用途 | 校验/联动 |
|---|---|---|---|---|
| 服务 | `serverUrl` | 「服务」卡（默认折叠） | 导航页地址，决定 `/api/*` 与新标签跳转目标 | 去尾斜杠；空则禁止保存；未配置时新标签开关与插件备份/还原按钮禁用 |
| 服务 | `authToken`（UI 标签「访问密码」） | 同上 | 明文密码经 `/api/auth/login` 换 token 后保存；后续 API 用 `Bearer` | 已存 token 时输入框留空；输入新密码则重新登录换 token |
| 备份 | `webdavUrl` / `webdavUser` / `webdavPass` | 「备份」卡（默认折叠） | WebDAV 备份与还原目标 | 地址+用户名是启用备份/还原按钮的条件；HTTP Basic |
| 开关 | `newtabEnabled` | 顶部开关 | 是否把新标签页跳到 `serverUrl` | 未配置服务时禁用 |
| 内部状态 | `lastSync` / `lastError` / `lastBackupCount` / `lastBackupAt` / `lastExtBackupAt` / `lastExtBackupCount` | 不上屏或只读展示 | 同步基线、备份时间展示、增量判断 | — |
| 常量（不可配） | `SYNC_ALARM='suenweb-sync-watchdog'`、`WATCHDOG_MIN=5`、`RESTORE_MAX_TABS=10`、debounce 3000ms、SSE 重连 10s | — | 看门狗周期、还原最多开页数、备份合并窗口、重连间隔 | **硬编码，用户不可调** |

---

# 四、第三方外部依赖

| 依赖 | 用途 | 证据 | 风险 |
|---|---|---|---|
| 自建 SuenWeb Worker API | 全部业务（附录 A） | background.js 各 fetch | 单点；无重试/离线队列 |
| WebDAV 服务器（任意实现） | 备份存储（`PROPFIND`/`MKCOL`/`PUT`/`GET`/`DELETE`，HTTP Basic） | background.js:180-206、352-369、1077-1134 | 各家 DAV 差异（重定向、405、目录语义）；Basic 口令存本地明文 |
| `https://www.crxsoso.com/webstore/detail/{id}` | Chrome 扩展「还原」跳转的第三方镜像 | background.js:918、936 | 第三方镜像可用性/合规；与 src/index.ts:1322 同规则重复实现 |
| `https://chromewebstore.google.com/search/?q=` | 无真 ID 时的 Chrome 商店检索 | background.js:920、937 | — |
| `https://addons.mozilla.org/firefox/search/?q=` | Firefox 扩展还原检索 | background.js:919、934 | — |
| `fflate`（npm） | ZIP 生成（打包脚本 + Worker 运行时） | scripts/pack-extension.mjs:15、40-64；src/extensions.ts:2 | — |
| GitHub Actions secrets `CRX_PRIVATE_KEY` | CI 签名私钥 | build-extension.yml:33-34 | 未配置则回退 `key.pem` 或新建私钥（扩展 ID 漂移） |

---

# 五、定时 / 后台任务

| 任务 | 周期/触发 | 行为 | 证据 |
|---|---|---|---|
| 看门狗 alarm | 每 5 分钟（`periodInMinutes:5`，硬编码） | SSE 断开则重连；跑一次 `runSync`（心跳 + 状态比对 + 可能自动备份 + 拉 pending + 重建右键菜单） | background.js:79-80、770-780、621-666 |
| 心跳上报 | 随每次 runSync（≈5 分钟，另有 SSE/启动触发） | `POST /api/sync/heartbeat` 更新 `sync_state` | background.js:628-631 |
| SSE 长连接 + 重连 | 常驻；断开后 10 秒重试 | 事件驱动同步检查；连接态广播 popup + 角标 | background.js:689-745 |
| 备份 debounce | 右键收藏后 3000ms 合并窗口 | 合并为一次 `_doBackup` | background.js:208-218 |
| 启动初始化 | SW 启动后 1 秒 | 建 alarm、建右键菜单、连 SSE、跑一次 runSync、再刷菜单 | background.js:1228-1243 |
| 新标签重定向防抖清理 | 重定向后 1.5s | 从 `_redirectingTabs` 删 tabId | background.js:1199 |
| popup 自动刷新 | 每 8 秒（仅 popup 打开） | 重读 storage + getStatus | popup.js:324 |
| CI 打包回写 | push main（paths: extension/**, scripts/**, templates/**）+ 手动 | 打包并提交产物回仓库 | build-extension.yml:3-10、46-51 |

---

# 六、已知技术债 / 疑似 bug（供裁决）

**A. 安全问题（优先级最高）**
1. `extension/key.pem`（CRX 签名私钥）已提交进 git，`.gitignore` 未排除 → 同扩展 ID 可被任意伪造（`git ls-files extension/key.pem`；pack-extension.mjs:67-83）。
2. CI 未配 `CRX_PRIVATE_KEY` secret 时**自动生成新私钥 → 扩展 ID 改变**，已装用户更新链断裂（pack-extension.mjs:70-82）。
3. `authToken`、`webdavPass` 明文存 `storage.local`，且 popup 把 `webdavPass` 明文回填输入框（background.js:95、popup.js:108）。
4. 权限过宽：`<all_urls>` + `management` + `tabs` 与实际能力不匹配，审核与信任成本高（manifest.json:6-7）。

**B. 功能正确性**
5. `pullPendingLinks` 对所有 pending 一律 ack，即使书签创建失败（`catch {}`）→ **书签静默丢失且不再下发**（background.js:596-612）。
6. `restoreBackup(index)` 内部重新列目录再按索引取 → 列表变更时**还原错文件**（background.js:413-421）。
7. `lastBackupAt` 在「部分成功」时也刷新 → 用户误以为已完整备份（background.js:305-311）。
8. 「应用全量数据」文件名秒级唯一 → 目录无限增长，**无保留份数**（WD-07），SSE 频繁触发时刷爆 WebDAV。
9. 右键收藏失败无任何用户反馈（仅 console.warn，background.js:901-909）。
10. 断开 SSE 后角标仍显示紫点/实时 → 图标状态不可信（background.js:759-767、738-744）。
11. `chrome.runtime?.lastError` 在 Firefox 分支被无条件引用，可能 `chrome` 未定义（background.js:1177、1192，待确认）。
12. 还原书签无去重/无嵌套，重复还原产生大量重复条目与多个「SuenWeb 恢复」文件夹（background.js:486-503）。

**C. 重复实现 / 死代码 / 过度设计**
13. 扩展资产在仓库存 **4 份**：`extension/{crx,xpi}`、`public/extension/{crx,xpi,两个 zip}`、`src/extensions.ts`（base64）、`public/extension/` 里 5 个与源完全相同的副本（无人读取）。见 BD-06。
14. `scripts/sync-extensions.mjs` 死代码，且**直接运行会生成缺 `CRX_B64/XPI_B64/EXTENSION_ID` 的 src/extensions.ts，破坏 `src/index.ts` 编译**。见 BD-07。
15. `scripts/pack-extension.py` 第三套打包实现，无调用方（是否漂移待确认）。
16. 扩展清单备份两条通路并存（WD-04 的 WebDAV JSON 与 EX-02 的 `/api/extensions`）；商店 URL 生成规则在前端 background.js:931-938 与后端 src/index.ts:1320-1325 **各写一遍**。
17. `browser.*` 兼容垫片在 background.js:14-77 与 popup.js:4-30 **各写一份**，能力不一致。
18. 每次 runSync（含 5 分钟看门狗）都 `GET /api/data` + `removeAll()` 重建右键菜单 → 高频冗余请求 + 菜单闪烁风险（background.js:655、832-867）。
19. workflow 的 `git add public/index.html`（:45）是幽灵步骤，打包脚本不产出该文件。
20. `/extension/download` 五条路由里 crx/xpi 各有重复入口，且无缓存头/版本标识（src/index.ts:1242-1295）。

**D. 平台/合规风险（待确认）**
21. Firefox 仍用 MV2（manifest_firefox.json:2）；`strict_min_version 142.0` 与 MV2 未来策略需确认。
22. 无 i18n（硬编码中文），无法多语言上架。
23. CRX3 头为手写 protobuf（pack-extension.mjs:86-147），无自动化校验（未验证 Chrome 全链路加载/更新），仅靠人工分发。

---

# 附录 A｜插件调用的后端接口（接口依赖契约）

| # | 方法 & 路径 | 鉴权 | 插件发送 | 期望返回（插件实际读取字段） | 证据 |
|---|---|---|---|---|---|
| 1 | POST `/api/auth/login` | 无 | `{password}` | `{ok, token}` | background.js:565-575；popup.js:265；src/index.ts:263 |
| 2 | GET `/api/data` | 无（公开） | — | `{groups:[{name,...}]}` | background.js:796-799；src/index.ts:314 |
| 3 | POST `/api/links` | Bearer | `{group_name, group_type:'pinned', title, url}` | 仅判 `resp.ok`；失败读 `{detail/error}` | background.js:888-903；src/index.ts:372 |
| 4 | GET `/api/sync/status` | Bearer | — | `{total_links, total_groups, pending_sync, last_sync_at, last_sync_from}` | background.js:635-640；popup.js:282-285；src/index.ts:862 |
| 5 | POST `/api/sync/heartbeat` | Bearer | 空 body | `{ok:true}`（忽略） | background.js:628-631；src/index.ts:879 |
| 6 | GET `/api/sync/pending` | Bearer | — | `{links:[{id,group_id,title,url,icon_type,description,group_name,group_type}], count}` | background.js:582-584；src/index.ts:886 |
| 7 | POST `/api/sync/ack` | Bearer | `{ids:[...]}` | `{ok, acked}`（忽略） | background.js:609-612；src/index.ts:894 |
| 8 | GET `/api/events/stream` | Bearer | — | SSE：`event: hello`、`event: change` + `data:{kind,payload,ts}` | background.js:694-735；src/index.ts:904 |
| 9 | GET `/api/config/export` | Bearer | — | 完整快照 JSON（含 `version`） | background.js:251-253；src/index.ts:643 |
| 10 | POST `/api/config/import` | Bearer | 同 #9 的 JSON（必须 `version:1`） | `{imported:{groups, links, settings, wallpapers, fonts, extensions}}` | background.js:448-459；src/index.ts:647 |
| 11 | GET `/api/extensions` | Bearer | — | `{extensions:[{ext_id,name,version,url,browser}]}` | background.js:986-996；src/index.ts:1297 |
| 12 | POST `/api/extensions` | Bearer | `{browser:'chrome'|'firefox', extensions:[{ext_id,name,version,url}]}` | `{ok, count}` | background.js:469-471、969-977；src/index.ts:1312 |
| 13 | WebDAV（外部） | HTTP Basic | `PROPFIND`/`MKCOL`/`PUT`/`GET`/`DELETE` | 状态码 + XML 列表 | background.js:180-206、352-369、1077-1134 |

# 附录 B｜插件内部消息协议（popup ⇄ background）

| 方向 | 消息 | 用途 | 证据 |
|---|---|---|---|
| popup→bg | `{action:'getStatus'}` | 配置态/上次同步/错误/服务器地址/SSE 连接态 | background.js:1030-1039；popup.js:142 |
| popup→bg | `{action:'updateConfig', serverUrl?, authToken?, webdavUrl?, webdavUser?, webdavPass?}` | 写配置 + 重连 SSE + 重建菜单 | background.js:1040-1052；popup.js:270、292、301 |
| popup→bg | `{action:'updateNewtab', enabled}` | 写 `newtabEnabled` | background.js:1053-1056；popup.js:88 |
| popup→bg | `{action:'loginServer', serverUrl, password}` | 换 token | background.js:1057-1058；popup.js:265 |
| popup→bg | `{action:'manualBackup'}` | 手动备份 | background.js:1059-1060；popup.js:156 |
| popup→bg | `{action:'listBackups'}` | 列备份 | background.js:1061-1062；popup.js:177 |
| popup→bg | `{action:'restoreBackup', index}` | 按索引还原 | background.js:1063-1064；popup.js:209 |
| popup→bg | `{action:'testWebDAV'}` | WebDAV 连接测试 | background.js:1065-1066；popup.js:306 |
| popup→bg | `{action:'backupExtensions'}` / `{action:'restoreExtensions'}` | 扩展清单备份/还原 | background.js:1067-1070；popup.js:234、246 |
| bg→popup | `{kind:'broadcast', payload:{type:'connection', connected}}` | SSE 连接态推送 | background.js:748-756；popup.js:315-321 |
| bg 未知 action | 返回 `null` | 静默忽略 | background.js:1071-1072 |

# 附录 C｜待确认清单

1. 「WebDAV 保留份数」是否为既有需求（代码零实现）——残留文档承诺还是计划未落地？
2. Firefox 是否仍暴露 `chrome.*` 全局（影响 NT-03 的 `chrome.runtime?.lastError`）。
3. MV3 service worker 休眠期间新标签页 `tabs.onCreated` 是否稳定（NT-02 可靠性）。
4. `scripts/pack-extension.py` 与 mjs 是否逻辑一致（是否可直接删除）。
5. `public/extension/` 下的源码副本是否曾被任何部署方式（wrangler 静态资源 / Pages）读取。
6. 后端 `/api/extensions` 与 WebDAV `suenweb-extensions-*.json` 哪一个是「权威数据源」（当前两份并存）。
