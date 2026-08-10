# ROADMAP — 阶段产出目标

运行时目标：**UE 5.8.1**。周期为单人节奏估算。

| Phase                 | 内容                                                                               | 周期     | 状态        |
| --------------------- | ---------------------------------------------------------------------------------- | -------- | ----------- |
| **0 · 地基**          | 仓库骨架、three.js submodule 接线 + 单实例验证、schema v0.1、校验器、CLI、CI、docs | 1 周     | ✅ **完成** |
| **1 · 可视化 + 求解** | layout solver ✅、three.js 场景构建、只读 3D 视口、第一人称漫游                    | 2.5 周   | 🔨 进行中   |
| **2 · 编辑能力**      | 命令层实现、undo/redo、gizmo、Inspector、2D 拓扑图、write-through + 热重载         | 3 周     | ⬜          |
| **3 · AI Agent 接口** | CLI 补全（`apply` / `screenshot`）、headless 渲染、AGENTS.md 收敛                  | 1.5 周   | ⬜          |
| **4 · 内容 + 导出**   | 主题库、道具库、结构件预设、glTF 导出                                              | 2 周     | ⬜          |
| **5 · UE 5.8.1 管线** | 父材质库、Python 导入、结构件碰撞/nav、标定资产、双端截图比对                      | 2.5–3 周 | ⬜          |

**合计 ≈ 12.5–13 周**

---

## Phase 0 — 地基 ✅

**产出**

- pnpm workspace + TS strict + eslint + prettier + vitest
- three.js 作为 **shallow submodule 锁定 `r185`**（commit `2431a09f`）
- `packages/schema` — RoomGraph schema v0.1（Zod 4），含内部结构件 9 类
- `packages/core` — 文档 IO（YAML，确定性序列化）、**29 条校验规则**、命令层契约
- `apps/cli` — `validate` / `describe` / `schema`，含 `--json` 与退出码契约
- `scripts/verify-three.ts` — submodule 接线 + **单实例**检查
- `examples/` — `two-rooms`（最小）、`loft-warehouse`（目标形态：10m 高主厅 + 夹层 + 楼梯 + 夹层门）
- docs：SCOPE / CONVENTIONS / ROADMAP / AGENTS / CLAUDE
- GitHub Actions CI

**验收** ✅

- `pnpm cli validate examples/*.roomgraph.yaml --strict` → 退出码 0
- `pnpm check` 全绿（38 tests）
- `pnpm verify:three` 确认两个 three.js 入口共享同一份 `three.core.js`

---

## Phase 1 — 可视化 + 求解

**产出**

- ✅ `packages/core/src/solver/` — 从连接图求解房间世界坐标
  - 轴对齐 + 90° 倍数旋转；**旋转是推导出来的**，作者只写拓扑
  - `pin` 作锚点；无 pin 时以 `meta.entryRoom` 为原点；BFS 按 id 排序展开（保证确定性）
  - 整数三角查表替代 `Math.cos`，坐标无浮点噪声
  - 布局用**无向**连通性（`oneWay` 只影响可达性，不影响物理相邻）
  - `R07x` 诊断：R070 房间重叠 / R071 环路或 pin 矛盾 / R072 无法定位 / R073 非法 pin 旋转
  - golden 测试写死示例关卡的求解坐标（手算可核对）
- ✅ `tjre solve` CLI，含 `--map` ASCII 俯视图
- ✅ `tjre validate` 并入 layout 层，三层逐层放行
- ✅ `packages/scene` —— RoomGraph + Layout → three.js 场景
  - 带洞口的四面墙（`Shape` + `holes` + Earcut）、地板、天花
  - 每面墙只长出半个墙厚，相邻两房各出一半拼成完整墙 → 无 z-fighting
  - 墙面几何直接生成在房间局部坐标系，避免 `offset` 方向被镜像（有回归测试）
  - 占位材质：按材质 id 哈希出**稳定**颜色，便于肉眼区分与比对
- ✅ `apps/editor` —— Vite + React 骨架 + 只读 3D 视口（WebGPURenderer 自动回退 WebGL2）
- ✅ `three.alias.ts` 单一来源；`verify:three` 增加**打包产物**单实例检查
- ✅ `@tjre/core` 拆双入口（纯逻辑 / `./node` 文件 IO），使 core 可在浏览器复用
- ✅ 内部结构件几何（9 类：platform / stair / ladder / ramp / catwalk / railing / pillar / beam / partition）
  - 楼梯踏面深度由 **Blondel 公式**（2R + G = 630mm）导出，不用魔法数字
  - 每个结构件的零件用 mergeGeometries 合并成 1 个 mesh（20 级楼梯 = 1 draw call）
  - buildScene 导出 walkables 列表，供第一人称地面检测
