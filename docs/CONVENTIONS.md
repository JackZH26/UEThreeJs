# CONVENTIONS — 开发规范

AI agent 请读 [`../AGENTS.md`](../AGENTS.md)（本文件是人类开发规范）。

---

## 1. 技术栈（已锁定）

| 层       | 选择                               | 锁定理由                                                  |
| -------- | ---------------------------------- | --------------------------------------------------------- |
| 语言     | TypeScript **5.9.3**（精确锁）     | `typescript-eslint@8` peer 要求 `<6.1.0`，TS 7 尚不受支持 |
| 3D       | three.js **r185**（git submodule） | 见 §2                                                     |
| Schema   | **Zod 4**                          | 单一来源产出 TS 类型 + 运行时校验 + JSON Schema           |
| 文本格式 | YAML                               | 注释友好、diff 友好、LLM 友好                             |
| 测试     | Vitest                             |                                                           |
| 包管理   | pnpm workspace                     |                                                           |

后续引入（对应 Phase）：Vite + React + Tailwind（Phase 1–2）、Playwright（Phase 3）。

## 2. three.js 依赖策略

**three.js 是锁定在 release tag `r185` 的 git submodule，不是 npm 依赖。**

- 克隆必须带 submodule：`git clone --recurse-submodules`
  已克隆的补救：`git submodule update --init --depth 1`
- **绝不把 `three` 加成 npm 依赖** —— 版本必须由 submodule 唯一决定，
  避免不同开发者/CI 拿到不同版本导致玄学 bug
- 消费方式：Vite alias 指向**预构建产物**（`build/` 随 three.js 仓库提交）

  | 导入路径         | 解析到                           |
  | ---------------- | -------------------------------- |
  | `three`          | `three.js/build/three.module.js` |
  | `three/webgpu`   | `three.js/build/three.webgpu.js` |
  | `three/tsl`      | `three.js/build/three.tsl.js`    |
  | `three/addons/*` | `three.js/examples/jsm/*`        |

- **必须锁 release tag，不能锁 main 上的 dev commit** ——
  three.js 的 `build/` 只在发版时重新生成，dev commit 上 `src/` 与 `build/` 的
  `REVISION` 会不一致（实测：commit `561f437` 的 src 是 `186dev` 而 build 是 `185`）
- 升级走独立 PR + 全量视觉回归，季度评估。`pnpm verify:three` 在 CI 里守着这些约束。

## 3. 仓库结构与依赖方向

```
packages/schema/   Zod schema + TS 类型 + JSON Schema 生成
packages/core/     文档 IO、校验器、命令层
apps/cli/          headless CLI（AI agent 与 CI 的主接口）
scripts/           构建期检查
examples/          示例关卡（同时是 CI 回归夹具）
three.js/          submodule，只读
```

**依赖方向严格单向：`schema ← core ← (scene) ← editor`**

`packages/core` 与 `packages/schema` **禁止 import three.js**，保证能在
CLI / CI / AI agent 中 headless 运行。由 eslint `no-restricted-imports` 强制。

后续包按 Phase 加入：`packages/scene`（Phase 1）、`packages/presets`（Phase 4）、
`packages/exporters`（Phase 4–5）、`apps/editor`（Phase 1）。**不预建空包。**

## 4. 代码规范

### 4.1 类型严格性

- `tsconfig.json` 的严格开关**不得放宽**，包括 `noUncheckedIndexedAccess`
- **禁 `any`**（eslint error）。需要时用 `unknown` + 类型守卫
- 优先用**类型谓词**而非内联断言：集合式判定要配 `is` 谓词函数
  （例：`isClimbTarget()` / `isElevatedSurface()`），让集合保持唯一来源的同时提供收窄
- 文件 < 300 行，函数 < 50 行，超了就拆

### 4.2 命令层（项目的宪法）

文档**只能**通过命令修改。每个命令必须提供五件套：

```ts
{
  type: 'room.setSize',        // domain.action
  params: ZodSchema,           // 同时用于运行时校验与生成给 AI 的 JSON Schema
  summary: string,             // 一句话，进 docs 与 AI system prompt
  apply(doc, params) → doc,    // 纯函数：不改入参、无副作用
  invert(doc, params) → cmd,   // 基于应用前状态生成逆命令
  describe(params) → string,   // 人类可读，用于历史面板与 AI 反馈
}
```

