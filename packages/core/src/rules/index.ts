import type { Rule } from '../diagnostics.js';
import { identityRules } from './identity.js';
import { referenceRules } from './references.js';
import { openingRules } from './openings.js';
import { connectionRules } from './connections.js';
import { structureRules } from './structures.js';
import { gridRules } from './grid.js';
import { gameplayRules } from './gameplay.js';

/**
 * 全部语义校验规则。
 *
 * 编号分段（新增规则请在对应段内取下一个空号，不要复用已废弃的编号）：
 *   R0xx  身份 / 唯一性        identity.ts
 *   R01x  引用完整性          references.ts
 *   R02x  开口                openings.ts
 *   R03x  连接 / 拓扑          connections.ts
 *   R04x  内部结构件           structures.ts
 *   R05x  网格对齐            grid.ts
 *   R06x  gameplay            gameplay.ts
 *   R07x  布局求解（Phase 1 预留：房间重叠等）
 */
export const ALL_RULES: readonly Rule[] = [
  ...identityRules,
  ...referenceRules,
  ...openingRules,
  ...connectionRules,
  ...structureRules,
  ...gridRules,
  ...gameplayRules,
];

export {
  identityRules,
  referenceRules,
  openingRules,
  connectionRules,
  structureRules,
  gridRules,
  gameplayRules,
};
