import { z } from 'zod';
import { Id, Meters, Size2, WallSide } from './primitives.js';

/**
 * 开口类型。
 *
 * 房间外壳始终是**全封闭**的；开口是壳体上被挖掉的洞。
 * 只有 `passable` 的类型才能参与 Connection（`window` 不能）。
 */
export const OpeningType = z.enum([
  'portal', // 传送门：通向**另一个关卡**，是房间之间唯一的连接方式
  'door', // 标准门，可通行，可上锁（房间内部用）
  'window', // 窗，不可通行
  'arch', // 拱门 / 无门扇洞口，可通行
  'passage', // 宽通道，可通行
  'hidden', // 隐藏门，可通行，默认对玩家不可见
]);
export type OpeningType = z.infer<typeof OpeningType>;

/** 可通行的开口类型 */
const PASSABLE: ReadonlySet<OpeningType> = new Set<OpeningType>([
  'portal',
  'door',
  'arch',
  'passage',
  'hidden',
]);

/**
 * 传送门 —— 房间之间的唯一连接方式。
 *
 * 关键语义：**传送门的另一端在别的关卡文档里**，本文档内不存在对应物。
 * 因此它不参与 Connection，也不该被"未连接"类规则告警。
 * 游戏运行时按 seed 随机拼装房间，传送门的去向由生成器决定，不由关卡作者指定。
 */
export function isPortal(type: OpeningType): boolean {
  return type === 'portal';
}

export function isPassable(type: OpeningType): boolean {
  return PASSABLE.has(type);
}

/** 计入房间 `doorCount` 的开口类型（即"门"的定义） */
export function isDoor(type: OpeningType): boolean {
  return isPassable(type);
}

export const Opening = z
  .strictObject({
    id: Id,
    wall: WallSide.describe('开口所在的外壳墙面'),
    type: OpeningType,
    offset: Meters.default(0).describe(
      '沿墙面从墙中心起算的有符号偏移；0 = 居中。north/south 墙沿 X，east/west 墙沿 Z',
    ),
    size: Size2.describe('洞口尺寸'),
    elevation: Meters.min(0)
      .default(0)
      .describe('开口下沿距房间地面的高度。用于夹层高度的门；连接两端必须相等'),
    note: z.string().max(200).optional().describe('给人/AI 看的备注，不影响几何'),
  })
  .describe('房间外壳墙上的一个洞口');
export type Opening = z.infer<typeof Opening>;
