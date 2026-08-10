import type { z } from 'zod';
import type { RoomGraphDocument } from '@tjre/schema';

/**
 * ============================================================
 *  命令层契约 —— 项目的"宪法"（docs/CONVENTIONS.md §4.2）
 * ============================================================
 *
 *  文档只能通过命令修改。UI、外部 AI agent、CLI、测试全部走这一条路径。
 *  由此免费获得：undo/redo、操作回放、确定性、审计日志，
 *  以及"人和 AI 能力完全对等"。
 *
 *  Phase 0 只落地契约与注册表；具体命令集在 Phase 2 实现。
 *  每个命令必须同时提供 params / apply / invert / describe 五件套，
 *  缺一项 CI 不予合并。
 */

/** 命令实例：可序列化，可存进 JSON 让 AI agent 批量提交 */
export interface CommandInstance<TParams = unknown> {
  type: string;
  params: TParams;
}

export interface CommandDefinition<TParams> {
  /** 命令类型标识，用 `domain.action` 形式，例如 `room.setSize` */
  type: string;

  /** 参数 schema —— 同时用于运行时校验与生成给 AI 的 JSON Schema */
  params: z.ZodType<TParams>;

  /** 一句话说明这个命令做什么，会进 docs/generated/COMMANDS.md 和 AI 的 system prompt */
  summary: string;

  /**
   * 应用命令，返回新文档。**必须是纯函数**：不得修改入参，不得有副作用。
   * 若命令在当前文档状态下不合法，抛出 `CommandError`。
   */
  apply(doc: RoomGraphDocument, params: TParams): RoomGraphDocument;

  /**
   * 基于**应用前**的文档状态，生成能够撤销本次操作的逆命令。
   * 正确性由属性测试保证：随机命令序列 → 全部 undo → 文档必须回到初态。
   */
  invert(doc: RoomGraphDocument, params: TParams): CommandInstance;

  /** 人类可读描述，用于历史面板与给 AI 的执行反馈 */
  describe(params: TParams): string;
}

export class CommandError extends Error {
  constructor(
    message: string,
    /** 修复建议 —— 会回传给 AI agent 用于自我修正 */
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/** 命令注册表 */
export class CommandRegistry {
  // 值的参数类型在注册时被擦除；类型安全由 register 的签名与 params.parse 共同保证
  private readonly definitions = new Map<string, CommandDefinition<never>>();

  register<TParams>(definition: CommandDefinition<TParams>): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`命令类型 "${definition.type}" 已注册`);
    }
    this.definitions.set(definition.type, definition as unknown as CommandDefinition<never>);
  }

  get(type: string): CommandDefinition<never> | undefined {
    return this.definitions.get(type);
  }

  list(): CommandDefinition<never>[] {
    return [...this.definitions.values()].sort((a, b) => (a.type < b.type ? -1 : 1));
  }

  /**
   * 校验并应用一条命令，同时返回逆命令。
   * 这是所有写入路径的**唯一入口**。
   */
  execute(
    doc: RoomGraphDocument,
    command: CommandInstance,
  ): { doc: RoomGraphDocument; inverse: CommandInstance; description: string } {
    const definition = this.get(command.type);
    if (definition === undefined) {
      throw new CommandError(
        `未知命令类型 "${command.type}"。`,
        `可用命令：${
          this.list()
            .map((d) => d.type)
            .join(', ') || '（尚未注册任何命令）'
        }`,
      );
    }

    const parsed = definition.params.safeParse(command.params);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new CommandError(`命令 "${command.type}" 的参数不合法：${detail}`);
    }

    const params = parsed.data as never;
    const inverse = definition.invert(doc, params);
    const nextDoc = definition.apply(doc, params);
    return { doc: nextDoc, inverse, description: definition.describe(params) };
  }
}

/** 全局注册表；命令模块在自身文件里调用 `commands.register(...)` 完成注册 */
export const commands = new CommandRegistry();
