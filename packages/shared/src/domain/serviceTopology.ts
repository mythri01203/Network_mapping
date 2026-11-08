import { ONT_STATUS_SOURCE_LABELS, SERVICE_KIND_LABELS, SERVICE_STATUS_LABELS } from '../model/enums';
import type { Building, BuildingUnit, Customer, Ont, Service, Splitter } from '../model/types';
import { customersOnOnt, isActiveCustomer, isLiveOnt } from './connectionRules';
import { buildFiberIndex, type CoreKey, coreKey, describeCore, type FiberData, type FiberIndex, ponKey, splitterCapacity } from './fiberIndex';
import { traceCoreUpstream, traceCustomerCores } from './fiberPath';
import type { OpticalSettings } from './opticalSettings';

/**
 * The logical (service) topology: OLT → PON port → splitter stages → output → ONT → customer →
 * services. It is built only from recorded links, walking the fibers downstream from each PON port;
 * a fiber that leads nowhere is shown as a gap with its name, and anything not reached from a PON
 * port is listed apart with the first missing link. Map position is never used.
 */

export type TopologyData = FiberData & { onts?: readonly Ont[]; services?: readonly Service[]; buildings?: readonly Building[] };

export type LogicalNodeKind = 'olt' | 'pon' | 'splitter' | 'output' | 'ont' | 'customer' | 'service' | 'gap' | 'note';

export interface LogicalNode {
  kind: LogicalNodeKind;
  /** Unique within the tree, for keys and tests. */
  key: string;
  label: string;
  detail?: string;
  status: 'ok' | 'gap' | 'warning';
  ref?: { type: 'equipment' | 'customer' | 'cable'; id: string };
  children: LogicalNode[];
}

export interface ServiceTopology {
  roots: LogicalNode[];
  /** Active customers and splitters no PON port reaches, each with the first missing link. */
  unreached: LogicalNode[];
  counts: { ponPorts: number; splitters: number; customersReached: number; customersUnreached: number; gaps: number };
}

const node = (kind: LogicalNodeKind, key: string, label: string, extra: Partial<LogicalNode> = {}): LogicalNode => ({ kind, key, label, status: 'ok', children: [], ...extra });
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

function servicesNodes(customer: Customer, services: readonly Service[]): LogicalNode[] {
  const list = services.filter((s) => s.customerId === customer.id && s.status !== 'ended');
  if (list.length === 0) return [node('note', `${customer.id}/no-service`, 'No service recorded', { status: 'warning' })];
  return list.map((s) =>
    node('service', s.id, SERVICE_KIND_LABELS[s.kind], {
      detail: [SERVICE_STATUS_LABELS[s.status], s.planName ? `plan "${s.planName}" as written` : 'plan not recorded', s.ontPort ? `ONT port ${s.ontPort}` : undefined].filter(Boolean).join(' · '),
    }),
  );
}

function customerNode(customer: Customer, services: readonly Service[], keyBase: string): LogicalNode {
  return node('customer', `${keyBase}/${customer.id}`, customer.name, {
    detail: [customer.id, customer.status !== 'Active' ? customer.status : undefined, customer.flatNumber ? `unit ${customer.flatNumber}` : undefined].filter(Boolean).join(' · '),
    ref: { type: 'customer', id: customer.id },
    children: servicesNodes(customer, services),
  });
}

/** The ONT a customer sink leads to, with every customer on it (several for a shared MDU ONT). */
function ontNode(customer: Customer, data: TopologyData, keyBase: string, shown: Set<string>): LogicalNode {
  const services = data.services ?? [];
  const record = customer.ontId ? (data.onts ?? []).find((o) => o.id === customer.ontId) : undefined;
  if (record) {
    const users = customersOnOnt({ customers: data.customers }, record.id);
    for (const u of users) shown.add(u.id);
    return node('ont', `${keyBase}/${record.id}`, `ONT ${record.serialNumber ?? '(serial not recorded)'}`, {
      detail: [[record.vendor, record.model].filter(Boolean).join(' ') || 'make not recorded', record.onuAddress ? `OLT address ${record.onuAddress}` : undefined, ONT_STATUS_SOURCE_LABELS[record.statusSource]].filter(Boolean).join(' · '),
      status: isLiveOnt(record) ? 'ok' : 'warning',
      children: (users.length ? users : [customer]).map((u) => customerNode(u, services, `${keyBase}/${record.id}`)),
    });
  }
  shown.add(customer.id);
  const serial = customer.ontSerialNumber?.trim();
  return node('ont', `${keyBase}/ont-${customer.id}`, serial ? `ONT ${serial}` : 'ONT not recorded', {
    detail: serial ? 'Serial written on the customer record; no ONT record yet' : 'No ONT serial recorded',
    status: serial ? 'ok' : 'warning',
    children: [customerNode(customer, services, keyBase)],
  });
}

