import { useMemo } from 'react';
import { Rows3 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { cablesAlongSpan, type CableSegment, cablesInDuct, describeSegmentEnd, type Equipment } from '@fibergis/shared';

import { useNetworkStore } from '../../../stores/networkStore';
import { useUiStore } from '../../../stores/uiStore';
import { INSTALL_LABELS } from '../../cables/cableLabels';
import { InspectorSection, RecordLink } from '../sections';

/**
 * Network mapping Phase 6: the corridor view, read-only. Every cable recorded in this duct or on this
 * span, from the duct's or span's own records and from cable stretches that name it, each with the
 * record that puts it there. Lines that only run near each other on the map are never counted.
 */
export function CorridorSection({ kind, id }: { kind: 'duct' | 'span'; id: string }) {
  const data = useNetworkStore(
    useShallow((s) => ({ cables: s.cables, ducts: s.ducts, spans: s.spans, attachments: s.attachments, cableSegments: s.cableSegments, equipment: s.equipment })),
  );
  const select = useUiStore((s) => s.select);
  const rows = useMemo(() => (kind === 'duct' ? cablesInDuct(data, id) : cablesAlongSpan(data, id)), [kind, data, id]);
  const byId = useMemo(() => new Map<string, Equipment>(data.equipment.map((e) => [e.id, e])), [data.equipment]);
  const stretch = (s: CableSegment) =>
    `${describeSegmentEnd(s, 'from', byId)} to ${describeSegmentEnd(s, 'to', byId)}${s.installMethod ? `, ${INSTALL_LABELS[s.installMethod]}` : ''}${s.measuredLengthMeters !== undefined ? `, measured ${s.measuredLengthMeters} m` : ''}`;

  return (
    <InspectorSection title={kind === 'duct' ? 'Corridor: every cable in this duct' : 'Corridor: every cable along this span'} icon={Rows3} aside={rows.length || undefined} defaultOpen={false}>
      <div className="space-y-2" data-testid={`corridor-${kind}`}>
        <p className="text-[12px] text-slate-600">
          Read only. From the {kind === 'duct' ? "duct's own list" : 'records of cables on this span'} and from cable stretches that name it. To change one, open the cable.
        </p>
        {rows.length === 0 ? (
          <p className="text-[12px] text-slate-600" data-testid={`corridor-${kind}-empty`}>
            No cable is recorded {kind === 'duct' ? 'in this duct' : 'on this span'}.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.cable.id} className="py-2 text-[13px]">
                <RecordLink name={row.cable.name} id={row.cable.id} onSelect={() => select({ type: 'cable', data: row.cable })} />
                <span className="block text-[11px] text-slate-500">
                  {row.cable.fiberCount > 0 ? `${row.cable.fiberCount} fibres` : 'Fibre count not recorded'} · {row.sources.join(' · ')}
                </span>
                {row.segments.map((s) => (
                  <span key={s.id} className="block text-[11px] text-slate-600">
                    Stretch: {stretch(s)}
                  </span>
                ))}
                {row.mismatch && <span className="block text-[11px] text-amber-800">Please check: {row.mismatch}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </InspectorSection>
  );
}
