import { Raycaster, Vector3 } from 'three/webgpu';
import type { Camera, Mesh, Object3D } from 'three/webgpu';

/**
 * ============================================================
 *  第一人称漫游控制器
 * ============================================================
 *
 *  目的是**验证尺度感与串联流程**（能走进房间、上到夹层），不是做游戏。
 *  因此不接物理引擎，用射线做地面跟随 + 少量水平碰撞：
 *
 *  · 地面：从头顶往下打一条射线，只打 `walkables`（地板 / 平台 / 廊桥 / 楼梯）
 *  · 台阶：落点比脚下高、但不超过 `STEP_UP` 时直接抬升 —— 楼梯就是靠这个走上去的，
 *          不需要为楼梯写专门逻辑
 *  · 墙：沿移动方向打短射线，命中则取消该方向的位移
 *
 *  已知简化：没有斜面滑动、没有蹲下、碰撞是"射线 + 半径"而非胶囊体。
 *  射线也没接 BVH（房间数少时够用），大关卡需要 three-mesh-bvh。
 */

/** 眼高（m） */
const EYE_HEIGHT = 1.7;
/** 可直接抬上去的最大高差 —— 楼梯踏步高 0.18，留足余量 */
const STEP_UP = 0.45;
/** 水平碰撞半径 */
const BODY_RADIUS = 0.3;
const WALK_SPEED = 4.2;
const RUN_SPEED = 8.5;
const GRAVITY = 22;
const JUMP_SPEED = 5.2;
/** 向下探测的起点相对脚底的抬升量，避免射线起点已经埋进地面 */
const PROBE_UP = 0.6;
/** 掉出关卡后重置的高度阈值 */
const FALL_LIMIT = -50;

export interface FirstPersonOptions {
  camera: Camera;
  /** 只对这些 mesh 做地面检测 —— 由 buildScene 提供 */
  walkables: Mesh[];
  /** 水平碰撞检测的目标（墙、结构件等整棵子树） */
  colliders: Object3D;
  /** 出生点（世界坐标，脚底位置） */
  spawn: Vector3;
}

export class FirstPersonController {
  private readonly camera: Camera;
  private readonly walkables: Mesh[];
  private readonly colliders: Object3D;
  private readonly spawn: Vector3;

  /** 脚底位置（不是相机位置；相机 = 脚底 + 眼高） */
  private readonly feet = new Vector3();
  private velocityY = 0;
  private grounded = false;

  private readonly keys = new Set<string>();
  private readonly down = new Raycaster();
  private readonly forwardRay = new Raycaster();

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly move = new Vector3();
  private readonly probeOrigin = new Vector3();
  private readonly DOWN = new Vector3(0, -1, 0);

  constructor(options: FirstPersonOptions) {
    this.camera = options.camera;
    this.walkables = options.walkables;
    this.colliders = options.colliders;
    this.spawn = options.spawn.clone();
    this.feet.copy(this.spawn);
    this.down.far = PROBE_UP + STEP_UP + 0.2;
    this.forwardRay.far = BODY_RADIUS + 0.2;
    this.syncCamera();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    // 空格会滚动页面
    if (event.code === 'Space') event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  connect(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  disconnect(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
  }

  /** 当前脚底高度，供 UI 显示 */
  get elevation(): number {
    return this.feet.y;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  private syncCamera(): void {
    this.camera.position.set(this.feet.x, this.feet.y + EYE_HEIGHT, this.feet.z);
  }

  /**
   * 从给定水平位置向下找可行走表面。
   * 返回命中高度；没打到返回 `null`（说明脚下是空的，该往下掉）。
   */
  private groundAt(x: number, z: number, fromY: number): number | null {
    this.probeOrigin.set(x, fromY + PROBE_UP, z);
    this.down.set(this.probeOrigin, this.DOWN);
    const hits = this.down.intersectObjects(this.walkables, false);
    const first = hits[0];
    return first === undefined ? null : first.point.y;
  }

  /** 沿 dir 方向是否被墙挡住 */
  private blocked(dir: Vector3): boolean {
    // 从腰部高度打，避免被地面或台阶误判为墙
    this.probeOrigin.set(this.feet.x, this.feet.y + 0.9, this.feet.z);
    this.forwardRay.set(this.probeOrigin, dir);
    return this.forwardRay.intersectObject(this.colliders, true).length > 0;
  }

  update(dt: number): void {
    // 相机朝向 → 水平前后左右
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-8) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.crossVectors(this.forward, new Vector3(0, 1, 0)).normalize();

    this.move.set(0, 0, 0);
    if (this.keys.has('KeyW')) this.move.add(this.forward);
    if (this.keys.has('KeyS')) this.move.sub(this.forward);
    if (this.keys.has('KeyD')) this.move.add(this.right);
    if (this.keys.has('KeyA')) this.move.sub(this.right);

    const speed =
      this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;

    if (this.move.lengthSq() > 1e-8) {
      this.move.normalize();
      // X / Z 分开判定，这样贴着墙走不会被完全卡住（可以沿墙滑动）
      for (const axis of ['x', 'z'] as const) {
        const component = this.move[axis];
        if (Math.abs(component) < 1e-6) continue;
        const dir = new Vector3();
        dir[axis] = Math.sign(component);
        if (this.blocked(dir)) continue;
        this.feet[axis] += component * speed * dt;
      }
    }

    // 垂直：地面跟随 + 台阶抬升 + 重力
    const ground = this.groundAt(this.feet.x, this.feet.z, this.feet.y);

    if (ground !== null && ground <= this.feet.y + STEP_UP) {
      const rising = ground > this.feet.y;
      if (rising || this.velocityY <= 0) {
        // 站上去（含直接踏上台阶）
        this.feet.y = ground;
        this.velocityY = 0;
        this.grounded = true;
      }
    } else {
      this.grounded = false;
    }

    if (this.grounded) {
      if (this.keys.has('Space')) {
        this.velocityY = JUMP_SPEED;
        this.grounded = false;
      }
    } else {
      this.velocityY -= GRAVITY * dt;
      this.feet.y += this.velocityY * dt;
    }

    // 掉出关卡 → 回到出生点，而不是无限下坠
    if (this.feet.y < FALL_LIMIT) {
      this.feet.copy(this.spawn);
      this.velocityY = 0;
    }

    this.syncCamera();
  }

  /** 传送到出生点 */
  respawn(): void {
    this.feet.copy(this.spawn);
    this.velocityY = 0;
    this.syncCamera();
  }
}
