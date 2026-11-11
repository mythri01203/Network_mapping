import { useMemo } from 'react';

import { describeUnitRuns, type Equipment, type Rack, RACK_NUMBERING_LABELS, rackElevation, type RackSlot } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';

const UNIT_PX = 28;

/** Side by side when two recorded items share a unit (half-width items can). */
function lanes(slots: readonly RackSlot[]): number[] {
  const lane: number[] = [];
  slots.forEach((s, i) => {
    const clash = slots.slice(0, i).some((o, j) => lane[j] === 0 && o.from <= s.to && s.from <= o.to);
    lane.push(clash ? 1 : 0);
  });
  return lane;
}

/**
 * Phase 9: a rack as recorded, drawn unit by unit: what sits in each unit and which are free.
 * Only recorded units and heights are drawn. Without the rack's height nothing is called free; an
 * item with no height recorded is drawn one unit tall with a dashed edge and says so.
 */
export function RackElevation({
  rack,
  onOpenItem,
  highlightId,
  items,
}: {
  rack: Rack;
  onOpenItem?: (item: Equipment) => void;
  highlightId?: string;
  /** The equipment to place; the network's equipment when not given. */
  items?: readonly Equipment[];
}) {
  const stored = useNetworkStore((s) => s.equipment);
  const equipment = items ?? stored;
  const site = useNetworkStore((s) => s.sites.find((x) => x.id === rack.siteId));
  const view = useMemo(() => rackElevation(rack, equipment), [rack, equipment]);
  const laneOf = lanes(view.slots);
  const shared = laneOf.some((l) => l === 1);
  const height = view.height;
  const rowOf = (unit: number) => (view.numbering === 'top_down' ? unit : height! - unit + 1);

  const itemButton = (s: RackSlot, i: number, style?: React.CSSProperties) => (
    <button
      key={s.equipment.id}
      type="button"
      style={style}
      onClick={() => onOpenItem?.(s.equipment)}
      data-testid={`rack-item-${s.equipment.id}`}
      className={`flex min-h-0 items-center gap-2 overflow-hidden rounded border-2 px-2 text-left text-[12px] font-semibold ${
        s.beyond ? 'border-red-500 bg-red-50 text-red-900' : s.equipment.id === highlightId ? 'border-blue-600 bg-blue-100 text-blue-950' : 'border-slate-500 bg-slate-100 text-slate-900'
      } ${s.heightKnown ? '' : 'border-dashed'} ${onOpenItem ? 'hover:bg-blue-50' : ''}`}
      title={`${s.equipment.name} (${s.equipment.type})`}
    >
      <span className="truncate">{s.equipment.name}</span>
      <span className="shrink-0 text-[10px] font-normal text-slate-600">
        {s.equipment.type}
        {s.heightKnown ? '' : ' · height not recorded'}
        {laneOf[i] === 1 || (shared && laneOf[i] === 0 && view.slots.some((o, j) => laneOf[j] === 1 && o.from <= s.to && s.from <= o.to)) ? ' · shares a unit' : ''}
      </span>
    </button>
  );

  return (
    <div className="space-y-3 text-[13px]" data-testid="rack-elevation">
      <div>
        <p className="font-semibold text-slate-900">
          {rack.name}
          {site ? ` · ${site.name}` : ''}
        </p>
        <p className="text-xs text-slate-600">
          {height ? `${height} units` : 'Height not recorded'}
          {rack.location ? ` · ${rack.location}` : ''}
          {' · '}
          {view.numberingRecorded ? RACK_NUMBERING_LABELS[view.numbering] : 'Numbering not recorded: drawn with unit 1 at the bottom'}
        </p>
      </div>

      {height ? (
        <>
          <p className="text-xs text-slate-700" data-testid="rack-free">
            {view.freeUnits!.length === 0
              ? 'No free units, as recorded.'
              : `Free, as recorded: ${view.freeUnits!.length === 1 ? 'unit' : 'units'} ${describeUnitRuns(view.freeUnits!)} (${view.freeUnits!.length} of ${height}).`}
            {view.heightUnknown > 0 && ` ${view.heightUnknown} item(s) have no height recorded, so they may fill more units than shown.`}
          </p>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[16rem] gap-x-1 rounded-md border-4 border-slate-700 bg-slate-800 p-1"
              style={{ gridTemplateColumns: '2.25rem 1fr 1fr', gridTemplateRows: `repeat(${height}, ${UNIT_PX}px)` }}
              role="list"
              aria-label={`${rack.name}, ${height} units`}
            >
              {Array.from({ length: height }, (_, i) => i + 1).map((unit) => (
                <div key={`u${unit}`} style={{ gridColumn: '1 / 2', gridRow: `${rowOf(unit)} / span 1` }} className="flex items-center justify-end pr-1 text-[10px] tabular-nums text-slate-300">
                  {unit}
                </div>
              ))}
              {view.freeUnits!.map((unit) => (
                <div
                  key={`f${unit}`}
                  style={{ gridColumn: '2 / 4', gridRow: `${rowOf(unit)} / span 1` }}
                  className="m-px rounded-sm border border-dashed border-slate-600 text-[10px] leading-[24px] text-slate-500"
                  aria-label={`Unit ${unit} free`}
                >
                  <span className="pl-2">free</span>
                </div>
              ))}
              {view.slots.map((s, i) => {
                if (s.from > height) return null;
                const top = Math.min(s.to, height);
                const span = top - s.from + 1;
                const start = view.numbering === 'top_down' ? s.from : rowOf(top);
                const column = shared ? (laneOf[i] === 0 ? '2 / 3' : '3 / 4') : '2 / 4';
                return itemButton(s, i, { gridColumn: column, gridRow: `${start} / span ${span}` });
              })}
            </div>
          </div>
          {view.slots.some((s) => s.beyond) && (
            <p className="text-xs text-red-800">
              Past the top of the rack: {view.slots.filter((s) => s.beyond).map((s) => s.equipment.name).join(', ')}. Check the unit numbers or the rack height.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-slate-700">Record the rack height to see free units. Items with a unit written:</p>
          {view.slots.length === 0 ? (
            <p className="text-xs text-slate-500">None.</p>
          ) : (
            <ul className="space-y-1">
              {view.slots.map((s, i) => (
                <li key={s.equipment.id} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs tabular-nums text-slate-600">{s.from === s.to ? `U${s.from}` : `U${s.from}–${s.to}`}</span>
                  {itemButton(s, i, { minHeight: 48 })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.unplaced.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600">In this rack, unit not recorded</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {view.unplaced.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onOpenItem?.(e)} className="min-h-12 rounded border border-slate-300 bg-white px-2 text-xs md:min-h-8">
                  {e.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
