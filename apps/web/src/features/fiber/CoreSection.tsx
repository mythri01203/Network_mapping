import { useState } from 'react';
import { CircleDot, Layers, Palette, Plus, Trash2 } from 'lucide-react';

import {
  activeAssignment,
  type Cable,
  completeCores,
  coreCrossSection,
  coreIdentity,
  coreUtilization,
  effectiveCoreStatus,
  isCoreFaultStatus,
  traceCoreUpstream,
  UNKNOWN_COLOR_MESSAGE,
} from '@fibergis/shared';

import { Button, Field, Input, Select } from '../../components/ui';
import { assignFiber, releaseFiber, saveCableLayout } from '../../stores/fiberActions';
import { getNetworkData, selectColorSchemes, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { InspectorSection } from '../inspector/sections';
import { ConnectionsPanel } from '../connections/ConnectionsPanel';
import { CoreConditionActions, CoreHistory } from './CoreConditionPanel';
import { CoreCrossSection } from './CoreCrossSection';
import { CoreFinder } from './CoreFinder';
import { CorePathView } from './CorePathView';
import { CoreStatusBadge, FiberSwatch, TubeSwatch } from './FiberChip';
import { STATUS_MARK } from './fiberUi';

/** Taller controls on phones (48 px), normal size on bigger screens. */
const tall = 'min-h-12 md:min-h-0';

/** A fiber picked on another cable in "Find a fiber": opened when that cable's Fibers section shows. */
let pendingFocus: { cableId: string; core: number } | null = null;

interface TubeRow {
  fiberCount: string;
  colorName: string;
}

/** How this cable's fibers are identified: scheme, tube colours and the tubes (same or different sizes). */
function LayoutForm({ cable }: { cable: Cable }) {
  const schemes = useNetworkStore(selectColorSchemes);
  const [scheme, setScheme] = useState(cable.colorScheme ?? '');
  const [tubeScheme, setTubeScheme] = useState(cable.tubeColorScheme ?? '');
  const [fpt, setFpt] = useState(cable.fibersPerTube ? String(cable.fibersPerTube) : '');
  const [source, setSource] = useState(cable.layoutSource ?? '');
  const [mixed, setMixed] = useState(!!cable.tubes?.length && (cable.fibersPerTube === undefined || cable.tubes.some((t) => t.colorName)));
  // Rows start from what is recorded: the tube records, or tubes of the recorded size. Never a guess.
  const [rows, setRows] = useState<TubeRow[]>(() =>
    cable.tubes?.length
      ? [...cable.tubes].sort((a, b) => a.number - b.number).map((t) => ({ fiberCount: String(t.fiberCount), colorName: t.colorName ?? '' }))
      : cable.fibersPerTube && cable.fiberCount % cable.fibersPerTube === 0
        ? Array.from({ length: cable.fiberCount / cable.fibersPerTube }, () => ({ fiberCount: String(cable.fibersPerTube), colorName: '' }))
        : [{ fiberCount: '', colorName: '' }],
  );
  const tubes = fpt && Number(fpt) > 0 ? cable.fiberCount / Number(fpt) : undefined;
  const selected = schemes.find((s) => s.id === scheme);
  const rowSum = rows.reduce((n, r) => n + (Number(r.fiberCount) || 0), 0);
  const setRow = (i: number, patch: Partial<TubeRow>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const modeButton = (on: boolean, label: string, testId: string) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={mixed === on}
      onClick={() => setMixed(on)}
      className={`${tall} flex-1 rounded-md border px-2 py-1 text-xs font-medium ${mixed === on ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'}`}
    >
      {mixed === on ? '✓ ' : ''}
      {label}
    </button>
  );

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Fiber colours">
          <Select data-testid="layout-scheme" className={tall} value={scheme} onChange={(e) => setScheme(e.target.value)}>
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
          <Select data-testid="layout-tube-scheme" className={tall} value={tubeScheme} onChange={(e) => setTubeScheme(e.target.value)}>
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
      </div>
      <div className="flex gap-2">
        {modeButton(false, 'All tubes the same size', 'layout-mode-same')}
        {modeButton(true, 'Tubes of different sizes', 'layout-mode-mixed')}
      </div>
      {!mixed ? (
        <Field label="Fibers in each tube" hint={tubes !== undefined ? (Number.isInteger(tubes) ? `${tubes} tube(s)` : `Does not divide ${cable.fiberCount}`) : 'From the drum sheet'}>
          <Input data-testid="layout-fpt" className={tall} inputMode="numeric" value={fpt} onChange={(e) => setFpt(e.target.value.replace(/\D/g, ''))} />
        </Field>
      ) : (
        <div className="space-y-1.5" data-testid="layout-tubes">
          {rows.map((row, i) => (
            <div key={i} className="flex items-end gap-2">
              <span className="w-14 shrink-0 pb-2 text-xs font-semibold text-slate-700">Tube {i + 1}</span>
              <Field label="Fibers" className="w-20 shrink-0">
                <Input
                  data-testid={`layout-tube-count-${i + 1}`}
                  className={tall}
                  inputMode="numeric"
                  value={row.fiberCount}
                  onChange={(e) => setRow(i, { fiberCount: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="Colour on the drum (if known)" className="min-w-0 flex-1">
                <Input data-testid={`layout-tube-colour-${i + 1}`} className={tall} value={row.colorName} placeholder="Not known" onChange={(e) => setRow(i, { colorName: e.target.value })} />
              </Field>
              <button
                type="button"
                aria-label={`Remove tube ${i + 1}`}
                disabled={rows.length === 1}
                onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 disabled:opacity-40 md:h-8 md:w-8"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Plus} data-testid="layout-tube-add" className={tall} onClick={() => setRows((list) => [...list, { fiberCount: '', colorName: '' }])}>
              Add tube
            </Button>
            <span className={`text-xs ${rowSum === cable.fiberCount ? 'text-emerald-800' : 'text-amber-800'}`} data-testid="layout-tube-sum">
              {rowSum === cable.fiberCount ? `✓ Adds up to ${cable.fiberCount} fibers` : `Adds up to ${rowSum} of ${cable.fiberCount} fibers`}
            </span>
          </div>
        </div>
      )}
      <Field label="Where this came from">
        <Input data-testid="layout-source" className={tall} value={source} placeholder="Drum sheet, date" onChange={(e) => setSource(e.target.value)} />
      </Field>
      {selected && <p className="text-[11px] text-slate-500">{selected.source}</p>}
      <Button
        size="sm"
        variant="primary"
        data-testid="layout-save"
        className={tall}
        onClick={() =>
          void saveCableLayout(cable.id, {
            colorScheme: scheme || undefined,
            tubeColorScheme: tubeScheme || undefined,
            ...(mixed
              ? { tubes: rows.map((r) => ({ fiberCount: Number(r.fiberCount) || 0, colorName: r.colorName.trim() || undefined })) }
              : { fibersPerTube: fpt ? Number(fpt) : undefined }),
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
  // Marked In Use or Reserved, but nothing on record says for what (older records, or reserved when
  // the cable was made). It cannot be given a new use until a person releases it.
  const heldUnrecorded = !active && (core.status === 'In Use' || core.status === 'Reserved');
  const faulty = isCoreFaultStatus(core.status);
  const lastCondition = [...(core.history ?? [])].reverse().find((e) => e.toStatus === core.status);
  const [kind, setKind] = useState<'in_use' | 'reserved'>('reserved');
  const [use, setUse] = useState('');
  const [destination, setDestination] = useState('');
  const [override, setOverride] = useState('');
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
      {(faulty || core.status === 'Retired') && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900" data-testid="core-condition-note">
          <span aria-hidden>{STATUS_MARK[core.status]} </span>
          Marked {core.status === 'Retired' ? 'retired (out of use)' : core.status.toLowerCase()}
          {lastCondition ? ` on ${lastCondition.at.slice(0, 10)}: ${lastCondition.reason}` : '. No reason on record.'}
          {lastCondition?.otdrRef ? ` (OTDR ${lastCondition.otdrRef})` : ''}
        </p>
      )}
      {active ? (
        <div className="space-y-1.5 text-xs text-slate-700">
          <p>
            {active.kind === 'reserved' ? 'Reserved' : 'In use'} for <strong>{active.use}</strong> since {active.effectiveFrom}
            {active.source ? `, from ${active.source}` : ''}
            {active.destination ? `, to ${active.destination}` : ''}.
          </p>
          {active.override && (
            <p className="text-amber-900" data-testid="core-override-note">
              Given while marked {active.override.status.toLowerCase()}
              {active.override.by ? ` by ${active.override.by}` : ''} on {active.override.at.slice(0, 10)}. Reason: {active.override.reason}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Input data-testid="core-release-reason" className={`${tall} min-w-0 flex-1`} value={reason} placeholder="Why it is released" onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" data-testid="core-release" className={tall} onClick={() => void releaseFiber(cable.id, coreNumber, reason)}>
              Release
            </Button>
          </div>
        </div>
      ) : heldUnrecorded ? (
        <div className="space-y-1.5 text-xs text-slate-700" data-testid="core-held-unrecorded">
          <p>
            Marked {core.status}, but nothing on record says what for. Check on site before using it. If it is really free, release it, then give it a use.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input data-testid="core-release-reason" className={`${tall} min-w-0 flex-1`} value={reason} placeholder="Why it is free" onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" data-testid="core-release" className={tall} onClick={() => void releaseFiber(cable.id, coreNumber, reason)}>
              Release
            </Button>
          </div>
        </div>
      ) : core.status === 'Retired' ? (
        <p className="text-xs text-slate-700" data-testid="core-retired-no-assign">
          A retired fiber cannot be given a service. Bring it back into use first if it is really fit to use.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Give it">
            <Select data-testid="core-assign-kind" className={tall} value={kind} onChange={(e) => setKind(e.target.value as 'in_use' | 'reserved')}>
              <option value="reserved">Reserve</option>
              <option value="in_use">In use now</option>
            </Select>
          </Field>
          <Field label="For (service or use)">
            <Input data-testid="core-assign-use" className={tall} value={use} placeholder="Tower link, customer…" onChange={(e) => setUse(e.target.value)} />
          </Field>
          <Field label="Goes to" className="sm:col-span-2">
            <Input data-testid="core-assign-destination" className={tall} value={destination} onChange={(e) => setDestination(e.target.value)} />
          </Field>
          {faulty && (
            <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 sm:col-span-2" data-testid="core-override">
              <p className="text-xs text-amber-900">
                This fiber is marked {core.status.toLowerCase()}. Choose another fiber, mark it repaired, or say why it is used anyway. Your name and reason are kept.
              </p>
              <Field label="Why use it anyway" required>
                <Input data-testid="core-override-reason" className={tall} value={override} placeholder="Re-tested OK on site, OTDR-0051" onChange={(e) => setOverride(e.target.value)} />
              </Field>
            </div>
          )}
          <Button
            size="sm"
            variant="primary"
            data-testid="core-assign-save"
            className={`${tall} sm:col-span-2`}
            disabled={faulty && !override.trim()}
            onClick={() => void assignFiber({ cableId: cable.id, coreNumber, kind, use, destination: destination || undefined, ...(faulty ? { overrideReason: override } : {}) })}
          >
            {faulty ? 'Save: use it anyway' : 'Save'}
          </Button>
        </div>
      )}
      <CoreConditionActions cable={cable} core={core} />
      <CoreHistory cable={cable} core={core} />
      {/* Network mapping Phase 13: every recorded link of this fibre, with its check state. */}
      <ConnectionsPanel bare target={{ cableId: cable.id, core: coreNumber }} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-testid="core-trace" className={tall} onClick={() => setShowTrace((v) => !v)}>
          {showTrace ? 'Hide path' : 'Follow this fiber to the OLT'}
        </Button>
        <Button size="sm" variant="ghost" className={tall} onClick={onClose}>
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
  const select = useUiStore((s) => s.select);
  // The choice remembers its cable, so switching cables never opens a fiber of the old one.
  const [choice, setChoice] = useState<{ cableId: string; core: number | null } | null>(null);
  const wanted = choice?.cableId === cable.id ? choice.core : pendingFocus?.cableId === cable.id ? pendingFocus.core : null;
  const selected = wanted !== null && wanted >= 1 && wanted <= cable.fiberCount ? wanted : null;
  const setSelected = (core: number | null) => {
    pendingFocus = null;
    setChoice({ cableId: cable.id, core });
  };
  const [editLayout, setEditLayout] = useState(false);
  const [showPicture, setShowPicture] = useState(false);
  const [finding, setFinding] = useState(false);
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

  const pick = (cableId: string, core: number) => {
    if (cableId === cable.id) {
      setSelected(core);
      return;
    }
    const other = getNetworkData().cables.find((c) => c.id === cableId);
    if (!other) return;
    // Read when that cable's Fibers section shows; cleared by the next choice there.
    pendingFocus = { cableId, core };
    select({ type: 'cable', data: other });
  };

  return (
    <InspectorSection title="Fibers" icon={Layers} aside={cable.fiberCount > 0 ? `${cable.fiberCount} F` : undefined}>
      {cable.fiberCount === 0 ? (
        <p className="text-xs text-slate-500">No fiber count recorded for this cable.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-900" data-testid="core-utilization">
            <strong className="tabular-nums">{usage.inUse}</strong> in use, <strong className="tabular-nums">{usage.reserved}</strong> reserved,{' '}
            <strong className="tabular-nums">{usage.available}</strong> free, <strong className="tabular-nums">{usage.damaged}</strong> damaged or faulty
            {usage.retired ? `, ${usage.retired} retired` : ''}
            {usage.other - usage.retired ? `, ${usage.other - usage.retired} other` : ''} ({usage.usedPercent}% used)
          </p>
          {!schemeKnown && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900" data-testid="scheme-unknown">
              {UNKNOWN_COLOR_MESSAGE} Fibers are shown by number.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={Palette} data-testid="layout-edit" className={tall} onClick={() => setEditLayout((v) => !v)}>
              {editLayout ? 'Hide fiber layout' : 'Fiber layout and colours'}
            </Button>
            <Button size="sm" icon={CircleDot} data-testid="core-picture-toggle" className={tall} aria-pressed={showPicture} onClick={() => setShowPicture((v) => !v)}>
              {showPicture ? 'Hide cable picture' : 'Show cable picture'}
            </Button>
            <Button size="sm" data-testid="core-find-toggle" className={tall} aria-pressed={finding} onClick={() => setFinding((v) => !v)}>
              {finding ? 'Hide find' : 'Find a fiber'}
            </Button>
          </div>
          {editLayout && <LayoutForm key={`${cable.id}-${cable.tubes?.length ?? 0}-${cable.fibersPerTube ?? 0}`} cable={cable} />}
          {finding && <CoreFinder cable={cable} onPick={pick} />}
          {showPicture && <CoreCrossSection section={coreCrossSection(cable, schemes)} selected={selected} onSelect={(n) => setSelected(n === selected ? null : n)} />}
          {[...byTube.entries()].map(([tube, numbers]) => (
            <div key={String(tube)} className="space-y-1" data-testid={`tube-${tube}`}>
              {tube !== 'all' && (
                <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                  <TubeSwatch identity={identities[numbers[0] - 1]} />
                  Tube {tube}
                  {identities[numbers[0] - 1].tubeColor ? `: ${identities[numbers[0] - 1].tubeColor!.name}` : ': colour not known'}
                  <span className="font-normal text-slate-500">({numbers.length} fibers)</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {numbers.map((n) => {
                  const id = identities[n - 1];
                  const status = effectiveCoreStatus(cores[n - 1]);
                  const bad = status === 'Damaged' || status === 'Faulty';
                  return (
                    <button
                      key={n}
                      type="button"
                      data-testid={`core-chip-${n}`}
                      title={`${id.label}. ${status}`}
                      aria-label={`${id.label}, ${status}`}
                      onClick={() => setSelected(n === selected ? null : n)}
                      className={`flex min-h-12 min-w-12 items-center justify-center gap-1 rounded border px-1.5 text-[11px] tabular-nums md:min-h-8 md:min-w-0 ${n === selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200'} ${status === 'In Use' ? 'bg-blue-50' : status === 'Reserved' ? 'bg-amber-50' : bad ? 'bg-red-50' : status === 'Retired' ? 'bg-slate-200 line-through' : 'bg-white'}`}
                    >
                      <FiberSwatch identity={id} size={12} />
                      <span>{n}</span>
                      {status !== 'Available' && <span aria-hidden className="text-[9px] text-slate-600">{STATUS_MARK[status] ?? '·'}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">The dot is the fiber colour from the cable's scheme. ● in use, ◐ reserved, ✕ damaged, ! faulty, — retired: the state never changes the colour.</p>
          {selected !== null && <CoreDetail key={`${cable.id}-${selected}`} cable={cable} coreNumber={selected} onClose={() => setSelected(null)} />}
        </div>
      )}
    </InspectorSection>
  );
}