- ✅ 天花默认关闭（编辑器要能看进房间内部），可开关
- ✅ 第一人称漫游：PointerLock + 向下射线地面跟随 + 台阶容差（楼梯自然可走）
- ✅ R046 校验：楼梯 / 斜坡 / 爬梯顶端是否真的落在目标平台上
  - Blondel 等纯几何推导已下移到 `packages/core/src/geometry.ts`，
    校验器与几何生成**共用同一套算法**（两边各算一遍必然漂移）
- ⬜ three-mesh-bvh 拾取加速（房间数少时暂不需要）
- `packages/scene/` — RoomGraph → three.js 场景
  - 外壳几何（带洞口的墙面）、结构件几何生成（平台/楼梯/廊桥/柱梁/隔墙）
  - 主题材质占位
- `apps/editor/` — Vite + React 骨架，只读 3D 视口 + orbit/fly
- 第一人称漫游（验证尺度感、能走上夹层）
- `three-mesh-bvh` 接入（核心无空间索引）

**验收**
手写一个 6 房间关卡（含一个带夹层楼梯的 loft）→ 浏览器正确渲染 → 能走进去并上到夹层；
solver golden test 通过。

---

## Phase 2 — 编辑能力

**产出**

- 命令集实现（房间增删改、开口、连接、结构件、道具、灯光、标记）
- undo/redo（基于 `invert`）
- **write-through**：每条命令立即落盘，永不存在"未保存状态"
- **file watcher 热重载**：外部 agent 改文件 → 浏览器 1s 内更新
- gizmo 编辑、schema 驱动的 Inspector、2D 拓扑图视图、文本模式双向同步
- 校验面板（实时）

**验收**
纯鼠标从零搭 10 房间关卡并保存；**属性测试通过**（随机命令序列 → 全部 undo → 文档回到初态）；
外部改文件后浏览器 1s 内反映。

---

## Phase 3 — AI Agent 接口

**产出**

- `tjre apply <commands.json>` — 批量应用命令（agent 主写入路径）
- **`tjre screenshot`** — headless 渲染出图，让 AI 能"看见"自己做的东西 ⭐
- JSON Schema 与命令表自动生成，CI 检查与代码同步
- `AGENTS.md` 按实际能力收敛

**验收**
Claude Code / Codex 在无人干预下，按自然语言需求改出正确关卡并**自行截图验证**；
非法指令能得到可操作的诊断并自我修正。

---

## Phase 4 — 内容 + 导出

**产出**

- 主题库 3–5 套（仓库混凝土 / 金属 / 办公 …）
- 道具库 20–30 个 + 结构件预设
- 灯光预设（含物理单位标注）
- glTF 导出

**验收**
导出的 glTF 在第三方查看器中正确显示（几何 + 材质参数 + 层级）。

---

## Phase 5 — UE 5.8.1 管线

**产出**

- UE 父材质库（覆盖预设库能力边界；按 BlendMode 分 Opaque/Masked/Translucent）
- Python 导入脚本 + headless commandlet，**幂等 + 增量**
- **内部结构件的碰撞与导航**
  - ⚠️ 楼梯需用**斜坡碰撞代理**而非阶梯状碰撞，否则角色移动顿挫
  - 夹层平台需 nav mesh 正确分层
- 标定资产套件：轴向/手性、单位、光照、法线绿通道、材质图表
- 双端截图比对 → 保真度报告

**关键转换约定**（Phase 5 开始时先用标定资产实测确认）

| 项       | three.js / RoomGraph | UE                               |
| -------- | -------------------- | -------------------------------- |
| 单位     | 米                   | ×100 → cm                        |
| 上方向   | Y-up 右手系          | Z-up 左手系（换轴 **+ 翻手性**） |
| 光强     | 物理单位（cd / lux） | `IntensityUnits` 需实测对齐      |
| 法线贴图 | OpenGL 约定          | 可能需 `Flip Green Channel`      |

**验收**
一键从编辑器导出 → UE 生成可玩关卡；标定资产全部通过；**角色能走楼梯上到夹层**。

---

## 待决事项

- **LICENSE** 尚未选定（见 `SCOPE.md`）
- Phase 1 开始前确认：编辑器是否需要支持房间旋转 UI（schema 已支持 90° 倍数）
