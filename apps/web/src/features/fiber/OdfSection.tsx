import { useState } from 'react';
import { Network } from 'lucide-react';

import {
  activeAssignment,
  type Cable,
  completeCores,
  describePatchCord,
  type Equipment,
  isCoreFaultStatus,
  isOdfPortFaulty,
  lastOdfPortLine,
  ODF_PORT_MARKS,
  type OdfPanel,
  type OdfPort,
  odfPortCounts,
  type OdfPortMark,
} from '@fibergis/shared';

import { Field, Input, Select } from '../../components/ui';
import { addPanel, setPortFeeder, setPortPatch } from '../../stores/fiberActions';
import { useNetworkStore } from '../../stores/networkStore';
import { markPort, savePortDetails } from '../../stores/plantActions';
import { InspectorSection } from '../inspector/sections';
import { FiberPicker } from './FiberPicker';
import { emptyFiber, type FiberChoice, fiberOf } from './fiberUi';
import { odfPortState } from './odfUi';

/** Common connector names, offered as suggestions only. Nothing is chosen for the person. */
const CONNECTORS = ['SC/APC', 'SC/UPC', 'LC/APC', 'LC/UPC', 'FC/UPC', 'ST/UPC'];

/** Phone-sized controls: at least 48 px tall on a phone, the usual size on a desk. */
const BIG = 'min-h-12 md:min-h-8';
const btn = `${BIG} rounded-lg border px-3 text-[14px] font-semibold md:text-[12px]`;
const BTN = {
  main: `${btn} border-blue-700 bg-blue-600 text-white hover:bg-blue-500 disabled:border-blue-300 disabled:bg-blue-300`,
  plain: `${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400`,
  warn: `${btn} border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300`,
};

const cablesAt = (cables: readonly Cable[], equipmentId: string) =>
  cables.filter((c) => c.cableCategory !== 'Coaxial' && (c.startEquipmentId === equipmentId || c.endEquipmentId === equipmentId));

const num = (text: string) => (text.trim() === '' ? undefined : Number(text));
const decimal = (text: string) => text.replace(/[^\d.]/g, '');

const markWhy = (port: OdfPort) => {
  const line = isOdfPortFaulty(port) ? lastOdfPortLine(port, ODF_PORT_MARKS.faulty) : port.status === 'reserved' ? lastOdfPortLine(port, ODF_PORT_MARKS.reserved) : undefined;
  return line ? `${line.details.replace(/^(Marked faulty|Reserved): /, '')} (${line.at.slice(0, 10)}${line.by ? `, ${line.by}` : ''})` : 'reason not recorded';
};

/**
 * Phase 9: an ODF's panels and adapters. Each adapter shows what is behind it (the feeder fiber and
 * its pigtail) and in front (the patch cord to a PON port), and may be marked faulty or reserved
 * with a reason. A faulty adapter takes a new patch only with a reason, which is kept.
 */
