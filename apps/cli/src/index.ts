#!/usr/bin/env -S node --import tsx
import { parseArgs } from 'node:util';
import { SCHEMA_VERSION, toJsonSchemaFragments } from '@tjre/schema';
import { ExitCode } from './exit.js';
import { runValidate } from './commands/validate.js';
import { runDescribe } from './commands/describe.js';
import { runSolve } from './commands/solve.js';

const USAGE = `
tjre —— ThreeJsRoomEditor CLI (schema ${SCHEMA_VERSION})

用法
  tjre validate <file.roomgraph.yaml> [--json] [--strict]
      校验关卡文档。退出码 0=通过, 1=有 error, 2=用法错误。
      --json    输出机器可读的诊断 JSON（AI agent 应使用此模式）
      --strict  把 warning 也视为失败（CI 建议开启）

  tjre describe <file.roomgraph.yaml> [--json]
      输出关卡的压缩摘要（房间规模 + 拓扑），用于先建立全局认知。

  tjre solve <file.roomgraph.yaml> [--json] [--map]
      从连接图求解房间世界坐标与旋转。文档里从不书写坐标，全部由此推导。
      --map     额外输出 ASCII 俯视图（上=北），用于不开 3D 也能核对布局

  tjre schema [--fragment <name>]
      输出 JSON Schema。fragment 可选 document|room|opening|structure|connection。

  tjre --help | --version

给 AI agent 的完整说明见 docs/AI_GUIDE.md
`.trimStart();

function main(argv: string[]): ExitCode {
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

    case 'solve': {
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          json: { type: 'boolean', default: false },
          map: { type: 'boolean', default: false },
        },
        allowPositionals: true,
      });
      const file = positionals[0];
      if (file === undefined) {
        process.stderr.write('✗ 缺少参数：需要指定关卡文件路径。\n');
        return ExitCode.USAGE;
      }
      return runSolve({ file, json: values.json, map: values.map });
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

try {
  process.exitCode = main(process.argv.slice(2));
} catch (cause) {
  process.stderr.write(
    `✗ 内部错误：${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
  );
  process.exitCode = ExitCode.INTERNAL;
}
