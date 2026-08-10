# AGENTS.md — 给 AI agent 的操作手册

本文件是 **Cindy / Codex / Claude Code 等外部 AI agent** 操作本项目的权威说明。
人类开发规范见 `docs/CONVENTIONS.md`。

> 本项目的 AI 集成方式是**外部 agent 直连**：没有应用内 LLM 面板、没有 API key。
> 你（agent）通过读写关卡文件 + 调用 CLI 来工作。

---

## 1. 一分钟上手

```bash
pnpm install                                                     # 首次；需 --recurse-submodules 克隆
pnpm cli describe examples/etc-m-catwalk-gallery.roomgraph.yaml   # 先看全局（含派生尺寸）
pnpm cli validate examples/etc-m-catwalk-gallery.roomgraph.yaml --json --strict
```

关卡文件是 **唯一真相**（`*.roomgraph.yaml`）。你直接编辑它，然后用 `validate` 自查。

---

## 2. 最重要的一件事：什么是派生的

**你只写意图，不写推导结果。** 一个房间的全部尺寸和全部出口，由**一个字段** `spec` 决定：

| spec | 占格  | 外廓（含墙） | 净内空（可走） | 层高 | 传送门           |
| ---- | ----- | ------------ | -------------- | ---- | ---------------- |
| `S`  | 1 × 1 | 30 × 30 m    | 28.5 × 28.5 m  | 12 m | 4（每面 1）      |
| `M`  | 2 × 1 | 60 × 30 m    | 58.5 × 28.5 m  | 18 m | 6（宽 2 / 窄 1） |
| `L`  | 2 × 2 | 60 × 60 m    | 58.5 × 58.5 m  | 24 m | 8（每面 2）      |

派生规则（`packages/schema/src/spec.ts` 是唯一定义处）：

- 格位 `GRID_UNIT = 30m`，墙厚 `WALL_T = 0.75m`，墙建在占格内侧
- 净内空 = 占格边长 − 2 × 0.75（每边各减 0.75）
- 传送门：**每条占格边一个，居中于该格边**，洞口恒为 3.0 × 3.2m、贴地
  - 一条格边的墙 → offset `0`；两条格边的墙 → offset `-15` / `+15`

**所以文档里没有、也不能写：** `size` / `doorCount` / `pin` / `wallThickness` /
任何 `type: portal` 的开口。写了会被 schema（strict）或 R020 直接拒绝。

想知道一个房间实际有多大、有哪些门 → 跑 `pnpm cli describe`，别自己算。

### 为什么这么设计

36 个房间是**可互换单元**，每局按 seed 拼装到格位网格里。可互换要求同规格房间的
外形与接口逐毫米一致。只要允许手写，就一定会漂移，而漂移的后果是拼装后
**门对上实墙、关卡不连通**。把它变成派生量，这类 bug 在结构上不可能发生。

---

## 3. 工作循环（务必遵守）

```
1. describe   → 建立全局认知（规格 + 派生尺寸 + 内容统计），不要一上来就读整个 YAML
2. 读取需要改动的房间片段
3. 编辑 YAML
4. validate --json --strict   → 读 diagnostics，逐条修
5. 重复 4 直到 ok:true
```

**每次编辑后必须跑 `validate`。** 诊断里的 `hint` 字段是专门写给你的修复建议，直接照做。

特别注意：**楼梯/斜坡的进深算不出来也别猜。** 进深由踢面高度按 Blondel 公式推导
（`2R + G = 630mm`），你只写起点 + 朝向。R046 会告诉你顶端实际落在哪、离目标平台差多少。

### 校验分两层，逐层放行

| 层         | 检查什么                                                |
| ---------- | ------------------------------------------------------- |
| `schema`   | 结构、类型、字段名（strict：拼错字段会硬报错）          |
| `semantic` | 跨对象一致性：引用、越界、净空、楼梯落点（`ALL_RULES`） |

上一层有 error 时**不会**进入下一层。`--json` 输出的 `stage` 字段告诉你卡在哪层，
所以修完一批 error 后要**重跑**。

> v0.1 有第三层 `layout`（布局求解 R07x）。求解器已随"一个房间 = 一个独立关卡"
> 的模型修正删除 —— 房间永远在原点，没有可冲突的位置。

---

## 4. CLI 契约

