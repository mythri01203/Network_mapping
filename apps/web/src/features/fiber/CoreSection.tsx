import { useState } from 'react';
import { Layers, Palette } from 'lucide-react';

import {
  activeAssignment,
  type Cable,
  completeCores,
  coreIdentity,
  coreUtilization,
  effectiveCoreStatus,
  traceCoreUpstream,
  UNKNOWN_COLOR_MESSAGE,
} from '@fibergis/shared';

import { Button, Field, Input, Select } from '../../components/ui';
import { assignFiber, releaseFiber, saveCableLayout } from '../../stores/fiberActions';
import { getNetworkData, selectColorSchemes, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { InspectorSection } from '../inspector/sections';
import { CorePathView } from './CorePathView';
import { CoreStatusBadge, FiberSwatch, TubeSwatch } from './FiberChip';

/** How this cable's fibers are identified: scheme, tube colours and fibers per tube. */
function LayoutForm({ cable }: { cable: Cable }) {
  const schemes = useNetworkStore(selectColorSchemes);
  const [scheme, setScheme] = useState(cable.colorScheme ?? '');
  const [tubeScheme, setTubeScheme] = useState(cable.tubeColorScheme ?? '');
  const [fpt, setFpt] = useState(cable.fibersPerTube ? String(cable.fibersPerTube) : '');
  const [source, setSource] = useState(cable.layoutSource ?? '');
  const tubes = fpt && Number(fpt) > 0 ? cable.fiberCount / Number(fpt) : undefined;
  const selected = schemes.find((s) => s.id === scheme);

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fiber colours">
          <Select data-testid="layout-scheme" value={scheme} onChange={(e) => setScheme(e.target.value)}>
            <option value="">Not known</option>
            {schemes
              .filter((s) => s.colors.length > 0)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Tube colours">
          <Select data-testid="layout-tube-scheme" value={tubeScheme} onChange={(e) => setTubeScheme(e.target.value)}>
            <option value="">Not known</option>
            {schemes
              .filter((s) => s.colors.length > 0)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Fibers in each tube" hint={tubes !== undefined ? (Number.isInteger(tubes) ? `${tubes} tube(s)` : `Does not divide ${cable.fiberCount}`) : 'From the drum sheet'}>
          <Input data-testid="layout-fpt" inputMode="numeric" value={fpt} onChange={(e) => setFpt(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Where this came from">
          <Input data-testid="layout-source" value={source} placeholder="Drum sheet, date" onChange={(e) => setSource(e.target.value)} />
        </Field>
      </div>
      {selected && <p className="text-[11px] text-slate-500">{selected.source}</p>}
      <Button
        size="sm"
        variant="primary"
        data-testid="layout-save"
        onClick={() =>
          void saveCableLayout(cable.id, {
            colorScheme: scheme || undefined,
            tubeColorScheme: tubeScheme || undefined,
            fibersPerTube: fpt ? Number(fpt) : undefined,
            layoutSource: source,
          })
        }
      >
        Save fiber layout
      </Button>
    </div>
  );
}

function CoreDetail({ cable, coreNumber, onClose }: { cable: Cable; coreNumber: number; onClose: () => void }) {
  const schemes = useNetworkStore(selectColorSchemes);
  const optical = useNetworkStore(selectOpticalSettings);
  // Read so the path is worked out again when fiber records change.
  useNetworkStore((s) => s.closures);
  useNetworkStore((s) => s.splitters);
  useNetworkStore((s) => s.equipment);
  useNetworkStore((s) => s.cables);
  const core = completeCores(cable).find((c) => c.coreNumber === coreNumber)!;
  const identity = coreIdentity(cable, coreNumber, schemes);
  const active = activeAssignment(core);
  const status = effectiveCoreStatus(core);
  const [kind, setKind] = useState<'in_use' | 'reserved'>('reserved');
  const [use, setUse] = useState('');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [showTrace, setShowTrace] = useState(false);
  const path = showTrace ? traceCoreUpstream(cable.id, coreNumber, getNetworkData(), { settings: optical }) : undefined;

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-2.5" data-testid="core-detail">
      <div className="flex items-center gap-2">
        <FiberSwatch identity={identity} size={16} />
        <span className="flex-1 text-[13px] font-semibold text-slate-900" data-testid="core-detail-label">
          {identity.label}
        </span>
        <CoreStatusBadge status={status} />
      </div>
      {!identity.schemeKnown && <p className="text-[11px] text-amber-800">{UNKNOWN_COLOR_MESSAGE}</p>}
      {active ? (
        <div className="space-y-1.5 text-xs text-slate-700">
          <p>
            {active.kind === 'reserved' ? 'Reserved' : 'In use'} for <strong>{active.use}</strong> since {active.effectiveFrom}
            {active.source ? `, from ${active.source}` : ''}
            {active.destination ? `, to ${active.destination}` : ''}.
          </p>
          <div className="flex gap-2">
            <Input data-testid="core-release-reason" value={reason} placeholder="Why it is released" onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" data-testid="core-release" onClick={() => void releaseFiber(cable.id, coreNumber, reason)}>
              Release
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Give it">
            <Select data-testid="core-assign-kind" value={kind} onChange={(e) => setKind(e.target.value as 'in_use' | 'reserved')}>
              <option value="reserved">Reserve</option>
              <option value="in_use">In use now</option>
            </Select>
          </Field>
          <Field label="For (service or use)">
            <Input data-testid="core-assign-use" value={use} placeholder="Tower link, customer…" onChange={(e) => setUse(e.target.value)} />
          </Field>
          <Field label="Goes to" className="col-span-2">
            <Input data-testid="core-assign-destination" value={destination} onChange={(e) => setDestination(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="primary"
            data-testid="core-assign-save"
            className="col-span-2"
            onClick={() => void assignFiber({ cableId: cable.id, coreNumber, kind, use, destination: destination || undefined })}
          >
            Save
          </Button>
        </div>
      )}
      {(core.assignments ?? []).some((a) => a.releasedAt) && (
        <details className="text-[11px] text-slate-600" data-testid="core-history">
          <summary className="cursor-pointer">History</summary>
          <ul className="mt-1 space-y-0.5">
            {(core.assignments ?? [])
              .filter((a) => a.releasedAt)
              .map((a) => (
                <li key={a.id}>
                  {a.kind === 'reserved' ? 'Reserved' : 'Used'} for {a.use}, {a.effectiveFrom} to {a.releasedAt?.slice(0, 10)}
                  {a.releaseReason ? ` (${a.releaseReason})` : ''}
                </li>
              ))}
          </ul>
        </details>
      )}
      <div className="flex gap-2">
        <Button size="sm" data-testid="core-trace" onClick={() => setShowTrace((v) => !v)}>
          {showTrace ? 'Hide path' : 'Follow this fiber to the OLT'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {path && <CorePathView path={path} showBudget={false} />}
    </div>
  );
}

/** Fibers of a cable: identity from its scheme, status as a separate badge, counts worked out. */
export function CoreSection({ cable }: { cable: Cable }) {
  const schemes = useNetworkStore(selectColorSchemes);
  const [selected, setSelected] = useState<number | null>(null);
  const [editLayout, setEditLayout] = useState(false);
  const usage = coreUtilization(cable);
  const cores = completeCores(cable);
  const identities = cores.map((c) => coreIdentity(cable, c.coreNumber, schemes));
  const schemeKnown = identities[0]?.schemeKnown ?? false;
  const byTube = new Map<number | 'all', number[]>();
  identities.forEach((id) => {
    const key = id.tubeNumber ?? 'all';
    byTube.set(key, [...(byTube.get(key) ?? []), id.coreNumber]);
  });

  if (cable.cableCategory === 'Coaxial') return null;

  return (
    <InspectorSection title="Fibers" icon={Layers} aside={cable.fiberCount > 0 ? `${cable.fiberCount} F` : undefined}>
      {cable.fiberCount === 0 ? (
        <p className="text-xs text-slate-500">No fiber count recorded for this cable.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-900" data-testid="core-utilization">
            <strong className="tabular-nums">{usage.inUse}</strong> in use, <strong className="tabular-nums">{usage.reserved}</strong> reserved,{' '}
            <strong className="tabular-nums">{usage.available}</strong> free, <strong className="tabular-nums">{usage.damaged}</strong> damaged
            {usage.other ? `, ${usage.other} other` : ''} ({usage.usedPercent}% used)
          </p>
          {!schemeKnown && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900" data-testid="scheme-unknown">
              {UNKNOWN_COLOR_MESSAGE} Fibers are shown by number.
            </p>
          )}
          <Button size="sm" icon={Palette} data-testid="layout-edit" onClick={() => setEditLayout((v) => !v)}>
            {editLayout ? 'Hide fiber layout' : 'Fiber layout and colours'}
          </Button>
          {editLayout && <LayoutForm cable={cable} />}
          {[...byTube.entries()].map(([tube, numbers]) => (
            <div key={String(tube)} className="space-y-1" data-testid={`tube-${tube}`}>
              {tube !== 'all' && (
                <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                  <TubeSwatch identity={identities[numbers[0] - 1]} />
                  Tube {tube}
                  {identities[numbers[0] - 1].tubeColor ? `: ${identities[numbers[0] - 1].tubeColor!.name}` : ': colour not known'}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {numbers.map((n) => {
                  const id = identities[n - 1];
                  const status = effectiveCoreStatus(cores[n - 1]);
                  return (
                    <button
                      key={n}
                      type="button"
                      data-testid={`core-chip-${n}`}
                      title={`${id.label}. ${status}`}
                      aria-label={`${id.label}, ${status}`}
                      onClick={() => setSelected(n === selected ? null : n)}
                      className={`flex min-h-8 items-center gap-1 rounded border px-1.5 text-[11px] tabular-nums ${n === selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200'} ${status === 'In Use' ? 'bg-blue-50' : status === 'Reserved' ? 'bg-amber-50' : status === 'Damaged' ? 'bg-red-50' : 'bg-white'}`}
                    >
                      <FiberSwatch identity={id} size={12} />
                      <span>{n}</span>
                      {status !== 'Available' && <span aria-hidden className="text-[9px] text-slate-500">{status === 'In Use' ? '●' : status === 'Reserved' ? '◐' : status === 'Damaged' ? '✕' : '·'}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">The dot is the fiber colour from the cable's scheme. ● in use, ◐ reserved, ✕ damaged: the state never changes the colour.</p>
          {selected !== null && <CoreDetail key={selected} cable={cable} coreNumber={selected} onClose={() => setSelected(null)} />}
        </div>
      )}
    </InspectorSection>
  );
}
