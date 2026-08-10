# AGENTS.md — 给 AI agent 的操作手册

本文件是 **Cindy / Codex / Claude Code 等外部 AI agent** 操作本项目的权威说明。
人类开发规范见 `docs/CONVENTIONS.md`。

> 本项目的 AI 集成方式是**外部 agent 直连**：没有应用内 LLM 面板、没有 API key。
> 你（agent）通过读写关卡文件 + 调用 CLI 来工作。

---

## 1. 一分钟上手

```bash
pnpm install                                          # 首次；需 --recurse-submodules 克隆
pnpm cli describe examples/loft-warehouse.roomgraph.yaml   # 先看全局
pnpm cli validate examples/loft-warehouse.roomgraph.yaml --json   # 机器可读诊断
```

关卡文件是 **唯一真相**（`*.roomgraph.yaml`）。你直接编辑它，然后用 `validate` 自查。

---

## 2. 工作循环（务必遵守）

```
1. describe   → 建立全局认知（房间规模 + 拓扑），不要一上来就读整个 YAML
2. 读取需要改动的房间片段
3. 编辑 YAML
4. validate --json --strict   → 读 diagnostics，逐条修
5. 重复 4 直到 ok:true
```

**每次编辑后必须跑 `validate`。** 诊断里的 `hint` 字段是专门写给你的修复建议，直接照做。

改动了房间尺寸、开口 offset 或连接拓扑后，再跑一次 `solve --map` ——
**布局是推导出来的**，改一个 offset 可能让下游整条房间链平移甚至旋转。
ASCII 俯视图能让你不开 3D 就确认结果符合意图。

### 校验分三层，逐层放行

| 层         | 检查什么                                              |
| ---------- | ----------------------------------------------------- |
| `schema`   | 结构、类型、字段名（strict：拼错字段会硬报错）        |
| `semantic` | 跨对象一致性：引用、doorCount、elevation 匹配、可达性 |
| `layout`   | 几何冲突：房间重叠、环路矛盾、无法定位（R07x）        |

上一层有 error 时**不会**进入下一层。`--json` 输出的 `stage` 字段告诉你卡在哪层，
所以修完一批 error 后要**重跑** —— 可能会暴露出下一层的新问题。

---

## 3. CLI 契约

