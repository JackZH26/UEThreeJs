# ROADMAP — 阶段产出目标

运行时目标：**UE 5.8.1**。周期为单人节奏估算。

| Phase                 | 内容                                                                          | 周期     | 状态        |
| --------------------- | ----------------------------------------------------------------------------- | -------- | ----------- |
| **0 · 地基**          | 仓库骨架、three.js submodule 接线 + 单实例验证、schema、校验器、CLI、CI、docs | 1 周     | ✅ **完成** |
| **1 · 可视化**        | S/M/L 规格派生表、three.js 场景构建、只读 3D 视口、第一人称漫游               | 2.5 周   | 🔨 进行中   |
| **2 · 编辑能力**      | 命令层实现、undo/redo、gizmo、Inspector、write-through + 热重载               | 3 周     | ⬜          |
| **3 · AI Agent 接口** | CLI 补全（`apply` / `screenshot`）、headless 渲染、AGENTS.md 收敛             | 1.5 周   | ⬜          |
| **4 · 内容 + 导出**   | 主题库、道具库、结构件预设、glTF 导出                                         | 2 周     | ⬜          |
| **5 · UE 5.8.1 管线** | 父材质库、Python 导入、结构件碰撞/nav、标定资产、双端截图比对                 | 2.5–3 周 | ⬜          |

**合计 ≈ 12.5–13 周**

---

## Phase 0 — 地基 ✅

**产出**

- pnpm workspace + TS strict + eslint + prettier + vitest
- three.js 作为 **shallow submodule 锁定 `r185`**（commit `2431a09f`）
- `packages/schema` — RoomGraph schema（Zod 4），含内部结构件 9 类
- `packages/core` — 文档 IO（YAML，确定性序列化）、校验规则、命令层契约
- `apps/cli` — `validate` / `describe` / `schema`，含 `--json` 与退出码契约
- `scripts/verify-three.ts` — submodule 接线 + **单实例**检查
- `examples/` — S / M / L 各一个（Piston Floor / Catwalk Gallery / Atrium）
- docs：SCOPE / CONVENTIONS / ROADMAP / AGENTS / CLAUDE
- GitHub Actions CI

**验收** ✅

- `pnpm cli validate examples/*.roomgraph.yaml --strict` → 退出码 0
- `pnpm check` 全绿
- `pnpm verify:three` 确认两个 three.js 入口共享同一份 `three.core.js`

---

## Phase 1 — 可视化

**产出**

- ✅ **模型修正：一个房间 = 一个独立关卡**（schema v0.2）
  - S/M/L 三规格派生表（`packages/schema/src/spec.ts`）：格位 30m × 占格数，墙厚 0.75m
  - 尺寸、层高、传送门全部派生，文档里**写不了** `size` / `doorCount` / `pin` / 传送门
  - 传送门锚定占格边中心 → 拼装必然对齐；有测试断言**外壳 AABB = 占格尺寸**
  - 删除布局求解器、文档级 `connections` 与 13 条相关规则（R003/R011/R012/R024/R025/
    R030–R033/R045/R060/R061/R070–R073）—— 房间永远在原点，没有可求解的东西
- ✅ `packages/scene` —— Room → three.js 场景（`buildRoom`，一次一个房间）
  - 带洞口的四面墙（`Shape` + `holes` + Earcut）、地板、天花
  - 每面墙长出**完整**墙厚，外廓恰好填满占格
  - 墙面几何直接生成在房间局部坐标系，避免 `offset` 方向被镜像（有回归测试）
  - 占位材质：按材质 id 哈希出**稳定**颜色，便于肉眼区分与比对
- ✅ 固定样式传送门（`portal.ts`）：自发光青色门面 + 暗金属门框，作者无可调项
- ✅ `apps/editor` —— Vite + React + 只读 3D 视口（WebGPURenderer 自动回退 WebGL2）
  - 左侧显示区 / 右侧操作面板；关卡与房间选择器；**中英文切换**
  - 面板显式展示派生量（规格 / 外廓 / 净内空 / 层高 / 传送门数）—— 它们不在文件里
