# CLAUDE.md

**本项目的 AI agent 说明在 [`AGENTS.md`](./AGENTS.md) —— 请先完整读它。**

那里面有：CLI 契约与退出码、数据模型、五条硬约束、绝对禁止事项、以及新增规则/命令的流程。

## 快速提醒

```bash
pnpm cli describe <file>                    # 先建立全局认知
pnpm cli validate <file> --json --strict    # 每次编辑后必跑
pnpm check                                  # 改代码后必跑
pnpm verify:three                           # 碰过依赖/构建配置后必跑
```

- 关卡文件（`*.roomgraph.yaml`）是唯一真相；**不要写房间世界坐标**，位置由连接图求解。
- `three.js/` 是锁定在 `r185` 的 submodule，**只读**。
- `packages/core` 与 `packages/schema` **禁止 import three.js**。
- 诊断里的 `hint` 是给你的修复指令，照做即可。
