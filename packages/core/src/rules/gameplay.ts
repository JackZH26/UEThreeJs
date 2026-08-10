import type { Rule } from '../diagnostics.js';

export const R060_noSpawnPoint: Rule = {
  id: 'R060',
  title: '关卡没有出生点',
  check(doc, report) {
    if (doc.rooms.length === 0) return;
    const hasSpawn = doc.rooms.some((room) => room.markers.some((m) => m.kind === 'spawn'));
    if (!hasSpawn) {
      report({
        severity: 'warning',
        path: 'rooms',
        message: '整个关卡没有任何 kind=spawn 的 marker，玩家无处出生。',
        hint: '在入口房间里加一个 markers 条目：{ id: spawn_player, kind: spawn, at: { x: 0, y: 0, z: 0 } }。',
      });
    }
  },
};

export const R061_lockedWithoutKey: Rule = {
  id: 'R061',
  title: '上锁的连接没有指定钥匙',
  check(doc, report) {
    doc.connections.forEach((conn, ci) => {
      if (conn.locked && conn.keyId === undefined) {
        report({
          severity: 'warning',
          path: `connections[${ci}].keyId`,
          message: `连接 "${conn.id}" 设为 locked 但未指定 keyId，玩家可能永远无法开启。`,
          hint: '设置 keyId，或在 note 里说明它由脚本解锁。',
        });
      }
    });
  },
};

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

export const gameplayRules: readonly Rule[] = [
  R060_noSpawnPoint,
  R061_lockedWithoutKey,
  R062_roomWithoutLight,
];
