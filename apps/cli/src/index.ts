#!/usr/bin/env -S node --import tsx
import { parseArgs } from 'node:util';
import { SCHEMA_VERSION, toJsonSchemaFragments } from '@tjre/schema';
import { ExitCode } from './exit.js';
import { loadExportCommand } from './lazyCommands.js';
import { runValidate } from './commands/validate.js';
import { runDescribe } from './commands/describe.js';

const USAGE = `
tjre —— ThreeJsRoomEditor CLI (schema ${SCHEMA_VERSION})

用法
  tjre validate <file.roomgraph.yaml> [--json] [--strict]
      校验关卡文档。退出码 0=通过, 1=有 error, 2=用法错误。
      --json    输出机器可读的诊断 JSON（AI agent 应使用此模式）
      --strict  把 warning 也视为失败（CI 建议开启）

  tjre describe <file.roomgraph.yaml> [--json]
      输出关卡的压缩摘要，用于先建立全局认知。
      会打出由 spec 派生的尺寸与传送门数（这些不写在文件里）。

  tjre export <file.roomgraph.yaml> [--room <id>] [--out <path>] [--json]
              [--no-ceiling] [--no-lights]
      把房间导成 GLB（二进制 glTF），可拖进 UE / Blender / 任意 glTF 查看器。
      glTF 与 three.js 同为 Y-up 右手系、单位米 —— 不做坐标换算，
      手性翻转与 ×100 转厘米由 UE 导入器负责。
      导出默认**开天花**（编辑器里默认关是为了看进内部）。
      ⚠ 这是核对几何/比例的通道，不是最终 UE 资产（UV 不可平铺、
        楼梯无斜坡碰撞代理），详见 packages/scene/src/gltf.ts。

  tjre schema [--fragment <name>]
      输出 JSON Schema。fragment 可选 document|room|opening|structure。

  tjre --help | --version

给 AI agent 的完整说明见 docs/AI_GUIDE.md
`.trimStart();

// async 只是因为 `export` 要懒加载 `@tjre/scene`（它会拉进 three.js，
// 而 validate / describe 不该为此付启动代价）
async function main(argv: string[]): Promise<ExitCode> {
  const [subcommand, ...rest] = argv;

  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(USAGE);
    return subcommand === undefined ? ExitCode.USAGE : ExitCode.OK;
  }

  if (subcommand === '--version' || subcommand === '-v') {
    process.stdout.write(`${SCHEMA_VERSION}\n`);
    return ExitCode.OK;
  }

  switch (subcommand) {
    case 'validate': {
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          json: { type: 'boolean', default: false },
          strict: { type: 'boolean', default: false },
        },
        allowPositionals: true,
      });
      const file = positionals[0];
      if (file === undefined) {
        process.stderr.write('✗ 缺少参数：需要指定关卡文件路径。\n\n');
        process.stderr.write(USAGE);
        return ExitCode.USAGE;
      }
      return runValidate({ file, json: values.json, strict: values.strict });
    }

    case 'describe': {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { json: { type: 'boolean', default: false } },
        allowPositionals: true,
      });
      const file = positionals[0];
      if (file === undefined) {
        process.stderr.write('✗ 缺少参数：需要指定关卡文件路径。\n');
        return ExitCode.USAGE;
      }
      return runDescribe(file, values.json);
    }

    case 'export': {
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          room: { type: 'string' },
          out: { type: 'string' },
          json: { type: 'boolean', default: false },
          // parseArgs 用 --no-x 关掉一个默认为 true 的布尔项时，需要把
          // 默认值放在这里，命令行上的 --no-ceiling 会覆盖成 false
          ceiling: { type: 'boolean', default: true },
          lights: { type: 'boolean', default: true },
        },
        allowPositionals: true,
        allowNegative: true,
      });
      const file = positionals[0];
      if (file === undefined) {
        process.stderr.write('✗ 缺少参数：需要指定关卡文件路径。\n');
        return ExitCode.USAGE;
      }
      // 动态 import 必须放在 lazyCommands.ts 里 —— 本文件有 shebang，
      // 而 tsx 在两者同时存在时会解析失败，原因见那个模块的注释
      const runExport = await loadExportCommand();
      return runExport({
        file,
        ...(values.room === undefined ? {} : { room: values.room }),
        ...(values.out === undefined ? {} : { out: values.out }),
        ceiling: values.ceiling,
        includeLights: values.lights,
        json: values.json,
      });
    }

    case 'schema': {
      const { values } = parseArgs({
        args: rest,
        options: { fragment: { type: 'string' } },
        allowPositionals: false,
      });
      const fragments = toJsonSchemaFragments();
      const name = values.fragment ?? 'document';
      const schema = fragments[name];
      if (schema === undefined) {
        process.stderr.write(
          `✗ 未知 fragment "${name}"。可选：${Object.keys(fragments).join(', ')}\n`,
        );
        return ExitCode.USAGE;
      }
      process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
      return ExitCode.OK;
    }

    default:
      process.stderr.write(`✗ 未知子命令 "${subcommand}"。\n\n`);
      process.stderr.write(USAGE);
      return ExitCode.USAGE;
  }
}

// 用 promise 链而不是顶层 await：同时接住同步抛错与 rejection，
// 也不依赖顶层 await 的支持。
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (cause: unknown) => {
    process.stderr.write(
      `✗ 内部错误：${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
    );
    process.exitCode = ExitCode.INTERNAL;
  },
);
