# 设计资产（原型 / 图标 / 视觉稿）

本目录存放所有设计侧产物，代码目录不放设计文件。

## 文件

| 文件 | 内容 |
|---|---|
| DESIGN-SYSTEM.md | **前端设计系统正式版**（Maximalism / Dopamine）：色彩令牌（深/浅）、排版、边框圆角阴影、图案分层、两级动效、禁止事项、可访问性、技术映射 |
| README.md | 本文件：设计资产落盘规则与清单 |

## 约定

- 目录：prototypes/（页面原型 HTML 或截图）、icons/（应用图标、插件图标、favicon 源文件）、assets/（插画、空状态图）、refs/（参考图与竞品截图）。
- 命名：用途-版本-日期，例如 prototypes/bookmarks-v1-20250601.html、icons/app-512.png。
- 图标必须同时给 SVG 源与 512/128/48/32 PNG；插件图标另需 16/32/48/128 四档。
- 视觉口径以 DESIGN-SYSTEM.md 为准；代码实现（web/）与本文冲突时，改代码不改文档，除非先改文档。
- 禁止 emoji（项目铁律 8）：装饰一律用内联 SVG 几何图形或色块。
- 每产出一份设计资产，回来更新本页清单与 docs/README.md。

## 清单

| 文件 | 说明 | 状态 |
|---|---|---|
| DESIGN-SYSTEM.md | 设计系统落地版，随 M2 一起生效 | 生效中 |
| logo-metro.svg | **当前品牌标**（Metro 磁贴版）：强调蓝直角方块 + 白色书签 + 一块浅色方砖，单色无渐变。前端顶栏用单色版（web/src/assets/logo.svg），favicon 与扩展图标用满色版（web/public/logo.svg、addons/icons/icon.svg） | 已启用 |
| logo原型.svg | 早前那版 1024 单路径 logo（已停用，仅存档） | 历史 |
| 扩展图标 PNG | addons/scripts/make-icons.mjs 生成 16/32/48/96/128 五档（无第三方依赖） | 已生成 |
| （待填充） | 应用图标 512/128/48/32 PNG 与插件 16/32/48/128 四档导出（M3/M7 需要） | 未开始 |
