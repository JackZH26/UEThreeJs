import { z } from 'zod';
import { Id, Meters, Size2, WallSide } from './primitives.js';

/**
 * 开口类型。
 *
 * 房间外壳始终是**全封闭**的；开口是壳体上被挖掉的洞。
 * 只有 `passable` 的类型才能参与 Connection（`window` 不能）。
 */
export const OpeningType = z.enum([
  'door', // 标准门，可通行，可上锁
  'window', // 窗，不可通行
  'arch', // 拱门 / 无门扇洞口，可通行
  'passage', // 宽通道，可通行
  'hidden', // 隐藏门，可通行，默认对玩家不可见
]);
export type OpeningType = z.infer<typeof OpeningType>;

/** 可通行的开口类型 —— 只有这些能参与 Connection */
const PASSABLE: ReadonlySet<OpeningType> = new Set<OpeningType>([
  'door',
  'arch',
  'passage',
  'hidden',
]);

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
