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

/** Looks swapped only inside India's ranges, where latitude and longitude cannot overlap. */
const looksSwapped = (lat, lng) => lat >= 68 && lat <= 98 && lng >= 6 && lng <= 38;

/** Returns findings as { severity: 'error' | 'warning' | 'note', rule, id, message }. */
export function checkNetwork(data, limits = DEFAULT_LIMITS) {
  const findings = [];
  const add = (severity, rule, id, message) => findings.push({ severity, rule, id, message });

  const equipment = data.equipment ?? [];
  const cables = data.cables ?? [];
  const splitters = data.splitters ?? [];
  const closures = data.closures ?? [];
  const customers = data.customers ?? [];
  const faults = data.faults ?? [];
  const workOrders = data.workOrders ?? [];

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
  for (const closure of closures) {
    const seen = new Map();
    for (const splice of closure.splices ?? []) {
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
    if (isBlank(splitter.inputPort?.connectedCableId)) {
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
      if (dropCoreOwners.has(key)) {
        add('error', 'core-shared', customer.id, `Customers "${customer.name}" and "${dropCoreOwners.get(key)}" use the same core of the same house wire.`);
      }
      dropCoreOwners.set(key, customer.name);
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
      if (a.type === b.type && gap <= limits.duplicateRadiusMeters) {
        add('warning', 'possible-duplicate', a.id, `"${a.name}" and "${b.name}" are the same type only ${gap.toFixed(1)} m apart. Possibly one item mapped twice.`);
      } else if (a.type !== b.type && a.category === b.category && gap <= limits.stackedRadiusMeters) {
        add('note', 'stacked-pins', a.id, `"${a.name}" and "${b.name}" sit on the same spot, so one pin hides the other.`);
      }
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

  return findings;
}

const SEVERITY_ORDER = ['error', 'warning', 'note'];
const SEVERITY_TITLE = { error: 'MUST FIX', warning: 'CHECK THESE', note: 'GOOD TO KNOW' };

export function formatReport(findings, data, limit = 10) {
  const lines = [];
  const counts = ['equipment', 'cables', 'splitters', 'closures', 'customers']
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
    args.find((arg, i) => !arg.startsWith('--') && i !== limitAt + 1) ?? 'http://localhost:5000/api/v1/network';

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