| 命令                                           | 用途                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm cli describe <file> [--json]`            | 压缩摘要：规格、**派生**尺寸、传送门数、结构件统计                     |
| `pnpm cli validate <file> [--json] [--strict]` | 校验。**你应始终加 `--json`**                                          |
| `pnpm cli export <file> [--room <id>]`         | 导出 GLB（二进制 glTF）。见下方边界说明                                |
| `pnpm cli schema [--fragment <name>]`          | 输出 JSON Schema。fragment: `document`\|`room`\|`opening`\|`structure` |

### `export` 的边界

```bash
pnpm cli export examples/etc-l-atrium.roomgraph.yaml --out atrium.glb
# 可选：--room <id>（多房间文档必填）/ --json / --no-ceiling / --no-lights
```

glTF 与 three.js 同为 **Y-up 右手系、单位米**，所以**不做坐标换算** ——
手性翻转与 ×100 转厘米由 UE 的导入器负责。导出默认**开天花**
（编辑器里默认关是为了看进内部，导给 UE 需要完整外壳）。

⚠️ **这是核对几何与比例的通道，不是最终 UE 资产。** 已知限制：

- **UV 不能平铺**：墙面是 `ExtrudeGeometry` + Earcut 挖洞，用的是默认 UV
  生成器，也没有 lightmap UV
- **墙角互相重叠** `WALL_T × WALL_T` → UE 里碰撞体会重复计算
- **楼梯是阶梯状实体**，没有斜坡碰撞代理 → 角色走上去会顿挫
- **面光源丢失**（glTF 的 `KHR_lights_punctual` 只有 point/spot/directional）；
  命令会明确报出被跳过的灯，不静默丢
- **markers 不导出** —— 它们是 gameplay 元数据而非几何，属于数据导出（JSON）

正经的 UE 资产要走模块化套件 + commandlet 重建，而不是烘这份网格 ——
理由与方案见 `packages/scene/src/gltf.ts` 末尾。

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
  "warningCount": 0,
  "diagnostics": [
    {
      "rule": "R020",
      "severity": "error",
      "path": "rooms[0].openings[0].type",
      "message": "房间 \"hall\" 手写了传送门 \"my_portal\"。传送门由 spec 派生，不能手写。",
      "hint": "把这个开口从 openings 里删掉。房间 \"hall\"（spec=S）已自动拥有 4 个传送门：portal_north_0@north, ..."
    }
  ]
}
```

诊断路径里的 `portals[i]` 指**派生**传送门（不在文件里，改不了 —— 这类诊断说明
`spec.ts` 的派生表本身有问题）；`openings[i]` 指你手写的开口。

---

## 5. 数据模型速览

完整定义跑 `pnpm cli schema`。这里是心智模型：

```
Document
├── meta          name / grid（吸附网格）/ description
├── themes[]      材质 + 灯光预设集合（房间必须引用其中之一）
└── rooms[]       每个房间 = 一个独立关卡；数组只是允许把多个房间放一个文件当房间库
    ├── spec      'S' | 'M' | 'L'   ← 尺寸、层高、传送门的**唯一**来源
    ├── theme
    ├── openings[]    **非传送门**的额外开口（窗等）。传送门是派生的，不写在这里
    ├── structures[]  内部结构件：platform/stair/ladder/ramp/catwalk/railing/pillar/beam/partition
    ├── props[] lights[] markers[]
    └── tags / userData / note
```

坐标约定（房间局部，原点 = 地面矩形中心）：
`north = -Z`，`south = +Z`，`east = +X`，`west = -X`，`up = +Y`。
开口 `offset` 沿墙延展方向（north/south 沿 X，east/west 沿 Z），`elevation` 是**下沿**离地高度。

### 六条硬约束（违反必被拦下）

1. **一个房间 = 一个独立关卡。** 房间永远在原点，**没有世界坐标**，也不要试图把多个
   房间摆成一个连通空间。房间之间的连接由游戏在运行时按 seed 拼装。
2. **尺寸不手写。** 只写 `spec`。想要别的尺寸就换规格 —— 不存在"自定义尺寸的房间"。
3. **传送门不手写。** 由 `spec` 派生。手写 `type: portal` 会被 R020 拒绝。
4. **房间外壳永远全封闭。** 房间之外没有空间。手写 `door`/`arch`/`passage`/`hidden`
   开在外壳上 = 一扇通往虚空的门，R023 会告警；造型用途请改 `window`。
5. **传送门样式固定**（`packages/scene/src/portal.ts`），且位置、数量、尺寸全部固定 ——
   作者对传送门**没有任何可调项**。
6. **房间朝向与出口编号不在本项目范围内。** 房间可旋转，朝向和编号由游戏侧处理；
   这里只关心**布局与结构**。

### 目标形态提醒

房间是**很高的仓库 / loft**（层高 12 / 18 / 24m），内部靠 `platform`（夹层）、
`stair`/`ladder`/`ramp`、`catwalk` 组织竖向空间。层高很高但**不是多层楼**：
只有一个地面，其余高度全靠结构件。

---

## 6. 绝对禁止

