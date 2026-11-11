import { useMemo } from 'react';

import type { JointClosure } from '@fibergis/shared';

import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';
import { type DiagramFiber, layoutSpliceDiagram, LEFT_DOT_X, LINK_SHAPE_WORDS, type LinkShape, RIGHT_DOT_X, type TrayFilter } from './spliceDiagramLayout';

const DOT = 8;

function Fiber({ fiber, side }: { fiber: DiagramFiber; side: 'left' | 'right' }) {
  const x = side === 'left' ? LEFT_DOT_X : RIGHT_DOT_X;
  const textX = side === 'left' ? x - DOT - 4 : x + DOT + 4;
  return (
    <g>
      <title>{`${fiber.shortLabel}${fiber.colorName ? ` ${fiber.colorName}` : ' (colour not known)'}`}</title>
      {fiber.colorHex ? (
        <circle cx={x} cy={fiber.y} r={DOT} fill={fiber.colorHex} stroke="#0f172a" strokeOpacity={0.35} />
      ) : (
        <>
          <circle cx={x} cy={fiber.y} r={DOT} fill="#ffffff" stroke="#64748b" strokeDasharray="2 2" />
          <text x={x} y={fiber.y + 3} fontSize={8} textAnchor="middle" fill="#334155">
            {fiber.core}
          </text>
        </>
      )}
      <text x={textX} y={fiber.y + 4} fontSize={11} textAnchor={side === 'left' ? 'end' : 'start'} fill="#1e293b">
        {fiber.shortLabel}
        {fiber.colorName ? ` ${fiber.colorName}` : ''}
      </text>
    </g>
  );
}

function linkStyle(shape: LinkShape) {
  if (shape === 'planned') return { strokeDasharray: '6 4', stroke: '#475569' };
  if (shape === 'unused') return { strokeDasharray: '1 4', stroke: '#94a3b8' };
  return { stroke: shape === 'broken' ? '#b91c1c' : '#1e293b' };
}

/** The splice picture of a closure, drawn from its records. */
export function SpliceDiagram({ closure, tray }: { closure: JointClosure; tray: TrayFilter }) {
  const cables = useNetworkStore((s) => s.cables);
  const schemes = useNetworkStore(selectColorSchemes);
  const d = useMemo(() => layoutSpliceDiagram(closure, cables, schemes, tray), [closure, cables, schemes, tray]);
  if (d.empty) return <p className="text-xs text-slate-500">Nothing to draw: no splices or pigtails in service here.</p>;
  const shapes = [...new Set(d.links.filter((l) => l.kind === 'splice').map((l) => l.shape))];
  const midX = (LEFT_DOT_X + RIGHT_DOT_X) / 2;
  return (
    <figure className="space-y-1" data-testid="splice-picture">
      <svg
        viewBox={`0 0 ${d.width} ${d.height}`}
        width="100%"
        style={{ maxWidth: 560 }}
        role="img"
        aria-label={`Splice picture of ${closure.name}: ${d.links.length} line(s). ${d.links.map((l) => l.label).join('. ')}`}
        className="rounded-md border border-slate-200 bg-white"
      >
        {d.leftGroups.map((g) => (
          <text key={`l-${g.cableName}-${g.y}`} x={LEFT_DOT_X + DOT} y={g.y} fontSize={11} fontWeight={700} textAnchor="end" fill="#0f172a">
            {g.cableName.length > 22 ? `${g.cableName.slice(0, 21)}…` : g.cableName}
          </text>
        ))}
        {d.rightGroups.map((g) => (
          <text key={`r-${g.cableName}-${g.y}`} x={RIGHT_DOT_X - DOT} y={g.y} fontSize={11} fontWeight={700} fill="#0f172a">
            {g.cableName.length > 22 ? `${g.cableName.slice(0, 21)}…` : g.cableName}
          </text>
        ))}
        {d.links.map((l) => (
          <g key={l.id} data-testid={`splice-line-${l.id}`} data-shape={l.shape}>
            <title>{l.label}</title>
            <line x1={LEFT_DOT_X + DOT} y1={l.fromY} x2={RIGHT_DOT_X - DOT} y2={l.toY} strokeWidth={2} {...linkStyle(l.shape)} />
            {l.shape === 'tested' && (
              <text x={midX} y={(l.fromY + l.toY) / 2 - 3} fontSize={11} textAnchor="middle" fill="#166534">
                ✓
              </text>
            )}
            {l.shape === 'broken' && (
              <text x={midX} y={(l.fromY + l.toY) / 2 + 4} fontSize={13} fontWeight={700} textAnchor="middle" fill="#b91c1c">
                ✕
              </text>
            )}
          </g>
        ))}
        {d.left.map((f) => (
          <Fiber key={`l-${f.key}`} fiber={f} side="left" />
        ))}
        {d.right.map((f) => (
          <Fiber key={`r-${f.key}`} fiber={f} side="right" />
        ))}
        {d.connectors.map((c) => (
          <g key={c.id}>
            <rect x={RIGHT_DOT_X - DOT} y={c.y - 8} width={16} height={16} fill="#f8fafc" stroke="#1e293b" />
            <rect x={RIGHT_DOT_X + 8} y={c.y - 4} width={6} height={8} fill="#1e293b" />
            <text x={RIGHT_DOT_X + 18} y={c.y + 4} fontSize={11} fill="#1e293b">
              {c.text.length > 18 ? `${c.text.slice(0, 17)}…` : c.text}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-[11px] leading-5 text-slate-600" data-testid="splice-picture-key">
        Left: towards the OLT. Right: towards customers. A filled circle shows the fiber colour from the cable&apos;s colour scheme; a white circle with a number means the colour is not known.
        {shapes.map((s) => (
          <span key={s} className="block">
            {LINK_SHAPE_WORDS[s]}
          </span>
        ))}
        {d.connectors.length > 0 && <span className="block">Square with a plug: the fiber ends on a pigtail (connector), not spliced.</span>}
      </figcaption>
    </figure>
  );
}
