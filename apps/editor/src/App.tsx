import { useEffect, useMemo, useState } from 'react';
import { parseDocument, validateDocument } from '@tjre/core';
import type { Diagnostic } from '@tjre/core';
import type { Room, RoomGraphDocument } from '@tjre/schema';
import { roomFootprint, roomOuterPlan, roomPortals, roomSize } from '@tjre/schema';
import { Viewport } from './Viewport.js';
import type { ViewportStats } from './Viewport.js';
import { ErrorBoundary } from './ErrorSurface.js';
import { LOCALES, LOCALE_LABEL, useI18n } from './i18n.js';
import type { Translate } from './i18n.js';
import pistonFloor from '../../../examples/etc-s-piston-floor.roomgraph.yaml?raw';
import catwalkGallery from '../../../examples/etc-m-catwalk-gallery.roomgraph.yaml?raw';
import atrium from '../../../examples/etc-l-atrium.roomgraph.yaml?raw';

/**
 * 编辑器外壳。
 *
 * 布局：**左侧 3D 显示区，右侧操作面板**。
 *
 * 核心模型（ENTER THE CUBE）：**一个房间 = 一个独立关卡**。
 * 36 个房间是可互换单元，每局按 seed 随机拼装，房间之间靠**传送门**在运行时
 * 连接。所以编辑器一次只显示一个房间 —— 把整份文档当成一个连通空间来渲染
 * 是错的模型。文档里若有多个房间，视为一个**房间库**，用房间选择器切换。
 */

const LEVELS: { id: string; label: string; source: string }[] = [
  { id: 'piston', label: 'S · Piston Floor', source: pistonFloor },
  { id: 'catwalk', label: 'M · Catwalk Gallery', source: catwalkGallery },
  { id: 'atrium', label: 'L · Atrium', source: atrium },
];

interface Analysis {
  doc: RoomGraphDocument | null;
  diagnostics: Diagnostic[];
  stage: string;
}

/** schema + semantic 两层（这也是全部层次 —— 布局求解已随模型修正删除）。 */
function analyse(source: string): Analysis {
  const loaded = parseDocument(source);
  if (!loaded.ok) return { doc: null, diagnostics: loaded.errors, stage: 'schema' };

  const semantic = validateDocument(loaded.doc);
  return {
    doc: semantic.ok ? loaded.doc : null,
    diagnostics: semantic.all,
    stage: semantic.ok ? 'complete' : 'semantic',
  };
}