| 命令                                           | 用途                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm cli describe <file> [--json]`            | 压缩摘要：房间尺寸、门数、结构件统计、拓扑                                           |
| `pnpm cli validate <file> [--json] [--strict]` | 校验。**你应始终加 `--json`**                                                        |
| `pnpm cli solve <file> [--json] [--map]`       | 从连接图求解房间世界坐标；`--map` 输出 ASCII 俯视图（上=北）                         |
| `pnpm cli schema [--fragment <name>]`          | 输出 JSON Schema。fragment: `document`\|`room`\|`opening`\|`structure`\|`connection` |

### 退出码（用于分支判断，不会变）

| 码   | 含义                                       |
| ---- | ------------------------------------------ |
| `0`  | 通过                                       |
| `1`  | 文档有 error（或 `--strict` 下有 warning） |
| `2`  | 用法错误：未知子命令 / 缺参数 / 文件读不到 |
| `70` | 内部错误 = 本项目的 bug，请报告而不是绕过  |

### `validate --json` 输出形状

```json
{
  "ok": false,
  "file": "examples/x.roomgraph.yaml",
  "stage": "semantic",
  "errorCount": 1,
  "warningCount": 2,
  "diagnostics": [
    {
      "rule": "R020",
      "severity": "error",
      "path": "rooms[0].doorCount",
      "message": "房间 \"hall\" 声明 doorCount=3，但实际有 2 个可通行开口。",
      "hint": "把 doorCount 改为 2，或补上缺少的门。"
    }
  ]
}
```

---

## 4. 数据模型速览

完整定义跑 `pnpm cli schema`。这里是心智模型：

```
Document
├── meta          name / grid / wallThickness / entryRoom
├── themes[]      材质 + 灯光预设集合（房间必须引用其中之一）
├── rooms[]
│   ├── size      { w, d, h }  ← 内部净尺寸，米
│   ├── doorCount 声明的门数（校验器核对，见 R020）
│   ├── openings[]    外壳墙上的洞：door/window/arch/passage/hidden
│   ├── structures[]  内部结构件：platform/stair/ladder/ramp/catwalk/railing/pillar/beam/partition
│   ├── props[] lights[] markers[]
│   └── pin?      手动锚定世界坐标（否则由 solver 依拓扑推导）
└── connections[]  opening ↔ opening，格式 "roomId.openingId"
```

### 五条硬约束（违反必被校验器拦下）

1. **不要写房间的世界坐标。** 房间位置由连接图**自动求解**。你只描述拓扑关系。需要固定某个房间时用 `pin`。
2. **房间外壳永远全封闭。** 只能通过 `openings` 打洞，没有"开放的一面"。
3. **`doorCount` 必须等于可通行开口数量。** `window` 不算门；`door`/`arch`/`passage`/`hidden` 算。
4. **连接两端的 `elevation` 必须相等。** 夹层高度的门要两边等高，否则门洞对不上。跨高度靠房间内的 `stair`/`ladder`/`ramp` 解决。
5. **一个开口最多参与一条连接。**

### 目标形态提醒

游戏是**多房间串联**，房间是**很高的仓库 / loft**（`size.h` 常在 6~12m），
内部靠 `platform`（夹层）+ `stair`/`ladder` + `catwalk` 组织竖向空间。
不要把房间做成 2.4m 层高的普通房间 —— 那不是这个项目的目标。

---

## 5. 绝对禁止

- ❌ **不要修改 `three.js/`** —— 它是锁定在 `r185` 的 git submodule，只读参考。
- ❌ **不要把 `three` 加成 npm 依赖** —— 版本必须由 submodule 唯一决定。
- ❌ **不要在 `packages/core` 或 `packages/schema` 里 import three.js** —— 它们必须能 headless 运行（eslint 会拦）。
- ❌ **不要放宽 `tsconfig.json` 的严格性开关**，也不要用 `any`。
- ❌ **不要手改 `schemaVersion`** 来绕过版本错误 —— 用 `packages/schema/src/migrations/` 里的迁移。
- ❌ **不要提交 `docs/generated/`** —— 生成物，按需跑 `pnpm schema:emit`。

---

## 6. 改代码时

提交前必须通过：

```bash
pnpm check          # format + lint + typecheck + test
pnpm verify:three   # three.js submodule 接线检查
```

### 新增校验规则

1. 在 `packages/core/src/rules/` 对应文件里加，按分段取下一个空号
   （`R0xx` 身份 / `R01x` 引用 / `R02x` 开口 / `R03x` 连接 / `R04x` 结构件 / `R05x` 网格 / `R06x` gameplay）
2. **每条 error 级诊断必须带 `hint`** —— 有测试强制检查这一点
3. 在 `packages/core/test/validate.test.ts` 加正反两个用例（能抓到 / 不误报）

### 新增命令（Phase 2 起）

`packages/core/src/command.ts` 定义了契约。每个命令必须同时提供
`params` / `apply` / `invert` / `describe` / `summary` 五件套 + 单元测试，**缺一项不予合并**。
`apply` 必须是纯函数。

---

## 7. 当前进度

**Phase 0 已完成**：schema v0.1、校验器（28 条规则）、CLI、CI。

**Phase 1 进行中**：布局求解器已完成 —— `solve` 命令可用，含 R07x 冲突诊断
（R070 房间重叠 / R071 环路或 pin 矛盾 / R072 无法定位 / R073 非法 pin 旋转）。

**尚不存在**（不要假设它们可用）：
3D 视口、编辑器 UI、命令实现、预设库（主题/道具）、导出器、UE 管线。

路线图见 `docs/ROADMAP.md`。
