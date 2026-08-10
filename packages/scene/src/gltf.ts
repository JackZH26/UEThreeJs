import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { Object3D } from 'three';

/**
 * ============================================================
 *  glTF / GLB 导出
 * ============================================================
 *
 *  用途：把房间导成通用格式，能拖进 UE / Blender / 任意 glTF 查看器。
 *
 *  ⚠️ **这是"快速验证通道"，不是最终 UE 管线。** 已知限制见文件末尾。
 *
 *  ── 坐标系：不需要换算 ──────────────────────────────────
 *  glTF 与 three.js 都是 **Y-up 右手系、单位米**，所以导出时**什么都不用转**。
 *  UE 的 glTF 导入器自己负责转到 Z-up 左手系并 ×100 到厘米 ——
 *  这正是选 glTF 而不是手搓 FBX 的主要理由：手性与单位的转换不由我们承担，
 *  也就不会出现"轴搞反了但看起来只是有点怪"这类最难查的问题。
 */

/**
 * `FileReader` 的最小替身。
 *
 * `GLTFExporter` 的 **GLB 分支无条件**使用 `FileReader`
 * （GLTFExporter.js 里 `options.binary === true` 那一段，两处），
 * 而 Node 里没有这个全局（Blob / File 有，FileReader 没有）。
 *
 * 只实现 exporter 真正用到的那部分：`readAsArrayBuffer` / `readAsDataURL`
 * + `onloadend` + `result`。
 */
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then(
      (buffer) => {
        this.result = buffer;
        this.onloadend?.();
      },
      () => this.onerror?.(),
    );
  }

  readAsDataURL(blob: Blob): void {
    blob.arrayBuffer().then(
      (buffer) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`;
        this.onloadend?.();
      },
      () => this.onerror?.(),
    );
  }
}

/**
 * 按需安装 shim。
 *
 * 浏览器里 `FileReader` 本来就有，`??=` 是空操作 —— 所以这个模块在两端都能用，
 * 不需要调用方判断环境。
 */
function ensureFileReader(): void {
  const registry = globalThis as unknown as Record<string, unknown>;
  registry.FileReader ??= NodeFileReader;
}

export interface ExportGLBOptions {
  /**
   * 是否把灯光写进 `KHR_lights_punctual`。默认 `true`。
   *
   * 注意 `RectAreaLight` **不在该扩展的范围内**（glTF 只有 point / spot /
   * directional），导出时会被跳过 —— `exportGLB` 会在结果里报出被跳过的数量，
   * 不要静默丢失。
   */
  includeLights?: boolean;
  /**
   * 追溯信息，写进**根节点**的 `extras`。
   *
   * ⚠️ 不是 `asset.extras` —— `GLTFExporter` 没有写 asset 级 extras 的选项
   * （它支持的只有 binary / trs / onlyVisible / animations /
   * includeCustomExtensions / maxTextureSize）。唯一的自定义数据通道是
   * `Object3D.userData` → 对应节点的 `extras`。
   */
  extras?: Record<string, unknown>;
}

export interface ExportGLBResult {
  glb: Uint8Array;
  /** 被跳过的面光源 id —— 调用方应当把它转告用户 */
  skippedAreaLights: string[];
}

/** glTF 的 punctual light 扩展支持的类型 */
function isExportableLight(object: Object3D): boolean {
  const o = object as unknown as Record<string, boolean | undefined>;
  return o.isPointLight === true || o.isSpotLight === true || o.isDirectionalLight === true;
}

function isAreaLight(object: Object3D): boolean {
  return (object as unknown as { isRectAreaLight?: boolean }).isRectAreaLight === true;
}

/**
 * 把一个 Object3D 子树导成 GLB（二进制 glTF）。
 *
 * 传 `buildRoom(...).root` 即可。返回 `Uint8Array`，调用方决定写文件还是下载。
 */
export async function exportGLB(
  root: Object3D,
  options: ExportGLBOptions = {},
): Promise<ExportGLBResult> {
  ensureFileReader();

  // 先把不可导出的面光源摘掉，否则 GLTFExporter 会往控制台打警告、
  // 而调用方无从知道丢了什么
  const skippedAreaLights: string[] = [];
  const detached: { light: Object3D; parent: Object3D }[] = [];
  root.traverse((object) => {
    if (isAreaLight(object) && object.parent !== null) {
      detached.push({ light: object, parent: object.parent });
    }
  });
  for (const { light, parent } of detached) {
    skippedAreaLights.push(light.name.replace(/^light:/, ''));
    parent.remove(light);
  }

  if (options.includeLights === false) {
    const lights: { light: Object3D; parent: Object3D }[] = [];
    root.traverse((object) => {
      if (isExportableLight(object) && object.parent !== null) {
        lights.push({ light: object, parent: object.parent });
      }
    });
    for (const { light, parent } of lights) {
      parent.remove(light);
      detached.push({ light, parent });
    }
  }

  // 追溯信息走 userData（唯一的自定义数据通道），导出后还原
  const originalUserData = root.userData;
  if (options.extras !== undefined) {
    root.userData = { ...originalUserData, ...options.extras };
  }

  try {
    const exporter = new GLTFExporter();
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        root,
        (result) => {
          resolve(result as ArrayBuffer);
        },
        (error: unknown) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
        {
          binary: true,
          // 灯光走 KHR_lights_punctual；不做压缩（UE 的导入器对 Draco 支持
          // 依版本而异，而我们的几何量很小，压缩收益不值得多一层兼容风险）
          onlyVisible: true,
        },
      );
    });
    return { glb: new Uint8Array(buffer), skippedAreaLights };
  } finally {
    // 还原场景图与 userData —— 导出不该有副作用（编辑器里同一棵树还在渲染）
    for (const { light, parent } of detached) parent.add(light);
    root.userData = originalUserData;
  }
}

/**
 * ── 已知限制（导出到 UE 前必须知道）────────────────────────
 *
 * 1. **UV 不适合平铺贴图。** 墙面几何来自 `ExtrudeGeometry` + Earcut 挖洞，
 *    用的是它的默认 UV 生成器。可视化没问题，但贴不了平铺材质、也没有
 *    lightmap UV。要正经做 UE 资产需要走模块化套件而不是烘这份网格。
 * 2. **墙角互相重叠** `WALL_T × WALL_T`（见 shell.ts 的说明）。视觉无影响，
 *    但导入 UE 后碰撞体会重复计算。
 * 3. **楼梯是阶梯状实体**，没有斜坡碰撞代理 —— UE 里角色走上去会顿挫。
 * 4. **面光源丢失**（glTF 规范所限），见 `skippedAreaLights`。
 * 5. **markers 不导出**。它们是 gameplay 元数据而不是几何，属于 Phase 5
 *    的数据导出（JSON）而不是 GLB。
 *
 * 换句话说：GLB 适合**核对几何与比例**，不适合当最终关卡资产。
 */
