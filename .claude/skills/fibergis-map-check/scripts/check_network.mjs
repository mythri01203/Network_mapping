#!/usr/bin/env node
/**
 * Read-only health check for FiberGIS network data. It only ever reads: a GET to the API or a local
 * backup file. Nothing is written back.
 *
 *   node check_network.mjs                           (reads http://localhost:5000/api/v1/network)
 *   node check_network.mjs http://host:5000/api/v1/network
 *   node check_network.mjs backup.json --json --limit 20
 *
 * Exit codes: 0 no errors, 1 errors found, 2 could not load the data.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Most of these are proposals or field conventions, not standards. Keep them editable.
 * See references/rules.md in this skill for where each one comes from.
 */
export const DEFAULT_LIMITS = {
  splitterLossToleranceDb: 0.1, // Proposed: allows rounded ideal values.
  rxOverloadDbm: -8, // G.984.2 B+ ONU overload.
  rxLowDbm: -27, // G.984.2 B+ ONU sensitivity.
  lengthDifferenceRatio: 0.1, // Proposed: map and recorded length differ by more than 10%.
  cableEndGapMeters: 50, // Proposed: a cable end this far from its equipment.
  duplicateRadiusMeters: 2, // Proposed: same type this close is probably one item mapped twice.
  stackedRadiusMeters: 1, // Proposed: pins this close cannot be tapped separately.
  attachmentGapMeters: 30, // Proposed: a pole recorded as carrying a cable this far from its drawn line.
};

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

