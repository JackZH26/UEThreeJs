import { useEffect, useRef } from 'react';
import {
  AgXToneMapping,
  Box3,
  DirectionalLight,
  GridHelper,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GRID_UNIT } from '@tjre/schema';
import type { Room, Theme } from '@tjre/schema';
import { buildRoom } from '@tjre/scene';
import type { BuildRoomResult } from '@tjre/scene';
import { FirstPersonController } from './FirstPersonController.js';
import { GRADING, createRenderPipeline } from './renderPipeline.js';
import { installRectAreaLightSupport } from './rectAreaLightSupport.js';

/**
 * 3D 视口。
 *
 * 渲染器用 `WebGPURenderer` —— `navigator.gpu` 不可用时它会自动降级到
 * WebGL2 后端，同一份代码不需要改（见 docs/SCOPE.md 的渲染器选型）。
 *
 * 所有 three 类型都从 `three/webgpu` 导入：该入口 `export * from './Three.Core.js'`，
 * 所以 Vector3 等核心类与 `@tjre/scene` 里 `from 'three'` 拿到的是**同一个类**
 * （`pnpm verify:three` 断言了这一点）。
 *
 * ── 影调设定 ────────────────────────────────────────────────
 * 色调映射 / 曝光 / 环境光 / 主光 全部对齐 three.js 的
 * `webgpu_postprocessing_ssr_denoise` 示例（详见 renderPipeline.ts）。
 * 在此之前这里是 `NoToneMapping` + 一盏平铺 AmbientLight —— 这正是画面
 * 发灰发平的根因，而不是材质参数不对。
 */

/**
 * ── 光照强度标定 ──────────────────────────────────────────
 *
 * ⚠️ **不要直接照抄参考例子的数值。** 它的方向光是 20、环境是 1.0，
 * 那套数值成立是因为它的地牢模型带**很暗的烘焙贴图**、而且画面大部分在阴影里。
 * 我们的房间是混凝土灰（albedo 约 0.07 线性）、开顶、阳光直射到每个面 ——
 * 照搬过来会整屏过曝：墙面直接冲成白色，palette 里的冷灰色调完全看不出来，
 * 地面的反射也被高光吃掉。（这就是第一版的实际结果。）
 *
 * 能迁移的是**色调曲线**（AgX + 对比/gamma），不是光强。
 * 下面的数值是用 `scripts/probe-editor.mts` 截图逐步收敛出来的。
 */

/** 环境光（IBL）强度 —— 只当暗部补光，让阴影不死黑 */
const ENV_INTENSITY = 0.11;

/** 主光强度 */
const SUN_INTENSITY = 2.6;

/** 主光方向（从房间指向光源），刻意偏斜以产生斜向长投影 */
const SUN_DIRECTION = new Vector3(-0.55, 0.78, 0.42).normalize();

export type ViewportStats = BuildRoomResult['stats'];

export interface ViewportProps {
  /**
   * 要渲染的房间。**一次只渲染一个** —— 每个房间就是一个独立关卡，
   * 房间之间由传送门在运行时连接，没有"把整份文档摆成一个连通空间"这回事。
   */
  room: Room | null;
  theme: Theme | undefined;
  wireframe: boolean;
  showCeiling: boolean;
  showStructures: boolean;
  /** 是否实例化房间自带的灯光（`room.lights`） */
  showLights: boolean;
  /**
   * 屏幕空间反射 + 时域降噪 + TRAA 的后处理管线。
   *
   * 关掉会退回直接渲染（仍保留色调映射与阴影）。留这个开关有两个用处：
   * A/B 对比反射效果，以及在后处理出问题时把它隔离掉照样能编辑房间。
   */
  ssr: boolean;
  /** 第一人称漫游模式 —— 用于验证尺度感与能否走上夹层 */
  firstPerson: boolean;
  onStats?: (stats: ViewportStats) => void;
  /** 渲染器初始化失败时上报 —— 不要让失败表现为一片空白 */
  onError?: (error: Error) => void;
  /**
   * 后处理管线构建失败时上报。
   *
   * 与 `onError` 分开是**刻意的**：管线失败不该让整个视口消失。
   * 我们回落到直接渲染，房间照样能看，只是没有反射 —— 然后把原因显示在面板上。
   */
  onPostFallback?: (error: Error) => void;
  /** 后端就绪后上报实际使用的是 WebGPU 还是 WebGL2 回退 */
  onBackend?: (name: string) => void;
  /**
   * 已渲染帧数（约 2Hz 上报）。
   *
   * 这是最有用的一条诊断：如果它一直是 0，说明动画循环从未启动
   * （init 失败 / 异常被吞）；如果在增长而画面仍空，问题就在相机或几何。
   */
  onFrames?: (count: number) => void;
}

