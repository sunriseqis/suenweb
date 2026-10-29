# fn/ 飞牛 fnOS 原生应用包

**D-2 / D-3 已关闭（2026-10-27）**：manifest 字段、目录规范与运行时交付方式均按 SuenMusic（suenmusic 仓库）已实证的 fnOS 打包工程方案落地，不再需要另行核对官方文档——该方案的 manifest 字段、cmd 回调、fnpack 流程已在真机安装/升级/卸载全链路验证过。

## 结构（与 SuenMusic 套件同构）

| 路径 | 作用 |
|---|---|
| manifest | 套件描述（service_port=8080、checkport、ctl_stop、desktop_uidir） |
| config/privilege | run-as package（非 root 运行） |
| config/resource | data-share：suenweb/backup（文件管理器可见的备份目录） |
| wizard/install、wizard/config | 安装/设置向导（服务端口） |
| cmd/main | 控制脚本：start/stop/status + 守护循环（进程异常 5 秒自动重启、PID+启动时间双校验、8MB 日志轮转、TRIM_* 反推与硬闸） |
| cmd/install_callback 等 | 生命周期回调（端口持久化 etc/.env、升级前后停起与健康确认） |
| app/bin/node | 包内自带 Node 22 运行时（构建时下载 linux-x64） |
| app/server | 服务端源码 + npm ci --omit=dev 生产依赖 |
| app/web/dist | 前端构建产物（服务端 @fastify/static 托管，单端口） |
| app/ui | 桌面图标与启动入口（icon_64/icon_256） |

## 构建

```bash
npm run build:fn        # 产物 output/suenweb-vX.Y.Z.fpk
```

构建脚本自动完成：版本注入 → 图标生成 → Node 运行时下载（npmmirror 镜像缓存）→ 前端陈旧检测与重建 → 服务端装配（严格 lockfile 生产依赖、删除 .bin 软链防死链）→ 插件打包 → 权限规范 → fnpack 打包 → 软链硬校验。

## 已知坑（照搬 SuenMusic 审计结论，已内建规避）

1. node_modules/.bin 软链进 fpk 会变死链 → 安装报「设置目录权限失败」；
2. TRIM_PKGVAR 可能为空 → 硬闸拒绝写根分区；
3. 升级前不停进程 → 旧代码驻留内存、升级形同虚设；
4. 守护进程残留 → 重装后 start 误判「已在运行」；
5. .env 用户配置必须放 etc/（升级不覆盖）。

## CI

tag 推送（v*）或手动触发 → GitHub Actions 构建 fpk 并附到 Release（.github/workflows/build-fnos.yml）。
