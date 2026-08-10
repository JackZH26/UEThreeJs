import type { BufferGeometry } from 'three';
import { ball, box, cyl, strut, taperedBox } from '../parts.js';
import { plasticMaterial } from '../palette.js';
import { defColor } from '../propPart.js';
import type { PropPart } from '../propPart.js';
import type { PrefabDef, PointXYZ } from '@tjre/schema';

/**
 * ============================================================
 *  乐高小人（坐姿 / 站姿）
 * ============================================================
 *
 *  按乐高小人的标志性比例来：**大脑袋、四棱台躯干、圆柱头顶带一个凸点**，
 *  手臂是斜伸的短杆、手是小球。放大到人的尺度（站姿含头顶凸点 1.79m）而不是
 *  玩具尺度 —— 房间里其它一切都是米制实尺。
 *
 *  局部坐标：面朝 **-Z**，y = 0 在脚底（`anchor: 'base'`）。
 *
 *  坐姿的关键数字：胯部底面在 y = 0.40。碰碰车的 `mount.y` 是脚坑地板，
 *  座垫上表面 = `mount.y + 0.40` —— 于是把人放在 `at.y = mount.y` 时，
 *  屁股正好落在座垫上、脚正好踩在脚坑里。两个数字的关系写在
 *  `bumperCar.ts` 的 `SEAT_ABOVE_MOUNT`。
 */

/** 胯部（两种姿态共用） */
const HIP = { w: 0.46, h: 0.22, d: 0.3 };
/** 躯干：上窄下宽的四棱台 */
const TORSO = { wTop: 0.37, wBottom: 0.45, h: 0.52, d: 0.28 };
const HEAD_R = 0.2;
const HEAD_H = 0.34;
const STUD_R = 0.09;
const STUD_H = 0.05;
const ARM_T = 0.13;
const HAND_R = 0.075;

interface Pose {
  /** 腿部（含大腿 / 小腿）零件 */
  legs: BufferGeometry[];
  /** 胯部底面高度 */
  hipY: number;
  /** 躯干中心的 Z 偏移（坐姿时整体略微后靠） */
  z: number;
  /** 肩点与手点（用于生成手臂） */
  shoulder: PointXYZ;
  hand: PointXYZ;
}

/** 坐姿：小腿垂下、大腿水平前伸、双手前伸去扶方向盘 */
function seatedPose(): Pose {
  const legs = [
    box({ w: 0.16, h: 0.4, d: 0.18 }, { x: 0.12, y: 0.2, z: -0.3 }),
    box({ w: 0.16, h: 0.4, d: 0.18 }, { x: -0.12, y: 0.2, z: -0.3 }),
    box({ w: 0.44, h: 0.18, d: 0.46 }, { x: 0, y: 0.49, z: -0.12 }),
  ];
  return {
    legs,
    hipY: 0.4,
    z: 0.12,
    // 肩点必须明显在躯干轮廓**之外**（躯干半宽 0.225）：贴着躯干时手臂
    // 在侧视下会糊成胸前的一道斜条（像安全带），完全看不出是手臂 —— 实测过。
    shoulder: { x: 0.31, y: 1.04, z: 0.06 },
    hand: { x: 0.19, y: 0.7, z: -0.29 },
  };
}

/** 站姿：两条直腿，手臂自然下垂略前摆 */
function standingPose(): Pose {
  const legs = [
    box({ w: 0.19, h: 0.66, d: 0.28 }, { x: 0.125, y: 0.33, z: 0 }),
    box({ w: 0.19, h: 0.66, d: 0.28 }, { x: -0.125, y: 0.33, z: 0 }),
  ];
  return {
    legs,
    hipY: 0.66,
    z: 0,
    shoulder: { x: 0.3, y: 1.3, z: 0.02 },
    hand: { x: 0.31, y: 0.94, z: -0.1 },
  };
}

export function buildMinifig(def: PrefabDef): PropPart[] {
  const color = defColor(def);
  const pose = def.pose === 'standing' ? standingPose() : seatedPose();

  const torsoBottom = pose.hipY + HIP.h;
  const headBottom = torsoBottom + TORSO.h;

  const plastic: BufferGeometry[] = [
    ...pose.legs,
    box(HIP, { x: 0, y: pose.hipY + HIP.h / 2, z: pose.z + (def.pose === 'standing' ? 0 : 0.06) }),
    taperedBox(TORSO, { x: 0, y: torsoBottom + TORSO.h / 2, z: pose.z }),
  ];
  // 手臂用 strut：给肩点与手点，长度和倾角自己算出来 —— 比拼两次旋转可靠
  for (const sx of [1, -1]) {
    const arm = strut(
      { x: sx * pose.shoulder.x, y: pose.shoulder.y, z: pose.shoulder.z },
      { x: sx * pose.hand.x, y: pose.hand.y, z: pose.hand.z },
      ARM_T,
    );
    if (arm !== null) plastic.push(arm);
  }

  // 头、手恒为经典乐高黄，不跟随衣裤配色
  const skin: BufferGeometry[] = [
    cyl(HEAD_R, HEAD_H, { x: 0, y: headBottom + HEAD_H / 2, z: pose.z }, { segments: 14 }),
    cyl(STUD_R, STUD_H, { x: 0, y: headBottom + HEAD_H + STUD_H / 2, z: pose.z }, { segments: 12 }),
    ...[1, -1].map((sx) =>
      ball(HAND_R, { x: sx * pose.hand.x, y: pose.hand.y, z: pose.hand.z }, 8),
    ),
  ];

  return [
    ...plastic.map((geometry) => ({ geometry, materialId: plasticMaterial(color) })),
    ...skin.map((geometry) => ({ geometry, materialId: 'minifig_skin' })),
  ];
}
