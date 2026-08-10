import { z } from 'zod';
import { Id, OpeningRef, PositiveMeters, Size3, Tags, UserData } from './primitives.js';
import { Opening } from './opening.js';
import { Structure } from './structure.js';
import { Light, Marker, Pin, Prop } from './content.js';

/**
 * Room —— 一个**全封闭**的立方体外壳，带固定数量的门与内部结构。
 *
 * 设计意图（见 docs/SCOPE.md）：
 *   · 外壳永远是闭合的六面盒（无开放侧），只能通过 Opening 打洞
 *   · `doorCount` 是**声明式约束**：校验器会核对可通行开口的实际数量，不符即报错
 *   · 房间可以很高（仓库 / loft，典型 6~12m），内部靠 Structure 组织竖向空间
 */
export const Room = z
  .strictObject({
    id: Id,
    name: z.string().max(80).optional().describe('给人看的显示名'),

    size: Size3.describe('房间**内部净尺寸**。典型仓库/loft：h 在 6~12 之间'),
    theme: Id.describe('引用 document.themes 中的主题 id'),

    /**
     * 声明本房间应有的门（可通行开口）数量。
     * 校验规则 R007 会核对它与 `openings` 中可通行开口的实际数量是否一致。
     * 这是"全封闭 + 固定数量门"这一游戏设计约束的机器可检查形式。
     */
    doorCount: z
      .number()
      .int()
      .min(0)
      .describe('声明的门数量；必须等于 openings 中可通行开口的数量（校验规则 R007）'),

    openings: z.array(Opening).default([]).describe('外壳墙上的洞口'),
    structures: z.array(Structure).default([]).describe('内部结构件：夹层 / 楼梯 / 廊桥 / 柱梁等'),
    props: z.array(Prop).default([]),
    lights: z.array(Light).default([]),
    markers: z.array(Marker).default([]),

    pin: Pin.optional().describe('手动锚定世界坐标；不设则由 solver 依连接图推导'),

    /** 覆盖 document.meta 的默认墙厚 */
    wallThickness: PositiveMeters.optional().describe('覆盖 meta.wallThickness'),

    tags: Tags,
    userData: UserData,
    note: z.string().max(500).optional(),
  })
  .describe('一个全封闭的立方体房间');
export type Room = z.infer<typeof Room>;

/**
 * Connection —— 连接两个房间的开口，构成关卡的串联拓扑。
 *
 * 约束（由校验器强制）：
 *   · 两端开口必须存在且**可通行**（window 不行）
 *   · 两端 `elevation` 必须相等（否则夹层门对不上）
 *   · 每个开口最多参与一个 Connection
 */
export const Connection = z
  .strictObject({
    id: Id,
    from: OpeningRef,
    to: OpeningRef,
    locked: z.boolean().default(false).describe('初始是否上锁'),
    keyId: z
      .string()
      .max(64)
      .optional()
      .describe('开锁所需的钥匙标识，供游戏逻辑使用；locked=true 时通常需要'),
    oneWay: z.boolean().default(false).describe('是否仅允许 from → to 单向通行'),
    transition: z
      .string()
      .max(64)
      .optional()
      .describe('过场 / 转场标识，供游戏逻辑使用（例如 "fade"、"elevator"）'),
    note: z.string().max(200).optional(),
  })
  .describe('两个房间开口之间的连接');
export type Connection = z.infer<typeof Connection>;