- ❌ **不要修改 `three.js/`** —— 它是锁定在 `r185` 的 git submodule，只读参考。
- ❌ **不要把 `three` 加成 npm 依赖** —— 版本必须由 submodule 唯一决定。
- ❌ **不要在 `packages/core` 或 `packages/schema` 里 import three.js** —— 它们必须能 headless 运行（eslint 会拦）。
- ❌ **不要放宽 `tsconfig.json` 的严格性开关**，也不要用 `any`。
- ❌ **不要手改 `schemaVersion`** 来绕过版本错误 —— 用 `packages/schema/src/migrations/` 里的迁移。
- ❌ **不要提交 `docs/generated/`** —— 生成物，按需跑 `pnpm schema:emit`。
- ❌ **不要为了"让房间大一点"去改 `GRID_UNIT` / `WALL_T` / `SPEC_*`** ——
  那是全库共用的派生表，改一个数字会改掉所有 36 个房间的外形。

---

## 7. 改代码时

提交前必须通过：

```bash
pnpm check          # format + lint + typecheck + test
pnpm verify:three   # three.js submodule 接线检查
```

改过**渲染器 / 材质 / 灯光 / 后处理**之后还要跑：

```bash
pnpm dev &                              # 先起服务
pnpm probe:editor --shots /tmp/shots    # 用 CDP 真开浏览器逐关卡自检
```

单元测试跑在 Node 里碰不到 WebGPU，渲染管线的错误只在真实 GPU 上出现，
而且常常表现为"画面不对"而不是抛异常。这个探针会机器判定每个关卡是否在渲染、
并汇总全程控制台，退出码 0 = 干净。踩过的三个 WebGPU 坑见 docs/CONVENTIONS.md §5.4。

### 新增校验规则

1. 在 `packages/core/src/rules/` 对应文件里加，按分段取下一个空号
   （`R0xx` 身份 / `R01x` 引用 / `R02x` 开口 / `R04x` 结构件 / `R05x` 网格 / `R06x` gameplay）
2. **不要复用已停用的编号**（见 `rules/index.ts` 的停用清单）
3. **每条 error 级诊断必须带 `hint`** —— 有测试强制检查这一点
4. 在 `packages/core/test/validate.test.ts` 加正反两个用例（能抓到 / 不误报）

> 先问一句：这条规则真的必要吗？如果错误的可能性能通过**把值变成派生量**消除，
> 那比加校验规则更好 —— 传送门就是这么从"4 条校验规则"变成"0 条"的。

### 新增命令（Phase 2 起）

`packages/core/src/command.ts` 定义了契约。每个命令必须同时提供
`params` / `apply` / `invert` / `describe` / `summary` 五件套 + 单元测试，**缺一项不予合并**。
`apply` 必须是纯函数。

---

## 8. 当前进度

**Phase 0 已完成**：schema v0.2、校验器（17 条规则）、CLI、CI。

**Phase 1 进行中**，已完成：

- **`packages/schema`** —— S/M/L 规格派生表（尺寸 + 传送门），有专门的回归测试钉死数字
- **`packages/scene`** —— 房间外壳几何（带洞口的四面墙 + 地板 + 天花）+ **9 类内部结构件几何**
  - 固定样式传送门。有测试断言**外壳 AABB 恰好等于占格尺寸**（可互换性的地基）
  - `palette.ts` 命名材质表（冷灰工业调）；未知材质 id 仍回落哈希占位色，
    这样主题引用写错时颜色会突变、一眼可见
  - `lights.ts` 把 `room.lights` 真正实例化（v0.2 之前它是个死字段，写了不渲染）
  - 平台护栏在楼梯 / 斜坡 / 爬梯的接入处**自动断开** —— 由 `to` + `facing` 派生，
    不需要作者声明哪条边留口
- **`apps/editor`** —— 3D 视口（`pnpm dev` 启动，WebGPU 自动回退 WebGL2），
  布局是**左侧显示区 / 右侧操作面板**，中英文切换；含第一人称漫游（可走上夹层）
  - 影调对齐 three.js 的 SSR + Denoise 示例：AgX 色调映射、阴影、程序化 IBL、
    以及 SSR → 时域重投影 → 递归降噪 → TRAA 的后处理链
  - 后处理构建失败会**回落到直接渲染**并在面板上报，不会黑屏

**尚不存在**（不要假设它们可用）：
编辑操作、命令实现、file watcher 热重载、预设库（主题/道具都是占位哈希色）、
导出器、UE 管线、three-mesh-bvh 拾取加速。

### 改代码时要知道的三条边界

1. **`@tjre/core` 有双入口**：主入口是纯逻辑（浏览器可用），
   文件 IO 在 `@tjre/core/node`。**不要往主入口加 `node:*` import** ——
   会让编辑器打包失败。
2. **只有 `packages/scene` 能 import three**。`core` 与 `schema` 必须零 three 依赖
   （eslint 会拦），否则 CLI 和 CI 就跑不起来了。
3. **`packages/scene/src/index.ts` 必须用具名再导出，不能用 `export *`。**
   文件里的注释解释了原因（HMR 下星号再导出会抛 `does not provide an export named`
   且浏览器会缓存坏模块，表现为整页空白无报错）。不要"顺手简化"回去。

路线图见 `docs/ROADMAP.md`。
