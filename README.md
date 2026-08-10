# ThreeJsRoomEditor

浏览器端、**AI 原生**的房间关卡编辑器。为一款**多房间串联**的游戏打造，运行时目标 **UE 5.8.1**。

房间形态是**很高的仓库 / loft**：外壳为全封闭立方体、带固定数量的门，
内部靠夹层平台与室内楼梯组织竖向空间。

> **为什么不用 UE 编辑器**：① 摆盒子房间不需要开一个完整 DCC；
> ② `.umap` 是二进制，AI 读不了、diff 无意义。本项目的关卡是一份 LLM 能整份读写的 YAML。

## 核心思路

| 原则                        | 含义                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| **文档即真相**              | 关卡是一份小而语义化的 YAML，存意图不存推导结果                                   |
| **图驱动布局**              | 房间世界坐标由连接关系**自动求解** —— LLM 擅长拓扑、不擅长坐标算术                |
| **单一命令层**              | UI / AI / CLI / 测试走同一套 typed command，人与 AI 能力对等                      |
| **AI 输出命令，不输出代码** | 外部 agent（Cindy / Codex / Claude Code）经 schema 校验后应用，永不执行生成的代码 |
| **约束优先**                | 材质、道具、灯光走白名单预设库，保证导出 UE 无损                                  |

## 快速开始

```bash
# 必须带 submodule（three.js 锁定在 r185）
git clone --recurse-submodules https://github.com/JackZH26/UEThreeJs.git
cd UEThreeJs

# 已克隆但漏了 submodule 的补救：
# git submodule update --init --depth 1

pnpm install

pnpm cli describe examples/loft-warehouse.roomgraph.yaml
pnpm cli validate examples/loft-warehouse.roomgraph.yaml --strict
pnpm cli solve examples/loft-warehouse.roomgraph.yaml --map
pnpm verify:three
pnpm check

# 3D 视口（http://localhost:5173）
pnpm dev
```

## 关卡长什么样

```yaml
schemaVersion: 0.1.0
meta:
  name: Loft Warehouse
  entryRoom: dock

themes:
  - id: warehouse
    surfaces: { floor: concrete_floor, ceiling: steel_deck, wall: concrete_wall }
    lightPreset: warehouse_dim

rooms:
  - id: hall
    size: { w: 20, d: 16, h: 10 } # 内部净尺寸，米
    theme: warehouse
    doorCount: 2 # 声明式约束，校验器核对
    openings:
      - id: door_to_dock
        wall: south
        type: passage
        size: { w: 3, h: 3.5 }
      - id: door_to_catwalk # 开在夹层高度
        wall: north
        type: door
        offset: 6
        size: { w: 1.6, h: 2.4 }
        elevation: 4
    structures:
      - id: mezzanine_north # 夹层 = 贴墙的 platform
        type: platform
        rect: { x: 0, z: -5, w: 20, d: 6 }
        elevation: 4
        railing: [south]
      - id: stair_to_mezzanine
        type: stair
        from: { x: -7, z: 1 }
        to: mezzanine_north
        facing: north

connections:
  - { id: dock_to_hall, from: dock.door_to_hall, to: hall.door_to_dock }
```

注意：**没有任何世界坐标** —— 房间位置由 `connections` 求解得出。

## 目录结构

```
packages/schema/   RoomGraph schema（Zod 4 → TS 类型 + 运行时校验 + JSON Schema）
packages/core/     文档 IO、29 条校验规则、布局求解器、几何推导、命令层（零 three.js 依赖）
packages/scene/    RoomGraph + Layout → three.js 场景（唯一允许 import three 的库包）
apps/cli/          headless CLI —— AI agent 与 CI 的主接口
apps/editor/       浏览器编辑器：左侧 3D 显示区 / 右侧操作面板，含第一人称漫游
scripts/           构建期检查（three.js submodule 接线 / 单实例）
three.alias.ts     three.js 模块解析映射（vite 与 vitest 共用的唯一来源）
examples/          示例关卡，同时是 CI 回归夹具
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

- 布局求解器（`pnpm cli solve --map` 带 ASCII 俯视图）
- 房间外壳几何（带洞口的墙）+ 9 类内部结构件（夹层 / 楼梯 / 廊桥 / 柱梁…）
- 3D 视口 + 第一人称漫游（可走进房间、爬楼梯上夹层）

下一步 Phase 2：命令层实现、undo/redo、gizmo 编辑、file watcher 热重载。
详见 [ROADMAP](./docs/ROADMAP.md)。

## 许可

[MIT](./LICENSE)