export function serviceTopology(data: TopologyData, options: { settings?: OpticalSettings; index?: FiberIndex } = {}): ServiceTopology {
  const index = options.index ?? buildFiberIndex(data);
  const reached = new Set<string>();
  const seenSplitters = new Set<string>();
  let gaps = 0;
  let splitterCount = 0;
  const gap = (key: string, message: string): LogicalNode => {
    gaps += 1;
    return node('gap', key, message, { status: 'gap' });
  };

  const followCore = (cableId: string, core: number, keyBase: string, seen: Set<CoreKey>, depth: number): LogicalNode[] => {
    const key = coreKey(cableId, core);
    if (seen.has(key) || depth > 200) return [gap(`${keyBase}/loop-${key}`, `${cap(describeCore(index, cableId, core))} loops back on itself.`)];
    seen.add(key);
    const sinks = index.sinks.get(key) ?? [];
    if (sinks.length === 0) {
      return [gap(`${keyBase}/end-${key}`, `${cap(describeCore(index, cableId, core))} has no recorded link on its customer side.`)];
    }
    const out: LogicalNode[] = [];
    for (const sink of sinks) {
      if (sink.kind === 'splice') out.push(...followCore(sink.splice.outputCableId, sink.splice.outputCore, keyBase, seen, depth + 1));
      else if (sink.kind === 'splitter') out.push(splitterNode(sink.splitter, keyBase, seen, depth + 1));
      else if (sink.kind === 'customer') {
        reached.add(sink.customer.id);
        if (shown.has(sink.customer.id)) continue;
        out.push(ontNode(sink.customer, data, `${keyBase}/${key}`, shown));
      }
    }
    return out;
  };
  const shown = new Set<string>();

  const splitterNode = (sp: Splitter, keyBase: string, seen: Set<CoreKey>, depth: number): LogicalNode => {
    const host = index.equipment.get(sp.terminalBoxId);
    const base = node('splitter', `${keyBase}/${sp.id}`, `Splitter ${sp.name}`, {
      detail: [sp.couplerRatio ? `coupler ${sp.couplerRatio}` : sp.ratio, host ? `in ${host.name}` : 'box not on record'].join(' · '),
      ref: host ? { type: 'equipment', id: host.id } : undefined,
      status: sp.status === 'Faulty' ? 'warning' : 'ok',
    });
    if (seenSplitters.has(sp.id)) {
      base.children.push(gap(`${base.key}/twice`, `Splitter ${sp.name} is reached twice: its output loops back into its own tree.`));
      return base;
    }
    seenSplitters.add(sp.id);
    splitterCount += 1;
    let free = 0;
    for (let p = 1; p <= splitterCapacity(sp); p += 1) {
      const record = sp.outputPorts.find((x) => x.portNumber === p);
      const children = index.cascadeChildren.get(`${sp.id}#${p}`) ?? [];
      const out = node('output', `${base.key}/out-${p}`, `Output ${p}`, { detail: record?.label && record.label !== `OUT-${String(p).padStart(2, '0')}` ? record.label : undefined });
      if (children.length) out.children.push(...children.map((c) => splitterNode(c, out.key, seen, depth + 1)));
      else if (record?.connectedDropCableId && record.connectedCore) {
        out.detail = `fiber ${record.connectedCore} of ${index.cables.get(record.connectedDropCableId)?.name ?? record.connectedDropCableId}`;
        out.children.push(...followCore(record.connectedDropCableId, record.connectedCore, out.key, seen, depth + 1));
      } else if (record?.connectedCustomerId) {
        const c = data.customers.find((x) => x.id === record.connectedCustomerId);
        out.children.push(gap(`${out.key}/nofiber`, `Output ${p} names ${c?.name ?? record.connectedCustomerId}, but no drop fiber is recorded on it.`));
      } else {
        if (record?.status === 'Faulty') out.children.push(node('note', `${out.key}/faulty`, 'Marked faulty', { status: 'warning' }));
        else {
          free += 1;
          continue;
        }
      }
      base.children.push(out);
    }
    if (free > 0) base.children.push(node('note', `${base.key}/free`, `${free} output${free === 1 ? '' : 's'} free`));
    return base;
  };

  const roots: LogicalNode[] = [];
  let ponPorts = 0;
  for (const olt of data.equipment.filter((e) => e.type === 'OLT')) {
    const oltNode = node('olt', olt.id, olt.name, { detail: [olt.manufacturer, olt.model, olt.site].filter(Boolean).join(' · ') || undefined, ref: { type: 'equipment', id: olt.id } });
    for (const pon of olt.ponPorts ?? []) {
      ponPorts += 1;
      const ponNode = node('pon', `${olt.id}/${pon.id}`, pon.id, {
        detail: [pon.vendorAddress ? `OLT address ${pon.vendorAddress}` : 'vendor address not recorded', pon.technology ?? olt.technology, pon.opticsClass].filter(Boolean).join(' · '),
      });
      const feeders: { cableId: string; core: number; via: string }[] = [];
      for (const ref of index.ponPatches.get(ponKey(olt.id, pon.id)) ?? []) {
        if (ref.port.feederCableId && ref.port.feederCore) feeders.push({ cableId: ref.port.feederCableId, core: ref.port.feederCore, via: `patched to ${ref.odf.name} ${ref.panel.label} port ${ref.port.number}` });
        else ponNode.children.push(gap(`${ponNode.key}/odf-${ref.port.id}`, `Patched to ${ref.odf.name} ${ref.panel.label} port ${ref.port.number}, but no feeder fiber is recorded behind that port.`));
      }
      if (pon.connectedFeederCableId && pon.feederCore) feeders.push({ cableId: pon.connectedFeederCableId, core: pon.feederCore, via: 'straight onto the feeder' });
      if (feeders.length === 0 && ponNode.children.length === 0) {
        // An idle port with nothing recorded is not a gap; say so plainly.
        ponNode.children.push(node('note', `${ponNode.key}/idle`, 'No patch or feeder fiber recorded on this port'));
      }
      for (const f of feeders) {
        ponNode.detail = `${ponNode.detail} · ${f.via}`;
        ponNode.children.push(...followCore(f.cableId, f.core, ponNode.key, new Set(), 0));
      }
      oltNode.children.push(ponNode);
    }
    if ((olt.ponPorts ?? []).length === 0) oltNode.children.push(node('note', `${olt.id}/noports`, 'No PON ports recorded on this OLT'));
    roots.push(oltNode);
  }

  // Anything not reached from a PON port, with the first missing link.
  const unreached: LogicalNode[] = [];
  for (const c of data.customers) {
    if (!isActiveCustomer(c) || reached.has(c.id) || shown.has(c.id)) continue;
    // A customer on a shared ONT that another customer's drop reaches is served through it.
    if (c.ontId && data.customers.some((o) => o.id !== c.id && o.ontId === c.ontId && reached.has(o.id))) continue;
    const trace = traceCustomerCores(c, data, { settings: options.settings, index });
    const first = trace.gaps[0] ?? (trace.pon ? 'Not reached downstream from its PON port.' : 'Does not reach a PON port.');
    gaps += 1;
    unreached.push(
      node('customer', `unreached/${c.id}`, c.name, {
        detail: c.id,
        status: 'gap',
        ref: { type: 'customer', id: c.id },
        children: [node('gap', `unreached/${c.id}/gap`, first, { status: 'gap' })],
      }),
    );
  }
  for (const sp of data.splitters) {
    if (seenSplitters.has(sp.id) || sp.inputPort.connectedSplitterId) continue;
    const host = index.equipment.get(sp.terminalBoxId);
    const input = sp.inputPort;
    const why =
      !input.connectedCableId || !input.connectedCore
        ? `The input of splitter ${sp.name} is not linked to a cable fiber.`
        : (traceCoreUpstream(input.connectedCableId, input.connectedCore, data, { settings: options.settings, index }).gaps[0] ?? 'Its input fiber does not reach a PON port.');
    gaps += 1;
    unreached.push(
      node('splitter', `unreached/${sp.id}`, `Splitter ${sp.name}`, {
        detail: host ? `in ${host.name}` : undefined,
        status: 'gap',
        ref: host ? { type: 'equipment', id: host.id } : undefined,
        children: [node('gap', `unreached/${sp.id}/gap`, why, { status: 'gap' })],
      }),
    );
  }
  const active = data.customers.filter(isActiveCustomer).length;
  const unreachedCustomers = unreached.filter((n) => n.kind === 'customer').length;
  return { roots, unreached, counts: { ponPorts, splitters: splitterCount, customersReached: active - unreachedCustomers, customersUnreached: unreachedCustomers, gaps } };
}

