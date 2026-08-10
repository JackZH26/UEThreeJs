# ThreeJsRoomEditor

浏览器端、**AI 原生**的房间关卡编辑器。为 **ENTER THE CUBE** 打造，运行时目标 **UE 5.8.1**。

游戏由 36 个**可互换的独立房间**按 seed 拼装成一个巨大立方体，外圈房间会整块塌落。
**一个房间 = 一个独立关卡**：外壳是全封闭立方体，房间之间靠**传送门**在运行时连接。
房间形态是**很高的仓库 / loft**（层高 12 / 18 / 24m），内部靠夹层平台与室内楼梯组织竖向空间。

> **为什么不用 UE 编辑器**：① 摆盒子房间不需要开一个完整 DCC；
> ② `.umap` 是二进制，AI 读不了、diff 无意义。本项目的关卡是一份 LLM 能整份读写的 YAML。

## 核心思路

| 原则                        | 含义                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| **文档即真相**              | 关卡是一份小而语义化的 YAML，存意图不存推导结果                                   |
| **能派生的就不要手写**      | 尺寸、层高、传送门全部由一个 `spec` 字段派生 —— 写不了，也就错不了                |
| **单一命令层**              | UI / AI / CLI / 测试走同一套 typed command，人与 AI 能力对等                      |
| **AI 输出命令，不输出代码** | 外部 agent（Cindy / Codex / Claude Code）经 schema 校验后应用，永不执行生成的代码 |
| **约束优先**                | 材质、道具、灯光走白名单预设库，保证导出 UE 无损                                  |

## 三种规格，全库共用

尺寸不是每间房单独定的，而是由「格位 30m × 占格数」派生：

| spec | 占格  | 外廓（含墙） | 净内空（可走） | 层高 | 传送门               |
| ---- | ----- | ------------ | -------------- | ---- | -------------------- |
| `S`  | 1 × 1 | 30 × 30 m    | 28.5 × 28.5 m  | 12 m | 4（每面 1）          |
| `M`  | 2 × 1 | 60 × 30 m    | 58.5 × 28.5 m  | 18 m | 6（宽墙 2 / 窄墙 1） |
| `L`  | 2 × 2 | 60 × 60 m    | 58.5 × 58.5 m  | 24 m | 8（每面 2）          |

墙厚恒为 `0.75m`、建在占格内侧，所以**外廓 AABB 恰好等于占格尺寸** ——
任意两个房间都能无缝对接。传送门锚定在**占格边中心**（洞口恒 3.0 × 3.2m、贴地），
所以拼装后必然对齐。这两条是"可互换"的地基，都有测试钉死。

## 快速开始

```bash
# 必须带 submodule（three.js 锁定在 r185）
git clone --recurse-submodules https://github.com/JackZH26/UEThreeJs.git
cd UEThreeJs

# 已克隆但漏了 submodule 的补救：
# git submodule update --init --depth 1

pnpm install

pnpm cli describe examples/etc-m-catwalk-gallery.roomgraph.yaml
pnpm cli validate examples/etc-m-catwalk-gallery.roomgraph.yaml --strict

# 导出 GLB（可拖进 UE / Blender / 任意 glTF 查看器），落在仓库的 out/
pnpm cli export examples/etc-m-catwalk-gallery.roomgraph.yaml --out out/gallery.glb
pnpm verify:three
pnpm check

# 3D 视口（http://localhost:5173）
pnpm dev
```

## 关卡长什么样

```yaml
schemaVersion: '0.2.0'
meta:
  name: ETC Catwalk Gallery

themes:
  - id: gallery
    surfaces: { floor: concrete_floor, ceiling: steel_deck, wall: concrete_wall }
    lightPreset: gallery_cool

rooms:
  - id: catwalk_gallery
    spec: M # ← 尺寸、层高、6 个传送门全部由此派生
    theme: gallery
    structures:
      - id: mezz_n # 夹层 = 贴墙的 platform
        type: platform
        rect: { x: 0, z: -11.2, w: 56, d: 6 }
        elevation: 6
        railing: [south]
      - id: stair_g_to_mezz_n # 进深由踢面高度按 Blondel 公式推导，写不了也不用写
        type: stair
        from: { x: -12, z: -1 }
        to: mezz_n
        facing: north
        stepHeight: 0.19
```

