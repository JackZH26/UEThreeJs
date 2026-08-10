import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadDocumentFile } from '@tjre/core/node';
import { roomOuterPlan, roomSize } from '@tjre/schema';
import { ExitCode } from '../exit.js';

/**
 * `export` —— 把房间导成 GLB（二进制 glTF）。
 *
 * ── 为什么 glTF ────────────────────────────────────────────
 * glTF 与 three.js 同为 **Y-up 右手系、单位米**，所以我们**不做任何坐标换算**；
 * 手性翻转与 ×100 转厘米由 UE 的导入器负责。手搓 FBX 就得自己承担这两件事，
 * 而"轴搞反了但看起来只是有点怪"是最难查的一类问题。
 *
 * ⚠️ **这是核对几何与比例的通道，不是最终 UE 资产。**
 * 已知限制（UV 不可平铺、墙角重叠、楼梯无斜坡碰撞代理、面光源丢失、
 * markers 不导出）详见 `packages/scene/src/gltf.ts` 末尾。
 */

export interface ExportOptions {
  file: string;
  /** 房间 id；文档里只有一个房间时可省略 */
  room?: string;
  /** 输出路径；默认 `<关卡文件名>.<房间 id>.glb` */
  out?: string;
  /**
   * 是否生成天花。**导出时默认开**（编辑器里默认关是为了能看进房间内部，
   * 但导给 UE 需要完整外壳）。
   */
  ceiling: boolean;
  includeLights: boolean;
  json: boolean;
}

export async function runExport(options: ExportOptions): Promise<ExitCode> {
  const loaded = loadDocumentFile(options.file);
  if (!loaded.ok) {
    process.stderr.write(
      `✗ 无法加载 ${options.file}：${loaded.errors[0]?.message ?? '未知错误'}\n`,
    );
    process.stderr.write('  先跑 `tjre validate` 看完整诊断。\n');
    return ExitCode.VALIDATION_FAILED;
  }
  const doc = loaded.doc;

  if (doc.rooms.length === 0) {
    process.stderr.write(`✗ ${options.file} 里没有房间。\n`);
    return ExitCode.VALIDATION_FAILED;
  }

  // 房间选择：只有一个就用它；多个则要求显式指定 —— 默认导第一个太容易
  // 让人以为"导出了整个文件"，而文档可能是个 36 房间的房间库。
  let roomId = options.room;
  if (roomId === undefined) {
    if (doc.rooms.length > 1) {
      process.stderr.write(
        `✗ ${options.file} 里有 ${doc.rooms.length} 个房间，请用 --room 指定要导出哪一个。\n` +
          `  可选：${doc.rooms.map((r) => r.id).join(', ')}\n`,
      );
      return ExitCode.USAGE;
    }
    roomId = doc.rooms[0]?.id;
  }
  const room = doc.rooms.find((r) => r.id === roomId);
  if (room === undefined) {
    process.stderr.write(
      `✗ 房间 "${roomId ?? ''}" 不在 ${options.file} 里。\n` +
        `  可选：${doc.rooms.map((r) => r.id).join(', ')}\n`,
    );
    return ExitCode.USAGE;
  }

  // 懒加载：`@tjre/scene` 会拉进 three.js，而 validate / describe 不该为此付代价
  const { buildRoom, exportGLB } = await import('@tjre/scene');

  const built = buildRoom(
    room,
    doc.themes.find((t) => t.id === room.theme),
    { showCeiling: options.ceiling, showStructures: true, showLights: options.includeLights },
  );

  try {
    const size = roomSize(room);
    const outer = roomOuterPlan(room);
    const { glb, skippedAreaLights } = await exportGLB(built.root, {
      includeLights: options.includeLights,
      extras: {
        generator: 'ThreeJsRoomEditor',
        schemaVersion: doc.schemaVersion,
        sourceFile: basename(options.file),
        roomId: room.id,
        spec: room.spec,
        outerPlanMeters: outer,
        interiorMeters: size,
        note: 'Y-up right-handed, metres. UE glTF importer handles the Z-up/left-handed conversion.',
      },
    });

    const outPath = resolve(
      options.out ?? `${basename(options.file).replace(/\.roomgraph\.ya?ml$/i, '')}.${room.id}.glb`,
    );
    writeFileSync(outPath, glb);

    const report = {
      ok: true,
      file: outPath,
      roomId: room.id,
      spec: room.spec,
      bytes: glb.byteLength,
      meshes: built.stats.meshes,
      lights: built.stats.lights,
      skippedAreaLights,
      outerPlanMeters: outer,
      interiorMeters: size,
    };

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      console.log(`\n✓ 已导出 ${outPath}`);
      console.log(
        `  房间 ${room.id} [${room.spec}] · 外廓 ${outer.w}×${outer.d}m · 层高 ${size.h}m`,
      );
      console.log(
        `  ${built.stats.meshes} 个 mesh · ${built.stats.lights} 盏灯 · ${(glb.byteLength / 1024).toFixed(0)} KB`,
      );
      if (skippedAreaLights.length > 0) {
        console.log(
          `\n  ⚠ 跳过 ${skippedAreaLights.length} 个面光源（glTF 的 KHR_lights_punctual 不支持）：` +
            `${skippedAreaLights.join(', ')}\n    导入 UE 后需要手工补 RectLight。`,
        );
      }
      console.log(
        `\n  glTF 是 Y-up 右手系、单位米；UE 导入器会自己转成 Z-up 左手系并 ×100 到厘米。`,
      );
      console.log(
        `  ⚠ 这是核对几何/比例的通道，不是最终资产（UV 不可平铺、楼梯无斜坡碰撞代理）。\n`,
      );
    }
    return ExitCode.OK;
  } finally {
    built.dispose();
  }
}