export function OdfSection({ odf }: { odf: Equipment }) {
  const [label, setLabel] = useState('');
  const [ports, setPorts] = useState('');
  const [connector, setConnector] = useState('');
  const [open, setOpen] = useState<{ panelId: string; number: number } | null>(null);
  const panels = odf.odfPanels ?? [];
  const panel = panels.find((p) => p.id === open?.panelId);
  const port = panel?.ports.find((p) => p.number === open?.number);
  const counts = odfPortCounts(odf);

  return (
    <InspectorSection title="ODF panels and patches" icon={Network} aside={counts.total || undefined}>
      <div className="space-y-3 text-[13px]">
        {panels.length === 0 ? (
          <p className="text-xs text-slate-600">No panels recorded. Add each panel with the number of adapters it has.</p>
        ) : (
          <p className="text-xs text-slate-700" data-testid="odf-counts">
            {counts.total} adapters: {counts.patched} patched, {counts.fed} with a fiber behind, {counts.faulty} faulty, {counts.reserved} reserved, {counts.free} free.
          </p>
        )}
        {panels.map((p) => (
          <div key={p.id} data-testid={`odf-panel-${p.label}`}>
            <p className="mb-1 text-xs font-semibold text-slate-600">
              {p.label}
              {p.connectorType ? ` · ${p.connectorType}` : ' · adapter type not recorded'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {p.ports.map((x) => {
                const state = odfPortState(x);
                const selected = open?.panelId === p.id && open.number === x.number;
                return (
                  <button
                    key={x.id}
                    type="button"
                    data-testid={`odf-port-${x.number}`}
                    aria-label={`Port ${x.number}: ${state.word}`}
                    title={`Port ${x.number}: ${state.word}`}
                    onClick={() => setOpen(selected ? null : { panelId: p.id, number: x.number })}
                    className={`flex min-h-12 min-w-12 flex-col items-center justify-center rounded-md border px-1 text-[12px] font-semibold tabular-nums md:min-h-9 md:min-w-9 md:text-[11px] ${state.tile} ${selected ? 'ring-2 ring-blue-500/60' : ''}`}
                  >
                    <span>{x.number}</span>
                    {state.mark && <span className="text-[10px] leading-none" aria-hidden>{state.mark}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {panels.length > 0 && <p className="text-[11px] text-slate-500">● patched with a fiber behind · ◐ only one side recorded · ✕ faulty · R reserved · blank free</p>}
        {panel && port && <PortDetail key={`${panel.id}/${port.number}`} odf={odf} panel={panel} port={port} />}
        <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-2.5">
          <p className="text-xs font-semibold text-slate-600">Add a panel</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Panel name">
              <Input data-testid="odf-panel-label" className={BIG} value={label} placeholder="Panel A" onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Adapters on it">
              <Input data-testid="odf-panel-ports" className={BIG} inputMode="numeric" value={ports} placeholder="24" onChange={(e) => setPorts(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Adapter type (optional)">
              <Input className={BIG} list="odf-connectors" value={connector} placeholder="SC/APC" onChange={(e) => setConnector(e.target.value)} />
            </Field>
          </div>
          <button
            type="button"
            data-testid="odf-panel-add"
            className={`${BTN.plain} w-full`}
            disabled={!label.trim() || !ports}
            onClick={() => {
              void addPanel(odf.id, { label, portCount: Number(ports), connectorType: connector });
              setLabel('');
            }}
          >
            Add panel
          </button>
        </div>
        <datalist id="odf-connectors">
          {CONNECTORS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
    </InspectorSection>
  );
}

function PortDetail({ odf, panel, port }: { odf: Equipment; panel: OdfPanel; port: OdfPort }) {
  const cables = useNetworkStore((s) => s.cables);
  const equipment = useNetworkStore((s) => s.equipment);
  const olts = equipment.filter((e) => e.type === 'OLT');
  const state = odfPortState(port);
  const faulty = isOdfPortFaulty(port);

  const [mark, setMark] = useState<OdfPortMark | null>(null);
  const [markReason, setMarkReason] = useState('');
  const [feeder, setFeeder] = useState<FiberChoice>(emptyFiber);
  const [feederReason, setFeederReason] = useState('');
  const [oltId, setOltId] = useState('');
  const [ponId, setPonId] = useState('');
  const [cord, setCord] = useState({ label: port.patch?.cordLabel ?? '', odfEnd: port.patch?.cordConnectorOdf ?? '', ponEnd: port.patch?.cordConnectorPon ?? '', length: port.patch?.cordLengthMeters?.toString() ?? '' });
  const [override, setOverride] = useState('');
  const [editCord, setEditCord] = useState(false);
  const [pig, setPig] = useState({ connector: port.pigtail?.connectorType ?? '', length: port.pigtail?.lengthMeters?.toString() ?? '', label: port.pigtail?.label ?? '' });
  const [editPig, setEditPig] = useState(false);

  const olt = olts.find((o) => o.id === oltId);
  const feederCable = cables.find((c) => c.id === port.feederCableId);
  const feederCore = feederCable ? completeCores(feederCable).find((c) => c.coreNumber === port.feederCore) : undefined;
  const feederUse = activeAssignment(feederCore);
  const chosen = fiberOf(feeder);
  const chosenCable = chosen ? cables.find((c) => c.id === chosen.cableId) : undefined;
  const chosenCore = chosenCable ? completeCores(chosenCable).find((c) => c.coreNumber === chosen!.core) : undefined;
  const chosenBad = isCoreFaultStatus(chosenCore?.status);
  const cordText = port.patch ? describePatchCord(port.patch) : '';

  const doMark = async () => {
    if (!mark) return;
    if (await markPort(odf.id, panel.id, port.number, mark, markReason)) {
      setMark(null);
      setMarkReason('');
    }
  };

  const markLabels: Record<OdfPortMark, { ask: string; button: string; hint: string }> = {
    faulty: { ask: 'What is wrong?', button: 'Mark faulty', hint: 'Adapter cracked, high loss on test…' },
    repaired: { ask: 'What was done?', button: 'Mark repaired', hint: 'Adapter replaced, cleaned and tested…' },
    reserved: { ask: 'What is it kept for?', button: 'Reserve', hint: 'OLT-2 PON 5, next week…' },
    end_reservation: { ask: 'Why (optional)', button: 'End reservation', hint: 'Not needed any more…' },
  };

  return (
    <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/40 p-2.5" data-testid="odf-port-detail">
      <div>
        <p className="font-semibold">
          {panel.label}, port {port.number}
          {port.label ? ` (${port.label})` : ''}
        </p>
        <p className="text-xs text-slate-700" data-testid="odf-port-state">
          {state.mark ? `${state.mark} ` : ''}
          {state.word}
          {faulty || port.status === 'reserved' ? `: ${markWhy(port)}` : ''}
        </p>
        <p className="text-[11px] text-slate-500">Adapter: {port.connectorType ?? panel.connectorType ?? 'type not recorded'}</p>
      </div>

      {/* Faulty and reserved marks, with a reason kept in the history. */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {!faulty && (
            <button type="button" className={BTN.warn} data-testid="odf-mark-faulty" onClick={() => setMark('faulty')}>
              Mark faulty
            </button>
          )}
          {faulty && (
            <button type="button" className={BTN.plain} data-testid="odf-mark-repaired" onClick={() => setMark('repaired')}>
              Mark repaired
            </button>
          )}
          {!faulty && port.status !== 'reserved' && !port.patch && (
            <button type="button" className={BTN.plain} data-testid="odf-mark-reserved" onClick={() => setMark('reserved')}>
              Reserve
            </button>
          )}
          {port.status === 'reserved' && (
            <button type="button" className={BTN.plain} data-testid="odf-end-reservation" onClick={() => setMark('end_reservation')}>
              End reservation
            </button>
          )}
        </div>
        {mark && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
            <Field label={markLabels[mark].ask}>
              <Input data-testid="odf-mark-reason" className={BIG} value={markReason} placeholder={markLabels[mark].hint} maxLength={300} onChange={(e) => setMarkReason(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={BTN.plain} onClick={() => setMark(null)}>
                Cancel
              </button>
              <button type="button" className={mark === 'faulty' ? `${btn} border-red-700 bg-red-600 text-white disabled:bg-red-300` : BTN.main} data-testid="odf-mark-save" disabled={mark !== 'end_reservation' && !markReason.trim()} onClick={() => void doMark()}>
                {markLabels[mark].button}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Back: the feeder fiber and its pigtail. */}
      <div className="space-y-2 border-t border-blue-100 pt-2">
        <p className="text-xs font-semibold text-slate-600">Back: fiber from the cable</p>
        <p className="text-xs text-slate-700" data-testid="odf-feeder-text">
          {port.feederCableId ? `${feederCable?.name ?? `${port.feederCableId} (not on record)`}, fiber ${port.feederCore}` : 'Not recorded'}
          {port.feederCableId && (
            <span className="block text-[11px] text-slate-600">
              {feederUse ? `Marked in use for ${feederUse.use}.` : 'This fiber is not marked in use. Save the feeder fiber again to mark it.'}
            </span>
          )}
        </p>
        {port.feederCableId ? (
          <button type="button" className={BTN.plain} onClick={() => void setPortFeeder(odf.id, panel.id, port.number, null)}>
            Remove feeder fiber
          </button>
        ) : (
          <>
            <FiberPicker label="Fiber behind this port" value={feeder} onChange={setFeeder} cables={cablesAt(cables, odf.id)} testId="odf-feeder" />
            {chosenBad && (
              <Field label={`This fiber is marked ${chosenCore!.status.toLowerCase()}. Why use it anyway?`}>
                <Input data-testid="odf-feeder-override" className={BIG} value={feederReason} maxLength={300} onChange={(e) => setFeederReason(e.target.value)} />
              </Field>
            )}
            <button
              type="button"
              className={`${BTN.main} w-full`}
              data-testid="odf-feeder-save"
              disabled={!chosen || (chosenBad && !feederReason.trim())}
              onClick={() => void setPortFeeder(odf.id, panel.id, port.number, chosen ? { ...chosen, ...(chosenBad ? { overrideReason: feederReason } : {}) } : null)}
            >
              Save feeder fiber
            </button>
          </>
        )}
        <p className="text-xs text-slate-700" data-testid="odf-pigtail-text">
          Pigtail:{' '}
          {port.pigtail
            ? [port.pigtail.connectorType ?? 'connector not recorded', port.pigtail.lengthMeters !== undefined ? `${port.pigtail.lengthMeters} m` : 'length not recorded', port.pigtail.label].filter(Boolean).join(', ')
            : 'Not recorded'}
        </p>
        {editPig ? (
          <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="Connector">
                <Input data-testid="odf-pigtail-connector" className={BIG} list="odf-connectors" value={pig.connector} onChange={(e) => setPig({ ...pig, connector: e.target.value })} />
              </Field>
              <Field label="Length (m)">
                <Input className={BIG} inputMode="decimal" value={pig.length} onChange={(e) => setPig({ ...pig, length: decimal(e.target.value) })} />
              </Field>
              <Field label="Label">
                <Input className={BIG} value={pig.label} onChange={(e) => setPig({ ...pig, label: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={BTN.plain} onClick={() => setEditPig(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={BTN.main}
                data-testid="odf-pigtail-save"
                onClick={async () => {
                  const empty = !pig.connector.trim() && !pig.length && !pig.label.trim();
                  const saved = await savePortDetails(odf.id, panel.id, port.number, { pigtail: empty ? null : { connectorType: pig.connector, lengthMeters: num(pig.length), label: pig.label } });
                  if (saved) setEditPig(false);
                }}
              >
                Save pigtail
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={BTN.plain} data-testid="odf-pigtail-edit" onClick={() => setEditPig(true)}>
            {port.pigtail ? 'Change pigtail' : 'Record pigtail'}
          </button>
        )}
      </div>

      {/* Front: the patch cord to a PON port. */}
      <div className="space-y-2 border-t border-blue-100 pt-2">
        <p className="text-xs font-semibold text-slate-600">Front: patch cord</p>
        <p className="text-xs text-slate-700" data-testid="odf-patch-text">
          {port.patch ? `To ${port.patch.oltId} ${port.patch.ponPortId}${cordText ? `, ${cordText}` : ''}` : 'No patch'}
          {port.patch?.override && <span className="block text-[11px] text-red-800">Patched while marked faulty: {port.patch.override.reason}</span>}
        </p>
        {port.patch ? (
          <>
            {editCord ? (
              <CordFields cord={cord} onChange={setCord}>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={BTN.plain} onClick={() => setEditCord(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={BTN.main}
                    data-testid="odf-cord-save"
                    onClick={async () => {
                      const saved = await savePortDetails(odf.id, panel.id, port.number, {
                        cord: { cordLabel: cord.label, cordConnectorOdf: cord.odfEnd, cordConnectorPon: cord.ponEnd, cordLengthMeters: num(cord.length) },
                      });
                      if (saved) setEditCord(false);
                    }}
                  >
                    Save cord
                  </button>
                </div>
              </CordFields>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN.plain} data-testid="odf-cord-edit" onClick={() => setEditCord(true)}>
                  Change cord details
                </button>
                <button type="button" className={BTN.warn} data-testid="odf-unpatch" onClick={() => void setPortPatch(odf.id, panel.id, port.number, null)}>
                  Remove patch
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Patch to OLT">
                <Select data-testid="odf-patch-olt" className={BIG} value={oltId} onChange={(e) => { setOltId(e.target.value); setPonId(''); }}>
                  <option value="">Choose…</option>
                  {olts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="PON port">
                <Select data-testid="odf-patch-pon" className={BIG} value={ponId} disabled={!olt} onChange={(e) => setPonId(e.target.value)}>
                  <option value="">Choose…</option>
                  {(olt?.ponPorts ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                      {p.vendorAddress ? ` (${p.vendorAddress})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {olt && !olt.ponPorts?.length && <p className="text-[11px] text-amber-800">{olt.name} has no PON ports recorded. Set them up in Configure OLT.</p>}
            <CordFields cord={cord} onChange={setCord} />
            {faulty && (
              <Field label="This port is marked faulty. Why patch it anyway?">
                <Input data-testid="odf-patch-override" className={BIG} value={override} maxLength={300} onChange={(e) => setOverride(e.target.value)} />
              </Field>
            )}
            <button
              type="button"
              className={`${BTN.main} w-full`}
              data-testid="odf-patch-save"
              disabled={!oltId || !ponId || (faulty && !override.trim())}
              onClick={() =>
                void setPortPatch(odf.id, panel.id, port.number, {
                  oltId,
                  ponPortId: ponId,
                  cordLabel: cord.label,
                  cordConnectorOdf: cord.odfEnd,
                  cordConnectorPon: cord.ponEnd,
                  cordLengthMeters: num(cord.length),
                  ...(faulty ? { overrideReason: override } : {}),
                })
              }
            >
              Save patch
            </button>
          </div>
        )}
      </div>

      {(port.history ?? []).length > 0 && (
        <details className="text-[11px] text-slate-600">
          <summary className={`${BIG} flex cursor-pointer items-center`}>History ({port.history!.length})</summary>
          <ul className="mt-1 space-y-0.5" data-testid="odf-port-history">
            {[...port.history!].reverse().map((h, i) => (
              <li key={i}>
                {h.at.slice(0, 10)}: {h.details}
                {h.by ? ` (${h.by})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type CordDraft = { label: string; odfEnd: string; ponEnd: string; length: string };

function CordFields({ cord, onChange, children }: { cord: CordDraft; onChange: (next: CordDraft) => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
      <p className="text-[11px] text-slate-500">The cord, as written on it. Leave empty what you do not know.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Cord label">
          <Input data-testid="odf-patch-cord" className={BIG} value={cord.label} onChange={(e) => onChange({ ...cord, label: e.target.value })} />
        </Field>
        <Field label="Length (m)">
          <Input data-testid="odf-cord-length" className={BIG} inputMode="decimal" value={cord.length} onChange={(e) => onChange({ ...cord, length: decimal(e.target.value) })} />
        </Field>
        <Field label="End at this port">
          <Input data-testid="odf-cord-odf-end" className={BIG} list="odf-connectors" value={cord.odfEnd} onChange={(e) => onChange({ ...cord, odfEnd: e.target.value })} />
        </Field>
        <Field label="End at the OLT">
          <Input data-testid="odf-cord-pon-end" className={BIG} list="odf-connectors" value={cord.ponEnd} onChange={(e) => onChange({ ...cord, ponEnd: e.target.value })} />
        </Field>
      </div>
      {children}
    </div>
  );
}
