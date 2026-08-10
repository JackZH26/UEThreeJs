import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GRID_UNIT } from '@tjre/schema';
import type { Room, Theme } from '@tjre/schema';
import { buildRoom } from '@tjre/scene';
import type { BuildRoomResult } from '@tjre/scene';
import { FirstPersonController } from './FirstPersonController.js';

/**
 * 3D 视口。
 *
 * 渲染器用 `WebGPURenderer` —— `navigator.gpu` 不可用时它会自动降级到
 * WebGL2 后端，同一份代码不需要改（见 docs/SCOPE.md 的渲染器选型）。
 *
 * 所有 three 类型都从 `three/webgpu` 导入：该入口 `export * from './Three.Core.js'`，
 * 所以 Vector3 等核心类与 `@tjre/scene` 里 `from 'three'` 拿到的是**同一个类**
 * （`pnpm verify:three` 断言了这一点）。
 */

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
  /** 第一人称漫游模式 —— 用于验证尺度感与能否走上夹层 */
  firstPerson: boolean;
  onStats?: (stats: ViewportStats) => void;
  /** 渲染器初始化失败时上报 —— 不要让失败表现为一片空白 */
  onError?: (error: Error) => void;
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
  firstPerson,
  onStats,
  onError,
  onBackend,
  onFrames,
}: ViewportProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  // 用 ref 持有回调，避免它们进 effect 依赖导致整个场景重建
  const callbacks = useRef({ onStats, onError, onBackend, onFrames });
  callbacks.current = { onStats, onError, onBackend, onFrames };

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

    const scene = new Scene();
    const camera = new PerspectiveCamera(firstPerson ? 75 : 60, 1, 0.1, 2000);
    const renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    scene.add(new AmbientLight(0xffffff, firstPerson ? 0.9 : 0.6));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 60, 20);
    scene.add(sun);

    // 第一人称时必须有天花，否则天光直接漏进来、也看不出是室内
    const built = buildRoom(room, theme, {
      wireframe,
      showCeiling: showCeiling || firstPerson,
      showStructures,
    });
    scene.add(built.root);
    callbacks.current.onStats?.(built.stats);

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

    void (async () => {
      try {
        // 显式 init：这样初始化失败能被 catch 到并上报，
        // 而不是变成一个无人处理的 Promise 拒绝 + 白屏。
        await renderer.init();
        if (cancelled) return;

        callbacks.current.onBackend?.(
          renderer.backend.constructor.name.replace('Backend', '') || '未知',
        );

        renderer.setAnimationLoop(() => {
          // Timer 必须显式推进（Clock 是查询时隐式推进的）
          timer.update();
          // 仍然夹一次上限：Page Visibility 只挡标签页切换，
          // 长 GC 停顿或场景重建造成的掉帧一样会给出很大的 delta
          const dt = Math.min(timer.getDelta(), 0.1);
          orbit?.update();
          fps?.update(dt);
          renderer.render(scene, camera);

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
      // three.js 核心不做自动回收 —— 漏掉这些调用会持续泄漏显存且不报错
      built.dispose();
      if (grid !== null) {
        grid.geometry.dispose();
        if (Array.isArray(grid.material)) grid.material.forEach((m) => m.dispose());
        else grid.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [room, theme, wireframe, showCeiling, showStructures, firstPerson]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
