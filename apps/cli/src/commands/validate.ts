import { formatDiagnostics, validateDocument } from '@tjre/core';
import { loadDocumentFile } from '@tjre/core/node';
import type { Diagnostic } from '@tjre/core';
import { ExitCode } from '../exit.js';

export interface ValidateOptions {
  file: string;
  json: boolean;
  /** 把 warning 也视为失败 —— CI 上建议开启 */
  strict: boolean;
}

/**
 * 校验分两层，逐层放行：
 *   1. `schema`   Zod 解析：结构、类型、strict 拒未知字段
 *   2. `semantic` 跨字段/跨对象一致性（ALL_RULES，无几何）
 *
 * 上一层有 error 时不进入下一层 —— 否则下层规则无法假设数据成立，
 * 会产出一堆由根因派生的噪声诊断。
 *
 * v0.1 曾有第三层 `layout`（布局求解产生的几何冲突，R07x）。求解器已随
 * "一个房间 = 一个独立关卡" 的模型修正删除：房间永远在原点，没有可冲突的位置。
 */
type Stage = 'schema' | 'semantic' | 'complete';

interface JsonReport {
  ok: boolean;
  file: string;
  /** 实际推进到的阶段；未到 `complete` 说明被前面的 error 挡住了 */
  stage: Stage;
  errorCount: number;
  warningCount: number;
  diagnostics: Diagnostic[];
}

export function runValidate(options: ValidateOptions): ExitCode {
  const loaded = loadDocumentFile(options.file);

  if (!loaded.ok) {
    return finish(options, {
      ok: false,
      file: options.file,
      stage: 'schema',
      errorCount: loaded.errors.length,
      warningCount: 0,
      diagnostics: loaded.errors,
    });
  }

  const semantic = validateDocument(loaded.doc);
  const failed = !semantic.ok || (options.strict && semantic.warnings.length > 0);

  return finish(options, {
    ok: !failed,
    file: options.file,
    stage: semantic.ok ? 'complete' : 'semantic',
    errorCount: semantic.errors.length,
    warningCount: semantic.warnings.length,
    diagnostics: semantic.all,
  });
}

function finish(options: ValidateOptions, report: JsonReport): ExitCode {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const errors = report.diagnostics.filter((d) => d.severity === 'error');
    const warnings = report.diagnostics.filter((d) => d.severity === 'warning');

    console.log(`\n关卡：${report.file}`);

    if (errors.length > 0) {
      console.log(`\n错误（${errors.length}）`);
      console.log(formatDiagnostics(errors));
    }
    if (warnings.length > 0) {
      console.log(`\n警告（${warnings.length}）`);
      console.log(formatDiagnostics(warnings));
    }

    if (report.stage !== 'complete' && !report.ok) {
      console.log(`\n  （校验止于 ${report.stage} 阶段，修完上述 error 后会继续检查后续阶段）`);
    }

    console.log(
      report.ok
        ? `\n✓ 校验通过（${errors.length} 错误 / ${warnings.length} 警告）\n`
        : `\n✗ 校验未通过（${errors.length} 错误 / ${warnings.length} 警告）\n`,
    );
  }

  return report.ok ? ExitCode.OK : ExitCode.VALIDATION_FAILED;
}