注意这里**没有**：世界坐标、`size`、`doorCount`、任何传送门。
全是派生量 —— 想看实际数字跑 `pnpm cli describe`。

## 目录结构

```
packages/schema/   RoomGraph schema（Zod 4 → TS 类型 + 运行时校验 + JSON Schema）+ S/M/L 规格派生表
packages/core/     文档 IO、17 条校验规则、几何推导、命令层（零 three.js 依赖）
packages/scene/    Room → three.js 场景 + 材质调色板 + 灯光（唯一允许 import three 的库包）
apps/cli/          headless CLI —— AI agent 与 CI 的主接口
apps/editor/       浏览器编辑器：左侧 3D 显示区 / 右侧操作面板，中英文切换，含第一人称漫游
scripts/           构建期检查（submodule 接线 / 单实例）+ 运行期探针（CDP 自检编辑器）
three.alias.ts     three.js 模块解析映射（vite 与 vitest 共用的唯一来源）
examples/          4 个示例关卡（S×2 / M / L），同时是 CI 回归夹具
three.js/          submodule @ r185，只读参考
```

## 文档

| 文件                                           | 内容                                                          |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [`AGENTS.md`](./AGENTS.md)                     | **AI agent 操作手册**（CLI 契约、数据模型、硬约束、禁止事项） |
| [`docs/SCOPE.md`](./docs/SCOPE.md)             | 项目范围与设计原则，含明确的 out-of-scope 清单                |
| [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md) | 开发规范（类型严格性、命令层、测试、three.js 依赖策略）       |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md)         | 阶段产出目标与验收标准                                        |

## 状态

**Phase 0 完成**，**Phase 1 基本完成**：

- S/M/L 规格派生表（尺寸 + 传送门），外壳 AABB = 占格尺寸有测试保证
- 房间外壳几何（带洞口的墙）+ 9 类内部结构件（夹层 / 楼梯 / 廊桥 / 柱梁…）+ 固定样式传送门
- 道具库第一批 30 个 prefab（碰碰车写实款 / **卡通款** / 乐高人 / 吊顶彩灯串 / 镜面球 /
  观众长椅 / 自动贩卖机）—— 目录是**闭合枚举**，写错的 prefab id 在 schema 层就被拒；
  示例见 `etc-s-bumper-arena`（同场摆了写实款与卡通款两种碰碰车）
- 3D 视口 + 第一人称漫游（可走进房间、爬楼梯上夹层），中英文切换
- 影调对齐 three.js 的 [SSR + Denoise 示例](https://threejs.org/examples/#webgpu_postprocessing_ssr_denoise)：
  AgX 色调映射、阴影、程序化 IBL、屏幕空间反射 + 时域降噪 + TRAA；
  冷灰工业调色板；关卡自带灯光真正参与渲染
- **GLB 导出**（`pnpm cli export`，编辑器面板里也有按钮）：glTF 与 three.js 同为
  Y-up 右手系、单位米，不做坐标换算，手性与单位由 UE 导入器负责。
  两条路径产物**逐字节相同**，都落在 `out/`。适合核对几何与比例，
  **不是最终 UE 资产**（UV 不可平铺、楼梯无斜坡碰撞代理）—— 边界见 `AGENTS.md`

下一步 Phase 2：命令层实现、undo/redo、gizmo 编辑、file watcher 热重载。
详见 [ROADMAP](./docs/ROADMAP.md)。

## 许可

[MIT](./LICENSE)
