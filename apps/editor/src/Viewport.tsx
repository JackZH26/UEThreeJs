import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  Box3,
  Clock,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { RoomGraphDocument } from '@tjre/schema';
import { buildScene } from '@tjre/scene';
import type { BuildSceneResult } from '@tjre/scene';
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

export type ViewportStats = BuildSceneResult['stats'];

export interface ViewportProps {
  doc: RoomGraphDocument | null;
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
}

/**
 * 找出生点的世界坐标。
 *
 * `spawn` marker 存的是**房间局部**坐标，所以要经房间 Group 的世界矩阵变换。
 * 没有 spawn marker 时退回到关卡中心上方，保证漫游模式总能启动。
 */
function resolveSpawn(doc: RoomGraphDocument, built: BuildSceneResult): Vector3 {
  built.root.updateMatrixWorld(true);
  for (const room of doc.rooms) {
    const marker = room.markers.find((m) => m.kind === 'spawn');
    const group = built.roomGroups.get(room.id);
    if (marker === undefined || group === undefined) continue;
    return group.localToWorld(new Vector3(marker.at.x, marker.at.y, marker.at.z));
  }
  const b = built.layout.bounds;
  return new Vector3((b.minX + b.maxX) / 2, 0.5, (b.minZ + b.maxZ) / 2);
}

export function Viewport({
  doc,
  wireframe,
  showCeiling,
  showStructures,
  firstPerson,
  onStats,
  onError,
  onBackend,
}: ViewportProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  // 用 ref 持有回调，避免它们进 effect 依赖导致整个场景重建
  const callbacks = useRef({ onStats, onError, onBackend });
  callbacks.current = { onStats, onError, onBackend };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || doc === null) return;

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
    const built = buildScene(doc, {
      wireframe,
      showCeiling: showCeiling || firstPerson,
      showStructures,
    });
    scene.add(built.root);
    callbacks.current.onStats?.(built.stats);

    const b = built.layout.bounds;

    // 网格只在俯视模式下有意义
    const grid = firstPerson
      ? null
      : (() => {
          const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 20);
          const size = Math.ceil(span / 10) * 10 + 20;
          const helper = new GridHelper(size, size / 2, 0x30363d, 0x21262d);
          helper.position.set((b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2);
          scene.add(helper);
          return helper;
        })();

    // ── 控制方式 ────────────────────────────────────────
    let orbit: OrbitControls | null = null;
    let lock: PointerLockControls | null = null;
    let fps: FirstPersonController | null = null;
    let onCanvasClick: (() => void) | null = null;

    if (firstPerson) {
      const spawn = resolveSpawn(doc, built);
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

    const clock = new Clock();

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
          // dt 夹上限：切标签页回来时 delta 会很大，会把人瞬移穿墙
          const dt = Math.min(clock.getDelta(), 0.1);
          orbit?.update();
          fps?.update(dt);
          renderer.render(scene, camera);
        });
      } catch (cause) {
        if (cancelled) return;
        callbacks.current.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      }
    })();

    return () => {
      cancelled = true;
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
  }, [doc, wireframe, showCeiling, showStructures, firstPerson]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
