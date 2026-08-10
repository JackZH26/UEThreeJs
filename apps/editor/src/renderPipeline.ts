import {
  AgXToneMapping,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  PhysicalLightingModel,
  RGBAFormat,
  RenderPipeline,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three/webgpu';
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu';
import {
  diffuseColor,
  float,
  materialMetalness,
  materialRoughness,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  sample,
  saturation,
  unpackRGBToNormal,
  uniform,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { temporalReproject } from 'three/addons/tsl/display/TemporalReprojectNode.js';
import { recurrentDenoise } from 'three/addons/tsl/display/RecurrentDenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

/**
 * ============================================================
 *  后处理管线 —— 对齐 three.js 的 SSR + Denoise 示例
 * ============================================================
 *
 *  参考：`three.js/examples/webgpu_postprocessing_ssr_denoise.html`
 *
 *  链路：
 *    pass(scene, camera) + MRT
 *      → ssr                  屏幕空间反射（随机采样，噪声很大）
 *      → temporalReproject    跨帧复用历史，压噪
 *      → recurrentDenoise     空间递归降噪
 *      → 回灌 history         让反射能多次反弹
 *      → sceneColor + 反射
 *      → AgX 色调映射 + 对比 / 饱和 / gamma
 *      → traa                 时域抗锯齿
 *
 *  ── 为什么放在 editor 而不是 packages/scene ─────────────
 *  后处理是**渲染器**关注点，依赖 `three/webgpu` 与 addons。
 *  `packages/scene` 一直从 `'three'` 导入并保持 headless 可测
 *  （几何测试不需要 GPU）。把 `three/webgpu` 引进去会破坏那条边界。
 *
 *  ── 与参考例子的三点差异（因为我们是全封闭室内）───────────
 *  1. **环境贴图是程序化生成的**，不加载 HDR 文件。参考例子用 1.5MB 的户外采石场
 *     HDRI；对一个全封闭房间来说那既不对（室内不该反射蓝天）也没必要。
 *     `createInteriorEnvMap()` 现算一张 64×32 的冷灰渐变，见那个函数的注释。
 *  2. **不加 sharpen。** 参考例子里锐化强度是 0，等于没开，不复制空节点。
 *  3. `screenEdgeFadeBlack = true` —— 参考例子的注释就写着室内该这么设。
 *
 *  ⚠️ **`stochastic: true` 必须配环境贴图。** 这条踩过：
 *  `SSRNode.js:1256` 在射线未命中时**无条件**调 `sampleEnvReflection()`，
 *  不看 `screenEdgeFadeBlack`。没调过 `setEnvMap()` 时 `_importanceEnvironment`
 *  是 null，于是构建着色器时抛 `Cannot read properties of null (reading
 *  'sampleEnvironmentBRDF')`。所以"室内就不需要 env map"是错的。
 */

/** 参考例子的调色参数（`params.post.grading`） */
export const GRADING = {
  exposure: 1.57,
  gamma: 0.89,
  contrast: 1.31,
  saturation: 1.0,
} as const;

/**
 * 关掉环境贴图的**镜面**项。
 *
 * SSR 已经提供镜面反射，环境贴图再叠一层就是双计。
 *
 * 为什么必须动原型：`material.envMapIntensity` 在 `EnvironmentNode` 里同时乘在
 * radiance(镜面) 和 irradiance(漫反射) 上，设 0 会把环境漫反射一起干掉 ——
 * 阴影区直接变纯黑。要**只**关镜面，只能改 `indirectSpecular`
 * （参考例子也是这么做的，并注明"scoped to this example rather than modifying core"）。
 *
 * 这是全局原型改写，在 HMR 下重复应用会套娃（包装包装包装…）。
 * 用全局符号表里的哨兵保证幂等 —— `Symbol.for` 跨模块重载存活，
 * 普通模块级 boolean 不行（模块被 HMR 换掉后 boolean 会重置）。
 */
const PATCH_FLAG = Symbol.for('tjre.envSpecularDisabled');

function disableEnvironmentSpecular(): void {
  const proto = PhysicalLightingModel.prototype as unknown as Record<string | symbol, unknown>;
  if (proto[PATCH_FLAG] === true) return;

  const original = PhysicalLightingModel.prototype.indirectSpecular;
  PhysicalLightingModel.prototype.indirectSpecular = function (
    this: PhysicalLightingModel & { clearcoatRadiance?: { assign: (v: unknown) => void } },
    builder: Parameters<PhysicalLightingModel['indirectSpecular']>[0],
  ) {
    (builder as unknown as { context: { radiance: unknown } }).context.radiance = vec3(0);
    if (this.clearcoatRadiance !== undefined && this.clearcoatRadiance !== null) {
      this.clearcoatRadiance.assign(vec3(0));
    }
    original.call(this, builder);
  };

  proto[PATCH_FLAG] = true;
}

/**
 * 生成一张室内环境贴图，供 SSR 在射线**未命中**时取样。
 *
 * 为什么是程序化而不是加载 HDR：
 *  · `SSRNode.setEnvMap()` 要求 **equirect + CPU 侧 `image.data`**，
 *    PMREM / `scene.environment` 的 cubemap 不接受（源码里明确 warn）。
 *  · 房间是全封闭的。射线飞出屏幕时"看到"的应该是**这个房间自身的平均色调**，
 *    不是蓝天，也不是黑（黑会让掠射角下的地面像个空洞）。
 *  · 64×32 的渐变足够：反射用的是粗糙度模糊后的低频信息，分辨率毫无意义。
 *
 * 渐变按真实内景的照度分布：顶部（被灯照亮的天花）亮，底部（地面）暗，
 * 整体压在冷灰色里，与 palette.ts 的墙面色调同一个色系。
 * 数值是**线性辐照度**，不是 sRGB —— 会经 AgX 与曝光处理。
 */
function createInteriorEnvMap(): DataTexture {
  const width = 64;
  const height = 32;
  const data = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    // v: 0 = 上（天花），1 = 下（地面）
    const v = (y + 0.5) / height;
    // 天花亮、地面暗，中段（墙面）居中
    const luma = 0.11 * (1 - v) ** 1.6 + 0.022;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // 冷调：蓝分量最高，红最低
      data[i] = luma * 0.86;
      data[i + 1] = luma * 0.94;
      data[i + 2] = luma * 1.12;
      data[i + 3] = 1;
    }
  }

  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

export interface RenderPipelineHandle {
  /** 在动画循环里调这个，**不要**再调 renderer.render() */
  render: () => void;
  dispose: () => void;
}

export interface CreateRenderPipelineOptions {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: Camera;
}

/**
 * 构建 SSR 后处理管线。
 *
 * 调用方**必须**处理抛错：失败时应回落到 `renderer.render(scene, camera)`，
 * 让房间照样能看。黑屏比没有反射糟糕得多。
 */
export function createRenderPipeline({
  renderer,
  scene,
  camera,
}: CreateRenderPipelineOptions): RenderPipelineHandle {
  disableEnvironmentSpecular();

  const scenePass = pass(scene, camera);
  scenePass.setMRT(
    mrt({
      output: output,
      // 基础色(albedo) 存 RGB，金属度存 alpha。albedo 是金属 Fresnel f0 所必需的；
      // 这里**不能**预乘 (1-metalness) 的漫反射衰减 —— 那会把金属清零、f0 变 0 → 全黑。
      diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
      // 粗糙度塞进法线的 alpha 通道，省一路 MRT 带宽
      normal: vec4(packNormalToRGB(normalView).rgb, materialRoughness),
      velocity: velocity,
    }),
  );

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassDepth = scenePass.getTextureNode('depth');
  const scenePassVelocity = scenePass.getTextureNode('velocity');
  const scenePassDiffuse = scenePass.getTextureNode('diffuseColor');

  // 法线与 albedo 只需 8bit，降到 UnsignedByte 省显存与带宽
  scenePass.getTexture('normal').type = UnsignedByteType;
  scenePass.getTexture('diffuseColor').type = UnsignedByteType;

  const sceneNormal = sample((uv) => unpackRGBToNormal(scenePassNormal.sample(uv).rgb));
  const sceneMetalRough = sample((uv) =>
    vec2(scenePassDiffuse.sample(uv).a, scenePassNormal.sample(uv).a),
  );

  const ssrNode = ssr(scenePassColor, scenePassDepth, sceneNormal, {
    stochastic: true,
    diffuseNode: scenePassDiffuse,
    metalnessNode: scenePassDiffuse.a,
    roughnessNode: scenePassNormal.a,
  });
  ssrNode.quality.value = 0.25;
  ssrNode.mirrorBias.value = 0.5;
  ssrNode.maxDistance.value = 0.4;
  ssrNode.intensity.value = 1;
  ssrNode.thickness.value = 0.1;
  ssrNode.maxLuminance.value = 35;
  ssrNode.screenEdgeFade.value = 0.2;
  ssrNode.stepExponent = 3;
  // 室内：屏幕边缘的反射淡出到黑（参考例子的注释就是这么建议的）
  ssrNode.screenEdgeFadeBlack = true;
  // 射线飞出屏幕时的回退取样源。**stochastic 模式下这个是必需的**，
  // 不是可选优化（见文件头的 ⚠️）。
  const envMap = createInteriorEnvMap();
  ssrNode.setEnvMap(envMap);
  ssrNode.environmentIntensity.value = 1;

  const temporalNode = temporalReproject(
    ssrNode,
    scenePassDepth,
    scenePassNormal,
    scenePassVelocity,
    camera,
    { mode: 'specular', accumulate: false },
  );
  temporalNode.maxFrames.value = 16;
  temporalNode.clampIntensity.value = 0.25;
  temporalNode.flickerSuppression.value = 1;
  temporalNode.hitPointReprojection.value = true;

  const denoiseNode = recurrentDenoise(temporalNode, camera, {
    depth: scenePassDepth,
    normal: scenePassNormal,
    raw: ssrNode,
    metalRoughness: sceneMetalRough,
    mode: 'specular',
    accumulate: true,
  });
  denoiseNode.alphaSource = 'raylength'; // SSR 的 alpha 存的是射线长度
  denoiseNode.lumaPhi.value = 0.75;
  denoiseNode.depthPhi.value = 20;
  denoiseNode.normalPhi.value = 0.3;
  denoiseNode.roughnessPhi.value = 100;
  denoiseNode.radius.value = 1.5;
  denoiseNode.alphaPhi.value = 5;
  denoiseNode.strength.value = 0.725;
  denoiseNode.adapt.value = 0.5;

  // 把降噪结果 + 速度回灌给 SSR，得到多次反弹的反射
  ssrNode.setHistory(denoiseNode, scenePassVelocity);
  temporalNode.setHistoryTexture(denoiseNode);

  const gammaUniform = uniform(GRADING.gamma);
  const contrastUniform = uniform(GRADING.contrast);
  const saturationUniform = uniform(GRADING.saturation);

  /** AgX → 对比（绕 0.5 支点）→ 饱和 → gamma。顺序与参考例子一致。 */
  const applyGrading = (source: ReturnType<typeof vec4>): ReturnType<typeof vec4> => {
    let rgb = source.rgb;
    rgb = renderOutput(vec4(rgb, 1), AgXToneMapping, SRGBColorSpace).rgb;
    rgb = rgb.sub(0.5).mul(contrastUniform).add(0.5);
    rgb = saturation(rgb, saturationUniform);
    rgb = rgb.max(0.0).pow(float(1).div(gammaUniform));
    return vec4(rgb, 1);
  };

  const litColor = scenePassColor.rgb.add(denoiseNode.rgb);
  const graded = applyGrading(vec4(litColor, 1));
  const outputNode = traa(graded, scenePassDepth, scenePassVelocity, camera);

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = outputNode;
  // 调色链里已经自己做了 renderOutput，不能让管线再套一次
  pipeline.outputColorTransform = false;

  return {
    render: () => {
      pipeline.render();
    },
    dispose: () => {
      // three 核心不做自动回收，每个节点都持有 render target
      for (const node of [outputNode, denoiseNode, temporalNode, ssrNode, scenePass]) {
        const disposable = node as unknown as { dispose?: () => void };
        if (typeof disposable.dispose === 'function') disposable.dispose();
      }
      envMap.dispose();
      pipeline.dispose();
    },
  };
}