export function App(): React.ReactElement {
  const { locale, setLocale, t } = useI18n();

  const [levelId, setLevelId] = useState(LEVELS[0]?.id ?? '');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  // 天花默认关：编辑器常态是从外部俯视，开着就什么内部都看不到
  const [showCeiling, setShowCeiling] = useState(false);
  const [showStructures, setShowStructures] = useState(true);
  const [firstPerson, setFirstPerson] = useState(false);
  const [stats, setStats] = useState<ViewportStats | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [rendererError, setRendererError] = useState<Error | null>(null);
  const [frames, setFrames] = useState(0);

  const level = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0];
  const analysis = useMemo(() => analyse(level?.source ?? ''), [level]);
  const rooms = analysis.doc?.rooms ?? [];

  // 换关卡后原来的房间 id 可能不存在了，回落到第一个
  useEffect(() => {
    if (rooms.length === 0) {
      setRoomId(null);
      return;
    }
    if (roomId === null || !rooms.some((r) => r.id === roomId)) {
      setRoomId(rooms[0]?.id ?? null);
    }
  }, [rooms, roomId]);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const theme = analysis.doc?.themes.find((t) => t.id === room?.theme);
  const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
  const warnings = analysis.diagnostics.filter((d) => d.severity === 'warning');

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* ── 左：3D 显示区 ─────────────────────────────── */}
      <main style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {analysis.doc === null || room === null ? (
          <div style={{ padding: 24, color: 'var(--error)' }}>
            {t('error.validationFailed', { stage: analysis.stage })}
          </div>
        ) : (
          <ErrorBoundary label="3D">
            {/* 出错时**不要**同时渲染 Viewport：它的 host div 是 position:absolute
                inset:0，会把错误信息整块盖住。 */}
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
                {`${t('error.rendererInit')}\n\n${rendererError.name}: ${rendererError.message}\n\n${rendererError.stack ?? ''}`}
              </div>
            ) : (
              <Viewport
                room={room}
                theme={theme}
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
          width: 330,
          flexShrink: 0,
          background: 'var(--panel)',
          borderLeft: '1px solid var(--border)',
          padding: 14,
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h1 style={{ fontSize: 15, margin: 0 }}>{t('app.title')}</h1>
          <div style={{ display: 'flex', gap: 4 }}>
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code)}
                style={{
                  background: code === locale ? 'var(--accent)' : 'transparent',
                  color: code === locale ? '#0d1117' : 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 7px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {LOCALE_LABEL[code]}
              </button>
            ))}
          </div>
        </div>

        <Field label={t('field.level')}>
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)} style={selectStyle}>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('field.room')}>
          <select
            value={roomId ?? ''}
            onChange={(e) => setRoomId(e.target.value)}
            style={selectStyle}
            disabled={rooms.length <= 1}
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ?? r.id}
              </option>
            ))}
          </select>
        </Field>

        <Section title={t('section.display')}>
          <Toggle checked={showStructures} onChange={setShowStructures}>
            {t('toggle.structures')}
          </Toggle>
          <Toggle checked={showCeiling} onChange={setShowCeiling}>
            {t('toggle.ceiling')}
          </Toggle>
          <Toggle checked={wireframe} onChange={setWireframe}>
            {t('toggle.wireframe')}
          </Toggle>
          <Toggle checked={firstPerson} onChange={setFirstPerson}>
            {t('toggle.firstPerson')}
          </Toggle>
        </Section>

        <Section title={t('section.room')}>
          <RoomRows room={room} stats={stats} backend={backend} frames={frames} t={t} />
        </Section>

        <Section title={`${t('section.diagnostics')}（${errors.length} / ${warnings.length}）`}>
          {analysis.diagnostics.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>{t('value.none')}</div>
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
          {locale === 'en' && (
            <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
              {t('note.diagnosticsLang')}
            </div>
          )}
        </Section>

        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 18, lineHeight: 1.7 }}>
          {t('app.subtitle')}
          <br />
          {firstPerson ? (
            <>
              {t('hint.fpsLine1')}
              <br />
              {t('hint.fpsLine2')}
            </>
          ) : (
            t('hint.orbit')
          )}
        </div>
      </aside>
    </div>
  );
}

function RoomRows({
  room,
  stats,
  backend,
  frames,
  t,
}: {
  room: Room | null;
  stats: ViewportStats | null;
  backend: string | null;
  frames: number;
  t: Translate;
}): React.ReactElement {
  if (room === null) return <div style={{ color: 'var(--muted)' }}>{t('value.none')}</div>;
  // 以下几项都是**派生量**（不在文件里），所以必须显式展示 ——
  // 否则作者无从知道自己在往一个多大的盒子里塞结构。
  const size = roomSize(room);
  const fp = roomFootprint(room);
  const outer = roomOuterPlan(room);
  return (
    <>
      <Row k={t('row.spec')} v={`${room.spec}  ·  ${fp.cx}×${fp.cz} ${t('unit.cells')}`} />
      <Row k={t('row.outer')} v={`${outer.w} × ${outer.d} m`} />
      <Row k={t('row.interior')} v={`${size.w} × ${size.d} m`} />
      <Row k={t('row.height')} v={`${size.h} m`} />
      <Row k={t('row.theme')} v={room.theme} />
      <Row k={t('row.portals')} v={`${roomPortals(room).length}  ${t('value.derived')}`} />
      {room.openings.length > 0 && <Row k={t('row.openings')} v={String(room.openings.length)} />}
      <Row k={t('row.structures')} v={String(room.structures.length)} />
      <Row k={t('row.props')} v={String(room.props.length)} />
      <Row k={t('row.lights')} v={String(room.lights.length)} />
      <Row k={t('row.markers')} v={String(room.markers.length)} />
      {backend !== null && <Row k={t('row.backend')} v={backend} />}
      <Row k={t('row.frames')} v={frames === 0 ? t('value.framesStalled') : String(frames)} />
      {stats !== null && <Row k={t('row.meshes')} v={String(stats.meshes)} />}
    </>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', gap: 8 }}>
      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{k}</span>
      <span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
}
