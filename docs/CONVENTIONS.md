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
packages/core/     文档 IO、校验器、几何推导、命令层
packages/scene/    Room → three.js 场景 + 材质调色板 + 灯光（唯一允许 import three 的库包）
apps/cli/          headless CLI（AI agent 与 CI 的主接口）
apps/editor/       浏览器编辑器（Vite + React）+ 后处理管线（唯一用 three/webgpu 的地方）
scripts/           构建期检查 + 运行期探针
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

| 入口              | 内容                                       | 可用环境      |
| ----------------- | ------------------------------------------ | ------------- |
| `@tjre/core`      | 解析、校验、几何推导、命令层 —— **纯逻辑** | 浏览器 + Node |
| `@tjre/core/node` | `loadDocumentFile` / `saveDocumentFile`    | **仅** Node   |

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

### 4.6 两层校验模型

逐层放行，**上一层有 error 时不进入下一层** —— 否则下层规则无法假设数据成立，
会产出一堆由根因派生的噪声诊断。

| 层         | 实现                             | 职责                                      |
| ---------- | -------------------------------- | ----------------------------------------- |
| `schema`   | Zod（`parseDocument`）           | 结构、类型、必填、枚举、strict 拒未知字段 |
| `semantic` | `validateDocument` + `ALL_RULES` | 跨字段/跨对象一致性                       |

`tjre validate` 依次跑完两层并合并诊断，JSON 输出里的 `stage` 字段标明实际推进到哪一层。

> v0.1 有第三层 `layout`（`solveLayout`，需要世界坐标）。求解器已随
> "一个房间 = 一个独立关卡"的模型修正删除，`layout` 层与 §4.9 的确定性要求一并作废。

#### 优先消灭错误，而不是校验错误

一条规则存在的前提是"这个错误有可能被写出来"。如果能把值变成**派生量**，
错误就在结构上不可能发生，规则也就不必存在。

实例：v0.1 用 4 条规则守着传送门（门数、对齐、尺寸、悬空）。v0.2 让传送门
完全由 `spec` 派生后，这 4 条全部消失，只剩一条 R020「不许手写传送门」——
把 4 个可能出错的地方压成 1 个不可能出错的地方。**加规则前先问能不能派生。**

### 4.7 校验规则编号

按分段取下一个空号，**不复用已废弃编号**：

| 段     | 主题          | 文件                  |
| ------ | ------------- | --------------------- |
| `R00x` | 身份 / 唯一性 | `rules/identity.ts`   |
| `R01x` | 引用完整性    | `rules/references.ts` |
| `R02x` | 开口          | `rules/openings.ts`   |
| `R03x` | 连接 / 拓扑   | （v0.2 整段停用）     |
| `R04x` | 内部结构件    | `rules/structures.ts` |
| `R05x` | 网格对齐      | `rules/grid.ts`       |
| `R06x` | gameplay      | `rules/gameplay.ts`   |
| `R07x` | 布局求解      | （v0.2 整段停用）     |

`error` 阻断导出；`warning` 不阻断但 CI 用 `--strict` 视为失败。

⚠️ **编号一旦用过就不再复用，哪怕规则已停用。** 复用会让旧的 diff、issue 和
AI 会话记录指向一条含义完全不同的规则。v0.2 停用清单见 `rules/index.ts` 顶部注释：
R003 / R011 / R012 / R024 / R025 / R030–R033 / R045 / R060 / R061 / R070–R073。

### 4.8 几何推导只能有一份实现

结构件的纯几何推导（Blondel 楼梯比例、斜坡坡度、朝向向量）住在
**`packages/core/src/geometry.ts`**，`packages/scene` 从那里 re-export。

原因：校验器需要它们（R046 要判断楼梯顶端是否落在平台上），而 core 不许依赖
three.js。若两边各写一份，会出现「**校验通过但几何错位**」——
这是最难查的一类 bug，因为两处代码单独看都对。

新增此类推导时一律放 core，scene 只做"把数值变成 BufferGeometry"。

### 4.9 派生量只能有一份定义

`packages/schema/src/spec.ts` 是**唯一**的规格派生表：格位、墙厚、层高、
净内空、传送门位置全在里面。任何地方都不许再算一遍。

- 拿房间尺寸用 `roomSize(room)`，不要自己 `GRID_UNIT * cx - 2 * WALL_T`
- 拿开口列表用 `roomOpenings(room)`（含派生传送门），不要只读 `room.openings`
- 几何、校验、CLI、编辑器全部走这些访问器