**缺任一项 CI 不予合并**（含单元测试与 docs 条目）。

命令粒度要**语义化**（`room.addAdjacent` 而非 `room.setPosition`）——
这直接决定 AI 生成命令的成功率。

### 4.3 序列化确定性

`serializeDocument()` 的输出**必须确定性**：同一文档序列化两次逐字节相同。

否则 write-through 会产生虚假文件变更、触发无意义热重载、让 git diff 充满噪声。
有测试守着这一点。

### 4.4 诊断质量

每条诊断必须**可操作**：

- `message` 说清哪里、什么错了（带上具体数值）
- `hint` 说清**怎么改**（带上建议值）
- `path` 精确定位

这两个字段会被外部 AI agent 直接读取用于自我修正，**措辞含糊等于让 agent 瞎猜**。
有测试强制所有 error 级诊断都带 `hint`。

### 4.5 Schema 版本与迁移

- `schemaVersion` 写在每个关卡文件头
- 破坏性变更必须提供 `packages/schema/src/migrations/vN→vN+1.ts` + 迁移测试
- CI 校验：所有 `examples/` 关卡能被当前版本加载
- 版本不符时 IO 层**先报版本错误**再谈字段，避免一屏无意义的字段错误

### 4.6 校验规则编号

按分段取下一个空号，**不复用已废弃编号**：

| 段     | 主题                     | 文件                   |
| ------ | ------------------------ | ---------------------- |
| `R00x` | 身份 / 唯一性            | `rules/identity.ts`    |
| `R01x` | 引用完整性               | `rules/references.ts`  |
| `R02x` | 开口                     | `rules/openings.ts`    |
| `R03x` | 连接 / 拓扑              | `rules/connections.ts` |
| `R04x` | 内部结构件               | `rules/structures.ts`  |
| `R05x` | 网格对齐                 | `rules/grid.ts`        |
| `R06x` | gameplay                 | `rules/gameplay.ts`    |
| `R07x` | 布局求解（Phase 1 预留） | —                      |

`error` 阻断导出；`warning` 不阻断但 CI 用 `--strict` 视为失败。

## 5. 测试规范

| 类型         | 覆盖                                                   | 工具            |
| ------------ | ------------------------------------------------------ | --------------- |
| 单元         | schema 校验、每条规则正反用例                          | Vitest          |
| 往返         | 序列化确定性、解析往返稳定                             | Vitest          |
| 夹具回归     | 所有 `examples/` 零 error 且 `--strict` 零 warning     | Vitest          |
| Golden       | solver：输入图 → 期望坐标快照（Phase 1）               | Vitest snapshot |
| **属性测试** | 随机命令序列 → 全部 undo → **文档回到初态**（Phase 2） | fast-check      |
| 视觉回归     | example 固定机位截图比对（Phase 3）                    | Playwright      |

新增规则**必须**同时加"能抓到"和"不误报"两个用例。
（实例：`R044` 初版对高窗误报，是 `loft-warehouse` 夹具抓出来的。）

## 6. Git 规范

- `main` 保护 + feature 分支 + PR
- Conventional Commits：`feat(core):` / `fix(solver):` / `docs:` / `chore:`
- PR 必过：`pnpm check` + `pnpm verify:three`
- 每个 PR 能用一句话说清"用户现在能做什么了"

## 7. 文档规范

- `AGENTS.md` / `CLAUDE.md` —— AI agent 操作手册，**一等交付物**，随能力变化同步更新
- `docs/generated/` **不入库**（生成物，避免漂移）；按需 `pnpm schema:emit`，
  或让 agent 直接跑 `pnpm cli schema`
- 每个 example 关卡带注释说明它演示什么

## 8. 常用命令

```bash
pnpm check                 # format + lint + typecheck + test（提交前必跑）
pnpm test                  # 仅测试
pnpm typecheck             # 仅类型
pnpm lint / lint:fix
pnpm format
pnpm verify:three          # three.js submodule 接线检查
pnpm schema:emit           # 生成 JSON Schema 到 docs/generated/
pnpm cli <subcommand>      # CLI
```
