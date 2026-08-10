import { useMemo, useState } from 'react';
import { parseDocument, solveLayout, validateDocument } from '@tjre/core';
import type { Diagnostic } from '@tjre/core';
import type { RoomGraphDocument } from '@tjre/schema';
import { Viewport } from './Viewport.js';
import type { ViewportStats } from './Viewport.js';
import { ErrorBoundary } from './ErrorSurface.js';
import twoRooms from '../../../examples/two-rooms.roomgraph.yaml?raw';
import loftWarehouse from '../../../examples/loft-warehouse.roomgraph.yaml?raw';

/**
 * Phase 1 的编辑器外壳：选关卡 → 三层校验 → 求解 → 渲染。
 *
 * 布局：**左侧 3D 显示区，右侧操作面板**。
 *
 * 关卡内容目前从 `examples/` 以 `?raw` 静态引入。Phase 2 会换成
 * file watcher + write-through，让外部 AI agent 改文件后浏览器自动热重载。
 */

const LEVELS: { id: string; label: string; source: string }[] = [
  { id: 'loft', label: 'Loft Warehouse（目标形态）', source: loftWarehouse },
  { id: 'two', label: 'Two Rooms（最小）', source: twoRooms },
];

interface Analysis {
  doc: RoomGraphDocument | null;
  diagnostics: Diagnostic[];
  stage: string;
  roomCount: number;
  bounds: string;
}

function analyse(source: string): Analysis {
  const loaded = parseDocument(source);
  if (!loaded.ok) {
    return { doc: null, diagnostics: loaded.errors, stage: 'schema', roomCount: 0, bounds: '—' };
  }

  const semantic = validateDocument(loaded.doc);
  if (!semantic.ok) {
    return {
      doc: null,
      diagnostics: semantic.all,
      stage: 'semantic',
      roomCount: loaded.doc.rooms.length,
      bounds: '—',
    };
  }

  const layout = solveLayout(loaded.doc);
  const b = layout.bounds;
  return {
    doc: loaded.doc,
    diagnostics: [...semantic.all, ...layout.diagnostics],
    stage: layout.ok ? 'complete' : 'layout',
    roomCount: loaded.doc.rooms.length,
    bounds: `${(b.maxX - b.minX).toFixed(1)} × ${(b.maxZ - b.minZ).toFixed(1)} m`,
  };
}

export function App(): React.ReactElement {
  const [levelId, setLevelId] = useState(LEVELS[0]?.id ?? '');
  const [wireframe, setWireframe] = useState(false);
  // 天花默认关：编辑器常态是从外部俯视，开着就什么内部都看不到
  const [showCeiling, setShowCeiling] = useState(false);
  const [showStructures, setShowStructures] = useState(true);
  const [firstPerson, setFirstPerson] = useState(false);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState<Error | null>(null);
  // 帧计数心跳：0 = 渲染循环从未跑起来；持续增长 = 循环正常，问题在相机或几何
  const [frames, setFrames] = useState(0);

  const level = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0];
  const analysis = useMemo(() => analyse(level?.source ?? ''), [level]);

  const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
  const warnings = analysis.diagnostics.filter((d) => d.severity === 'warning');

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* ── 左：3D 显示区 ─────────────────────────────── */}
      <main style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {analysis.doc === null ? (
          <div style={{ padding: 24, color: 'var(--error)' }}>
            关卡在 {analysis.stage} 阶段校验失败，无法渲染。见右侧诊断。
          </div>
        ) : (
          <ErrorBoundary label="3D 视口">
            {/* 出错时**不要**同时渲染 Viewport：它的 host div 是 position:absolute
                inset:0，会把错误信息整块盖住，等于错误白写了一遍。 */}
            {rendererError !== null ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  overflow: 'auto',
                  padding: 24,
                  color: 'var(--error)',
                  whiteSpace: 'pre-wrap',
                  font: '12px/1.6 ui-monospace, Consolas, monospace',
                }}
              >
                {`✗ 渲染器初始化失败\n\n${rendererError.name}: ${rendererError.message}\n\n${rendererError.stack ?? ''}`}
              </div>
            ) : (
              <Viewport
                doc={analysis.doc}
                wireframe={wireframe}
                showCeiling={showCeiling}
                showStructures={showStructures}
                firstPerson={firstPerson}
                onStats={setStats}
                onBackend={setBackend}
                onError={setRendererError}
                onFrames={setFrames}
              />
            )}
          </ErrorBoundary>
        )}
      </main>

      {/* ── 右：操作面板 ──────────────────────────────── */}
      <aside
        style={{
          width: 320,
          flexShrink: 0,
          background: 'var(--panel)',
          borderLeft: '1px solid var(--border)',
          padding: 14,
          overflowY: 'auto',
        }}
      >
        <h1 style={{ fontSize: 15, margin: '0 0 12px' }}>ThreeJsRoomEditor</h1>

        <Field label="关卡">
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)} style={selectStyle}>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <Section title="显示">
          <Toggle checked={showStructures} onChange={setShowStructures}>
            内部结构件（夹层 / 楼梯 / 廊桥）
          </Toggle>
          <Toggle checked={showCeiling} onChange={setShowCeiling}>
            天花（挡住内部，默认关）
          </Toggle>
          <Toggle checked={wireframe} onChange={setWireframe}>
            线框模式（核对几何拓扑）
          </Toggle>
          <Toggle checked={firstPerson} onChange={setFirstPerson}>
            第一人称漫游
          </Toggle>
        </Section>

        <Section title="布局">
          <Row k="校验阶段" v={analysis.stage} />
          <Row k="房间" v={String(analysis.roomCount)} />
          <Row k="范围" v={analysis.bounds} />
          {backend !== null && <Row k="渲染后端" v={backend} />}
          <Row k="已渲染帧" v={frames === 0 ? '0（循环未启动！）' : String(frames)} />
          {stats !== null && (
            <>
              <Row k="已渲染房间" v={String(stats.rooms)} />
              <Row k="Mesh 数" v={String(stats.meshes)} />
              <Row k="洞口数" v={String(stats.openings)} />
              <Row k="结构件" v={String(stats.structures)} />
            </>
          )}
        </Section>

        <Section title={`诊断（${errors.length} 错误 / ${warnings.length} 警告）`}>
          {analysis.diagnostics.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>无</div>
          ) : (
            analysis.diagnostics.map((d, i) => (
              <div
                key={`${d.rule}-${i}`}
                style={{
                  borderLeft: `2px solid ${d.severity === 'error' ? 'var(--error)' : 'var(--warn)'}`,
                  padding: '4px 0 4px 8px',
                  marginBottom: 8,
                }}
              >
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                  {d.rule} · {d.path}
                </div>
                <div>{d.message}</div>
                {d.hint !== undefined && (
                  <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                    → {d.hint}
                  </div>
                )}
              </div>
            ))
          )}
        </Section>

        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 18, lineHeight: 1.7 }}>
          Phase 1 · 只读视口
          <br />
          {firstPerson ? (
            <>
              点击画面锁定鼠标 · WASD 移动 · Shift 加速
              <br />
              Space 跳 · Esc 退出锁定
            </>
          ) : (
            <>鼠标左键旋转 · 滚轮缩放 · 右键平移</>
          )}
        </div>
      </aside>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f1216',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '5px 6px',
};

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section style={{ marginBottom: 18 }}>
      <h2
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--muted)',
          margin: '0 0 6px',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
