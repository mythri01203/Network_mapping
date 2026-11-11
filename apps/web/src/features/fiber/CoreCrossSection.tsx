import { CORE_STATUS_LABELS, type CoreCrossSection as CrossSection } from '@fibergis/shared';

import { layoutCrossSection, MARKER_LEGEND, markerFor, type PlacedFiber, type StatusMarker, VIEW_SIZE } from './crossSectionLayout';

/** Marks a fiber's state with a shape, drawn over the fiber, so the state is never colour alone. */
function Marker({ marker, x, y, r }: { marker: StatusMarker; x: number; y: number; r: number }) {
  const halo = { stroke: '#ffffff', strokeWidth: Math.max(1.5, r * 0.35), strokeLinecap: 'round' as const };
  const ink = { stroke: '#111827', strokeWidth: Math.max(0.8, r * 0.18), strokeLinecap: 'round' as const };
  const d = r * 0.75;
  switch (marker) {
    case 'dot': {
      const dr = Math.max(1.2, r * 0.32);
      const cx = x + r * 0.62;
      const cy = y - r * 0.62;
      return <circle cx={cx} cy={cy} r={dr} fill="#111827" stroke="#ffffff" strokeWidth={Math.max(0.6, dr * 0.45)} />;
    }
    case 'ring':
      return <circle cx={x} cy={y} r={r * 1.22} fill="none" stroke="#111827" strokeWidth={Math.max(0.8, r * 0.16)} strokeDasharray={`${Math.max(1, r * 0.35)} ${Math.max(1, r * 0.25)}`} />;
    case 'cross':
      return (
        <g>
          <line x1={x - d} y1={y - d} x2={x + d} y2={y + d} {...halo} />
          <line x1={x - d} y1={y + d} x2={x + d} y2={y - d} {...halo} />
          <line x1={x - d} y1={y - d} x2={x + d} y2={y + d} {...ink} />
          <line x1={x - d} y1={y + d} x2={x + d} y2={y - d} {...ink} />
        </g>
      );
    case 'slash':
      return (
        <g>
          <line x1={x - d} y1={y + d} x2={x + d} y2={y - d} {...halo} />
          <line x1={x - d} y1={y + d} x2={x + d} y2={y - d} {...ink} />
        </g>
      );
    default:
      return null;
  }
}

function Fiber({ placed, selected, onSelect }: { placed: PlacedFiber; selected: boolean; onSelect?: (core: number) => void }) {
  const { fiber, x, y, r, showNumber } = placed;
  const colour = fiber.color;
  const marker = markerFor(fiber.status);
  return (
    <g
      data-testid={`xs-fiber-${fiber.coreNumber}`}
      data-status={fiber.status}
      onClick={onSelect ? () => onSelect(fiber.coreNumber) : undefined}
      style={onSelect ? { cursor: 'pointer' } : undefined}
    >
      <title>{`${fiber.label}. ${CORE_STATUS_LABELS[fiber.status]}`}</title>
      <circle
        cx={x}
        cy={y}
        r={r}
        // No colour is drawn unless the cable's scheme says it: an unknown scheme shows white with the number.
        fill={colour ? colour.hex : '#ffffff'}
        stroke={selected ? '#2563eb' : colour ? 'rgba(0,0,0,0.45)' : '#64748b'}
        strokeWidth={selected ? Math.max(1.5, r * 0.3) : Math.max(0.5, r * 0.1)}
        strokeDasharray={colour ? undefined : `${Math.max(1, r * 0.3)} ${Math.max(0.6, r * 0.2)}`}
      />
      {showNumber && (
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(r * 0.95, 13)} fontWeight={600} fill={colour ? colour.textColor : '#0f172a'}>
          {fiber.coreNumber}
        </text>
      )}
      <Marker marker={marker} x={x} y={y} r={r} />
    </g>
  );
}

/**
 * Cable cross-section: tubes as rings with their fibers. Colours appear only when the cable's
 * scheme is known (tube colours only when written on the tube or known from the tube scheme);
 * otherwise fibers are white with their number. The state is a separate mark on each fiber.
 */
export function CoreCrossSection({ section, selected, onSelect }: { section: CrossSection; selected?: number | null; onSelect?: (core: number) => void }) {
  const tubes = layoutCrossSection(section);
  const fiberCount = section.tubes.reduce((n, t) => n + t.fibers.length, 0);
  const summary = section.tubesKnown
    ? `${section.tubes.length} tube${section.tubes.length === 1 ? '' : 's'}, ${fiberCount} fibers. ${section.schemeKnown ? 'Colours from the cable scheme.' : 'Colours not known, shown by number.'}`
    : `${fiberCount} fibers. Tubes not recorded, so all fibers are shown in one group by number.`;
  return (
    <figure className="space-y-1.5" data-testid="core-cross-section">
      <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} role="img" aria-label={`Cable cross-section: ${summary}`} className="mx-auto block h-auto w-full max-w-[320px]">
        <circle cx={VIEW_SIZE / 2} cy={VIEW_SIZE / 2} r={VIEW_SIZE / 2 - 3} fill="#f1f5f9" stroke="#1e293b" strokeWidth={4} />
        {tubes.map((t, i) => (
          <g key={t.tube.number ?? `all-${i}`} data-testid={`xs-tube-${t.tube.number ?? 'all'}`}>
            <title>{t.tube.number !== undefined ? `Tube ${t.tube.number}: ${t.tube.color ? t.tube.color.name : 'colour not known'}` : 'Tubes not recorded'}</title>
            <circle
              cx={t.x}
              cy={t.y}
              r={t.r}
              fill="#ffffff"
              stroke={t.tube.color ? t.tube.color.hex : '#94a3b8'}
              strokeWidth={t.tube.color ? Math.max(2, t.r * 0.12) : 1.5}
              strokeDasharray={t.tube.color ? undefined : '5 4'}
            />
            {t.tube.color && <circle cx={t.x} cy={t.y} r={t.r + Math.max(1, t.r * 0.06)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={0.75} />}
            {t.labelInside && t.tube.number !== undefined && (
              <text x={t.x} y={t.y} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(t.r * 0.32, 16)} fontWeight={700} fill="#334155">
                T{t.tube.number}
              </text>
            )}
            {t.fibers.map((f) => (
              <Fiber key={f.fiber.coreNumber} placed={f} selected={selected === f.fiber.coreNumber} onSelect={onSelect} />
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="text-center text-[11px] text-slate-600">
        <span className="block">{summary}</span>
        <span className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1" aria-label="What the marks mean">
          {MARKER_LEGEND.map((l) => (
            <span key={l.marker} className="inline-flex items-center gap-1">
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
                <circle cx={10} cy={10} r={7} fill="#ffffff" stroke="#64748b" strokeWidth={1} />
                <Marker marker={l.marker} x={10} y={10} r={7} />
              </svg>
              {l.text}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
