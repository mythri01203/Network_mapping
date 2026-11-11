import React, { useMemo } from 'react';

import { type NetworkTraceResult, TRACE_STEP_STATE_LABELS, type TraceStep, type TraceTreeNode } from '@fibergis/shared';

import { KIND_WORDS, STATE_STYLE } from './traceWords';

/**
 * Network mapping Phase 15: the trace as a simple tree drawing, readable on a 390 px phone. Paths are
 * a straight line down (OLT at the top); downstream traces branch. Each box shows a mark and words
 * for its state, never colour alone.
 */

interface Row {
  step: TraceStep;
  depth: number;
  parent: number;
}

const MAX_ROWS = 400;
const ROW = 44;
const BOX = 36;
const INDENT = 14;
const WIDTH = 360;

function rowsOf(result: NetworkTraceResult): { rows: Row[]; cut: boolean } {
  const rows: Row[] = [];
  let cut = false;
  for (const path of result.paths) {
    let parent = -1;
    for (const step of path.steps) {
      if (rows.length >= MAX_ROWS) {
        cut = true;
        break;
      }
      rows.push({ step, depth: 0, parent });
      parent = rows.length - 1;
    }
  }
  const walk = (n: TraceTreeNode, depth: number, parent: number) => {
    if (rows.length >= MAX_ROWS) {
      cut = true;
      return;
    }
    rows.push({ step: n.step, depth, parent });
    const me = rows.length - 1;
    for (const c of n.children) walk(c, depth + 1, me);
  };
  for (const t of result.trees) walk(t, 0, -1);
  return { rows, cut };
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

export const TraceDiagram: React.FC<{ result: NetworkTraceResult; onPick?: (step: TraceStep) => void }> = ({ result, onPick }) => {
  const { rows, cut } = useMemo(() => rowsOf(result), [result]);
  if (rows.length === 0) return <p className="text-sm text-slate-600">Nothing to draw: no step is on record.</p>;
  const height = rows.length * ROW + 8;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label={`Diagram of the trace: ${rows.length} steps`} data-testid="trace-diagram">
        {rows.map((r, i) => {
          if (r.parent < 0) return null;
          const p = rows[r.parent];
          const px = 8 + Math.min(p.depth, 10) * INDENT + 10;
          const py = r.parent * ROW + 4 + BOX;
          const cx = 8 + Math.min(r.depth, 10) * INDENT;
          const cy = i * ROW + 4 + BOX / 2;
          return <path key={`l${i}`} d={`M ${px} ${py} V ${cy} H ${cx}`} fill="none" stroke="#94a3b8" strokeWidth={1.2} />;
        })}
        {rows.map((r, i) => {
          const x = 8 + Math.min(r.depth, 10) * INDENT;
          const y = i * ROW + 4;
          const w = WIDTH - x - 4;
          const style = STATE_STYLE[r.step.state];
          const chars = Math.floor((w - 30) / 6.4);
          const label = `${KIND_WORDS[r.step.kind]}: ${r.step.title}`;
          return (
            <g
              key={`n${i}`}
              onClick={onPick && r.step.lat !== undefined ? () => onPick(r.step) : undefined}
              style={{ cursor: onPick && r.step.lat !== undefined ? 'pointer' : 'default' }}
            >
              <title>{`${label}. ${TRACE_STEP_STATE_LABELS[r.step.state]}. ${r.step.detail}`}</title>
              <rect x={x} y={y} width={w} height={BOX} rx={8} fill={style.fill} stroke={style.stroke} strokeWidth={1.5} strokeDasharray={style.dash} />
              <text x={x + 10} y={y + 23} fontSize={14} fontWeight={700} fill={style.stroke}>
                {style.mark}
              </text>
              <text x={x + 28} y={y + 15} fontSize={11.5} fontWeight={600} fill="#0f172a">
                {shorten(label, chars)}
              </text>
              <text x={x + 28} y={y + 29} fontSize={10} fill="#475569">
                {shorten(TRACE_STEP_STATE_LABELS[r.step.state], chars)}
              </text>
            </g>
          );
        })}
      </svg>
      {cut && <p className="mt-1 text-xs text-slate-600">Only the first {MAX_ROWS} steps are drawn. The list and the report have all of them.</p>}
    </div>
  );
};
