import { TorusGeometry } from 'three';
import type { BufferGeometry } from 'three';
import { bar, cyl } from '../parts.js';
import type { PointXYZ } from '@tjre/schema';

/**
 * ============================================================
 *  橡胶围裙 —— 碰碰车共用的保险杠圈
 * ============================================================
 *
 *  碰碰车的识别特征就是这一圈贴地的厚橡胶：它**藏住轮子**（实物是三个小轮，
 *  全在围裙里），同时是全车最外的轮廓。两款碰碰车（写实款 / 卡通款）都要它，
 *  所以抽到这里 —— 两份实现必然漂移，而漂移的表现是"围裙不再是最外轮廓"，
 *  于是车身侧面会先撞上别的东西，碰碰车就不像碰碰车了。
 *
 *  做法：4 段直边 + 4 个圆角柱，圆角用整根小圆柱填实（不掏空，车壳会把内侧
 *  全挡住）。产出的几何在道具局部坐标系，y = 0 在地面。
 */

export interface RoundSkirtSpec {
  /** 外缘半宽（= 全车半宽） */
  halfWidth: number;
  noseZ: number;
  tailZ: number;
  /** 管半径。管顶 = 2×它，管底与地面相切 */
  tubeRadius: number;
  /** 平面圆角半径（**外轮廓**的，不是管中线的） */
  cornerRadius: number;
}

export interface SkirtSpec {
  /** 外缘半宽（= 全车半宽） */
  halfWidth: number;
  /** 车头外缘 z（负） */
  noseZ: number;
  /** 车尾外缘 z（正） */
  tailZ: number;
  height: number;
  /** 壁厚 */
  thickness: number;
  /** 平面圆角半径 */
  cornerRadius: number;
}

/**
 * 圆角处的四分之一环面，**水平**放置（管中线在 y = center.y 的平面里）。
 *
 * 不放进 `parts.ts`：`ring()` 的 `facing` / `tiltX` / `arc` 三个参数是为**立面上**
 * 的圆环设计的（轮眉、方向盘、笑嘴），再挂一个水平分支会把那三个参数的含义
 * 全搅乱。而"水平圆角管"只有围裙用得到。
 *
 * `quarter`：0 = 东北（弧从 +X 扫到 -Z），每 +1 逆时针转 90°。
 */
function cornerArc(
  pathRadius: number,
  tube: number,
  center: PointXYZ,
  quarter: number,
): BufferGeometry {
  const geometry = new TorusGeometry(pathRadius, tube, 6, 8, Math.PI / 2);
  // 环面本在 XY 平面；转到 XZ 平面后，原来的 +Y 指向 -Z
  geometry.rotateX(-Math.PI / 2);
  if (quarter !== 0) geometry.rotateY((Math.PI / 2) * quarter);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/**
 * **圆管截面**的围裙（卡通款用）。
 *
 * 与上面的方形截面是两个函数而不是一个参数：写实款的包围盒被测试钉死，
 * 而圆管的外轮廓要靠"管中线内缩一个管半径"才守得住同一个宽度 ——
 * 两套算法混在一个函数里，改一处必然碰坏另一处。
 *
 * 管底与地面**相切**（中心高 = 管半径），所以看上去是一圈搁在地上的橡胶胎，
 * 而不是一块黑色台座 —— 这一点是碰碰车的识别特征，方截面做不出来。
 */
export function roundBumperSkirt(spec: RoundSkirtSpec): BufferGeometry[] {
  const { halfWidth, noseZ, tailZ, tubeRadius, cornerRadius } = spec;
  const y = tubeRadius;
  // 管中线：整体轮廓各向内缩一个管半径
  const px = halfWidth - tubeRadius;
  const pzNose = noseZ + tubeRadius;
  const pzTail = tailZ - tubeRadius;
  const rc = cornerRadius - tubeRadius;
  const cx = px - rc;
  const czNose = pzNose + rc;
  const czTail = pzTail - rc;

  const parts: BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    parts.push(
      cyl(
        tubeRadius,
        czTail - czNose,
        { x: sx * px, y, z: (czNose + czTail) / 2 },
        { axis: 'z', segments: 10 },
      ),
    );
  }
  for (const z of [pzNose, pzTail]) {
    parts.push(cyl(tubeRadius, cx * 2, { x: 0, y, z }, { axis: 'x', segments: 10 }));
  }
  parts.push(cornerArc(rc, tubeRadius, { x: cx, y, z: czNose }, 0));
  parts.push(cornerArc(rc, tubeRadius, { x: -cx, y, z: czNose }, 1));
  parts.push(cornerArc(rc, tubeRadius, { x: -cx, y, z: czTail }, 2));
  parts.push(cornerArc(rc, tubeRadius, { x: cx, y, z: czTail }, 3));
  return parts;
}

export function bumperSkirt(spec: SkirtSpec): BufferGeometry[] {
  const { halfWidth, noseZ, tailZ, height, thickness, cornerRadius } = spec;
  const parts: BufferGeometry[] = [];
  const y = height / 2;
  const cornerX = halfWidth - cornerRadius;
  const barX = halfWidth - thickness / 2;

  for (const sx of [1, -1]) {
    parts.push(
      cyl(cornerRadius, height, { x: sx * cornerX, y, z: noseZ + cornerRadius }, { segments: 8 }),
    );
    parts.push(
      cyl(cornerRadius, height, { x: sx * cornerX, y, z: tailZ - cornerRadius }, { segments: 8 }),
    );
    const side = bar(
      { x: sx * barX, z: noseZ + cornerRadius },
      { x: sx * barX, z: tailZ - cornerRadius },
      y,
      thickness,
      height,
    );
    if (side !== null) parts.push(side);
  }
  for (const z of [noseZ + thickness / 2, tailZ - thickness / 2]) {
    const end = bar({ x: -cornerX, z }, { x: cornerX, z }, y, thickness, height);
    if (end !== null) parts.push(end);
  }
  return parts;
}
