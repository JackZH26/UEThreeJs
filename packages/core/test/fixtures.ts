import { RoomGraphDocument, SCHEMA_VERSION } from '@tjre/schema';
import type { RoomGraphDocumentInput } from '@tjre/schema';

/**
 * schema 里带 `.default()` 的数组字段在**输入**类型上是可选的，
 * 直接拿 RoomGraphDocumentInput 写测试会到处需要 `!`。
 *
 * 这里定义一个「稠密」输入类型：fixture 保证这些数组一定存在（哪怕是空数组），
 * 于是测试里可以直接 `d.rooms[0]!.openings.push(...)`。
 */
type RoomInput = NonNullable<RoomGraphDocumentInput['rooms']>[number];

type DenseRoomInput = Omit<
  RoomInput,
  'openings' | 'structures' | 'props' | 'lights' | 'markers'
> & {
  openings: NonNullable<RoomInput['openings']>;
  structures: NonNullable<RoomInput['structures']>;
  props: NonNullable<RoomInput['props']>;
  lights: NonNullable<RoomInput['lights']>;
  markers: NonNullable<RoomInput['markers']>;
};

export type FixtureInput = Omit<RoomGraphDocumentInput, 'rooms' | 'connections'> & {
  rooms: DenseRoomInput[];
  connections: NonNullable<RoomGraphDocumentInput['connections']>;
};

function denseRoom(room: RoomInput): DenseRoomInput {
  return {
    ...room,
    openings: room.openings ?? [],
    structures: room.structures ?? [],
    props: room.props ?? [],
    lights: room.lights ?? [],
    markers: room.markers ?? [],
  };
}

/**
 * 构造一份「两房一门」的最小合法文档。
 * 测试通过 `mutate` 回调破坏它，验证对应规则能抓到。
 */
export function minimalDocInput(): FixtureInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'Fixture', entryRoom: 'a' },
    themes: [
      {
        id: 'plain',
        surfaces: { floor: 'f', ceiling: 'c', wall: 'w' },
        lightPreset: 'basic',
      },
    ],
    rooms: [
      denseRoom({
        id: 'a',
        size: { w: 8, d: 8, h: 4 },
        theme: 'plain',
        doorCount: 1,
        openings: [
          { id: 'door_n', wall: 'north', type: 'door', offset: 0, size: { w: 1.5, h: 2.5 } },
        ],
        markers: [{ id: 'spawn_p', kind: 'spawn', at: { x: 0, y: 0, z: 0 } }],
      }),
      denseRoom({
        id: 'b',
        size: { w: 8, d: 8, h: 4 },
        theme: 'plain',
        doorCount: 1,
        openings: [
          { id: 'door_s', wall: 'south', type: 'door', offset: 0, size: { w: 1.5, h: 2.5 } },
        ],
      }),
    ],
    connections: [{ id: 'a_to_b', from: 'a.door_n', to: 'b.door_s' }],
  };
}

/** 解析出一份合法文档；`mutate` 在解析**前**修改输入 */
export function makeDoc(mutate?: (input: FixtureInput) => void): RoomGraphDocument {
  const input = minimalDocInput();
  mutate?.(input);
  return RoomGraphDocument.parse(input);
}