/* ------------------------------------------------------------------ */
/* Building and unit paths                                             */
/* ------------------------------------------------------------------ */

export interface UnitPathStep {
  kind: 'olt' | 'entry' | 'riser' | 'floor_box' | 'drop' | 'ont' | 'customer';
  label: string;
  detail?: string;
  status: 'ok' | 'gap' | 'warning';
}

export interface UnitPath {
  unit: BuildingUnit;
  customer?: Customer;
  steps: UnitPathStep[];
  gaps: string[];
}

/**
 * Street to flat for each unit of a building: OLT link, entry point, riser, floor box, drop fiber,
 * ONT, customer, from recorded links only. A house has no riser or floor box, so they are skipped.
 */
export function buildingUnitPaths(building: Building, data: TopologyData, options: { settings?: OpticalSettings } = {}): UnitPath[] {
  const index = buildFiberIndex(data);
  const multi = building.kind !== 'house';
  const entry = building.entryEquipmentId ? index.equipment.get(building.entryEquipmentId) : undefined;
  const riser = building.riserCableId ? index.cables.get(building.riserCableId) : undefined;
  const paths: UnitPath[] = [];
  for (const unit of building.units) {
    const people = data.customers.filter((c) => c.unitId === unit.id && isActiveCustomer(c));
    for (const customer of people.length ? people : [undefined]) {
      const steps: UnitPathStep[] = [];
      const gaps: string[] = [];
      const add = (step: UnitPathStep) => {
        steps.push(step);
        if (step.status === 'gap') gaps.push(step.label);
      };
      if (customer) {
        const trace = traceCustomerCores(customer, data, { settings: options.settings, index });
        add(
          trace.complete && trace.olt && trace.pon
            ? { kind: 'olt', label: `${trace.olt.name} ${trace.pon.id}`, detail: 'Every fiber recorded to the OLT', status: 'ok' }
            : { kind: 'olt', label: trace.gaps[0] ?? 'Not traced to an OLT', status: 'gap' },
        );
      }
      add(entry ? { kind: 'entry', label: entry.name, detail: building.entryNote, status: 'ok' } : { kind: 'entry', label: 'Entry point not recorded', detail: building.entryNote, status: 'gap' });
      if (multi) {
        add(riser ? { kind: 'riser', label: riser.name, detail: `${riser.fiberCount} fibers${building.riserNote ? ` · ${building.riserNote}` : ''}`, status: 'ok' } : { kind: 'riser', label: 'Riser cable not recorded', detail: building.riserNote, status: 'gap' });
        const box = building.floorBoxes.find((f) => f.id === unit.floorBoxId);
        if (!box) add({ kind: 'floor_box', label: `No floor box recorded for ${unit.label}`, status: 'gap' });
        else {
          const sp = box.splitterId ? index.splitters.get(box.splitterId) : undefined;
          const mismatch = !!customer && !!sp && !!customer.splitterId && customer.splitterId !== sp.id;
          add({
            kind: 'floor_box',
            label: box.label,
            detail: [box.floor ? `floor ${box.floor}` : undefined, sp ? `splitter ${sp.name}` : undefined, mismatch ? `but ${customer!.name} is on splitter ${customer!.splitterId}` : undefined].filter(Boolean).join(' · ') || undefined,
            status: mismatch ? 'warning' : 'ok',
          });
        }
      }
      if (!customer) {
        add({ kind: 'customer', label: `No customer recorded in ${unit.label}`, status: 'warning' });
        paths.push({ unit, steps, gaps });
        continue;
      }
      add(
        customer.dropCableId && customer.fiberCore
          ? { kind: 'drop', label: cap(describeCore(index, customer.dropCableId, customer.fiberCore)), detail: customer.splitterId ? `from output ${customer.splitterOutputPort} of ${index.splitters.get(customer.splitterId)?.name ?? customer.splitterId}` : undefined, status: 'ok' }
          : { kind: 'drop', label: `${customer.name} has no drop fiber recorded`, status: 'gap' },
      );
      const ont = customer.ontId ? (data.onts ?? []).find((o) => o.id === customer.ontId) : undefined;
      add(
        ont
          ? { kind: 'ont', label: `ONT ${ont.serialNumber ?? '(serial not recorded)'}`, detail: ont.arrangement === 'shared' ? 'shared by several units' : undefined, status: 'ok' }
          : customer.ontSerialNumber
            ? { kind: 'ont', label: `ONT ${customer.ontSerialNumber}`, detail: 'serial on the customer record', status: 'ok' }
            : { kind: 'ont', label: 'ONT not recorded', status: 'warning' },
      );
      add({ kind: 'customer', label: customer.name, detail: customer.id, status: 'ok' });
      paths.push({ unit, customer, steps, gaps });
    }
  }
  return paths;
}
