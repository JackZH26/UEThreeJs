import { formatDiagnostics, loadDocumentFile, validateDocument } from '@tjre/core';
import type { Diagnostic } from '@tjre/core';
import { ExitCode } from '../exit.js';

export interface ValidateOptions {
  file: string;
  json: boolean;
  /** 把 warning 也视为失败 —— CI 上建议开启 */
  strict: boolean;
}

interface JsonReport {
  ok: boolean;
  file: string;
  errorCount: number;
  warningCount: number;
  diagnostics: Diagnostic[];
}

export function runValidate(options: ValidateOptions): ExitCode {
  const loaded = loadDocumentFile(options.file);

  if (!loaded.ok) {
    // schema / 解析阶段失败：语义规则无法运行，直接报告
    emit(options, {
      ok: false,
      file: options.file,
      errorCount: loaded.errors.length,
      warningCount: 0,
      diagnostics: loaded.errors,
    });
    return ExitCode.VALIDATION_FAILED;
  }

  const result = validateDocument(loaded.doc);
  const failed = !result.ok || (options.strict && result.warnings.length > 0);

  emit(options, {
    ok: !failed,
    file: options.file,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    diagnostics: result.all,
  });

  return failed ? ExitCode.VALIDATION_FAILED : ExitCode.OK;
}

function emit(options: ValidateOptions, report: JsonReport): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

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

  console.log(
    report.ok
      ? `\n✓ 校验通过（${errors.length} 错误 / ${warnings.length} 警告）\n`
      : `\n✗ 校验未通过（${errors.length} 错误 / ${warnings.length} 警告）\n`,
  );
}
