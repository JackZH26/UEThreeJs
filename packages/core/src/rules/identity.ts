import type { Rule } from '../diagnostics.js';

/** 在一组条目里找出重复的 id，回调报告 */
function findDuplicates<T extends { id: string }>(
  items: readonly T[],
  onDuplicate: (id: string, index: number) => void,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) onDuplicate(item.id, index);
    else seen.add(item.id);
  });
}

export const R001_duplicateRoomId: Rule = {
  id: 'R001',
  title: '房间 id 重复',
  check(doc, report) {
    findDuplicates(doc.rooms, (id, index) => {
      report({
        severity: 'error',
        path: `rooms[${index}].id`,
        message: `房间 id "${id}" 重复。`,
        hint: '每个房间 id 在整个文档内必须唯一，请改为一个未被使用的 id。',
      });
    });
  },
};

export const R002_duplicateThemeId: Rule = {
  id: 'R002',
  title: '主题 id 重复',
  check(doc, report) {
    findDuplicates(doc.themes, (id, index) => {
      report({
        severity: 'error',
        path: `themes[${index}].id`,
        message: `主题 id "${id}" 重复。`,
        hint: '合并这两个主题，或给其中一个改名。',
      });
    });
  },
};

export const R003_duplicateConnectionId: Rule = {
  id: 'R003',
  title: '连接 id 重复',
  check(doc, report) {
    findDuplicates(doc.connections, (id, index) => {
      report({
        severity: 'error',
        path: `connections[${index}].id`,
        message: `连接 id "${id}" 重复。`,
        hint: '给其中一个连接换一个唯一 id。',
      });
    });
  },
};

export const R004_duplicateInRoomId: Rule = {
  id: 'R004',
  title: '房间内条目 id 重复',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      const collections = [
        { key: 'openings', items: room.openings },
        { key: 'structures', items: room.structures },
        { key: 'props', items: room.props },
        { key: 'lights', items: room.lights },
        { key: 'markers', items: room.markers },
      ] as const;

      // 房间内所有条目共享同一命名空间 —— 便于命令层与 AI 用单一 id 定位
      const seen = new Map<string, string>();
      for (const { key, items } of collections) {
        items.forEach((item, ii) => {
          const previous = seen.get(item.id);
          if (previous !== undefined) {
            report({
              severity: 'error',
              path: `rooms[${ri}].${key}[${ii}].id`,
              message: `房间 "${room.id}" 内 id "${item.id}" 重复（已被 ${previous} 使用）。`,
              hint: '同一房间内 openings / structures / props / lights / markers 共享命名空间，请改用唯一 id。',
            });
          } else {
            seen.set(item.id, key);
          }
        });
      }
    });
  },
};

export const identityRules: readonly Rule[] = [
  R001_duplicateRoomId,
  R002_duplicateThemeId,
  R003_duplicateConnectionId,
  R004_duplicateInRoomId,
];
