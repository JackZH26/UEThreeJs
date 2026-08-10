import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseDocument } from '@tjre/core';
import { specOuterPlan } from '@tjre/schema';
import type { RoomSpec } from '@tjre/schema';
import { buildRoomFromDocument, exportGLB } from '@tjre/scene';

const examplesDir = resolve(import.meta.dirname, '../../../examples');

const EXAMPLES: Record<RoomSpec, { file: string; roomId: string }> = {
  S: { file: 'etc-s-piston-floor.roomgraph.yaml', roomId: 'piston_floor' },
  M: { file: 'etc-m-catwalk-gallery.roomgraph.yaml', roomId: 'catwalk_gallery' },
  L: { file: 'etc-l-atrium.roomgraph.yaml', roomId: 'atrium' },
};

function roomOf(spec: RoomSpec) {
  const { file, roomId } = EXAMPLES[spec];
  const loaded = parseDocument(readFileSync(resolve(examplesDir, file), 'utf8'), file);
  if (!loaded.ok) throw new Error(`${file} 解析失败`);
  return { doc: loaded.doc, roomId };
}

/** GLB 容器结构：12 字节头 + 若干 chunk（[长度 u32][类型 u32][数据]） */
const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

interface GltfJson {
  asset: { version: string; generator?: string; extras?: Record<string, unknown> };
  nodes?: {
    name?: string;
    mesh?: number;
    extras?: Record<string, unknown>;
    extensions?: Record<string, unknown>;
  }[];
  meshes?: { name?: string }[];
  materials?: { name?: string; pbrMetallicRoughness?: Record<string, unknown> }[];
  extensionsUsed?: string[];
  extensions?: { KHR_lights_punctual?: { lights: { type: string; name?: string }[] } };
}

/** 解开 GLB，返回 JSON chunk 与 BIN chunk 的字节数 */
function parseGlb(glb: Uint8Array): { json: GltfJson; binBytes: number } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(view.getUint32(0, true), 'GLB magic 必须是 "glTF"').toBe(GLB_MAGIC);
  expect(view.getUint32(4, true), 'GLB 版本必须是 2').toBe(2);
  expect(view.getUint32(8, true), '头里的总长度必须等于实际字节数').toBe(glb.byteLength);

  let offset = 12;
  let json: GltfJson | undefined;
  let binBytes = 0;
  while (offset < glb.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = glb.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
    else if (type === CHUNK_BIN) binBytes = length;
    offset += 8 + length;
  }
  if (json === undefined) throw new Error('GLB 里没有 JSON chunk');
  return { json, binBytes };
}

/**
 * 导出并解开 GLB。
 *
 * ⚠️ 统计值必须在 `dispose()` **之前**快照下来 —— `dispose()` 会清空材质缓存，
 * 之后再读 `materials.size` 得到的是 0（第一版就这么写错了）。
 */
async function exportSpec(spec: RoomSpec, options: Parameters<typeof exportGLB>[1] = {}) {
  const { doc, roomId } = roomOf(spec);
  const built = buildRoomFromDocument(doc, roomId, { showCeiling: true });
  try {
    const result = await exportGLB(built.root, options);
    return {
      ...result,
      ...parseGlb(result.glb),
      meshCount: built.stats.meshes,
      materialCount: built.materials.size,
    };
  } finally {
    built.dispose();
  }
}

describe('GLB 容器', () => {
  it('三种规格都导出为合法的 GLB 2.0', async () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { json, binBytes, glb } = await exportSpec(spec);
      expect(json.asset.version, `spec=${spec}`).toBe('2.0');
      expect(binBytes, `spec=${spec} 应该有二进制缓冲`).toBeGreaterThan(0);
      expect(glb.byteLength).toBeGreaterThan(binBytes);
    }
  });

  /**
   * 追溯信息落在**根节点**的 extras，不是 asset.extras ——
   * GLTFExporter 没有写 asset 级 extras 的选项，唯一通道是 userData。
   */
  it('provenance 写进根节点 extras —— 下游要能追溯这份 GLB 是哪个房间导出的', async () => {
    const { json } = await exportSpec('M', {
      extras: { roomId: 'catwalk_gallery', spec: 'M', outerPlanMeters: specOuterPlan('M') },
    });
    const withExtras = (json.nodes ?? []).find((n) => n.extras?.roomId === 'catwalk_gallery');
    expect(withExtras, `没有节点带上 roomId extras`).toBeDefined();
    expect(withExtras?.extras?.spec).toBe('M');
    expect(withExtras?.extras?.outerPlanMeters).toEqual({ w: 60, d: 30 });
  });
});

