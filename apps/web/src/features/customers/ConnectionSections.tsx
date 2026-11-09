import { useMemo, useState } from 'react';
import { Activity, Building2, HardDrive, History, Layers, Plug, Unplug } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import {
  buildingUnitPaths,
  type Customer,
  customersOnOnt,
  isLiveOnt,
  isLiveService,
  ONT_ARRANGEMENT_LABELS,
  ONT_ARRANGEMENTS,
  ONT_STATUS_LABELS,
  ONT_STATUS_SOURCE_LABELS,
  type OntArrangement,
  ontOfCustomer,
  reconcileCustomerRx,
  SERVICE_KIND_LABELS,
  SERVICE_KINDS,
  SERVICE_STATUS_LABELS,
  type ServiceKind,
  splitterCapacity,
  withDeviceRx,
} from '@fibergis/shared';

import { Badge, Button, Field, Input, Select } from '../../components/ui';
import {
  changeCustomerOnt,
  disconnect,
  endCustomerService,
  makeOntRecord,
  moveTo,
  placeInUnit,
  saveCustomerService,
  saveOnt,
  swapCustomerOnt,
} from '../../stores/connectionActions';
import { getNetworkData, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { formatDateTime } from '../inspector/format';
import { InspectorSection } from '../inspector/sections';

const toneFor = (status: 'ok' | 'gap' | 'warning') => (status === 'gap' ? 'text-red-700' : status === 'warning' ? 'text-amber-700' : 'text-slate-800');

/* ------------------------------------------------------------------ */
/* Disconnected notice and reconnect                                   */
/* ------------------------------------------------------------------ */

export function DisconnectedNotice({ customer }: { customer: Customer }) {
  const [open, setOpen] = useState(false);
  if (customer.status !== 'Disconnected') return null;
  const last = customer.connectionHistory?.at(-1);
  return (
    <div role="status" data-testid="cust-disconnected" className="mx-4 mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-800">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Unplug size={14} className="shrink-0 text-slate-500" />
        Disconnected{customer.disconnectedAt ? ` on ${formatDateTime(customer.disconnectedAt)}` : ''}
      </p>
      <p className="mt-1">Reason: {customer.disconnectReason ?? 'not recorded'}</p>
      {last && (
        <p className="mt-1 text-slate-600">
          Was on {last.splitterId ? `output ${last.splitterOutputPort ?? '?'} of ${last.splitterId}` : 'no splitter output'}
          {last.dropCableId ? `, fiber ${last.fiberCore ?? '?'} of ${last.dropCableId}` : ''}
          {last.ontSerialNumber ? `, ONT ${last.ontSerialNumber}` : ''}. Those were released and are kept in the history.
        </p>
      )}
      <Button size="sm" className="mt-2" icon={Plug} data-testid="cust-reconnect-open" onClick={() => setOpen((v) => !v)}>
        Reconnect
      </Button>
      {open && <MoveForm customer={customer} reconnect onDone={() => setOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Move and disconnect                                                 */
/* ------------------------------------------------------------------ */

function MoveForm({ customer, reconnect = false, onDone }: { customer: Customer; reconnect?: boolean; onDone: () => void }) {
  const { splitters, equipment, cables } = useNetworkStore(useShallow((s) => ({ splitters: s.splitters, equipment: s.equipment, cables: s.cables })));
  const last = customer.connectionHistory?.at(-1);
  const fromBox = customer.terminalBoxId || last?.terminalBoxId || '';
  const [splitterId, setSplitterId] = useState(customer.splitterId || last?.splitterId || '');
  const [port, setPort] = useState('');
  const [dropMode, setDropMode] = useState<'same' | 'other'>('same');
  const [dropCable, setDropCable] = useState('');
  const [dropCore, setDropCore] = useState('');
  const [reason, setReason] = useState('');
  const splitter = splitters.find((s) => s.id === splitterId);
  const boxName = (id: string) => equipment.find((e) => e.id === id)?.name ?? id;
  const sameBox = !!splitter && splitter.terminalBoxId === fromBox;
  const hasDrop = !!(customer.dropCableId || last?.dropCableId);
  const useOther = dropMode === 'other' || !sameBox || !hasDrop;
  const boxCables = splitter ? cables.filter((c) => c.startEquipmentId === splitter.terminalBoxId || c.endEquipmentId === splitter.terminalBoxId) : [];
  const outputs = splitter
    ? Array.from({ length: splitterCapacity(splitter) }, (_, i) => {
        const n = i + 1;
        const record = splitter.outputPorts.find((p) => p.portNumber === n);
        const mine = record?.connectedCustomerId === customer.id;
        const usedBy = record?.connectedCustomerId && !mine ? (record.connectedCustomerName ?? record.connectedCustomerId) : record?.connectedDropCableId && !mine ? `fiber of ${record.connectedDropCableId}` : undefined;
        const blocked = usedBy ?? (record?.status === 'Faulty' ? 'faulty' : record?.status === 'Reserved' ? 'reserved' : record?.status === 'Occupied' && !mine ? 'in use' : undefined);
        return { n, label: `Output ${n}${mine ? ' (now)' : ''}${blocked ? ` · used: ${blocked}` : ''}`, disabled: !!blocked || mine };
      })
    : [];
  const save = async () => {
    const drop = useOther ? { cableId: dropCable, core: Number(dropCore) } : undefined;
    const done = await moveTo(customer.id, { splitterId, port: Number(port), ...(drop ? { drop } : {}) }, reason);
    if (done) onDone();
  };
  return (
    <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-white p-2" data-testid="cust-move-form">
      <Field label="Splitter">
        <Select data-testid="cust-move-splitter" value={splitterId} onChange={(e) => { setSplitterId(e.target.value); setPort(''); }}>
          <option value="">Choose</option>
          {splitters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.ratio} in {boxName(s.terminalBoxId)}
            </option>
          ))}
        </Select>
      </Field>
      {splitter && (
        <Field label="Output" hint="Outputs in use are shown but cannot be chosen.">
          <Select data-testid="cust-move-port" value={port} onChange={(e) => setPort(e.target.value)}>
            <option value="">Choose</option>
            {outputs.map((o) => (
              <option key={o.n} value={o.n} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {splitter && sameBox && hasDrop && (
        <Field label="Drop fiber">
          <Select data-testid="cust-move-drop-mode" value={dropMode} onChange={(e) => setDropMode(e.target.value as 'same' | 'other')}>
            <option value="same">Same drop fiber, plugged into the new output</option>
            <option value="other">Another fiber</option>
          </Select>
        </Field>
      )}
      {splitter && useOther && (
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label="Cable from the box" hint={!sameBox ? 'This splitter is in another box, so choose the fiber that runs from it to the customer.' : undefined}>
            <Select data-testid="cust-move-drop-cable" value={dropCable} onChange={(e) => setDropCable(e.target.value)}>
              <option value="">Choose</option>
              {boxCables.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.fiberCount}F)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fiber">
            <Input data-testid="cust-move-drop-core" inputMode="numeric" value={dropCore} onChange={(e) => setDropCore(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      )}
      <Field label="Why" required>
        <Input data-testid="cust-move-reason" value={reason} placeholder={reconnect ? 'Such as "Paid again"' : 'Such as "Output 2 faulty"'} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" data-testid="cust-move-save" disabled={!splitterId || !port || !reason.trim() || (useOther && (!dropCable || !dropCore))} onClick={() => void save()}>
          {reconnect ? 'Reconnect here' : 'Move here'}
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ConnectionSection({ customer }: { customer: Customer }) {
  const [mode, setMode] = useState<'none' | 'move' | 'disconnect'>('none');
  const [reason, setReason] = useState('');
  const ont = useNetworkStore((s) => (customer.ontId ? s.onts.find((o) => o.id === customer.ontId) : undefined));
  if (customer.status === 'Disconnected') return null;
  const releases = [
    customer.dropCableId && customer.fiberCore ? `fiber ${customer.fiberCore} of ${customer.dropCableId}` : undefined,
    customer.splitterId ? `output ${customer.splitterOutputPort} of ${customer.splitterId}` : undefined,
    ont ? `the link to ONT ${ont.serialNumber ?? ont.id}` : undefined,
  ].filter(Boolean);
  return (
    <InspectorSection title="Connection" icon={Plug}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-testid="cust-move-open" onClick={() => setMode(mode === 'move' ? 'none' : 'move')}>
          Move to another output
        </Button>
        <Button size="sm" variant="danger" icon={Unplug} data-testid="cust-disconnect-open" onClick={() => setMode(mode === 'disconnect' ? 'none' : 'disconnect')}>
          Disconnect
        </Button>
      </div>
      {mode === 'move' && <MoveForm customer={customer} onDone={() => setMode('none')} />}
      {mode === 'disconnect' && (
        <div className="mt-3 space-y-2 rounded-md border border-red-200 bg-red-50/40 p-2 text-xs">
          <p>
            This frees {releases.length ? releases.join(', ') : 'nothing recorded on a fiber'} and ends the customer's services. Nothing is deleted: the old connection stays in the history.
          </p>
          <Field label="Why" required>
            <Input data-testid="cust-disconnect-reason" value={reason} placeholder='Such as "Moved away"' onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              data-testid="cust-disconnect-confirm"
              disabled={!reason.trim()}
              onClick={() => void disconnect(customer.id, reason).then((done) => done && setMode('none'))}
            >
              Disconnect {customer.name}
            </Button>
            <Button size="sm" onClick={() => setMode('none')}>
              Keep connected
            </Button>
          </div>
        </div>
      )}
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* ONT                                                                 */
/* ------------------------------------------------------------------ */

export function OntSection({ customer }: { customer: Customer }) {
  const onts = useNetworkStore((s) => s.onts);
  const customers = useNetworkStore((s) => s.customers);
  const view = ontOfCustomer({ onts }, customer);
  const record = view.record;
  const hasMonitoringRows = useNetworkStore((s) => !!record && s.onuStatuses.some((r) => r.ontId === record.id));
  const [mode, setMode] = useState<'none' | 'edit' | 'swap' | 'change'>('none');
  const [serial, setSerial] = useState('');
  const [vendor, setVendor] = useState('');
  const [model, setModel] = useState('');
  const [address, setAddress] = useState('');
  const [arrangement, setArrangement] = useState<OntArrangement>('single');
  const [reason, setReason] = useState('');
  const [otherId, setOtherId] = useState('');
  const others = onts.filter((o) => isLiveOnt(o) && o.id !== record?.id && (o.arrangement === 'shared' || customersOnOnt({ customers }, o.id).length === 0));
  const open = (next: typeof mode) => {
    setMode(mode === next ? 'none' : next);
    setSerial(next === 'edit' ? (record?.serialNumber ?? '') : '');
    setVendor(next === 'edit' ? (record?.vendor ?? '') : '');
    setModel(next === 'edit' ? (record?.model ?? '') : '');
    setAddress(next === 'edit' ? (record?.onuAddress ?? '') : '');
    setArrangement(record?.arrangement ?? 'single');
    setReason('');
  };
  if (customer.status === 'Disconnected') return null;
  return (
    <InspectorSection title="ONT" icon={HardDrive} aside={record ? <Badge tone={record.status === 'faulty' ? 'red' : 'neutral'}>{ONT_STATUS_LABELS[record.status]}</Badge> : undefined}>
      <div className="space-y-2 text-[13px]" data-testid="ont-section">
        <p>
          <span className="font-semibold" data-testid="ont-serial">{view.serialNumber ? `Serial ${view.serialNumber}` : 'Serial not recorded'}</span>
          {record && <span className="text-slate-600"> · {[record.vendor, record.model].filter(Boolean).join(' ') || 'make and model not recorded'}</span>}
        </p>
        {record ? (
          <div className="text-xs text-slate-600">
            <p>{ONT_STATUS_SOURCE_LABELS[record.statusSource]}{record.statusAt ? `, ${formatDateTime(record.statusAt)}` : ''}.{' '}
              {hasMonitoringRows ? 'This is the install state. Online status from the OLT is under Live status.' : 'No live connection to the OLT, so online status is not known.'}
            </p>
            <p>OLT address for this ONT: {record.onuAddress ?? 'not recorded'}{record.ponPortId ? ` on ${record.oltId} ${record.ponPortId}` : ''}</p>
            <p>Plugged into: {record.splitterId ? `output ${record.splitterOutputPort ?? '?'} of ${record.splitterId}` : 'not recorded'}{record.dropCableId ? `, fiber ${record.dropCore ?? '?'} of ${record.dropCableId}` : ''}</p>
            <p>{ONT_ARRANGEMENT_LABELS[record.arrangement]}</p>
          </div>
        ) : (
          <p className="text-xs text-slate-600" data-testid="ont-legacy-note">
            {view.source === 'customer_record' ? 'This serial is written on the customer record only. Make an ONT record to keep its history when it is swapped or moved.' : 'No ONT is recorded for this customer.'}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!record && (
            <Button size="sm" variant="primary" data-testid="ont-make-record" onClick={() => void makeOntRecord(customer.id)}>
              Make ONT record
            </Button>
          )}
          {record && (
            <Button size="sm" data-testid="ont-edit" onClick={() => open('edit')}>
              Edit details
            </Button>
          )}
          <Button size="sm" data-testid="ont-swap" onClick={() => open('swap')}>
            Swap ONT
          </Button>
          {others.length > 0 && (
            <Button size="sm" data-testid="ont-change" onClick={() => open('change')}>
              Use another ONT
            </Button>
          )}
        </div>
        {(mode === 'edit' || mode === 'swap') && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
            {mode === 'swap' && <p className="text-xs text-slate-600">The old ONT is kept as a removed record with the reason. Type the new serial exactly as on its label.</p>}
            <Field label={mode === 'swap' ? 'New serial' : 'Serial'}>
              <Input data-testid="ont-form-serial" value={serial} onChange={(e) => setSerial(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Vendor">
                <Input data-testid="ont-form-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
              </Field>
              <Field label="Model">
                <Input data-testid="ont-form-model" value={model} onChange={(e) => setModel(e.target.value)} />
              </Field>
            </div>
            {mode === 'edit' && (
              <>
                <Field label="OLT address for this ONT" hint="As the OLT writes it, such as gpon-onu_1/2/3:5. Nothing is converted.">
                  <Input data-testid="ont-form-address" value={address} onChange={(e) => setAddress(e.target.value)} />
                </Field>
                <Field label="Serves">
                  <Select data-testid="ont-form-arrangement" value={arrangement} onChange={(e) => setArrangement(e.target.value as OntArrangement)}>
                    {ONT_ARRANGEMENTS.map((a) => (
                      <option key={a} value={a}>
                        {ONT_ARRANGEMENT_LABELS[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            {mode === 'swap' && (
              <Field label="Why" required>
                <Input data-testid="ont-form-reason" value={reason} placeholder='Such as "No light, power LED off"' onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            <Button
              size="sm"
              variant="primary"
              data-testid="ont-form-save"
              disabled={mode === 'swap' && !reason.trim()}
              onClick={() =>
                void (mode === 'edit' && record
                  ? saveOnt(record.id, { serialNumber: serial, vendor, model, onuAddress: address, arrangement })
                  : swapCustomerOnt(customer.id, { serialNumber: serial, vendor, model }, reason)
                ).then((done) => done && setMode('none'))
              }
            >
              {mode === 'swap' ? 'Swap ONT' : 'Save'}
            </Button>
          </div>
        )}
        {mode === 'change' && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
            <Field label="ONT" hint="ONTs in stock, and shared (MDU) ONTs.">
              <Select data-testid="ont-change-select" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                <option value="">Choose</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.serialNumber ?? o.id} · {ONT_STATUS_LABELS[o.status]} · {ONT_ARRANGEMENT_LABELS[o.arrangement]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Why" required>
              <Input data-testid="ont-change-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button size="sm" variant="primary" data-testid="ont-change-save" disabled={!otherId || !reason.trim()} onClick={() => void changeCustomerOnt(customer.id, otherId, reason).then((done) => done && setMode('none'))}>
              Use this ONT
            </Button>
          </div>
        )}
        {record?.history?.length ? (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">ONT history ({record.history.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {record.history.slice(-8).map((h, i) => (
                <li key={i}>
                  {formatDateTime(h.at)} · {h.details}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export function ServicesSection({ customer }: { customer: Customer }) {
  const all = useNetworkStore((s) => s.services);
  const services = all.filter((s) => s.customerId === customer.id);
  const live = services.filter(isLiveService);
  const ended = services.length - live.length;
  const [kind, setKind] = useState<ServiceKind>('internet');
  const [plan, setPlan] = useState('');
  const [ontPort, setOntPort] = useState('');
  const [ontChoice, setOntChoice] = useState<'customer' | 'none'>('customer');
  const [ending, setEnding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const disconnected = customer.status === 'Disconnected';
  return (
    <InspectorSection title="Services" icon={Layers} aside={`${live.length}`}>
      <div className="space-y-2 text-[13px]" data-testid="svc-section">
        {live.length === 0 && <p className="text-xs text-slate-600">No service recorded.</p>}
        {live.map((s) => (
          <div key={s.id} className="rounded-md border border-slate-200 bg-white p-2" data-testid={`svc-${s.kind}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{SERVICE_KIND_LABELS[s.kind]}</span>
              <Badge tone={s.status === 'active' ? 'green' : 'neutral'}>{SERVICE_STATUS_LABELS[s.status]}</Badge>
            </div>
            <p className="text-xs text-slate-600">
              Plan: {s.planName ? `"${s.planName}" as written` : 'not recorded'}
              {s.ontId ? ` · ONT ${s.ontId}` : ''}
              {s.ontPort ? ` · port ${s.ontPort}` : ''}
            </p>
            {ending === s.id ? (
              <div className="mt-1 flex flex-wrap items-end gap-2">
                <Input data-testid={`svc-end-reason-${s.id}`} className="max-w-[14rem]" placeholder="Why it ends" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button size="sm" variant="danger" data-testid={`svc-end-confirm-${s.id}`} disabled={!reason.trim()} onClick={() => void endCustomerService(s.id, reason).then(() => setEnding(null))}>
                  End service
                </Button>
              </div>
            ) : (
              <Button size="xs" className="mt-1" data-testid={`svc-end-${s.id}`} onClick={() => { setEnding(s.id); setReason(''); }}>
                End
              </Button>
            )}
          </div>
        ))}
        {live.length > 1 && customer.dropCableId && (
          <p className="text-xs text-slate-600" data-testid="svc-shared-fiber">
            {live.map((s) => SERVICE_KIND_LABELS[s.kind]).join(' and ')} share fiber {customer.fiberCore} of {customer.dropCableId}.
          </p>
        )}
        {ended > 0 && <p className="text-xs text-slate-500">{ended} ended service(s) kept as history.</p>}
        {!disconnected && (
          <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Service">
                <Select data-testid="svc-kind" value={kind} onChange={(e) => setKind(e.target.value as ServiceKind)}>
                  {SERVICE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SERVICE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Plan as written" hint="Optional. No plan or price is filled in.">
                <Input data-testid="svc-plan" value={plan} onChange={(e) => setPlan(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="On ONT">
                <Select data-testid="svc-ont" value={ontChoice} onChange={(e) => setOntChoice(e.target.value as 'customer' | 'none')}>
                  {customer.ontId && <option value="customer">This customer's ONT ({customer.ontSerialNumber || customer.ontId})</option>}
                  <option value="none">Not recorded</option>
                </Select>
              </Field>
              <Field label="ONT port" hint="As written, such as LAN 1 or CATV.">
                <Input data-testid="svc-ont-port" value={ontPort} onChange={(e) => setOntPort(e.target.value)} />
              </Field>
            </div>
            <Button
              size="sm"
              variant="primary"
              data-testid="svc-add"
              onClick={() =>
                void saveCustomerService({ customerId: customer.id, kind, planName: plan, ontPort, ...(ontChoice === 'customer' && customer.ontId ? { ontId: customer.ontId } : {}) }).then((done) => {
                  if (done) {
                    setPlan('');
                    setOntPort('');
                  }
                })
              }
            >
              Add service
            </Button>
          </div>
        )}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Building and unit                                                   */
/* ------------------------------------------------------------------ */

export function CustomerPlaceSection({ customer }: { customer: Customer }) {
  const buildings = useNetworkStore((s) => s.buildings);
  const network = useNetworkStore(useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers, onts: s.onts })));
  const optical = useNetworkStore(selectOpticalSettings);
  const [buildingId, setBuildingId] = useState(customer.buildingId ?? '');
  const [unitId, setUnitId] = useState(customer.unitId ?? '');
  const current = buildings.find((b) => b.id === customer.buildingId);
  const chosen = buildings.find((b) => b.id === buildingId);
  const path = useMemo(
    () => (current ? buildingUnitPaths(current, { ...network, buildings }, { settings: optical }).find((p) => p.customer?.id === customer.id) : undefined),
    [current, network, buildings, optical, customer.id],
  );
  if (buildings.length === 0 && !customer.buildingId) return null;
  return (
    <InspectorSection title="Building and unit" icon={Building2}>
      <div className="space-y-2 text-[13px]" data-testid="cust-place">
        <p>{current ? `${current.name}${customer.flatNumber ? `, unit ${customer.flatNumber}` : ''}` : 'Not recorded in a building.'}</p>
        {path && (
          <ol className="space-y-0.5 text-xs" data-testid="cust-unit-path">
            {path.steps.map((s, i) => (
              <li key={i} className={toneFor(s.status)}>
                {s.status === 'gap' ? 'Missing: ' : ''}
                {s.label}
                {s.detail ? <span className="text-slate-500"> · {s.detail}</span> : null}
              </li>
            ))}
          </ol>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Building">
            <Select data-testid="cust-building" value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setUnitId(''); }}>
              <option value="">None</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit">
            <Select data-testid="cust-unit" value={unitId} disabled={!chosen} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Not recorded</option>
              {chosen?.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                  {u.floor ? ` (floor ${u.floor})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button size="sm" data-testid="cust-place-save" onClick={() => void placeInUnit(customer.id, buildingId ? { buildingId, ...(unitId ? { unitId } : {}) } : null)}>
          Save place
        </Button>
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* Reading check                                                       */
/* ------------------------------------------------------------------ */

export function RxCheckSection({ customer }: { customer: Customer }) {
  const optical = useNetworkStore(selectOpticalSettings);
  // Recomputed with the inspector: the check is cheap for one customer.
  // Phase 7: the newest real device reading (never TEST) is compared with the prediction.
  const onuReadings = useNetworkStore((s) => s.onuReadings);
  const result = reconcileCustomerRx(withDeviceRx(customer, { onuReadings }), getNetworkData(), optical);
  if (customer.status === 'Disconnected') return null;
  return (
    <InspectorSection title="Reading against the records" icon={Activity}>
      <div data-testid="rx-check" className={`rounded-md border p-2 text-xs ${result.flagged ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}>
        <p data-testid="rx-check-finding">{result.finding}</p>
        <p className="mt-1 font-semibold" data-testid="rx-check-action">{result.nextAction}</p>
        {(result.expectedDbm !== undefined || result.expectedRangeDbm) && (
          <p className="mt-1 text-slate-500">
            Expected is calculated from the recorded path{result.basis === 'port_tx' ? " and the port's recorded launch power" : ' and the class launch range'}; limits {optical.measuredGapDb} dB below and {optical.measuredStrongGapDb} dB above, in Optical settings.
          </p>
        )}
      </div>
    </InspectorSection>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function CustomerHistorySection({ customer }: { customer: Customer }) {
  const lines = customer.history ?? [];
  const past = customer.connectionHistory ?? [];
  if (lines.length === 0 && past.length === 0) return null;
  return (
    <InspectorSection title="Connection history" icon={History} defaultOpen={customer.status === 'Disconnected'}>
      <ul className="space-y-1 text-xs text-slate-700" data-testid="cust-history">
        {past.map((c, i) => (
          <li key={`c${i}`}>
            {formatDateTime(c.at)} · {c.kind === 'disconnected' ? 'Disconnected' : 'Moved'} ({c.reason}): was {c.splitterId ? `output ${c.splitterOutputPort ?? '?'} of ${c.splitterId}` : 'no output'}
            {c.dropCableId ? `, fiber ${c.fiberCore ?? '?'} of ${c.dropCableId}` : ''}
            {c.oltId ? `, ${c.oltId} ${c.ponPort ?? ''}` : ''}
            {c.ontSerialNumber ? `, ONT ${c.ontSerialNumber}` : ''}
          </li>
        ))}
        {lines.slice(-10).map((h, i) => (
          <li key={`h${i}`} className="text-slate-500">
            {formatDateTime(h.at)} · {h.action.replace(/_/g, ' ').toLowerCase()}: {h.details}
          </li>
        ))}
      </ul>
    </InspectorSection>
  );
}
