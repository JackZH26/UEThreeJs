import { RoomGraphDocument, SCHEMA_VERSION } from '@tjre/schema';
import type { RoomGraphDocumentInput } from '@tjre/schema';

/**
 * schema 里带 `.default()` 的数组字段在**输入**类型上是可选的，
 * 直接拿 RoomGraphDocumentInput 写测试会到处需要 `!`。
 *
 * 这里定义一个「稠密」输入类型：fixture 保证这些数组一定存在（哪怕是空数组），
 * 于是测试里可以直接 `d.rooms[0].openings.push(...)`。
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

export type FixtureInput = Omit<RoomGraphDocumentInput, 'rooms'> & {
  rooms: DenseRoomInput[];
};

export function denseRoom(room: RoomInput): DenseRoomInput {
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
 * 构造一份最小合法文档：一个 S 房间。
 *
 * 注意这里**没有** size / doorCount / openings —— 尺寸与传送门都由 `spec`
 * 派生。测试通过 `mutate` 回调破坏它，验证对应规则能抓到。
 */
export function minimalDocInput(): FixtureInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'Fixture' },
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
        spec: 'S',
        theme: 'plain',
        markers: [{ id: 'spawn_p', kind: 'spawn', at: { x: 0, y: 0, z: 0 } }],
      }),
    ],
  };
}

/** 解析出一份合法文档；`mutate` 在解析**前**修改输入 */
export function makeDoc(mutate?: (input: FixtureInput) => void): RoomGraphDocument {
  const input = minimalDocInput();
  mutate?.(input);
  return RoomGraphDocument.parse(input);
}
