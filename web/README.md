# web/ 前端（Vite + TS + 原生 DOM）

当前状态：占位。前端原型由用户在 docs/design/prototypes 产出后接入。

落地时的约定：

- 只做视图与交互；数据契约见 docs/REQUIREMENTS.md 第六章，返回体统一 { ok, data, error }。
- 开发期通过 Vite 代理把 /api 转发到 http://127.0.0.1:8080。
- 构建产物输出到 public/（生成物，gitignore）。
- 不引框架（已裁决）；状态集中在一个轻量 store，实时更新走 SSE。