/**
 * 找出生点。
 *
 * 房间固定在原点、不旋转，所以房间局部坐标就是世界坐标 —— 不需要矩阵变换。
 * 没有 spawn marker 时退回到房间中心，保证漫游模式总能启动。
 */
function resolveSpawn(room: Room): Vector3 {
  const marker = room.markers.find((m) => m.kind === 'spawn');
  if (marker !== undefined) return new Vector3(marker.at.x, marker.at.y, marker.at.z);
  return new Vector3(0, 0.5, 0);
}

export function Viewport({
  room,
  theme,
  wireframe,
  showCeiling,
  showStructures,
  showLights,
  ssr,
  firstPerson,
  onStats,
  onError,
  onPostFallback,
  onBackend,
  onFrames,
}: ViewportProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  // 用 ref 持有回调，避免它们进 effect 依赖导致整个场景重建
  const callbacks = useRef({ onStats, onError, onPostFallback, onBackend, onFrames });
  callbacks.current = { onStats, onError, onPostFallback, onBackend, onFrames };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || room === null) return;

    /**
     * StrictMode 在开发模式会 挂载 → 卸载 → 再挂载。
     * `renderer.init()` 是异步的，清理函数可能在它 resolve 之前就跑完了；
     * 如果不设这个标志，动画循环会在一个已经 dispose 的渲染器上启动，
     * 之后每一帧都抛错。
     */
    let cancelled = false;

    // 必须在建任何面光源之前调 —— 否则 type=area 的房间会整屋渲染成黑的，
    // 而且帧数照涨、看起来毫无异常。详见该模块的注释。
    installRectAreaLightSupport();

    const scene = new Scene();
    const camera = new PerspectiveCamera(firstPerson ? 75 : 60, 1, 0.1, 2000);
    // ⚠️ 开 SSR 时**必须**关掉 MSAA。后处理链要把场景 pass 的深度纹理拷出来
    // 给 SSR 用，而多重采样的深度纹理拷不到单采样目标上 ——
    // WebGPU 会报 `Source [Texture "depth"] sample count (4) and destination
    // sample count (1) does not match`，接着整条 command buffer 失效。
    // 抗锯齿此时由 TRAA 负责；SSR 关掉时再让 MSAA 接手。
    const renderer = new WebGPURenderer({ antialias: !ssr });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // AgX + 抬高的曝光是这套影调的地基
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = GRADING.exposure;
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    // 第一人称时必须有天花，否则天光直接漏进来、也看不出是室内
    const built = buildRoom(room, theme, {
      wireframe,
      showCeiling: showCeiling || firstPerson,
      showStructures,
      showLights,
    });
    scene.add(built.root);
    callbacks.current.onStats?.(built.stats);

    // ── 主光 ────────────────────────────────────────────
    // 单盏高强度方向光 + 硬阴影，对齐参考例子（阳光射进地牢）。
    // 阴影正交视锥必须按房间**外廓**收紧：60m 的 L 房间用默认视锥会糊成一片。
    const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
    const reach = Math.hypot(built.outerPlan.w, built.outerPlan.d) / 2 + built.size.h;
    sun.position.copy(SUN_DIRECTION).multiplyScalar(reach * 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const half = Math.max(built.outerPlan.w, built.outerPlan.d) * 0.75;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = reach * 3;
    // 外壳材质是 DoubleSide，阴影 pass 也会走双面（Renderer.js 的 _shadowSide 表），
    // 所以必须给足偏置压 acne。normalBias 按房间尺度放大。
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    scene.add(sun);

    // 网格只在俯视模式下有意义。用**外廓**尺寸并按格位（GRID_UNIT）划分 ——
    // 一格 = 一个占格，能直接看出这个房间占几格。
    const grid = firstPerson
      ? null
      : (() => {
          const span = Math.max(built.outerPlan.w, built.outerPlan.d);
          const size = span + GRID_UNIT * 2;
          const helper = new GridHelper(size, size / GRID_UNIT, 0x30363d, 0x21262d);
          helper.position.set(0, -0.01, 0);
          scene.add(helper);
          return helper;
        })();

    // ── 控制方式 ────────────────────────────────────────
    let orbit: OrbitControls | null = null;
    let lock: PointerLockControls | null = null;
    let fps: FirstPersonController | null = null;
    let onCanvasClick: (() => void) | null = null;

    if (firstPerson) {
      const spawn = resolveSpawn(room);
      lock = new PointerLockControls(camera, renderer.domElement);
      fps = new FirstPersonController({
        camera,
        walkables: built.walkables,
        colliders: built.root,
        spawn,
      });
      fps.connect();
      // 指针锁定必须由用户手势触发，浏览器不允许自动进入
      onCanvasClick = () => {
        lock?.lock();
      };
      renderer.domElement.addEventListener('click', onCanvasClick);
    } else {
      orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;

      const box = new Box3().setFromObject(built.root);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.9 + 5;
      camera.position.set(center.x + radius, center.y + radius * 0.8, center.z + radius);
      orbit.target.copy(center);
      orbit.update();
    }

    const resize = (): void => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // 必须让 setSize 同时更新 CSS 尺寸（默认行为）。传 updateStyle=false 时
      // canvas 的 CSS 尺寸会等于其像素尺寸，在 pixelRatio=2 下变成容器的两倍大，
      // 被父元素 overflow:hidden 裁掉大半，看起来就像"什么都没渲染"。
      renderer.setSize(w, h);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // 用 Timer 而不是 Clock：Clock 在 r183 起已 deprecated，会每帧往控制台打
    // 警告 —— 而控制台是我们诊断黑屏的主要通道，不能让它被噪声淹没。
    // 另外 connect(document) 会启用 Page Visibility API：切到别的标签页时
    // delta 归零，回来时不会因为累积了几十秒而把人瞬移穿墙。
    const timer = new Timer();
    timer.connect(document);
    let frames = 0;
    let lastReport = 0;

    // 这两个要在 init 之后才能建，但 cleanup 需要看得到它们
    let pipeline: ReturnType<typeof createRenderPipeline> | null = null;
    let pmrem: PMREMGenerator | null = null;

    void (async () => {
      try {
        // 显式 init：这样初始化失败能被 catch 到并上报，
        // 而不是变成一个无人处理的 Promise 拒绝 + 白屏。
        await renderer.init();
        if (cancelled) return;

        callbacks.current.onBackend?.(
          renderer.backend.constructor.name.replace('Backend', '') || '未知',
        );

        // ── 环境光（IBL）─────────────────────────────────
        // 程序化环境，零资产。房间是全封闭的，所以**不设** scene.background ——
        // 背景永远被墙挡住，加载 HDR 只是白付带宽。环境贴图不做遮挡，
        // 所以它在这里的作用就是"假装的反弹光"，让暗部不死黑。
        pmrem = new PMREMGenerator(renderer);
        const envScene = new RoomEnvironment();
        scene.environment = pmrem.fromScene(envScene, 0.04).texture;
        scene.environmentIntensity = ENV_INTENSITY;
        envScene.dispose();

        // ── 后处理 ──────────────────────────────────────
        // 失败**不能**变成黑屏：回落到直接渲染，房间照样能编辑。
        if (ssr) {
          try {
            pipeline = createRenderPipeline({ renderer, scene, camera });
          } catch (cause) {
            pipeline = null;
            callbacks.current.onPostFallback?.(
              cause instanceof Error ? cause : new Error(String(cause)),
            );
          }
        }

        renderer.setAnimationLoop(() => {
          // Timer 必须显式推进（Clock 是查询时隐式推进的）
          timer.update();
          // 仍然夹一次上限：Page Visibility 只挡标签页切换，
          // 长 GC 停顿或场景重建造成的掉帧一样会给出很大的 delta
          const dt = Math.min(timer.getDelta(), 0.1);
          orbit?.update();
          fps?.update(dt);
          // 用了后处理管线就**不能**再调 renderer.render()
          if (pipeline !== null) pipeline.render();
          else renderer.render(scene, camera);

          frames++;
          // 每帧 setState 会把 React 拖死，约 2Hz 上报一次就够诊断
          const elapsed = timer.getElapsed();
          if (elapsed - lastReport > 0.5) {
            lastReport = elapsed;
            callbacks.current.onFrames?.(frames);
          }
        });
      } catch (cause) {
        if (cancelled) return;
        callbacks.current.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      }
    })();

    return () => {
      cancelled = true;
      timer.dispose(); // 摘掉 visibilitychange 监听
      observer.disconnect();
      if (onCanvasClick !== null) renderer.domElement.removeEventListener('click', onCanvasClick);
      fps?.disconnect();
      lock?.disconnect();
      orbit?.dispose();
      // 只有初始化完成才停循环 —— 否则 setAnimationLoop(null) 内部会
      // 先 await init()，等于在一个即将 dispose 的渲染器上又发起初始化
      if (renderer.initialized) renderer.setAnimationLoop(null);
      // three.js 核心不做自动回收 —— 漏掉这些调用会持续泄漏显存且不报错。
      // 后处理管线里每个节点都自带 render target，是这里最大的一笔。
      pipeline?.dispose();
      scene.environment?.dispose();
      scene.environment = null;
      pmrem?.dispose();
      built.dispose();
      if (grid !== null) {
        grid.geometry.dispose();
        if (Array.isArray(grid.material)) grid.material.forEach((m) => m.dispose());
        else grid.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [room, theme, wireframe, showCeiling, showStructures, showLights, ssr, firstPerson]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
