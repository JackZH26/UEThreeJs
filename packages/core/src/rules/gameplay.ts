import type { Rule } from '../diagnostics.js';

/**
 * ── 已停用：R060（关卡没有出生点）/ R061（上锁连接没有钥匙）──────
 *
 * 两条都建立在 v0.1 的"一个关卡 = 多房间串联，有唯一入口"模型上：
 *   · R060 要求整个关卡至少有一个 spawn marker。现在每个房间就是一个关卡，
 *     而玩家出生点由游戏的对局逻辑（20 人空投 / 复活点）决定，不是房间属性 ——
 *     对 36 个房间逐个告警"没有出生点"是纯噪声。
 *   · R061 依赖已被移除的 `connections.locked` / `keyId`。
 *
 * 编号不复用，见 docs/CONVENTIONS.md §4.7。
 */

export const R062_roomWithoutLight: Rule = {
  id: 'R062',
  title: '房间既无光源也无主题默认布光',
  check(doc, report) {
    const themesWithLight = new Set(
      doc.themes.filter((t) => t.lightPreset !== undefined).map((t) => t.id),
    );
    doc.rooms.forEach((room, ri) => {
      if (room.lights.length === 0 && !themesWithLight.has(room.theme)) {
        report({
          severity: 'warning',
          path: `rooms[${ri}].lights`,
          message: `房间 "${room.id}" 没有光源，且其主题 "${room.theme}" 未设置 lightPreset，房间会是全黑的。`,
          hint: '给房间加光源，或给主题设置 lightPreset。',
        });
      }
    });
  },
};

export const gameplayRules: readonly Rule[] = [R062_roomWithoutLight];
