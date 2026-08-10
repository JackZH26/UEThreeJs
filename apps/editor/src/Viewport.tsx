import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RoomGraphDocument } from '@tjre/schema';
import { buildScene } from '@tjre/scene';
import type { BuildSceneResult } from '@tjre/scene';

/**
 * 只读 3D 视口（Phase 1）。
 *
 * 渲染器用 `WebGPURenderer` —— 它在 `navigator.gpu` 不可用时会自动降级到
 * WebGL2 后端，同一份代码不需要改（见 docs/SCOPE.md 的渲染器选型）。
 *
 * 所有 three 类型都从 `three/webgpu` 导入：该入口 `export * from './three.core.js'`，
 * 所以 Vector3 等核心类与 `@tjre/scene` 里 `from 'three'` 拿到的是**同一个类**
 * （`pnpm verify:three` 断言了这一点）。
 */

export interface ViewportProps {
  doc: RoomGraphDocument | null;
  wireframe: boolean;
  onStats?: (stats: BuildSceneResult['stats']) => void;
}

export function Viewport({ doc, wireframe, onStats }: ViewportProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || doc === null) return;

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 2000);
    const renderer = new WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new AmbientLight(0xffffff, 0.6));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 60, 20);
    scene.add(sun);

    const built = buildScene(doc, { wireframe });
    scene.add(built.root);
    onStatsRef.current?.(built.stats);

    // 网格：铺满关卡范围，10m 一格
    const b = built.layout.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 20);
    const gridSize = Math.ceil(span / 10) * 10 + 20;
    const grid = new GridHelper(gridSize, gridSize / 2, 0x30363d, 0x21262d);
    grid.position.set((b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2);
    scene.add(grid);

    // 相机框住整个关卡
    const box = new Box3().setFromObject(built.root);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.9 + 5;
    camera.position.set(center.x + radius, center.y + radius * 0.8, center.z + radius);
    controls.target.copy(center);
    controls.update();

    const resize = (): void => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    renderer.setAnimationLoop(() => {
      controls.update();
      void renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      controls.dispose();
      // three.js 核心不做自动回收 —— 漏掉这些调用会持续泄漏显存且不报错
      built.dispose();
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) grid.material.forEach((m) => m.dispose());
      else grid.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [doc, wireframe]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />;
}