export function distanceMeters(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

const routeMeters = (coords) =>
  coords.slice(1).reduce((sum, point, i) => sum + distanceMeters(coords[i][0], coords[i][1], point[0], point[1]), 0);

const portCount = (ratio) => {
  const n = Number(String(ratio ?? '').split(':')[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const isBlank = (value) => value === undefined || value === null || value === '';

/** Poles of any owner are one kind; everything else is compared by its exact type. */
const kindOf = (type) => (/pole/i.test(type ?? '') ? 'pole' : type);

/** Shortest distance from a point to a polyline, on a flat local projection. Fine for tens of metres. */
export function distanceToLineMeters(lat, lng, line) {
  if (!line?.length) return Infinity;
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  const cos0 = Math.cos(toRad(lat));
  const xy = ([pLat, pLng]) => [(pLng - lng) * k * cos0, (pLat - lat) * k];
  if (line.length === 1) return distanceMeters(lat, lng, line[0][0], line[0][1]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, ay] = xy(line[i]);
    const [bx, by] = xy(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Looks swapped only inside India's ranges, where latitude and longitude cannot overlap. */
const looksSwapped = (lat, lng) => lat >= 68 && lat <= 98 && lng >= 6 && lng <= 38;

/**
 * Returns findings as { severity: 'error' | 'warning' | 'note', rule, id, message }.
 * `today` (YYYY-MM-DD) is only used to spot permissions past their end date.
 */
export function checkNetwork(data, limits = DEFAULT_LIMITS, today = new Date().toISOString().slice(0, 10)) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  const findings = [];
  const add = (severity, rule, id, message) => findings.push({ severity, rule, id, message });

  const equipment = data.equipment ?? [];
  const cables = data.cables ?? [];
  const splitters = data.splitters ?? [];
  const closures = data.closures ?? [];
  const customers = data.customers ?? [];
  const faults = data.faults ?? [];
  const workOrders = data.workOrders ?? [];
  const spans = data.spans ?? [];
  const attachments = data.attachments ?? [];
  const ducts = data.ducts ?? [];
  const slackLoops = data.slackLoops ?? [];
  const permissions = data.permissions ?? [];

  const equipmentById = new Map(equipment.map((e) => [e.id, e]));
  const cableById = new Map(cables.map((c) => [c.id, c]));
  const splitterById = new Map(splitters.map((s) => [s.id, s]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const used = new Set();

  // --- Cables ---
  for (const cable of cables) {
    for (const side of ['start', 'end']) {
      const ref = cable[`${side}EquipmentId`];
      if (isBlank(ref)) {
        add('warning', 'cable-end-not-connected', cable.id, `Cable "${cable.name}": the ${side} is not connected to anything.`);
        continue;
      }
      used.add(ref);
      const target = equipmentById.get(ref) ?? customerById.get(ref);
      if (!target) {
        add('error', 'cable-end-missing', cable.id, `Cable "${cable.name}": the ${side} points to "${ref}", which does not exist.`);
        continue;
      }
      const coords = cable.coordinates ?? [];
      const point = side === 'start' ? coords[0] : coords[coords.length - 1];
      if (point) {
        const gap = distanceMeters(point[0], point[1], target.lat, target.lng);
        if (gap > limits.cableEndGapMeters) {
          add('warning', 'cable-end-far', cable.id, `Cable "${cable.name}": the ${side} of the line is ${Math.round(gap)} m from "${target.name}", which it says it connects to.`);
        }
      }
    }

    const coords = cable.coordinates ?? [];
    if (coords.length < 2) {
      add('warning', 'cable-no-route', cable.id, `Cable "${cable.name}" has no route drawn on the map.`);
    } else if (cable.lengthMeters > 0) {
      const drawn = routeMeters(coords);
      const difference = Math.abs(drawn - cable.lengthMeters) / cable.lengthMeters;
      if (difference > limits.lengthDifferenceRatio) {
        add('warning', 'cable-length-mismatch', cable.id, `Cable "${cable.name}": the map line is ${Math.round(drawn)} m but the saved length is ${Math.round(cable.lengthMeters)} m. Some difference is normal (slack, corners). Check it.`);
      }
    }
    if (coords.some(([lat, lng]) => looksSwapped(lat, lng))) {
      add('error', 'coordinates-swapped', cable.id, `Cable "${cable.name}": latitude and longitude look swapped.`);
    }

    if (cable.cableCategory !== 'Coaxial') {
      const cores = cable.cores ?? [];
      if (cores.length !== cable.fiberCount) {
        add('error', 'core-count-wrong', cable.id, `Cable "${cable.name}" says ${cable.fiberCount} cores but has ${cores.length} core records.`);
      }
      const numbers = cores.map((c) => c.coreNumber);
      if (new Set(numbers).size !== numbers.length) {
        add('error', 'core-number-repeated', cable.id, `Cable "${cable.name}" has the same core number more than once.`);
      }
    }
  }

  // --- Closures and splices ---
  // A splice taken out of service is history: it is not checked as a live join.
  const isActiveSplice = (s) => isBlank(s.retiredAt) && s.status !== 'Unused';
  for (const closure of closures) {
    const seen = new Map();
    for (const splice of (closure.splices ?? []).filter(isActiveSplice)) {
      for (const [cableId, core, side] of [
        [splice.inputCableId, splice.inputCore, 'input'],
        [splice.outputCableId, splice.outputCore, 'output'],
      ]) {
        const cable = cableById.get(cableId);
        if (!cable) {
          add('error', 'splice-cable-missing', splice.id, `Closure "${closure.name}": a splice uses cable "${cableId}", which does not exist.`);
          continue;
        }
        used.add(cableId);
        if (core > cable.fiberCount) {
          add('error', 'splice-core-missing', splice.id, `Closure "${closure.name}": a splice uses core ${core} of "${cable.name}", which only has ${cable.fiberCount} cores.`);
        }
        const key = `${cableId}#${core}#${side}`;
        if (seen.has(key)) {
          add('error', 'core-spliced-twice', splice.id, `Closure "${closure.name}": core ${core} of "${cable.name}" is spliced twice on the ${side} side.`);
        }
        seen.set(key, splice.id);
      }
    }
  }

  // --- Fiber by fiber: one feed and one continuation per core (Phase 4 records) ---
  const coreKey = (cableId, core) => `${cableId}#${core}`;
  const coreName = (cableId, core) => `fiber ${core} of "${cableById.get(cableId)?.name ?? cableId}"`;
  const capital = (text) => `${text[0].toUpperCase()}${text.slice(1)}`;
  const splitKey = (key) => [key.slice(0, key.lastIndexOf('#')), Number(key.slice(key.lastIndexOf('#') + 1))];
  const feeds = new Map();
  const continuations = new Map();
  const push = (map, key, what) => map.set(key, [...(map.get(key) ?? []), what]);
  const coreExists = (cableId, core) => {
    const c = cableById.get(cableId);
    return !!c && Number.isInteger(core) && core >= 1 && core <= c.fiberCount;
  };
  for (const closure of closures) {
    for (const s of (closure.splices ?? []).filter(isActiveSplice)) {
      push(feeds, coreKey(s.outputCableId, s.outputCore), `a splice in "${closure.name}"`);
      push(continuations, coreKey(s.inputCableId, s.inputCore), `a splice in "${closure.name}"`);
      if (s.status === 'Pending') add('note', 'splice-planned', s.id, `Closure "${closure.name}": the splice from ${coreName(s.inputCableId, s.inputCore)} is planned, not done. Traces stop there.`);
      if (!isBlank(s.spliceLossDb) && isBlank(s.lossSource)) add('note', 'splice-loss-origin', s.id, `Closure "${closure.name}": a splice loss of ${s.spliceLossDb} dB has no recorded origin, so it is not known to be measured.`);
    }
  }
  for (const sp of splitters) {
    const input = sp.inputPort ?? {};
    if (!isBlank(input.connectedCableId) && Number.isInteger(input.connectedCore)) {
      push(continuations, coreKey(input.connectedCableId, input.connectedCore), `the input of splitter "${sp.name}"`);
      if (!coreExists(input.connectedCableId, input.connectedCore) && cableById.has(input.connectedCableId)) {
        add('error', 'splitter-input-core-missing', sp.id, `Splitter "${sp.name}": its input uses ${coreName(input.connectedCableId, input.connectedCore)}, which the cable does not have.`);
      }
    }
    for (const port of sp.outputPorts ?? []) {
      if (!isBlank(port.connectedDropCableId) && Number.isInteger(port.connectedCore)) {
        push(feeds, coreKey(port.connectedDropCableId, port.connectedCore), `output ${port.portNumber} of splitter "${sp.name}"`);
      }
    }
  }
  const patchesPerPon = new Map();
  for (const eq of equipment) {
    for (const panel of eq.odfPanels ?? []) {
      for (const port of panel.ports ?? []) {
        const where = `ODF "${eq.name}" ${panel.label} port ${port.number}`;
        if (!isBlank(port.feederCableId)) {
          push(feeds, coreKey(port.feederCableId, port.feederCore), where);
          if (!coreExists(port.feederCableId, port.feederCore)) add('error', 'odf-port-core-missing', eq.id, `${where} names ${coreName(port.feederCableId, port.feederCore)}, which does not exist.`);
        }
        if (port.patch) {
          const olt = equipmentById.get(port.patch.oltId);
          if (!olt?.ponPorts?.some((p) => p.id === port.patch.ponPortId)) {
            add('error', 'odf-patch-missing', eq.id, `${where} is patched to "${port.patch.oltId}" ${port.patch.ponPortId}, which does not exist.`);
          }
          push(patchesPerPon, `${port.patch.oltId}/${port.patch.ponPortId}`, where);
        }
        if (!!port.patch !== !isBlank(port.feederCableId)) {
          add('note', 'odf-port-half', eq.id, `${where} has ${port.patch ? 'a patch but no feeder fiber' : 'a feeder fiber but no patch'} recorded, so a trace stops there.`);
        }
      }
    }
  }
  for (const eq of equipment) {
    for (const pon of eq.ponPorts ?? []) {
      if (!isBlank(pon.connectedFeederCableId) && Number.isInteger(pon.feederCore)) push(feeds, coreKey(pon.connectedFeederCableId, pon.feederCore), `"${eq.name}" ${pon.id}`);
      if ((!isBlank(pon.connectedFeederCableId) || patchesPerPon.has(`${eq.id}/${pon.id}`)) && isBlank(pon.opticsClass)) {
        add('note', 'pon-class-not-recorded', eq.id, `"${eq.name}" ${pon.id}: the optics class (B+, C+ ...) is not recorded, so budgets assume one.`);
      }
    }
  }
  for (const [key, list] of patchesPerPon) {
    if (list.length > 1) add('error', 'pon-two-patches', key, `PON port ${key} is patched to ${list.length} ODF ports (${list.join('; ')}). One port takes one cord.`);
  }
  for (const customer of customers) {
    if (customer.status !== 'Disconnected' && !isBlank(customer.dropCableId) && Number.isInteger(customer.fiberCore)) {
      push(continuations, coreKey(customer.dropCableId, customer.fiberCore), `the ONT of "${customer.name}"`);
    }
  }
  for (const [key, list] of feeds) {
    if (list.length < 2) continue;
    const [cableId, core] = splitKey(key);
    add('error', 'core-two-feeds', cableId, `${capital(coreName(cableId, core))} is fed from ${list.length} places: ${list.join('; ')}.`);
  }
  for (const [key, list] of continuations) {
    // Two ONTs on one drop fiber are already reported as core-shared.
    if (list.length < 2 || list.every((x) => x.startsWith('the ONT'))) continue;
    const [cableId, core] = splitKey(key);
    add('error', 'core-two-continuations', cableId, `${capital(coreName(cableId, core))} goes to ${list.length} places: ${list.join('; ')}.`);
  }
  for (const cable of cables) {
    if (cable.cableCategory === 'Coaxial') continue;
    if (Number.isInteger(cable.fibersPerTube) && cable.fiberCount > 0) {
      const tubes = cable.tubeCount ?? cable.fiberCount / cable.fibersPerTube;
      if (!Number.isInteger(tubes) || tubes * cable.fibersPerTube !== cable.fiberCount) {
        add('error', 'tube-layout-wrong', cable.id, `Cable "${cable.name}": ${cable.tubeCount ?? '?'} tubes x ${cable.fibersPerTube} fibers per tube does not make ${cable.fiberCount}.`);
      }
    }
    for (const core of cable.cores ?? []) {
      const active = (core.assignments ?? []).filter((a) => isBlank(a.releasedAt));
      if (active.length > 1) add('error', 'core-two-assignments', cable.id, `Cable "${cable.name}" fiber ${core.coreNumber} has ${active.length} active assignments. One fiber carries one service.`);
    }
    // Only where fibers are joined one by one does an unknown colour order matter to the splicer.
    const joinedFiberByFiber =
      [...feeds.keys()].some((key) => splitKey(key)[0] === cable.id) ||
      [...continuations.entries()].some(([key, list]) => splitKey(key)[0] === cable.id && list.some((x) => !x.startsWith('the ONT')));
    if (joinedFiberByFiber && cable.fiberCount > 0 && (isBlank(cable.colorScheme) || cable.colorScheme === 'unknown')) {
      add('note', 'cable-scheme-unknown', cable.id, `Cable "${cable.name}": colour scheme not recorded, so fibers are shown by number. Blue may not be fiber 1: check the drum.`);
    }
  }

  // --- Splitters ---
  for (const splitter of splitters) {
    if (!isBlank(splitter.terminalBoxId)) used.add(splitter.terminalBoxId);
    if (!equipmentById.has(splitter.terminalBoxId)) {
      add('error', 'splitter-box-missing', splitter.id, `Splitter "${splitter.name}" belongs to box "${splitter.terminalBoxId}", which does not exist.`);
    }
    const n = portCount(splitter.ratio);
    if (n) {
      const ideal = 10 * Math.log10(n);
      // Tolerance: records and datasheets round the ideal, such as 3.0 dB for a true 3.01 dB.
      if (splitter.insertionLossDb > 0 && splitter.insertionLossDb < ideal - limits.splitterLossToleranceDb) {
        add('error', 'splitter-loss-impossible', splitter.id, `Splitter "${splitter.name}" (${splitter.ratio}) records ${splitter.insertionLossDb} dB loss. A real one cannot lose less than ${ideal.toFixed(1)} dB. Check the ratio or the value.`);
      }
      const over = (splitter.outputPorts ?? []).filter((p) => p.portNumber > n).map((p) => p.portNumber);
      if (over.length > 0) {
        add('error', 'splitter-output-overflow', splitter.id, `Splitter "${splitter.name}" is ${splitter.ratio} but lists output ${over.join(', ')}. It has only ${n} outputs.`);
      }
      if ((splitter.outputPorts ?? []).length !== n) {
        add('warning', 'splitter-port-count', splitter.id, `Splitter "${splitter.name}" is ${splitter.ratio} but has ${(splitter.outputPorts ?? []).length} output ports.`);
      }
    }
    const numbers = new Set();
    for (const port of splitter.outputPorts ?? []) {
      if (numbers.has(port.portNumber)) {
        add('error', 'splitter-port-repeated', splitter.id, `Splitter "${splitter.name}" has port ${port.portNumber} more than once.`);
      }
      numbers.add(port.portNumber);
      if (!isBlank(port.connectedCustomerId) && !customerById.has(port.connectedCustomerId)) {
        add('error', 'splitter-customer-missing', splitter.id, `Splitter "${splitter.name}" port ${port.portNumber} points to customer "${port.connectedCustomerId}", who does not exist.`);
      }
    }
    if (isBlank(splitter.inputPort?.connectedCableId) && !isBlank(splitter.inputPort?.connectedSplitterId)) {
      if (!splitterById.has(splitter.inputPort.connectedSplitterId)) {
        add('error', 'splitter-input-missing', splitter.id, `Splitter "${splitter.name}" is fed by splitter "${splitter.inputPort.connectedSplitterId}", which does not exist.`);
      }
    } else if (isBlank(splitter.inputPort?.connectedCableId)) {
      add('warning', 'splitter-no-input', splitter.id, `Splitter "${splitter.name}" has no incoming cable recorded.`);
    } else if (!cableById.has(splitter.inputPort.connectedCableId)) {
      add('error', 'splitter-input-missing', splitter.id, `Splitter "${splitter.name}" gets its signal from cable "${splitter.inputPort.connectedCableId}", which does not exist.`);
    }
  }

  // --- Customers ---
  const portOwners = new Map();
  const dropCoreOwners = new Map();
  const pathFields = [
    ['terminalBoxId', 'box', equipmentById],
    ['splitterId', 'splitter', splitterById],
    ['feederCableId', 'main cable', cableById],
    ['distributionCableId', 'street cable', cableById],
    ['dropCableId', 'house wire', cableById],
  ];
  for (const customer of customers) {
    // A disconnected customer has no path by design; its old one is in its history (Phase 5 rules below).
    if (customer.status === 'Disconnected') continue;
    const olt = equipmentById.get(customer.oltId);
    if (isBlank(customer.oltId)) {
      add('warning', 'customer-path-incomplete', customer.id, `Customer "${customer.name}": no OLT recorded, so the path is incomplete.`);
    } else if (!olt) {
      add('error', 'customer-link-missing', customer.id, `Customer "${customer.name}" points to OLT "${customer.oltId}", which does not exist.`);
    } else if (olt.ponPorts?.length && !isBlank(customer.ponPort)) {
      const known = olt.ponPorts.some((p) => p.id === customer.ponPort || p.slotCardPort === customer.ponPort);
      if (!known) add('warning', 'customer-pon-unknown', customer.id, `Customer "${customer.name}" uses PON port "${customer.ponPort}", which "${olt.name}" does not have.`);
    }
    if (!isBlank(customer.oltId)) used.add(customer.oltId);

    for (const [field, label, lookup] of pathFields) {
      const ref = customer[field];
      if (isBlank(ref)) {
        add('warning', 'customer-path-incomplete', customer.id, `Customer "${customer.name}": no ${label} recorded, so the path is incomplete.`);
      } else if (!lookup.has(ref)) {
        add('error', 'customer-link-missing', customer.id, `Customer "${customer.name}" points to ${label} "${ref}", which does not exist.`);
      } else {
        used.add(ref);
      }
    }

    if (!isBlank(customer.splitterId) && customer.splitterOutputPort > 0) {
      const key = `${customer.splitterId}#${customer.splitterOutputPort}`;
      if (portOwners.has(key)) {
        add('error', 'splitter-port-shared', customer.id, `Customers "${customer.name}" and "${portOwners.get(key)}" are both on port ${customer.splitterOutputPort} of splitter "${customer.splitterId}".`);
      }
      portOwners.set(key, customer.name);
      const splitter = splitterById.get(customer.splitterId);
      const port = splitter?.outputPorts?.find((p) => p.portNumber === customer.splitterOutputPort);
      if (splitter && !port) {
        add('error', 'splitter-port-missing', customer.id, `Customer "${customer.name}" uses port ${customer.splitterOutputPort} of "${splitter.name}", which has no such port.`);
      } else if (port && !isBlank(port.connectedCustomerId) && port.connectedCustomerId !== customer.id) {
        add('error', 'splitter-port-disagrees', customer.id, `Customer "${customer.name}" says port ${customer.splitterOutputPort} of "${splitter.name}", but that port lists a different customer.`);
      }
    }

    if (!isBlank(customer.dropCableId) && customer.fiberCore > 0) {
      const key = `${customer.dropCableId}#${customer.fiberCore}`;
      const other = dropCoreOwners.get(key);
      // Customers on one shared (MDU) ONT use one drop fiber; that is recorded, not a clash.
      if (other && !(customer.ontId && other.ontId === customer.ontId)) {
        add('error', 'core-shared', customer.id, `Customers "${customer.name}" and "${other.name}" use the same core of the same house wire.`);
      }
      dropCoreOwners.set(key, customer);
    }

    const rx = customer.rxOpticalPowerDbm;
    if (rx === 0) {
      add('warning', 'rx-looks-fake', customer.id, `Customer "${customer.name}" shows 0 dBm. This is what the app saves when it has no reading, so treat it as "no reading".`);
    } else if (rx > limits.rxOverloadDbm) {
      add('warning', 'rx-too-strong', customer.id, `Customer "${customer.name}" shows ${rx} dBm: too much light. Check for a missing splitter or wrong path.`);
    } else if (rx < limits.rxLowDbm) {
      add('warning', 'rx-too-weak', customer.id, `Customer "${customer.name}" shows ${rx} dBm: too weak. Check connectors, bends and the path.`);
    }

    if (/^HWTC-ONT-[A-Z0-9]{1,6}$/.test(customer.ontSerialNumber ?? '')) {
      add('warning', 'made-up-serial', customer.id, `Customer "${customer.name}": the ONT serial "${customer.ontSerialNumber}" was auto-generated. Replace it with the real one on the device label.`);
    }
    if (looksSwapped(customer.lat, customer.lng)) {
      add('error', 'coordinates-swapped', customer.id, `Customer "${customer.name}": latitude and longitude look swapped.`);
    }
  }

  // --- Equipment ---
  const names = new Map();
  for (const item of equipment) {
    if (looksSwapped(item.lat, item.lng)) {
      add('error', 'coordinates-swapped', item.id, `"${item.name}": latitude and longitude look swapped.`);
    }
    if (/^New /.test(item.name)) {
      add('note', 'default-name', item.id, `"${item.name}" still has its default name.`);
    }
    const key = `${item.type}#${item.name.trim().toLowerCase()}`;
    names.set(key, [...(names.get(key) ?? []), item.id]);
    if (item.category !== 'Supporting Infrastructure' && !used.has(item.id)) {
      add('note', 'not-connected', item.id, `"${item.name}" (${item.type}) is not connected to any cable, splitter or customer.`);
    }
  }
  for (const [key, ids] of names) {
    if (ids.length > 1) {
      const name = equipmentById.get(ids[0]).name;
      add('warning', 'same-name', ids[0], `${ids.length} items of type ${key.split('#')[0]} are all named "${name}". People cannot tell them apart.`);
    }
  }

  // Sweep by latitude so large networks stay fast.
  const sorted = [...equipment].sort((a, b) => a.lat - b.lat);
  const reach = Math.max(limits.duplicateRadiusMeters, limits.stackedRadiusMeters);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (distanceMeters(a.lat, 0, b.lat, 0) > reach) break;
      const gap = distanceMeters(a.lat, a.lng, b.lat, b.lng);
      if (kindOf(a.type) === kindOf(b.type) && gap <= limits.duplicateRadiusMeters) {
        add('warning', 'possible-duplicate', a.id, `"${a.name}" and "${b.name}" are the same type only ${gap.toFixed(1)} m apart. Possibly one item mapped twice.`);
      } else if (kindOf(a.type) !== kindOf(b.type) && a.category === b.category && gap <= limits.stackedRadiusMeters) {
        add('note', 'stacked-pins', a.id, `"${a.name}" and "${b.name}" sit on the same spot, so one pin hides the other.`);
      }
    }
  }

  // --- Outside plant: spans, attachments, ducts, slack loops, permissions ---
  const spanById = new Map(spans.map((s) => [s.id, s]));
  const name = (id) => equipmentById.get(id)?.name ?? id;
  const spanPairs = new Map();
  let proposedSpans = 0;
  for (const span of spans) {
    for (const end of [span.fromStructureId, span.toStructureId]) {
      if (isBlank(end) || !equipmentById.has(end)) {
        add('error', 'span-end-missing', span.id, `Span "${span.name ?? span.id}": its end "${end ?? ''}" does not exist.`);
      }
    }
    if (!isBlank(span.fromStructureId) && span.fromStructureId === span.toStructureId) {
      add('error', 'span-same-ends', span.id, `Span "${span.name ?? span.id}" starts and ends at the same pole.`);
    }
    const pair = [span.fromStructureId, span.toStructureId].sort().join('#');
    if (spanPairs.has(pair)) {
      add('warning', 'span-repeated', span.id, `Two spans join ${name(span.fromStructureId)} and ${name(span.toStructureId)} (${spanPairs.get(pair)} and ${span.id}). Possibly recorded twice.`);
    }
    spanPairs.set(pair, span.id);
    if (span.status === 'proposed') proposedSpans += 1;
  }
  if (proposedSpans > 0) {
    add('warning', 'span-proposed', spans.find((s) => s.status === 'proposed').id, `${proposedSpans} span(s) are only proposed (poles captured one after the other). The office should confirm or remove each one.`);
  }

  const attachmentKeys = new Map();
  const cablesWithAttachments = new Set();
  for (const a of attachments) {
    const cable = cableById.get(a.cableId);
    if (!cable) add('error', 'attachment-cable-missing', a.id, `Attachment ${a.id} names cable "${a.cableId}", which does not exist.`);
    else cablesWithAttachments.add(cable.id);
    const onPole = !isBlank(a.structureId);
    const onSpan = !isBlank(a.spanId);
    if (onPole === onSpan) {
      add('error', 'attachment-host-missing', a.id, `Attachment ${a.id} must be on exactly one pole or one span.`);
    } else if (onPole && !equipmentById.has(a.structureId)) {
      add('error', 'attachment-host-missing', a.id, `Attachment ${a.id} says the cable is on "${a.structureId}", which does not exist.`);
    } else if (onSpan && !spanById.has(a.spanId)) {
      add('error', 'attachment-host-missing', a.id, `Attachment ${a.id} says the cable is on span "${a.spanId}", which does not exist.`);
    }
    const key = `${a.cableId}#${a.structureId ?? ''}#${a.spanId ?? ''}`;
    if (attachmentKeys.has(key)) {
      add('warning', 'attachment-repeated', a.id, `Cable "${cable?.name ?? a.cableId}" is recorded twice on the same ${onPole ? 'pole' : 'span'}.`);
    }
    attachmentKeys.set(key, a.id);
    if (cable && onPole && equipmentById.has(a.structureId) && (cable.coordinates ?? []).length >= 2) {
      const pole = equipmentById.get(a.structureId);
      const gap = distanceToLineMeters(pole.lat, pole.lng, cable.coordinates);
      if (gap > limits.attachmentGapMeters) {
        add('warning', 'attachment-far-from-route', a.id, `"${pole.name}" is recorded as carrying "${cable.name}", but it is ${Math.round(gap)} m from the drawn line. Either the line or the record is wrong.`);
      }
    }
  }
  for (const cable of cables) {
    const aerial = cable.installationType === 'Aerial' || cable.type === 'Aerial Fiber';
    if (aerial && !cablesWithAttachments.has(cable.id)) {
      add('note', 'aerial-no-poles', cable.id, `Aerial cable "${cable.name}" has no poles recorded, so nobody can answer which poles carry it.`);
    }
  }

  for (const duct of ducts) {
    for (const end of [duct.fromStructureId, duct.toStructureId]) {
      if (!isBlank(end) && !equipmentById.has(end)) add('error', 'duct-end-missing', duct.id, `Duct "${duct.name}": its end "${end}" does not exist.`);
    }
    const inDuct = [...(duct.cableIds ?? []), ...(duct.subducts ?? []).flatMap((s) => s.cableIds ?? [])];
    for (const id of inDuct) {
      if (!cableById.has(id)) add('error', 'duct-cable-missing', duct.id, `Duct "${duct.name}" lists cable "${id}", which does not exist.`);
      else used.add(id);
    }
    const repeated = inDuct.find((id, i) => inDuct.indexOf(id) !== i);
    if (repeated) add('error', 'duct-cable-repeated', duct.id, `Duct "${duct.name}" lists cable "${repeated}" twice. One cable is in one place at a time.`);
    if ((duct.coordinates ?? []).some(([lat, lng]) => looksSwapped(lat, lng))) {
      add('error', 'coordinates-swapped', duct.id, `Duct "${duct.name}": latitude and longitude look swapped.`);
    }
  }

  for (const loop of slackLoops) {
    if (!cableById.has(loop.cableId)) add('error', 'slack-cable-missing', loop.id, `Slack loop "${loop.name}" is on cable "${loop.cableId}", which does not exist.`);
    if (!isBlank(loop.structureId) && !equipmentById.has(loop.structureId)) {
      add('error', 'slack-place-missing', loop.id, `Slack loop "${loop.name}" is at "${loop.structureId}", which does not exist.`);
    }
    if (!(loop.lengthMeters > 0)) add('error', 'slack-length-invalid', loop.id, `Slack loop "${loop.name}" has no usable length.`);
  }

  for (const p of permissions) {
    for (const id of p.structureIds ?? []) {
      if (!equipmentById.has(id)) add('error', 'permission-item-missing', p.id, `Permission from ${p.authority} (${p.permitNumber ?? p.id}) covers "${id}", which does not exist.`);
    }
    for (const id of p.cableIds ?? []) {
      if (!cableById.has(id)) add('error', 'permission-item-missing', p.id, `Permission from ${p.authority} (${p.permitNumber ?? p.id}) covers cable "${id}", which does not exist.`);
    }
    if (!isBlank(p.validUntil) && p.validUntil.slice(0, 10) < today) {
      add('warning', 'permission-expired', p.id, `Permission from ${p.authority} (${p.permitNumber ?? 'no number'}) ended on ${p.validUntil.slice(0, 10)}, as recorded.`);
    }
  }

  // --- Customers and connections (Phase 5): ONTs, services, buildings, disconnects ---
  // Messages name customers by id only, so this report carries no personal data of its own.
  const onts = data.onts ?? [];
  const services = data.services ?? [];
  const buildings = data.buildings ?? [];
  const ontById = new Map(onts.map((o) => [o.id, o]));
  const buildingById = new Map(buildings.map((b) => [b.id, b]));
  const isLive = (o) => o.status !== 'removed';
  const ontLabel = (o) => `ONT ${o.serialNumber || o.id}`;
  const activeOn = (ontId) => customers.filter((c) => c.ontId === ontId && c.status !== 'Disconnected');
  const serials = new Map();
  for (const ont of onts.filter(isLive)) {
    const links = [
      [ont.oltId, equipmentById, 'OLT'],
      [ont.splitterId, splitterById, 'splitter'],
      [ont.dropCableId, cableById, 'drop cable'],
    ];
    for (const [ref, lookup, label] of links) {
      if (!isBlank(ref) && !lookup.has(ref)) add('error', 'ont-link-missing', ont.id, `${ontLabel(ont)} names ${label} "${ref}", which does not exist.`);
    }
    const olt = equipmentById.get(ont.oltId);
    if (olt?.ponPorts?.length && !isBlank(ont.ponPortId) && !olt.ponPorts.some((p) => p.id === ont.ponPortId)) {
      add('error', 'ont-link-missing', ont.id, `${ontLabel(ont)} names port "${ont.ponPortId}" on "${olt.name}", which has no such port.`);
    }
    const drop = cableById.get(ont.dropCableId);
    if (drop && Number.isInteger(ont.dropCore) && (ont.dropCore < 1 || ont.dropCore > drop.fiberCount)) {
      add('error', 'ont-link-missing', ont.id, `${ontLabel(ont)} names fiber ${ont.dropCore} of "${drop.name}", which has ${drop.fiberCount} fibers.`);
    }
    const users = activeOn(ont.id);
    if (ont.arrangement !== 'shared' && users.length > 1) {
      add('error', 'ont-one-customer-shared', ont.id, `${ontLabel(ont)} is recorded for one customer but ${users.length} use it (${users.map((c) => c.id).join(', ')}).`);
    }
    if (users.length === 1) {
      const [c] = users;
      const dropDiffers = !isBlank(ont.dropCableId) && !isBlank(c.dropCableId) && (ont.dropCableId !== c.dropCableId || ont.dropCore !== c.fiberCore);
      const portDiffers = !isBlank(ont.splitterId) && !isBlank(c.splitterId) && (ont.splitterId !== c.splitterId || ont.splitterOutputPort !== c.splitterOutputPort);
      if (dropDiffers || portDiffers) add('warning', 'ont-link-disagrees', ont.id, `${ontLabel(ont)} and customer ${c.id} record different ${dropDiffers ? 'drop fibers' : 'splitter outputs'}. One of them is out of date.`);
    }
    if (ont.status === 'installed' && users.length === 0) add('note', 'ont-installed-unused', ont.id, `${ontLabel(ont)} is marked installed but no customer uses it.`);
    if (!isBlank(ont.serialNumber)) {
      const key = ont.serialNumber.replace(/\s+/g, '').toLowerCase();
      serials.set(key, [...(serials.get(key) ?? []), ont.id]);
    }
  }
  for (const [, ids] of serials) {
    if (ids.length > 1) add('error', 'ont-serial-twice', ids[0], `ONT serial "${ontById.get(ids[0]).serialNumber}" is on ${ids.length} ONT records (${ids.join(', ')}).`);
  }
  let embeddedOnly = 0;
  for (const c of customers) {
    const active = c.status !== 'Disconnected';
    if (!isBlank(c.ontId)) {
      const ont = ontById.get(c.ontId);
      if (!ont) add('error', 'customer-ont-missing', c.id, `Customer ${c.id} names ONT "${c.ontId}", which does not exist.`);
      else if (!isLive(ont) && active) add('error', 'customer-on-removed-ont', c.id, `Customer ${c.id} is on ${ontLabel(ont)}, which was removed.`);
    } else if (active && !isBlank(c.ontSerialNumber)) embeddedOnly += 1;
    if (!isBlank(c.buildingId)) {
      const b = buildingById.get(c.buildingId);
      if (!b) add('error', 'customer-building-missing', c.id, `Customer ${c.id} names building "${c.buildingId}", which does not exist.`);
      else if (!isBlank(c.unitId) && !(b.units ?? []).some((u) => u.id === c.unitId)) add('error', 'customer-building-missing', c.id, `Customer ${c.id} names a unit that building "${b.name}" does not have.`);
    }
    if (!active) {
      const ports = splitters.flatMap((s) => (s.outputPorts ?? []).filter((p) => p.connectedCustomerId === c.id).map((p) => `output ${p.portNumber} of "${s.name}"`));
      if (ports.length) add('warning', 'disconnected-holds-port', c.id, `Customer ${c.id} is disconnected but still holds ${ports.join(', ')}, so it cannot be reused.`);
      const fibers = cables.flatMap((cable) => (cable.cores ?? []).filter((k) => (k.assignments ?? []).some((a) => isBlank(a.releasedAt) && a.customerId === c.id)).map((k) => `fiber ${k.coreNumber} of "${cable.name}"`));
      if (fibers.length) add('warning', 'disconnected-holds-fiber', c.id, `Customer ${c.id} is disconnected but ${fibers.join(', ')} is still given to them.`);
      if (isBlank(c.disconnectReason) && !(c.connectionHistory ?? []).length) add('note', 'disconnect-no-history', c.id, `Customer ${c.id} is disconnected with no reason or earlier connection recorded.`);
    }
  }
  // Only once ONT records are in use: before that every customer is like this, and it is not a fault.
  if (embeddedOnly > 0 && onts.length > 0) {
    add('note', 'ont-only-on-customer', 'customers', `${embeddedOnly} active customer(s) have an ONT serial written only on their own record, with no ONT record, so a swap would leave no history.`);
  }
  const liveKinds = new Map();
  for (const s of services) {
    const c = customerById.get(s.customerId);
    if (!c) {
      add('error', 'service-customer-missing', s.id, `Service ${s.id} names customer "${s.customerId}", who does not exist.`);
      continue;
    }
    if (s.status === 'ended') continue;
    if (!isBlank(s.ontId)) {
      const ont = ontById.get(s.ontId);
      if (!ont) add('error', 'service-ont-missing', s.id, `Service ${s.id} of customer ${c.id} names ONT "${s.ontId}", which does not exist.`);
      else if (!isLive(ont)) add('warning', 'service-on-removed-ont', s.id, `Service ${s.id} of customer ${c.id} is on ${ontLabel(ont)}, which was removed.`);
    }
    if (c.status === 'Disconnected' && (s.status === 'active' || s.status === 'suspended')) {
      add('warning', 'service-on-disconnected', s.id, `Customer ${c.id} is disconnected, but service ${s.id} is still ${s.status}.`);
    }
    if (s.status === 'active') liveKinds.set(`${c.id}/${s.kind}`, [...(liveKinds.get(`${c.id}/${s.kind}`) ?? []), s.id]);
  }
  for (const [key, ids] of liveKinds) {
    if (ids.length > 1) add('warning', 'service-kind-twice', ids[0], `Customer ${key.split('/')[0]} has ${ids.length} active ${key.split('/')[1]} services (${ids.join(', ')}). Check one is not a duplicate.`);
  }
  for (const b of buildings) {
    if (!isBlank(b.entryEquipmentId) && !equipmentById.has(b.entryEquipmentId)) add('error', 'building-link-missing', b.id, `Building "${b.name}": its entry point "${b.entryEquipmentId}" does not exist.`);
    else if (!isBlank(b.entryEquipmentId)) used.add(b.entryEquipmentId);
    if (!isBlank(b.riserCableId) && !cableById.has(b.riserCableId)) add('error', 'building-link-missing', b.id, `Building "${b.name}": its riser cable "${b.riserCableId}" does not exist.`);
    const boxIds = new Set((b.floorBoxes ?? []).map((f) => f.id));
    for (const f of b.floorBoxes ?? []) {
      if (!isBlank(f.equipmentId) && !equipmentById.has(f.equipmentId)) add('error', 'building-link-missing', b.id, `Building "${b.name}": floor box "${f.label}" names pin "${f.equipmentId}", which does not exist.`);
      if (!isBlank(f.splitterId) && !splitterById.has(f.splitterId)) add('error', 'building-link-missing', b.id, `Building "${b.name}": floor box "${f.label}" names splitter "${f.splitterId}", which does not exist.`);
    }
    const labels = new Map();
    for (const u of b.units ?? []) {
      if (!isBlank(u.floorBoxId) && !boxIds.has(u.floorBoxId)) add('error', 'unit-box-missing', b.id, `Building "${b.name}": unit "${u.label}" names a floor box the building does not have.`);
      const key = u.label.trim().toLowerCase();
      labels.set(key, (labels.get(key) ?? 0) + 1);
    }
    for (const [label, count] of labels) if (count > 1) add('warning', 'unit-label-repeated', b.id, `Building "${b.name}" lists unit "${label}" ${count} times.`);
    if (b.kind !== 'house' && (b.units ?? []).length > 0) {
      if (isBlank(b.riserCableId)) add('note', 'building-riser-not-recorded', b.id, `Building "${b.name}": no riser cable is recorded, so the path to its units cannot be followed.`);
      const noBox = (b.units ?? []).filter((u) => isBlank(u.floorBoxId)).length;
      if (noBox > 0) add('note', 'unit-box-not-recorded', b.id, `Building "${b.name}": ${noBox} unit(s) have no floor box recorded.`);
    }
  }

  // --- Records left pointing at deleted items ---
  const dangling = (source, id, field, ref, lookup, label) => {
    if (!isBlank(ref) && !lookup.has(ref)) {
      add('warning', 'points-to-deleted', id, `${source} "${id}": its ${field} "${ref}" no longer exists (${label}).`);
    }
  };
  const faultById = new Map(faults.map((f) => [f.id, f]));
  for (const fault of faults) {
    dangling('Fault', fault.id, 'equipment', fault.affectedEquipmentId, equipmentById, 'equipment');
    dangling('Fault', fault.id, 'cable', fault.affectedCableId, cableById, 'cable');
  }
  for (const order of workOrders) {
    dangling('Work order', order.id, 'equipment', order.equipmentId, equipmentById, 'equipment');
    dangling('Work order', order.id, 'cable', order.cableId, cableById, 'cable');
    dangling('Work order', order.id, 'customer', order.customerId, customerById, 'customer');
    dangling('Work order', order.id, 'fault', order.faultId, faultById, 'fault');
  }

  checkFaults(data, add, { equipmentById, cableById, splitterById, customerById, faultById });

  return findings;
}

/** Why a check does not count, or null. Same rules as the app (`verificationProblem`). */
const verificationProblem = (v) => {
  if (!v) return 'no check recorded';
  if (isBlank(v.by)) return 'the check does not say who did it';
  if (v.method === 'field_reading') {
    if (typeof v.readingDbm !== 'number') return 'the light reading has no value';
    if (v.readingOrigin !== 'field_measured') return 'the light reading is not marked as measured in the field';
    if (isBlank(v.photoId)) return 'the light reading has no meter photo';
    return null;
  }
  if (v.method === 'photo') return isBlank(v.photoId) ? 'the photo check has no photo' : null;
  if (v.method === 'office_check') return isBlank(v.note) ? 'the office check has no note of what was checked' : null;
  return 'the check has an unknown method';
};

const CLOSED_FAULT = ['Verified', 'Closed'];
const CLOSED_JOB = ['Verified', 'Closed'];
const DONE_JOB = ['Completed', 'Verified', 'Closed', 'Cancelled'];

/**
 * Phase 8: alarms, faults, work orders and offline conflicts. Ids only in messages, never names.
 * A device alarm cannot be real while no OLT is connected; a TEST must say TEST; nothing is
 * verified or closed without a check; an affected list built from a path that is now broken is
 * flagged so nobody trusts it blindly.
 */
function checkFaults(data, add, { equipmentById, cableById, splitterById, customerById, faultById }) {
  const alarms = data.alarms ?? [];
  const faults = data.faults ?? [];
  const workOrders = data.workOrders ?? [];
  const closureById = new Map((data.closures ?? []).map((c) => [c.id, c]));
  const spanIds = new Set((data.spans ?? []).map((s) => s.id));
  const ontIds = new Set((data.onts ?? []).map((o) => o.id));
  const alarmById = new Map(alarms.map((a) => [a.id, a]));

  const elementExists = (el) => {
    if (!el || isBlank(el.id)) return false;
    switch (el.type) {
      case 'customer':
        return customerById.has(el.id);
      case 'ont':
        return ontIds.has(el.id);
      case 'splitter':
        return splitterById.has(el.id);
      case 'pon_port':
        return !!(equipmentById.get(el.id)?.ponPorts ?? []).some((p) => p.id === el.ponPortId);
      case 'olt':
      case 'equipment':
        return equipmentById.has(el.id);
      case 'cable':
        return cableById.has(el.id);
      case 'core': {
        const c = cableById.get(el.id);
        return !!c && Number.isInteger(el.fiberNumber) && el.fiberNumber >= 1 && el.fiberNumber <= c.fiberCount;
      }
      case 'closure':
        return closureById.has(el.id);
      case 'span':
        return spanIds.has(el.id);
      default:
        return false;
    }
  };

  for (const a of alarms) {
    if (a.source === 'device_adapter') {
      add('error', 'alarm-device-not-connected', a.id, `Alarm ${a.id} claims to come from the OLT, but no OLT is connected. It cannot be real.`);
    }
    if ((a.source === 'test') !== !!a.isTest) {
      add('error', 'alarm-test-label', a.id, `Alarm ${a.id}: a TEST event must be marked TEST, and only a TEST event may be.`);
    }
    if (a.state !== 'cleared' && !elementExists(a.element)) {
      add('warning', 'alarm-points-to-missing', a.id, `Open alarm ${a.id} is about ${a.element?.type ?? '?'} "${a.element?.id ?? ''}", which is not on record.`);
    }
  }

  let legacyResolved = 0;
  for (const f of faults) {
    const jobs = workOrders.filter((w) => w.faultId === f.id);
    const checked = !verificationProblem(f.verification) || jobs.some((w) => !verificationProblem(w.verification));
    if (CLOSED_FAULT.includes(f.status) && !checked) {
      add('error', 'fault-closed-unverified', f.id, `Fault ${f.id} is ${f.status.toLowerCase()} with no check: no field light reading, photo or office check.`);
    }
    if (f.verification && verificationProblem(f.verification)) {
      add('error', 'verification-incomplete', f.id, `Fault ${f.id}: ${verificationProblem(f.verification)}, so it does not count as a check.`);
    }
    if (f.status === 'Resolved') legacyResolved += 1;
    const linked = (f.alarmIds ?? []).map((id) => alarmById.get(id)).filter(Boolean);
    if (linked.some((a) => !!a.isTest !== !!f.isTest)) {
      add('error', 'fault-test-mixed', f.id, `Fault ${f.id} mixes TEST events and real alarms, or is labelled differently from its alarms.`);
    }
    for (const id of f.alarmIds ?? []) {
      if (!alarmById.has(id)) add('warning', 'points-to-deleted', f.id, `Fault "${f.id}": its alarm "${id}" no longer exists (alarm).`);
    }
    // The affected list was worked out from recorded paths when the fault was opened. If those paths are now broken, say so.
    const open = !CLOSED_FAULT.includes(f.status) && f.status !== 'Resolved';
    if (open) {
      const missing = [];
      const broken = [];
      for (const id of f.affectedCustomerIds ?? []) {
        const c = customerById.get(id);
        if (!c) missing.push(id);
        else if (c.status === 'Disconnected' || isBlank(c.dropCableId) || !c.fiberCore || !cableById.has(c.dropCableId)) broken.push(id);
      }
      if (missing.length) add('warning', 'fault-affected-missing', f.id, `Open fault ${f.id} lists ${missing.length} affected customer(s) no longer on record (${missing.slice(0, 5).join(', ')}).`);
      if (broken.length) {
        add('warning', 'fault-affected-broken-path', f.id, `Open fault ${f.id} lists ${broken.length} affected customer(s) whose path is now broken or disconnected (${broken.slice(0, 5).join(', ')}). Open "Who is affected now" before calling customers.`);
      }
    }
  }
  if (legacyResolved > 0) {
    add('note', 'fault-resolved-before-checks', 'faults', `${legacyResolved} fault(s) were marked "Resolved" before checks were recorded, so nothing shows the repair was verified.`);
  }

  for (const w of workOrders) {
    const fault = faultById.get(w.faultId);
    if (CLOSED_JOB.includes(w.status) && verificationProblem(w.verification)) {
      add('error', 'work-order-closed-unverified', w.id, `Work order ${w.id} is ${w.status.toLowerCase()} but ${verificationProblem(w.verification)}.`);
    } else if (w.verification && verificationProblem(w.verification)) {
      add('error', 'verification-incomplete', w.id, `Work order ${w.id}: ${verificationProblem(w.verification)}, so it does not count as a check.`);
    }
    if (fault?.isTest && !w.isTest) add('error', 'fault-test-mixed', w.id, `Work order ${w.id} is for TEST fault ${fault.id} but is not marked TEST.`);
    if (fault && CLOSED_FAULT.includes(fault.status) && !DONE_JOB.includes(w.status)) {
      add('warning', 'work-order-open-on-closed-fault', w.id, `Work order ${w.id} is still ${w.status.toLowerCase()}, but its fault ${fault.id} is ${fault.status.toLowerCase()}.`);
    }
    if (w.status === 'Completed' && !w.verification) {
      add('note', 'work-order-awaiting-check', w.id, `Work order ${w.id}: repair done, waiting for a check.`);
    }
  }

  const waiting = (data.syncConflicts ?? []).filter((c) => c.status === 'open' || c.status === 'office_decides');
  if (waiting.length > 0) {
    add('note', 'sync-conflicts-waiting', 'syncConflicts', `${waiting.length} record(s) were changed by two people at once and wait for a choice (Operations, Changed twice). Both versions are kept.`);
  }
}

const SEVERITY_ORDER = ['error', 'warning', 'note'];
const SEVERITY_TITLE = { error: 'MUST FIX', warning: 'CHECK THESE', note: 'GOOD TO KNOW' };

export function formatReport(findings, data, limit = 10) {
  const lines = [];
  const counts = ['equipment', 'cables', 'splitters', 'closures', 'customers', 'spans', 'attachments', 'ducts', 'onts', 'services', 'buildings', 'alarms', 'faults', 'workOrders']
    .map((name) => `${(data[name] ?? []).length} ${name}`)
    .join(', ');
  lines.push(`Checked: ${counts}.`);
  const totals = SEVERITY_ORDER.map((s) => findings.filter((f) => f.severity === s).length);
  lines.push(`Result: ${totals[0]} must fix, ${totals[1]} to check, ${totals[2]} good to know.`);
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push('', `== ${SEVERITY_TITLE[severity]} ==`);
    for (const rule of [...new Set(group.map((f) => f.rule))]) {
      const items = group.filter((f) => f.rule === rule);
      lines.push(`[${rule}] ${items.length}`);
      for (const item of items.slice(0, limit)) lines.push(`  - ${item.message}`);
      if (items.length > limit) lines.push(`  ...and ${items.length - limit} more`);
    }
  }
  lines.push('', 'Passing this check does not prove the map matches the street. Only photos and site visits can show that.');
  return lines.join('\n');
}

async function load(source) {
  const raw = /^https?:\/\//.test(source)
    ? await fetch(source).then((response) => {
        if (!response.ok) throw new Error(`server answered ${response.status}`);
        return response.json();
      })
    : JSON.parse(readFileSync(source, 'utf8').replace(/^﻿/, ''));
  return raw.data ?? raw.collections ?? raw;
}

async function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const limitAt = args.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 10;
  const source =
    // With no --limit, limitAt is -1: the first argument must not be mistaken for the limit's value.
    args.find((arg, i) => !arg.startsWith('--') && (limitAt < 0 || i !== limitAt + 1)) ?? 'http://localhost:5000/api/v1/network';

  let data;
  try {
    data = await load(source);
  } catch (error) {
    console.error(`Could not load network data from ${source}: ${error.message}`);
    return 2;
  }
  const findings = checkNetwork(data);
  console.log(json ? JSON.stringify(findings, null, 2) : formatReport(findings, data, limit));
  return findings.some((f) => f.severity === 'error') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv);
}
