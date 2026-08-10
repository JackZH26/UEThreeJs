import type { Rule } from '../diagnostics.js';
import { identityRules } from './identity.js';
import { referenceRules } from './references.js';
import { openingRules } from './openings.js';
import { structureRules } from './structures.js';
import { gridRules } from './grid.js';
import { gameplayRules } from './gameplay.js';

/**
 * 全部语义校验规则。
 *
 * 编号分段（新增规则请在对应段内取下一个空号，**不要复用已废弃的编号** ——
 * 复用会让旧的 diff、issue 和 AI 会话记录指向一条含义完全不同的规则）：
 *   R0xx  身份 / 唯一性        identity.ts
 *   R01x  引用完整性          references.ts
 *   R02x  开口                openings.ts
 *   R03x  连接 / 拓扑          （v0.2 整段停用：文档级 connections 已移除）
 *   R04x  内部结构件           structures.ts
 *   R05x  网格对齐            grid.ts
 *   R06x  gameplay            gameplay.ts
 *   R07x  布局求解            （v0.2 整段停用：求解器已删除）
 *
 * v0.2 停用清单：R003 / R011 / R012 / R024 / R025 / R030–R033 / R060 / R061 /
 * R070–R073。原因都是同一个模型修正 —— 房间不再串联成图，而是各自独立、
 * 运行时由传送门拼装。
 */
export const ALL_RULES: readonly Rule[] = [
  ...identityRules,
  ...referenceRules,
  ...openingRules,
  ...structureRules,
  ...gridRules,
  ...gameplayRules,
];

export { identityRules, referenceRules, openingRules, structureRules, gridRules, gameplayRules };