两条不变量必须永远成立，`shell.test.ts` 与 `buildRoom.test.ts` 各有一组断言守着：

1. **外壳水平 AABB 恒等于占格尺寸**（`GRID_UNIT` 的整数倍）
2. **传送门 offset 与墙厚无关**（锚定占格边中心，所以拼装必然对齐）

改这张表等于改所有 36 个房间的外形，属破坏性变更，要按 §4.5 走版本迁移。

## 5. 测试规范

| 类型         | 覆盖                                                   | 工具       |
| ------------ | ------------------------------------------------------ | ---------- |
| 单元         | schema 校验、每条规则正反用例                          | Vitest     |
| 往返         | 序列化确定性、解析往返稳定                             | Vitest     |
| 夹具回归     | 所有 `examples/` 零 error 且 `--strict` 零 warning     | Vitest     |
| Golden       | 规格派生表 → **显式写死**的尺寸与传送门偏移            | Vitest     |
| **属性测试** | 随机命令序列 → 全部 undo → **文档回到初态**（Phase 2） | fast-check |
| 视觉回归     | example 固定机位截图比对（Phase 3）                    | Playwright |

新增规则**必须**同时加"能抓到"和"不误报"两个用例。
（实例：`R044` 初版对高窗误报，是夹具关卡抓出来的。）

**规格派生表的测试刻意不用 snapshot**（`packages/schema/test/spec.test.ts`）：
那张表里的数字来自游戏的真实规格，写成显式期望值等于把约定文档化；
snapshot 会在改坏时被无声地更新掉。

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

### 5.3 渲染管线只能在真实 GPU 上验证

单元测试跑在 Node 里，**碰不到 WebGPU**。渲染管线的错误只在真实设备上出现，
而且症状通常是"画面不对"而不是抛异常 —— 靠肉眼看服务又慢又容易漏掉一屏之外的报错。

`pnpm probe:editor [--shots <目录>]`（`scripts/probe-editor.ts`）：用 CDP 真开一个
Chrome 把编辑器跑起来，遍历每个关卡，**机器判定**「是否在渲染」（canvas + 帧数）
并汇总全程控制台的 error / warning；带 `--shots` 时逐关卡截图供人看影调。
退出码 0 = 干净。改过渲染器 / 材质 / 灯光 / 后处理后应当跑一次。

⚠️ **控制台必须在遍历完所有关卡之后才汇总。** 第一版在切关卡前就打印了，
结果只有 L 规格触发的那个错误压根没被打出来 —— 表现成"一张黑图 + 控制台干净"。

### 5.4 WebGPU 管线的三个坑（都实际踩过）

1. **开 SSR 时必须关 MSAA。** 后处理要把场景 pass 的深度纹理拷给 SSR，
   多重采样深度纹理拷不到单采样目标：`sample count (4) and destination
sample count (1) does not match`，整条 command buffer 随之失效。
   抗锯齿改由 TRAA 承担（`WebGPURenderer({ antialias: !ssr })`）。
2. **`stochastic: true` 的 SSR 必须配环境贴图。** `SSRNode` 在射线未命中时
   **无条件**取样环境，不看 `screenEdgeFadeBlack`；没调 `setEnvMap()` 就会在
   构建着色器时抛 `Cannot read properties of null (reading 'sampleEnvironmentBRDF')`。
   室内场景不必加载 HDR —— 现算一张小的 equirect `DataTexture` 就够
   （见 `apps/editor/src/renderPipeline.ts` 的 `createInteriorEnvMap`）。
3. **用 `RectAreaLight` 前必须 `RectAreaLightNode.setLTC(...)`。** 否则整个房间
   渲染成全黑，而**帧数照涨**。这个症状最有欺骗性 —— 排查时先问
   "这个房间有什么别的房间没有的东西"。见 `apps/editor/src/rectAreaLightSupport.ts`。

### 5.5 光照强度不能照抄参考实现

从别的项目/示例搬色调曲线（tone mapping、对比、gamma）是安全的，
**搬光强不是**：光强只在特定的 albedo 与遮挡分布下成立。
照抄 three.js SSR 示例的方向光 20 / 环境 1.0 到我们的混凝土开顶房间，
结果是整屏过曝、配色完全看不出来。数值必须按自己的内容重新收敛
（用 §5.3 的截图回路），并在代码里注明是**待标定**的经验值。

## 6. Git 规范

- `main` 保护 + feature 分支 + PR
- Conventional Commits：`feat(core):` / `fix(scene):` / `docs:` / `chore:`
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
