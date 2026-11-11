import { useState } from 'react';
import { Box, Cable as CableGlyph, GitMerge, Split } from 'lucide-react';

import {
  type Cable,
  CLOSURE_CONDITIONS,
  CLOSURE_TYPES,
  type ClosureCondition,
  describeSplitterOutputLink,
  type Equipment,
  type JointClosure,
  OPTICS_CLASSES,
  type OpticsClass,
  pickerEntries,
  PON_TECHNOLOGIES,
  ponCapacityText,
  ponPortPlace,
  type PonPortUsage,
  ponPortUsage,
  type PonTechnology,
  ponTreeSplits,
  SEAL_STATUSES,
  type SealStatus,
  type Splitter,
  SPLITTER_OUTPUT_STATE_WORDS,
  SPLITTER_RATIOS,
  splitterOutputSummary,
  splitterOutputUse,
  splitterPlace,
  type SplitterRatio,
  tracePonTree,
} from '@fibergis/shared';

import { Button, Field, Input, Select } from '../../components/ui';
import {
  addSplitter,
  saveClosure,
  savePonPort,
  saveSplitter,
  setSplitterInput,
  setUpClosure,
} from '../../stores/fiberActions';
import { getNetworkData, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { InspectorSection } from '../inspector/sections';
import { ClosurePhotos } from './ClosurePhotos';
import { FiberPicker } from './FiberPicker';
import { emptyFiber, type FiberChoice, fiberOf, parsePartsText } from './fiberUi';
import { BIG, BTN, OUTPUT_MARK, OUTPUT_TILE, SplitterOutputDetail, SplitterPlaceBlock } from './SplitterParts';

const ADDRESS_PART_HINT = 'Each level as the vendor names it, separated by commas. Shapes differ by vendor; nothing is converted.';

const cablesAt = (cables: readonly Cable[], equipmentId: string) =>
  cables.filter((c) => c.cableCategory !== 'Coaxial' && (c.startEquipmentId === equipmentId || c.endEquipmentId === equipmentId));

const CONDITION_LABELS: Record<ClosureCondition, string> = {
  good: 'Good',
  needs_attention: 'Needs attention',
  damaged: 'Damaged',
  unknown: 'Not checked',
};
const SEAL_LABELS: Record<SealStatus, string> = { sealed: 'Sealed', open: 'Open', unknown: 'Not checked' };

/* ------------------------------------------------------------------ */
/* Closure                                                             */
/* ------------------------------------------------------------------ */

/** On a closure pin: set up its closure record, or open it. */
export function ClosureLinkSection({ equipment }: { equipment: Equipment }) {
  const closure = useNetworkStore((s) => s.closures.find((c) => c.equipmentId === equipment.id));
  const select = useUiStore((s) => s.select);
  const openSplicing = useUiStore((s) => s.openSplicing);
  const [type, setType] = useState<JointClosure['closureType']>('Dome Splice Closure');
  const [trays, setTrays] = useState('2');
  return (
    <InspectorSection title="Closure and splices" icon={GitMerge}>
      {closure ? (
        <div className="space-y-2 text-[13px]">
          <p>
            {closure.trays?.length ?? 0} tray(s), {closure.splices.filter((s) => !s.retiredAt).length} splice(s) in service.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" data-testid="closure-open-splices" onClick={() => openSplicing(closure.id)}>
              Splices and trays
            </Button>
            <Button size="sm" data-testid="closure-open" onClick={() => select({ type: 'closure', data: closure })}>
              Closure details
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">No closure record yet. Set one up to record trays and splices.</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <Select data-testid="closure-setup-type" value={type} onChange={(e) => setType(e.target.value as JointClosure['closureType'])}>
                {CLOSURE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Trays">
              <Input data-testid="closure-setup-trays" inputMode="numeric" value={trays} onChange={(e) => setTrays(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <Button size="sm" variant="primary" data-testid="closure-setup" onClick={() => void setUpClosure({ equipmentId: equipment.id, closureType: type, trayCount: Number(trays) || 0 })}>
            Set up closure
          </Button>
        </div>
      )}
    </InspectorSection>
  );
}

/** Closure record details: trays, cable entries, condition, seal, maintenance. */
export function ClosureDetailsSection({ closure }: { closure: JointClosure }) {
  const cables = useNetworkStore((s) => s.cables);
  const [trayLabel, setTrayLabel] = useState('');
  const [entryCable, setEntryCable] = useState('');
  const [entryRole, setEntryRole] = useState<'in' | 'out' | 'through'>('in');
  const name = (id: string) => cables.find((c) => c.id === id)?.name ?? id;
  const entries = closure.cableEntries ?? [];
  return (
    <InspectorSection title="Trays, cables and condition" icon={Box}>
      <div className="space-y-3 text-[13px]">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Trays</p>
          <ul className="mb-1 flex flex-wrap gap-1" data-testid="closure-trays">
            {(closure.trays ?? []).map((t) => (
              <li key={t.id} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs">
                {t.label} · {closure.splices.filter((s) => !s.retiredAt && s.trayId === t.id).length} splice(s)
              </li>
            ))}
            {(closure.trays ?? []).length === 0 && <li className="text-xs text-slate-500">No trays recorded.</li>}
          </ul>
          <div className="flex gap-2">
            <Input data-testid="closure-tray-label" value={trayLabel} placeholder="Tray name" onChange={(e) => setTrayLabel(e.target.value)} />
            <Button
              size="sm"
              data-testid="closure-tray-add"
              disabled={!trayLabel.trim()}
              onClick={() => {
                void saveClosure(closure.id, { trays: [...(closure.trays ?? []), { id: `TRY-${Date.now().toString(36).toUpperCase()}`, label: trayLabel.trim() }] });
                setTrayLabel('');
              }}
            >
              Add tray
            </Button>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Cables in and out</p>
          <ul className="mb-1 space-y-0.5 text-xs" data-testid="closure-entries">
            {entries.map((e) => (
              <li key={e.cableId} className="flex items-center justify-between gap-2">
                <span>
                  {e.role === 'in' ? 'In (from the OLT side)' : e.role === 'out' ? 'Out (towards customers)' : 'Passes through'}: {name(e.cableId)}
                </span>
                <button type="button" className="text-red-700 hover:underline" onClick={() => void saveClosure(closure.id, { cableEntries: entries.filter((x) => x.cableId !== e.cableId) })}>
                  Remove
                </button>
              </li>
            ))}
            {entries.length === 0 && <li className="text-slate-500">No cables recorded at this closure.</li>}
          </ul>
          <div className="grid grid-cols-[1fr_7rem_auto] gap-2">
            <Select data-testid="closure-entry-cable" value={entryCable} onChange={(e) => setEntryCable(e.target.value)}>
              <option value="">Choose a cable…</option>
              {cables
                .filter((c) => c.cableCategory !== 'Coaxial' && !entries.some((e) => e.cableId === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
            <Select value={entryRole} onChange={(e) => setEntryRole(e.target.value as 'in' | 'out' | 'through')}>
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="through">Through</option>
            </Select>
            <Button size="sm" disabled={!entryCable} onClick={() => void saveClosure(closure.id, { cableEntries: [...entries, { cableId: entryCable, role: entryRole }] })}>
              Add
            </Button>
          </div>
        </div>
        <ClosurePhotos closure={closure} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Condition">
            <Select data-testid="closure-condition" value={closure.condition ?? 'unknown'} onChange={(e) => void saveClosure(closure.id, { condition: e.target.value as ClosureCondition })}>
              {CLOSURE_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Seal">
            <Select value={closure.sealStatus ?? 'unknown'} onChange={(e) => void saveClosure(closure.id, { sealStatus: e.target.value as SealStatus })}>
              {SEAL_STATUSES.map((c) => (
                <option key={c} value={c}>
                  {SEAL_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Last maintained">
            <Input type="date" value={closure.lastMaintainedAt ?? ''} onChange={(e) => void saveClosure(closure.id, { lastMaintainedAt: e.target.value || undefined })} />
          </Field>
          <Field label="Installed">
            <Input type="date" value={closure.installationDate || ''} onChange={(e) => void saveClosure(closure.id, { installationDate: e.target.value })} />
          </Field>
        </div>
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* ODF                                                                 */
/* ------------------------------------------------------------------ */

/** Phase 9: the ODF section lives in its own file; kept exported here for the inspector. */
export { OdfSection } from './OdfSection';

/* ------------------------------------------------------------------ */
/* OLT PON ports                                                       */
/* ------------------------------------------------------------------ */

export function PonPortSection({ olt }: { olt: Equipment }) {
  const cables = useNetworkStore((s) => s.cables);
  const optical = useNetworkStore(selectOpticalSettings);
  useNetworkStore((s) => s.splitters);
  useNetworkStore((s) => s.closures);
  const ports = olt.ponPorts ?? [];
  const [ponId, setPonId] = useState('');
  const pon = ports.find((p) => p.id === ponId);
  const [address, setAddress] = useState('');
  const [parts, setParts] = useState('');
  const [tech, setTech] = useState('');
  const [cls, setCls] = useState('');
  const [clsSource, setClsSource] = useState('');
  const [vendorBudget, setVendorBudget] = useState('');
  const [maxOnu, setMaxOnu] = useState('');
  const [direct, setDirect] = useState<FiberChoice>(emptyFiber);
  const choose = (id: string) => {
    const p = ports.find((x) => x.id === id);
    setPonId(id);
    setAddress(p?.vendorAddress ?? '');
    setParts((p?.addressParts ?? []).map((a) => `${a.label} ${a.value}`).join(', '));
    setTech(p?.technology ?? '');
    setCls(p?.opticsClass ?? '');
    setClsSource(p?.opticsClassSource ?? '');
    setVendorBudget(p?.vendorBudgetDb !== undefined ? String(p.vendorBudgetDb) : '');
    setMaxOnu(p?.maxOnu !== undefined ? String(p.maxOnu) : '');
    setDirect({ cableId: p?.connectedFeederCableId ?? '', core: p?.feederCore ? String(p.feederCore) : '' });
  };
  const tree = pon ? tracePonTree(olt.id, pon.id, getNetworkData(), { settings: optical }) : undefined;
  // Phase 11: splitter levels and split product on this port's tree, from each splitter's recorded links.
  const splits = pon ? ponTreeSplits(getNetworkData(), olt.id, pon.id, { settings: optical }) : undefined;
  // Phase 10: ONT, customer and service counts worked out from the records each time.
  useNetworkStore((s) => s.customers);
  useNetworkStore((s) => s.onts);
  useNetworkStore((s) => s.services);
  const usage = pon ? ponPortUsage(getNetworkData(), olt.id, pon.id, { trace: true, settings: optical }) : undefined;
  const place = pon ? ponPortPlace(olt, pon.id) : undefined;

  return (
    <InspectorSection title="PON ports: address, optics and path" icon={CableGlyph}>
      {ports.length === 0 ? (
        <p className="text-xs text-slate-600">No PON ports recorded. Use Configure OLT to set the port count first.</p>
      ) : (
        <div className="space-y-2 text-[13px]">
          <Field label="Port">
            <Select data-testid="pon-select" value={ponId} onChange={(e) => choose(e.target.value)}>
              <option value="">Choose a port…</option>
              {ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                  {p.vendorAddress ? ` · ${p.vendorAddress}` : ''}
                  {p.opticsClass ? ` · ${p.opticsClass}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          {pon && (
            <div className="space-y-2" data-testid="pon-detail">
              {usage && <PonUsageBlock usage={usage} place={place?.text} />}
              <p className="text-[11px] text-slate-500">Online, offline and LOS counts need a live OLT connection: No live connection.</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Address as the OLT writes it" className="col-span-2" hint="Kept exactly as typed, such as gpon 0/5/0">
                  <Input data-testid="pon-vendor-address" value={address} onChange={(e) => setAddress(e.target.value)} />
                </Field>
                <Field label="Levels (optional)" className="col-span-2" hint={ADDRESS_PART_HINT}>
                  <Input data-testid="pon-address-parts" value={parts} placeholder="Shelf 0, Slot 5, Port 0" onChange={(e) => setParts(e.target.value)} />
                </Field>
                <Field label="Technology">
                  <Select data-testid="pon-technology" value={tech} onChange={(e) => setTech(e.target.value)}>
                    <option value="">Not recorded</option>
                    {PON_TECHNOLOGIES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Optics class in this port">
                  <Select data-testid="pon-optics-class" value={cls} onChange={(e) => setCls(e.target.value)}>
                    <option value="">Not recorded</option>
                    {OPTICS_CLASSES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="How you know the class" className="col-span-2">
                  <Input value={clsSource} placeholder="Module datasheet, part number" onChange={(e) => setClsSource(e.target.value)} />
                </Field>
                <Field label="Vendor's own budget (dB)" hint="Kept apart from the class">
                  <Input data-testid="pon-vendor-budget" inputMode="decimal" value={vendorBudget} onChange={(e) => setVendorBudget(e.target.value.replace(/[^\d.]/g, ''))} />
                </Field>
                <Field label="ONU limit (vendor)" hint="From the OLT's datasheet. Blank: not recorded">
                  <Input data-testid="pon-max-onu" inputMode="numeric" value={maxOnu} onChange={(e) => setMaxOnu(e.target.value.replace(/\D/g, ''))} />
                </Field>
              </div>
              <FiberPicker label="Straight onto a feeder fiber (no ODF)" value={direct} onChange={setDirect} cables={cablesAt(cables, olt.id)} testId="pon-direct" />
              <Button
                size="sm"
                variant="primary"
                data-testid="pon-save"
                onClick={() =>
                  void savePonPort(olt.id, pon.id, {
                    vendorAddress: address.trim(),
                    addressParts: parsePartsText(parts),
                    technology: (tech || undefined) as PonTechnology | undefined,
                    opticsClass: (cls || undefined) as OpticsClass | undefined,
                    opticsClassSource: clsSource.trim(),
                    vendorBudgetDb: vendorBudget ? Number(vendorBudget) : undefined,
                    maxOnu: maxOnu ? Number(maxOnu) : undefined,
                    ...(fiberOf(direct) ? { connectedFeederCableId: direct.cableId, feederCore: Number(direct.core) } : { feederCore: undefined }),
                  })
                }
              >
                Save port
              </Button>
              {tree && (
                <p className="text-xs text-slate-700" data-testid="pon-tree">
                  Fiber by fiber this port reaches {tree.coreKeys.length} fiber(s), {tree.splitterIds.length} splitter(s) and {tree.customers.length} customer(s).
                  {splits && (
                    <span className="block" data-testid="pon-tree-splits">
                      {splits.levels === undefined
                        ? 'Splitter levels: no splitter is recorded on this port yet.'
                        : `Splitter levels: ${splits.levels} (${splits.architecture === 'distributed' ? 'distributed, cascaded' : 'centralised'}). Splits multiply up to 1:${splits.maxProduct}${splits.maxFactors.length > 1 ? ` (${splits.maxFactors.join(' × ')})` : ''}; limit ${splits.splitLimit} in Optical settings.`}
                    </span>
                  )}
                  {splits?.overSplitLimit && (
                    <span className="block text-amber-800" data-testid="pon-tree-split-warning">
                      Check: splits multiply to 1:{splits.maxProduct}, above the limit of {splits.splitLimit}. Customers at the end may get too little light.
                    </span>
                  )}
                  {splits && splits.differs.length > 0 && (
                    <span className="block text-amber-800">Check: {splits.differs.length} splitter(s) have a recorded arrangement that differs from these records.</span>
                  )}
                  {tree.problems.map((p) => (
                    <span key={p} className="block text-amber-800">
                      Check: {p}
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </InspectorSection>
  );
}

/**
 * Phase 10: what one PON port serves, counted from the records. The old stored counter is shown
 * only when it differs, labelled as an old saved number.
 */
function PonUsageBlock({ usage, place }: { usage: PonPortUsage; place?: string }) {
  const rows: [string, string][] = [
    ['On card', place ?? 'Not recorded'],
    ['Customers on record', String(usage.customers.length)],
    ['ONTs', `${usage.ontCount}${usage.customersWithoutOnt.length ? ` (${usage.customersWithoutOnt.length} customer(s) have no ONT record; each counted as one)` : ''}`],
    ['Services running', String(usage.services.length)],
    ['Capacity', ponCapacityText(usage)],
  ];
  if (usage.reached) rows.push(['Reached by the fibers', `${usage.reached.customers.length} customer(s), ${usage.reached.splitterIds.length} splitter(s)`]);
  return (
    <div className="space-y-1 rounded-md border border-slate-200 bg-white p-2" data-testid="pon-usage">
      <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className={label === 'Capacity' && usage.overLimit ? 'font-semibold text-red-700' : 'font-semibold text-slate-800'}>{value}</dd>
          </div>
        ))}
      </dl>
      {usage.notes.map((n) => (
        <p key={n} className="text-xs text-amber-800">
          Check: {n}
        </p>
      ))}
      {usage.storedCount !== usage.customers.length && (
        <p className="text-[11px] text-slate-500">An older saved count said {usage.storedCount}. It is not used; the counts above come from the records.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Splitters                                                           */
/* ------------------------------------------------------------------ */

function SplitterCard({ splitter, host }: { splitter: Splitter; host: Equipment }) {
  const cables = useNetworkStore((s) => s.cables);
  const splitters = useNetworkStore((s) => s.splitters);
  const [input, setInput] = useState<FiberChoice>(emptyFiber);
  const [parent, setParent] = useState('');
  const [parentReason, setParentReason] = useState('');
  const [portOpen, setPortOpen] = useState<number | null>(null);
  const [loss, setLoss] = useState(String(splitter.insertionLossDb));
  const [lossSource, setLossSource] = useState(splitter.lossSource ?? '');
  const local = cablesAt(cables, host.id);
  const inp = splitter.inputPort;
  const inputText = inp.connectedSplitterId
    ? `output ${inp.connectedSplitterPort} of ${splitters.find((s) => s.id === inp.connectedSplitterId)?.name ?? inp.connectedSplitterId}`
    : inp.connectedCableId
      ? `${cables.find((c) => c.id === inp.connectedCableId)?.name ?? inp.connectedCableId}, ${inp.connectedCore ? `fiber ${inp.connectedCore}` : 'fiber not recorded'}`
      : 'not linked';
  const others = splitters.filter((s) => s.id !== splitter.id);
  // Phase 11: where it sits and what is on each output, worked out from the records every time.
  useNetworkStore((s) => s.customers);
  useNetworkStore((s) => s.closures);
  useNetworkStore((s) => s.equipment);
  const optical = useNetworkStore(selectOpticalSettings);
  const data = getNetworkData();
  const place = splitterPlace(data, splitter.id, { settings: optical });
  const { outputs, counts } = splitterOutputUse(data, splitter);
  const openUse = outputs.find((o) => o.portNumber === portOpen);
  // Outputs of other splitters a cascade may hang on: free ones, and faulty ones with a reason.
  const parentChoices = others.flatMap((s) =>
    splitterOutputUse(data, s)
      .outputs.filter((o) => o.links.length === 0 && !o.markedOnly && (o.state === 'free' || o.state === 'faulty' || o.state === 'reserved'))
      .map((o) => ({ value: `${s.id}#${o.portNumber}`, label: `${s.name} output ${o.portNumber}${o.state === 'free' ? '' : ` (${SPLITTER_OUTPUT_STATE_WORDS[o.state].toLowerCase()})`}`, faulty: o.state === 'faulty' })),
  );
  const parentFaulty = parentChoices.find((c) => c.value === parent)?.faulty ?? false;

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2.5" data-testid={`splitter-${splitter.id}`}>
      <p className="font-semibold">
        {splitter.name} · {splitter.couplerRatio ? `coupler ${splitter.couplerRatio}` : `${splitter.kind ?? 'PLC'} ${splitter.ratio}`}
      </p>
      <p className="text-xs text-slate-700" data-testid="splitter-input-text">
        Input: {inputText}
      </p>
      {!inp.connectedCableId && !inp.connectedSplitterId ? (
        <div className="space-y-2">
          <FiberPicker label="Fiber that feeds the input" value={input} onChange={setInput} cables={local} testId="splitter-input" />
          <button type="button" className={BTN.main} data-testid="splitter-input-save" disabled={!fiberOf(input)} onClick={() => void setSplitterInput(splitter.id, fiberOf(input))}>
            Link input to this fiber
          </button>
          {parentChoices.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select data-testid="splitter-parent" className={BIG} value={parent} onChange={(e) => { setParent(e.target.value); setParentReason(''); }}>
                  <option value="">Or fed by another splitter's output…</option>
                  {parentChoices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className={BTN.plain}
                  data-testid="splitter-parent-link"
                  disabled={!parent || (parentFaulty && !parentReason.trim())}
                  onClick={() => {
                    const [splitterId, port] = parent.split('#');
                    void setSplitterInput(splitter.id, { splitterId, port: Number(port), ...(parentFaulty ? { overrideReason: parentReason } : {}) });
                  }}
                >
                  Link
                </button>
              </div>
              {parentFaulty && (
                <Field label="That output is marked faulty. Why use it anyway?">
                  <Input data-testid="splitter-parent-override" className={BIG} value={parentReason} maxLength={300} onChange={(e) => setParentReason(e.target.value)} />
                </Field>
              )}
            </div>
          )}
        </div>
      ) : (
        <button type="button" className={BTN.plain} onClick={() => void setSplitterInput(splitter.id, null)}>
          Unlink input
        </button>
      )}
      {place && <SplitterPlaceBlock place={place} />}
      <p className="text-xs text-slate-700" data-testid="splitter-out-counts">
        {splitterOutputSummary(counts)}.
        {counts.faultyInUse > 0 ? ` ${counts.faultyInUse} faulty output(s) still have something connected.` : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {outputs.map((o) => {
          const p = o.port;
          const word = SPLITTER_OUTPUT_STATE_WORDS[o.state];
          return (
            <button
              key={o.portNumber}
              type="button"
              data-testid={`splitter-out-${o.portNumber}`}
              aria-label={`Output ${o.portNumber}: ${word}`}
              title={`Output ${o.portNumber}: ${word}${o.links.length ? `, ${o.links.map((l) => describeSplitterOutputLink(l)).join(', ')}` : ''}`}
              onClick={() => {
                setPortOpen(o.portNumber === portOpen ? null : o.portNumber);
              }}
              className={`flex min-h-12 min-w-12 flex-col items-center justify-center rounded-md border px-1 text-[12px] font-semibold tabular-nums md:min-h-9 md:min-w-9 md:text-[11px] ${OUTPUT_TILE[o.state]} ${portOpen === o.portNumber ? 'ring-2 ring-blue-500/60' : ''}`}
            >
              <span>{p?.label?.includes('%') ? p.label.replace(' leg', '') : o.portNumber}</span>
              {OUTPUT_MARK[o.state] && (
                <span className="text-[10px] leading-none" aria-hidden>
                  {OUTPUT_MARK[o.state]}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">● in use · ✕ faulty · R reserved · ? not recorded · blank free</p>
      {openUse && <SplitterOutputDetail key={`${splitter.id}#${openUse.portNumber}`} splitter={splitter} use={openUse} cables={local} />}
      {!splitter.couplerRatio && (
        <div className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
          <Field label="Loss dB">
            <Input data-testid="splitter-loss" className={BIG} inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="From">
            <Input className={BIG} value={lossSource} placeholder="Datasheet" onChange={(e) => setLossSource(e.target.value)} />
          </Field>
          <button type="button" className={BTN.plain} data-testid="splitter-loss-save" onClick={() => void saveSplitter(splitter.id, { insertionLossDb: Number(loss), lossSource })}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

export function SplitterSection({ host }: { host: Equipment }) {
  const allSplitters = useNetworkStore((s) => s.splitters);
  const splitters = allSplitters.filter((sp) => sp.terminalBoxId === host.id);
  const cables = useNetworkStore((s) => s.cables);
  const [ratio, setRatio] = useState<SplitterRatio | ''>('');
  const [coupler, setCoupler] = useState('');
  const [input, setInput] = useState<FiberChoice>(emptyFiber);
  // Phase 11: the owner's names for ratios (Phase 23 editable list); the ratios themselves are fixed.
  const settings = useNetworkStore((s) => s.settings);
  const ratioEntries = pickerEntries('splitterRatios', settings);
  return (
    <InspectorSection title="Splitters and ports" icon={Split} aside={splitters.length || undefined}>
      <div className="space-y-2 text-[13px]">
        {splitters.length === 0 && <p className="text-xs text-slate-600">No splitter recorded here. Placing a pin does not create one: add it with its ratio.</p>}
        {splitters.map((sp) => (
          <SplitterCard key={sp.id} splitter={sp} host={host} />
        ))}
        <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-2.5">
          <p className="text-xs font-semibold text-slate-600">Add a splitter</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Equal split">
              <Select data-testid="splitter-add-ratio" className={BIG} value={ratio} onChange={(e) => { setRatio(e.target.value as SplitterRatio); setCoupler(''); }}>
                <option value="">Choose…</option>
                {ratioEntries
                  .filter((r) => (SPLITTER_RATIOS as readonly string[]).includes(r.value))
                  .map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label === r.value ? r.value : `${r.label} (${r.value})`}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Or unequal coupler">
              <Input data-testid="splitter-add-coupler" className={BIG} value={coupler} placeholder="90/10" onChange={(e) => { setCoupler(e.target.value); setRatio(''); }} />
            </Field>
          </div>
          <FiberPicker label="Fiber that feeds it (optional now)" value={input} onChange={setInput} cables={cablesAt(cables, host.id)} testId="splitter-add-input" />
          <Button
            size="sm"
            variant="primary"
            className={BIG}
            data-testid="splitter-add"
            disabled={!ratio && !coupler.trim()}
            onClick={() =>
              void addSplitter({
                terminalBoxId: host.id,
                ratio: ratio || '1:2',
                ...(coupler.trim() ? { couplerRatio: coupler.trim() } : {}),
                ...(fiberOf(input) ? { input: fiberOf(input)! } : {}),
              })
            }
          >
            Add splitter
          </Button>
        </div>
      </div>
    </InspectorSection>
  );
}