describe('内容可辨识', () => {
  it('节点名保留了语义（导进 UE / Blender 后能认出是什么）', async () => {
    const { json } = await exportSpec('S');
    const names = (json.nodes ?? []).map((n) => n.name ?? '');
    // GLTFExporter 会把 `:` 之类的字符做清洗，所以只断言前缀可辨识
    expect(
      names.some((n) => n.startsWith('wall')),
      `节点名：${names.join(', ')}`,
    ).toBe(true);
    expect(names.some((n) => n.startsWith('floor'))).toBe(true);
    expect(names.some((n) => n.startsWith('ceiling'))).toBe(true);
    expect(names.some((n) => n.startsWith('portal'))).toBe(true);
    expect(names.some((n) => n.startsWith('pillar'))).toBe(true);
  });

  it('材质数量与房间实际用到的材质数一致，且带 PBR 参数', async () => {
    const { json, materialCount } = await exportSpec('L');
    expect(json.materials?.length).toBe(materialCount);
    for (const material of json.materials ?? []) {
      expect(material.pbrMetallicRoughness, material.name).toBeDefined();
    }
  });

  it('mesh 数量与场景一致', async () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { json, meshCount } = await exportSpec(spec);
      expect(json.meshes?.length, `spec=${spec}`).toBe(meshCount);
    }
  });
});

describe('灯光', () => {
  it('point / spot 走 KHR_lights_punctual', async () => {
    const { json } = await exportSpec('S');
    expect(json.extensionsUsed).toContain('KHR_lights_punctual');
    const lights = json.extensions?.KHR_lights_punctual?.lights ?? [];
    // S 示例是 4 盏点光
    expect(lights).toHaveLength(4);
    for (const light of lights) expect(light.type).toBe('point');
  });

  it('面光源被跳过并**明确报出** —— glTF 规范不支持，但不能静默丢失', async () => {
    const { skippedAreaLights, json } = await exportSpec('L');
    // L 示例有一盏 area 光（天窗）
    expect(skippedAreaLights).toEqual(['sky']);
    const lights = json.extensions?.KHR_lights_punctual?.lights ?? [];
    expect(lights).toHaveLength(5); // 6 盏里 1 盏是面光源
  });

  it('includeLights: false 时不写灯光扩展', async () => {
    const { json } = await exportSpec('S', { includeLights: false });
    expect(json.extensionsUsed ?? []).not.toContain('KHR_lights_punctual');
  });
});

describe('导出没有副作用', () => {
  /**
   * 导出过程会把面光源临时摘出场景图（GLTFExporter 不支持它们）。
   * 编辑器里同一棵树还在渲染，所以必须还原 —— 否则点一次"导出"房间就变暗了。
   */
  it('临时摘掉的灯在导出后被放回', async () => {
    const { doc, roomId } = roomOf('L');
    const built = buildRoomFromDocument(doc, roomId);
    const before = built.root.children.length;
    const areaLightsBefore = built.root.children.filter(
      (c) => (c as { isRectAreaLight?: boolean }).isRectAreaLight === true,
    ).length;
    expect(areaLightsBefore).toBe(1);

    await exportGLB(built.root);

    expect(built.root.children.length, '子节点数必须还原').toBe(before);
    expect(
      built.root.children.filter(
        (c) => (c as { isRectAreaLight?: boolean }).isRectAreaLight === true,
      ).length,
      '面光源必须放回去',
    ).toBe(1);
    built.dispose();
  });

  it('includeLights: false 也要还原（下次渲染还得用）', async () => {
    const { doc, roomId } = roomOf('S');
    const built = buildRoomFromDocument(doc, roomId);
    const before = built.root.children.length;
    await exportGLB(built.root, { includeLights: false });
    expect(built.root.children.length).toBe(before);
    built.dispose();
  });
});

/**
 * ⭐ 最强的有效性证明：用 three **自己的** GLTFLoader 把导出的 GLB 读回来。
 *
 * 上面那些断言是我们自己的解析器在校验自己的写入器 —— 是循环论证。
 * 只有独立的加载器读回来、尺寸与 mesh 数都对得上，才说明这份 GLB 真的合法。
 */
describe('往返（独立加载器验证）', () => {
  it('导出再读回，包围盒与 mesh 数不变', async () => {
    const { doc, roomId } = roomOf('L');
    const built = buildRoomFromDocument(doc, roomId, { showCeiling: true });
    const before = new Box3().setFromObject(built.root).getSize(new Vector3());
    const meshesBefore = built.stats.meshes;
    const { glb } = await exportGLB(built.root);
    built.dispose();

    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(
      glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer,
      '',
    );

    const after = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
    // Float32 顶点精度，见 shell.test.ts 的说明
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(after.z).toBeCloseTo(before.z, 4);

    // 而且尺寸必须正好是 L 的占格外廓（60×60）+ 上下各一个墙厚
    const outer = specOuterPlan('L');
    expect(after.x).toBeCloseTo(outer.w, 4);
    expect(after.z).toBeCloseTo(outer.d, 4);

    let meshesAfter = 0;
    gltf.scene.traverse((object) => {
      if ((object as { isMesh?: boolean }).isMesh === true) meshesAfter++;
    });
    expect(meshesAfter).toBe(meshesBefore);
  });
});

describe('确定性', () => {
  /**
   * 同输入 → 逐字节同输出。这样 GLB 可以进 CI 做回归比对，
   * 也不会在无改动时产生虚假的文件变更。
   */
  it('同一个房间导出两次逐字节相同', async () => {
    const a = await exportSpec('M');
    const b = await exportSpec('M');
    expect(a.glb.byteLength).toBe(b.glb.byteLength);
    expect(Buffer.compare(Buffer.from(a.glb), Buffer.from(b.glb))).toBe(0);
  });
});
