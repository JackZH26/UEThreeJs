# CONVENTIONS — 开发规范

AI agent 请读 [`../AGENTS.md`](../AGENTS.md)（本文件是人类开发规范）。

---

## 1. 技术栈（已锁定）

| 层       | 选择                                 | 锁定理由                                                       |
| -------- | ------------------------------------ | -------------------------------------------------------------- |
| 语言     | TypeScript **5.9.3**（精确锁）       | `typescript-eslint@8` peer 要求 `<6.1.0`，TS 7 尚不受支持      |
| 3D       | three.js **r185**（git submodule）   | 见 §2                                                          |
| Schema   | **Zod 4**                            | 单一来源产出 TS 类型 + 运行时校验 + JSON Schema                |
| 文本格式 | YAML                                 | 注释友好、diff 友好、LLM 友好                                  |
| 测试     | Vitest                               |                                                                |
| 包管理   | pnpm workspace                       |                                                                |
| 构建     | Vite 8                               |                                                                |
| UI       | React 19                             | LLM 训练数据最多 → AI 改 UI 成功率最高                         |
| 3D 类型  | `@types/three` **0.185.4**（精确锁） | three.js 官方不发 .d.ts；**版本必须与 submodule 的 r185 对应** |

后续引入（对应 Phase）：Tailwind（Phase 2，有真实 UI 时再上）、Playwright（Phase 3）。

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
packages/core/     文档 IO、校验器、布局求解器、命令层
packages/scene/    RoomGraph + Layout → three.js 场景（唯一允许 import three 的库包）
apps/cli/          headless CLI（AI agent 与 CI 的主接口）
apps/editor/       浏览器编辑器（Vite + React）
scripts/           构建期检查
three.alias.ts     three.js 模块解析映射（vitest 与 vite 共用的唯一来源）
examples/          示例关卡（同时是 CI 回归夹具）
three.js/          submodule，只读
```

**依赖方向严格单向：`schema ← core ← scene ← editor`**

`packages/core` 与 `packages/schema` **禁止 import three.js**，保证能在
CLI / CI / AI agent 中 headless 运行。由 eslint `no-restricted-imports` 强制。

后续包按 Phase 加入：`packages/presets`（Phase 4）、`packages/exporters`（Phase 4–5）。
**不预建空包。**

### 3.1 `@tjre/core` 的双入口

| 入口              | 内容                                    | 可用环境      |
| ----------------- | --------------------------------------- | ------------- |
| `@tjre/core`      | 解析、校验、求解、命令层 —— **纯逻辑**  | 浏览器 + Node |
| `@tjre/core/node` | `loadDocumentFile` / `saveDocumentFile` | **仅** Node   |

**主入口顶层不得 import `node:*`。** 否则 Vite 打包编辑器时会报错或塞进
一堆 polyfill。文件 IO 一律放在 `src/node.ts`。

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

### 4.6 三层校验模型

逐层放行，**上一层有 error 时不进入下一层** —— 否则下层规则无法假设数据成立，
会产出一堆由根因派生的噪声诊断。

| 层         | 实现                             | 职责                                      |
| ---------- | -------------------------------- | ----------------------------------------- |
| `schema`   | Zod（`parseDocument`）           | 结构、类型、必填、枚举、strict 拒未知字段 |
| `semantic` | `validateDocument` + `ALL_RULES` | 跨字段/跨对象一致性，**不涉及几何**       |
| `layout`   | `solveLayout`                    | 布局求解产生的几何冲突                    |

`validateDocument` 必须保持**几何无关**；一切需要世界坐标的检查都属于 `layout` 层。
`tjre validate` 会依次跑完三层并合并诊断，JSON 输出里的 `stage` 字段标明实际推进到哪一层。

### 4.7 校验规则编号

按分段取下一个空号，**不复用已废弃编号**：

| 段     | 主题          | 文件                   |
| ------ | ------------- | ---------------------- |
| `R00x` | 身份 / 唯一性 | `rules/identity.ts`    |
| `R01x` | 引用完整性    | `rules/references.ts`  |
| `R02x` | 开口          | `rules/openings.ts`    |
| `R03x` | 连接 / 拓扑   | `rules/connections.ts` |
| `R04x` | 内部结构件    | `rules/structures.ts`  |
| `R05x` | 网格对齐      | `rules/grid.ts`        |
| `R06x` | gameplay      | `rules/gameplay.ts`    |
| `R07x` | 布局求解      | `solver/solve.ts`      |

`error` 阻断导出；`warning` 不阻断但 CI 用 `--strict` 视为失败。

⚠️ **`R07x` 由求解器直接产生，不在 `ALL_RULES` 注册表里** ——
它们需要世界坐标，而注册表里的规则按 §4.6 必须几何无关。
因此 `rules.test.ts` 的注册表自检不覆盖 R07x，其正确性由 `solver.test.ts` 保证。

### 4.8 求解器的确定性要求

`solveLayout` 必须满足「同输入 → 逐字节同输出」，有测试守着。两个具体约束：

1. **禁止用 `Math.cos` / `Math.sin` 做 90° 旋转** ——
   `Math.cos(Math.PI/2)` 返回 `6.123e-17` 而非 `0`，会给坐标带上浮点噪声，
   破坏 golden 测试与序列化确定性。用 `solver/rotation.ts` 里的整数查表。
2. **BFS 的队列与邻接表必须排序**（按 room id / connection id），
   否则遍历顺序受 `Map` 插入顺序影响，环路冲突的报告位置会漂移。

## 5. 测试规范

| 类型         | 覆盖                                                   | 工具       |
| ------------ | ------------------------------------------------------ | ---------- |
| 单元         | schema 校验、每条规则正反用例                          | Vitest     |
| 往返         | 序列化确定性、解析往返稳定                             | Vitest     |
| 夹具回归     | 所有 `examples/` 零 error 且 `--strict` 零 warning     | Vitest     |
| Golden       | solver：输入图 → **显式写死**的期望坐标                | Vitest     |
| **属性测试** | 随机命令序列 → 全部 undo → **文档回到初态**（Phase 2） | fast-check |
| 视觉回归     | example 固定机位截图比对（Phase 3）                    | Playwright |

新增规则**必须**同时加"能抓到"和"不误报"两个用例。
（实例：`R044` 初版对高窗误报，是 `loft-warehouse` 夹具抓出来的。）

**solver 的 golden 测试刻意不用 snapshot**：坐标是手算可核对的，
写成显式期望值等于把几何约定文档化；snapshot 会在改坏时被无声地更新掉。

### 5.1 几何测试可以 headless 跑

构造 `BufferGeometry` 不需要 WebGL 上下文，所以墙面开洞、地板对齐这类几何
正确性都能在 Node 里**机器验证**，不必靠肉眼看 3D。`packages/scene/test/` 就是这么做的。

⚠️ **断言精度上限是 5 位小数**。three.js 的 `BufferAttribute` 用 `Float32Array`
存顶点，只有约 7 位十进制有效数字 —— `0.1` 存进去再读出来是 `0.10000000149011612`。
断言 9 位必然失败，且失败原因与几何正确性无关。

### 5.2 three.js 单实例要验两层

`pnpm verify:three` 检查两个不同层面，**两者都必须过**：

1. **Node 侧模块解析** —— 两个 three 入口是否共享同一份 `three.core.js`
2. **Vite 打包产物** —— 在真实 bundle 里数「只存在于 three.core.js 的字符串」
   出现几次（应为 1）

Node 通过不代表打包通过，两套解析逻辑不同。CI 会先构建编辑器再跑这个检查。
产物检查依赖一个标记字符串，three.js 升级后可能失效 —— 脚本自带自检并会明确报出。

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
