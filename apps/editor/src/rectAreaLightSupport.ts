import { RectAreaLightNode } from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';

/**
 * 启用 `RectAreaLight`（schema 里的 `type: area`）。
 *
 * 面光源的 BRDF 用 LTC（Linearly Transformed Cosines）近似，需要两张预计算查找表。
 * three 不会自动加载它们：**不调这个函数就用面光源**，`RectAreaLightNode` 内部的
 * `_ltcLib` 是 null，构建着色器时炸在 `_ltcLib.LTC_FLOAT_1` 上。
 *
 * 症状很有欺骗性：**整个房间渲染成全黑，但帧数照涨、控制台看起来正常**
 * （报错发生在节点构建期，容易被漏掉）。L 规格的中庭示例是唯一用面光源的，
 * 所以只有它黑屏 —— 排查时先怀疑"这个房间有什么别的房间没有的东西"。
 *
 * 幂等：LTC 表是全局单例，重复 init 只是白算一遍。用全局符号表做哨兵，
 * 这样 HMR 换掉本模块后也不会重复初始化。
 */
const FLAG = Symbol.for('tjre.rectAreaLightLTCInstalled');

export function installRectAreaLightSupport(): void {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  if (registry[FLAG] === true) return;
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  registry[FLAG] = true;
}
