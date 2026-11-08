import { useState } from 'react';
import { Box, Cable as CableGlyph, GitMerge, Network, Split } from 'lucide-react';

import {
  type Cable,
  CLOSURE_CONDITIONS,
  CLOSURE_TYPES,
  type ClosureCondition,
  type Equipment,
  type JointClosure,
  OPTICS_CLASSES,
  type OpticsClass,
  PON_TECHNOLOGIES,
  type PonTechnology,
  SEAL_STATUSES,
  type SealStatus,
  type Splitter,
  SPLITTER_RATIOS,
  splitterCapacity,
  type SplitterRatio,
  tracePonTree,
} from '@fibergis/shared';

import { Button, Field, Input, Select } from '../../components/ui';
import {
  addPanel,
  addSplitter,
  saveClosure,
  savePonPort,
  saveSplitter,
  setPortFeeder,
  setPortPatch,
  setSplitterInput,
  setSplitterOutput,
  setUpClosure,
} from '../../stores/fiberActions';
import { getNetworkData, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { InspectorSection } from '../inspector/sections';
import { ClosurePhotos } from './ClosurePhotos';
import { FiberPicker } from './FiberPicker';
import { emptyFiber, type FiberChoice, fiberOf, parsePartsText } from './fiberUi';

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

export function OdfSection({ odf }: { odf: Equipment }) {
  const cables = useNetworkStore((s) => s.cables);
  const equipment = useNetworkStore((s) => s.equipment);
  const olts = equipment.filter((e) => e.type === 'OLT');
  const [label, setLabel] = useState('');
  const [ports, setPorts] = useState('24');
  const [connector, setConnector] = useState('SC/APC');
  const [open, setOpen] = useState<{ panelId: string; number: number } | null>(null);
  const [feeder, setFeeder] = useState<FiberChoice>(emptyFiber);
  const [oltId, setOltId] = useState('');
  const [ponId, setPonId] = useState('');
  const [cord, setCord] = useState('');
  const panels = odf.odfPanels ?? [];
  const panel = panels.find((p) => p.id === open?.panelId);
  const port = panel?.ports.find((p) => p.number === open?.number);
  const olt = olts.find((o) => o.id === oltId);
  const local = cablesAt(cables, odf.id);

  return (
    <InspectorSection title="ODF panels and patches" icon={Network}>
      <div className="space-y-3 text-[13px]">
        {panels.length === 0 && <p className="text-xs text-slate-600">No panels recorded. Add each panel with the number of adapters it has.</p>}
        {panels.map((p) => (
          <div key={p.id} data-testid={`odf-panel-${p.label}`}>
            <p className="mb-1 text-xs font-semibold text-slate-600">
              {p.label}
              {p.connectorType ? ` · ${p.connectorType}` : ''} · {p.ports.filter((x) => x.patch).length} patched, {p.ports.filter((x) => x.feederCableId).length} with a feeder fiber
            </p>
            <div className="flex flex-wrap gap-1">
              {p.ports.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  data-testid={`odf-port-${x.number}`}
                  title={`${x.feederCableId ? `Back: ${x.feederCableId} fiber ${x.feederCore}` : 'No feeder fiber'}${x.patch ? `; front: ${x.patch.oltId} ${x.patch.ponPortId}` : ''}`}
                  onClick={() => {
                    setOpen({ panelId: p.id, number: x.number });
                    setFeeder(emptyFiber);
                    setOltId('');
                    setPonId('');
                  }}
                  className={`min-h-8 min-w-8 rounded border px-1 text-[11px] tabular-nums ${x.patch && x.feederCableId ? 'border-blue-300 bg-blue-50' : x.patch || x.feederCableId ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'} ${open?.panelId === p.id && open.number === x.number ? 'ring-2 ring-blue-500/40' : ''}`}
                >
                  {x.number}
                </button>
              ))}
            </div>
          </div>
        ))}
        {panel && port && (
          <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-2.5" data-testid="odf-port-detail">
            <p className="font-semibold">
              {panel.label}, port {port.number}
            </p>
            <p className="text-xs text-slate-700">
              Back (feeder fiber): {port.feederCableId ? `${cables.find((c) => c.id === port.feederCableId)?.name ?? port.feederCableId}, fiber ${port.feederCore}` : 'not recorded'}
              <br />
              Front (patch cord): {port.patch ? `${port.patch.oltId} ${port.patch.ponPortId}${port.patch.cordLabel ? `, cord ${port.patch.cordLabel}` : ''}` : 'no patch'}
            </p>
            {port.feederCableId ? (
              <Button size="sm" onClick={() => void setPortFeeder(odf.id, panel.id, port.number, null)}>
                Remove feeder fiber
              </Button>
            ) : (
              <>
                <FiberPicker label="Feeder fiber behind this port" value={feeder} onChange={setFeeder} cables={local} testId="odf-feeder" />
                <Button size="sm" variant="primary" data-testid="odf-feeder-save" disabled={!fiberOf(feeder)} onClick={() => void setPortFeeder(odf.id, panel.id, port.number, fiberOf(feeder))}>
                  Save feeder fiber
                </Button>
              </>
            )}
            {port.patch ? (
              <Button size="sm" data-testid="odf-unpatch" onClick={() => void setPortPatch(odf.id, panel.id, port.number, null)}>
                Remove patch
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Patch to OLT">
                  <Select data-testid="odf-patch-olt" value={oltId} onChange={(e) => { setOltId(e.target.value); setPonId(''); }}>
                    <option value="">Choose…</option>
                    {olts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="PON port">
                  <Select data-testid="odf-patch-pon" value={ponId} disabled={!olt} onChange={(e) => setPonId(e.target.value)}>
                    <option value="">Choose…</option>
                    {(olt?.ponPorts ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                        {p.vendorAddress ? ` (${p.vendorAddress})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cord label (optional)" className="col-span-2">
                  <Input data-testid="odf-patch-cord" value={cord} onChange={(e) => setCord(e.target.value)} />
                </Field>
                {olt && !olt.ponPorts?.length && <p className="col-span-2 text-[11px] text-amber-800">{olt.name} has no PON ports recorded. Set them up in Configure OLT.</p>}
                <Button size="sm" variant="primary" data-testid="odf-patch-save" className="col-span-2" disabled={!oltId || !ponId} onClick={() => void setPortPatch(odf.id, panel.id, port.number, { oltId, ponPortId: ponId, cordLabel: cord })}>
                  Save patch
                </Button>
              </div>
            )}
            {(port.history ?? []).length > 0 && (
              <details className="text-[11px] text-slate-600">
                <summary className="cursor-pointer">History</summary>
                <ul className="mt-1 space-y-0.5">
                  {port.history!.map((h, i) => (
                    <li key={i}>
                      {h.at.slice(0, 10)}: {h.details}
                      {h.by ? ` (${h.by})` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Panel name">
            <Input data-testid="odf-panel-label" value={label} placeholder="Panel A" onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Ports">
            <Input data-testid="odf-panel-ports" inputMode="numeric" value={ports} onChange={(e) => setPorts(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Connector">
            <Input value={connector} onChange={(e) => setConnector(e.target.value)} />
          </Field>
        </div>
        <Button
          size="sm"
          data-testid="odf-panel-add"
          disabled={!label.trim() || !ports}
          onClick={() => {
            void addPanel(odf.id, { label, portCount: Number(ports), connectorType: connector });
            setLabel('');
          }}
        >
          Add panel
        </Button>
      </div>
    </InspectorSection>
  );
}

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
                <Field label="ONU limit (vendor)">
                  <Input inputMode="numeric" value={maxOnu} onChange={(e) => setMaxOnu(e.target.value.replace(/\D/g, ''))} />
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

/* ------------------------------------------------------------------ */
/* Splitters                                                           */
/* ------------------------------------------------------------------ */

function SplitterCard({ splitter, host }: { splitter: Splitter; host: Equipment }) {
  const cables = useNetworkStore((s) => s.cables);
  const splitters = useNetworkStore((s) => s.splitters);
  const [input, setInput] = useState<FiberChoice>(emptyFiber);
  const [parent, setParent] = useState('');
  const [portOpen, setPortOpen] = useState<number | null>(null);
  const [out, setOut] = useState<FiberChoice>(emptyFiber);
  const [loss, setLoss] = useState(String(splitter.insertionLossDb));
  const [lossSource, setLossSource] = useState(splitter.lossSource ?? '');
  const local = cablesAt(cables, host.id);
  const n = splitterCapacity(splitter);
  const inp = splitter.inputPort;
  const inputText = inp.connectedSplitterId
    ? `output ${inp.connectedSplitterPort} of ${splitters.find((s) => s.id === inp.connectedSplitterId)?.name ?? inp.connectedSplitterId}`
    : inp.connectedCableId
      ? `${cables.find((c) => c.id === inp.connectedCableId)?.name ?? inp.connectedCableId}, ${inp.connectedCore ? `fiber ${inp.connectedCore}` : 'fiber not recorded'}`
      : 'not linked';
  const others = splitters.filter((s) => s.id !== splitter.id);

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
          <Button size="sm" variant="primary" data-testid="splitter-input-save" disabled={!fiberOf(input)} onClick={() => void setSplitterInput(splitter.id, fiberOf(input))}>
            Link input to this fiber
          </Button>
          {others.length > 0 && (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Select data-testid="splitter-parent" value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">Or fed by another splitter's output…</option>
                {others.flatMap((s) =>
                  s.outputPorts
                    .filter((p) => p.status === 'Available')
                    .map((p) => (
                      <option key={`${s.id}#${p.portNumber}`} value={`${s.id}#${p.portNumber}`}>
                        {s.name} output {p.portNumber}
                      </option>
                    )),
                )}
              </Select>
              <Button
                size="sm"
                disabled={!parent}
                onClick={() => {
                  const [splitterId, port] = parent.split('#');
                  void setSplitterInput(splitter.id, { splitterId, port: Number(port) });
                }}
              >
                Link
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button size="sm" onClick={() => void setSplitterInput(splitter.id, null)}>
          Unlink input
        </Button>
      )}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: n }, (_, i) => i + 1).map((num) => {
          const p = splitter.outputPorts.find((x) => x.portNumber === num);
          const child = splitters.find((s) => s.inputPort.connectedSplitterId === splitter.id && s.inputPort.connectedSplitterPort === num);
          const used = !!p?.connectedDropCableId || !!p?.connectedCustomerId || !!child;
          return (
            <button
              key={num}
              type="button"
              data-testid={`splitter-out-${num}`}
              title={p?.connectedDropCableId ? `${p.connectedDropCableId} fiber ${p.connectedCore ?? '?'}${p.connectedCustomerName ? `, ${p.connectedCustomerName}` : ''}` : child ? `Feeds ${child.name}` : 'Available'}
              onClick={() => {
                setPortOpen(num === portOpen ? null : num);
                setOut(emptyFiber);
              }}
              className={`min-h-8 min-w-8 rounded border px-1 text-[11px] tabular-nums ${used ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'} ${portOpen === num ? 'ring-2 ring-blue-500/40' : ''}`}
            >
              {p?.label?.includes('%') ? p.label.replace(' leg', '') : num}
            </button>
          );
        })}
      </div>
      {portOpen !== null && (
        <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-2" data-testid="splitter-out-detail">
          {(() => {
            const p = splitter.outputPorts.find((x) => x.portNumber === portOpen);
            if (p?.connectedDropCableId) {
              return (
                <>
                  <p className="text-xs">
                    Output {portOpen} → {cables.find((c) => c.id === p.connectedDropCableId)?.name ?? p.connectedDropCableId}, fiber {p.connectedCore ?? 'not recorded'}
                    {p.connectedCustomerName ? ` (${p.connectedCustomerName})` : ''}. Loss {p.lossDb ?? splitter.insertionLossDb} dB configured.
                  </p>
                  {!p.connectedCustomerId && (
                    <Button size="sm" onClick={() => void setSplitterOutput(splitter.id, portOpen, null)}>
                      Free this output
                    </Button>
                  )}
                </>
              );
            }
            return (
              <>
                <FiberPicker label={`Output ${portOpen} goes to`} value={out} onChange={setOut} cables={local} testId="splitter-out" />
                <Button size="sm" variant="primary" data-testid="splitter-out-save" disabled={!fiberOf(out)} onClick={() => void setSplitterOutput(splitter.id, portOpen, fiberOf(out))}>
                  Connect output
                </Button>
              </>
            );
          })()}
        </div>
      )}
      {!splitter.couplerRatio && (
        <div className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
          <Field label="Loss dB">
            <Input data-testid="splitter-loss" inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="From">
            <Input value={lossSource} placeholder="Datasheet" onChange={(e) => setLossSource(e.target.value)} />
          </Field>
          <Button size="sm" data-testid="splitter-loss-save" onClick={() => void saveSplitter(splitter.id, { insertionLossDb: Number(loss), lossSource })}>
            Save
          </Button>
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
              <Select data-testid="splitter-add-ratio" value={ratio} onChange={(e) => { setRatio(e.target.value as SplitterRatio); setCoupler(''); }}>
                <option value="">Choose…</option>
                {SPLITTER_RATIOS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Or unequal coupler">
              <Input data-testid="splitter-add-coupler" value={coupler} placeholder="90/10" onChange={(e) => { setCoupler(e.target.value); setRatio(''); }} />
            </Field>
          </div>
          <FiberPicker label="Fiber that feeds it (optional now)" value={input} onChange={setInput} cables={cablesAt(cables, host.id)} testId="splitter-add-input" />
          <Button
            size="sm"
            variant="primary"
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
