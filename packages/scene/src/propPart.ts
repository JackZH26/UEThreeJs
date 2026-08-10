import type { BufferGeometry } from 'three';
import type { PrefabDef } from '@tjre/schema';

/**
 * 道具构造器的契约。
 *
 * 单独一个模块（而不是放在 `props.ts`）是为了让 `prefabs/*.ts` 与 `props.ts`
 * 之间**没有任何模块环** —— 本包以源码形式被编辑器消费，HMR 下的环状依赖
 * 已经咬过一次（见 `index.ts` 顶部关于星号再导出的注释），不值得再试一次。
 */

/** 构造器产出的一个零件：几何 + 用哪种材质 */
export interface PropPart {
  geometry: BufferGeometry;
  materialId: string;
}

/**
 * 一个 prefab 的几何构造器。
 *
 * 约定（三条，全部由 `props.ts` 与测试守着）：
 *  1. 产出**局部坐标**：forward = -Z（即 `rotationY = 0` 时朝北），x 向东，y 向上
 *  2. 锚点遵守 `def.anchor`：`base` → 最低点在 y = 0；`top` → 最高点在 y = 0
 *  3. 尺寸不读 `def.size`（那是结果，不是输入），但**必须**读 `def.mount`
 *     —— 挂载面是与作者的契约，两边各写一个数就会漂移
 */
export type PrefabBuilder = (def: PrefabDef) => PropPart[];

/**
 * 取配色。目录保证有配色的种类一定写了 `color`，这里的回落只是让类型收窄，
 * 真要触发说明目录写漏了 —— 那时会渲染成白色，而不是崩掉。
 */
export function defColor(def: PrefabDef): NonNullable<PrefabDef['color']> {
  return def.color ?? 'white';
}