- ✅ `three.alias.ts` 单一来源；`verify:three` 增加**打包产物**单实例检查
- ✅ `@tjre/core` 拆双入口（纯逻辑 / `./node` 文件 IO），使 core 可在浏览器复用
- ✅ 内部结构件几何（9 类：platform / stair / ladder / ramp / catwalk / railing / pillar / beam / partition）
  - 楼梯踏面深度由 **Blondel 公式**（2R + G = 630mm）导出，不用魔法数字
  - 每个结构件的零件用 mergeGeometries 合并成 1 个 mesh（20 级楼梯 = 1 draw call）
  - 导出 walkables 列表，供第一人称地面检测
- ✅ 天花默认关闭（编辑器要能看进房间内部），可开关
- ✅ 第一人称漫游：PointerLock + 向下射线地面跟随 + 台阶容差（楼梯自然可走）
- ✅ R046 校验：楼梯 / 斜坡 / 爬梯顶端是否真的落在目标平台上
  - Blondel 等纯几何推导住在 `packages/core/src/geometry.ts`，
    校验器与几何生成**共用同一套算法**（两边各算一遍必然漂移）
- ✅ **影调对齐 three.js 的 `webgpu_postprocessing_ssr_denoise` 示例**
  - AgX 色调映射 + 曝光 / 对比 / gamma 调色链
  - 单盏高强度方向光 + 阴影（视锥按房间外廓收紧）+ 程序化 IBL（`RoomEnvironment`，零资产）
  - SSR → 时域重投影 → 递归降噪 → 回灌多次反弹 → TRAA
  - 冷灰工业调色板（`palette.ts`），粗糙度从 0.85 降到 0.2~0.45 落进 SSR 有效区间
  - 后处理可开关；构建失败回落直接渲染并上报，不黑屏
- ✅ `room.lights` 真正落地（此前是死字段）+ 平台护栏在楼梯接入处自动断开
- ✅ `pnpm probe:editor` —— 用 CDP 真开浏览器逐关卡自检渲染状态与控制台
- ⬜ three-mesh-bvh 拾取加速（当前单房间复杂度下暂不需要）
- ⬜ 校验诊断的双语化（需把规则改成产出「消息 key + 参数」而非成品中文句子）
- ⬜ 光照强度的正式标定（现在是目视收敛的经验值，见 CONVENTIONS §5.6）

**验收**
S / M / L 三个示例关卡 `--strict` 零诊断 → 浏览器正确渲染 → 能走进去并爬楼梯上到夹层；
外壳 AABB = 占格尺寸的断言通过。

---

## Phase 2 — 编辑能力

**产出**

- 命令集实现（房间增删改、开口、结构件、道具、灯光、标记）
  - 注意：**没有** `room.setSize` 这类命令 —— 尺寸由 spec 决定，只有 `room.setSpec`
- undo/redo（基于 `invert`）
- **write-through**：每条命令立即落盘，永不存在"未保存状态"
- **file watcher 热重载**：外部 agent 改文件 → 浏览器 1s 内更新
- gizmo 编辑、schema 驱动的 Inspector、文本模式双向同步
- 校验面板（实时）

**验收**
纯鼠标从零搭一个含夹层 + 楼梯 + 廊桥的 L 房间并保存；
**属性测试通过**（随机命令序列 → 全部 undo → 文档回到初态）；
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
- ✅ **GLB 导出**（`pnpm cli export`，`packages/scene/src/gltf.ts`）
  - glTF 与 three.js 同为 Y-up 右手系、单位米 → 不做坐标换算
  - 灯光走 `KHR_lights_punctual`；面光源不被规范支持，**明确报出**不静默丢
  - 有往返测试：用 three 自己的 `GLTFLoader` 读回，包围盒与 mesh 数必须一致
  - 导出无副作用（临时摘掉的灯会放回）+ 同输入逐字节确定

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

- 校验诊断双语化的优先级（当前诊断仅中文；界面已双语）
- 是否需要「36 房间总览」视图来辅助设计塌落顺序（36/24/16/10/6/3/1）——
  这需要一个格位拼装预览，与单房间编辑是两件事
