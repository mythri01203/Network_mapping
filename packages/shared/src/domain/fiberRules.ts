import { type ColorScheme, coreIdentity, DEFAULT_COLOR_SCHEMES, tubeRecordsProblem } from '../fiber/colors';
import type { ChangeSet } from '../model/api';
import type { SplitterRatio } from '../model/enums';
import type { Splitter } from '../model/types';
import { spliceDirectionMismatch, trayUsage } from './closureTrays';
import {
  buildFiberIndex,
  coreKey,
  describeCore,
  describeSink,
  describeSource,
  type FiberData,
  type FiberIndex,
  isSpliceActive,
  splitterCapacity,
} from './fiberIndex';
import { opticsClassMismatch, tracePonTree } from './fiberPath';
import { oltChassisProblems } from './oltConfig';
import { DEFAULT_OPTICAL_SETTINGS, idealSplitterLossDb, type OpticalSettings } from './opticalSettings';

/**
 * Validators from the fibergis-ftth-mapping rules table. Errors are physical impossibilities or
 * broken data and are refused, in the browser and on the server. Everything else is a warning the
 * person may accept; the acceptance is written to the audit trail. A wrong rule must never stop
 * field work, so only the error list ever blocks.
 */

export type FiberProblemSeverity = 'error' | 'warning';

export interface FiberProblem {
  severity: FiberProblemSeverity;
  code: string;
  /** Stable across runs, so a change can be judged by the problems it adds. */
  key: string;
  message: string;
  /** Record ids involved: cables, closures, splitters, equipment, customers. */
  refs: string[];
}

export interface FiberCheckOptions {
  settings?: OpticalSettings;
  schemes?: readonly ColorScheme[];
  /** Also walk every PON tree for split, ONU and spread warnings. Slower. */
  trees?: boolean;
}

const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

export function findFiberProblems(data: FiberData, options: FiberCheckOptions = {}): FiberProblem[] {
  const settings = options.settings ?? DEFAULT_OPTICAL_SETTINGS;
  const index = buildFiberIndex(data, options.schemes ?? DEFAULT_COLOR_SCHEMES);
  const problems: FiberProblem[] = [];
  const error = (code: string, key: string, message: string, refs: string[]) => problems.push({ severity: 'error', code, key: `${code}:${key}`, message, refs });
  const warning = (code: string, key: string, message: string, refs: string[]) => problems.push({ severity: 'warning', code, key: `${code}:${key}`, message, refs });

  const coreExists = (cableId: string, core: number | undefined) => {
    const cable = index.cables.get(cableId);
    return !!cable && !!core && Number.isInteger(core) && core >= 1 && core <= cable.fiberCount;
  };

  // --- Cables: layout and assignments ---------------------------------------------------------
  for (const cable of data.cables) {
    // Phase 7: tube records (tubes of different sizes) must add up to the cable's fiber count.
    const tubeProblem = cable.tubes?.length ? tubeRecordsProblem(cable) : undefined;
    if (tubeProblem) {
      error('tube_sizes', cable.id, `${cable.name}: ${tubeProblem}. Fix the tube sizes from the drum sheet.`, [cable.id]);
    }
    if (cable.fibersPerTube !== undefined && cable.fiberCount > 0) {
      const tubes = cable.tubeCount ?? cable.fiberCount / cable.fibersPerTube;
      if (!Number.isInteger(tubes) || tubes * cable.fibersPerTube !== cable.fiberCount) {
        error(
          'tube_layout',
          cable.id,
          `${cable.name}: ${cable.tubeCount ?? '?'} tubes x ${cable.fibersPerTube} fibers per tube does not make ${cable.fiberCount} fibers.`,
          [cable.id],
        );
      }
    }
    if (cable.colorScheme && !index.schemes.some((s) => s.id === cable.colorScheme)) {
      warning('unknown_scheme', cable.id, `${cable.name} names colour scheme "${cable.colorScheme}", which is not in settings. Its colours are not shown.`, [cable.id]);
    }
    for (const core of cable.cores) {
      const active = (core.assignments ?? []).filter((a) => !a.releasedAt);
      // Marked In Use, but nothing on record says for what: the next person cannot tell it is taken.
      if (core.status === 'In Use' && active.length === 0) {
        warning(
          'core_in_use_unassigned',
          coreKey(cable.id, core.coreNumber),
          `${cap(describeCore(index, cable.id, core.coreNumber))} is marked In Use but has no assignment saying what uses it${core.customerId ? ` (the core names ${core.customerId})` : ''}. Record its use or mark it free.`,
          [cable.id],
        );
      }
      if (active.length > 1) {
        error(
          'core_two_assignments',
          coreKey(cable.id, core.coreNumber),
          `${cap(describeCore(index, cable.id, core.coreNumber))} has ${active.length} active assignments (${active.map((a) => a.use).join('; ')}). One core carries one service.`,
          [cable.id],
        );
      }
      // Phase 7: a damaged or faulty core given a service needs a recorded override reason. A core
      // that went faulty while already in service is not blamed: its fault came after the assignment.
      // Warnings only, never blocking: the mark may be out of date.
      if ((core.status === 'Damaged' || core.status === 'Faulty') && active.length > 0) {
        const lastFault = [...(core.history ?? [])].reverse().find((e) => e.toStatus === core.status);
        const givenWhileBad = active.filter((a) => !a.override?.reason?.trim() && (!lastFault || lastFault.at < a.createdAt));
        if (givenWhileBad.length > 0) {
          warning(
            'core_faulty_assigned',
            coreKey(cable.id, core.coreNumber),
            `${cap(describeCore(index, cable.id, core.coreNumber))} is marked ${core.status.toLowerCase()} but is given to ${givenWhileBad.map((a) => a.use).join('; ')} with no reason recorded for using it anyway.`,
            [cable.id],
          );
        }
      }
      if (core.status === 'Retired' && active.length > 0) {
        warning(
          'core_retired_assigned',
          coreKey(cable.id, core.coreNumber),
          `${cap(describeCore(index, cable.id, core.coreNumber))} is retired (out of use) but is still recorded for ${active.map((a) => a.use).join('; ')}. Release it, or bring it back into use.`,
          [cable.id],
        );
      }
    }
  }

  // --- What cables and customers point to ----------------------------------------------------
  // The browser will not delete equipment or a cable that something still uses. The server must
  // refuse the same, or a write straight to the API leaves a cable end or a customer pointing at
  // nothing. A cable may end at equipment or, as older drops do, at the customer itself (the map
  // check accepts both). An empty route is allowed (not drawn yet); a route of one point is broken.
  const customerIds = new Set(data.customers.map((c) => c.id));
  for (const cable of data.cables) {
    for (const [end, id] of [
      ['start', cable.startEquipmentId],
      ['end', cable.endEquipmentId],
    ] as const) {
      if (id && !index.equipment.has(id) && !customerIds.has(id)) {
        error('cable_end_missing', `${cable.id}/${end}`, `${cable.name}: its ${end} is at ${id}, which is not on record. Connect that end to existing equipment, or leave it empty.`, [cable.id]);
      }
    }
    if (cable.coordinates.length === 1) {
      error('cable_one_point', cable.id, `${cable.name} has a route of one point. Draw at least two points, or leave the route empty until it is known.`, [cable.id]);
    }
  }
  for (const customer of data.customers) {
    const refs: [string, string | undefined, ReadonlyMap<string, unknown>][] = [
      ['OLT', customer.oltId, index.equipment],
      ['box', customer.terminalBoxId, index.equipment],
      ['splitter', customer.splitterId, index.splitters],
      ['feeder cable', customer.feederCableId, index.cables],
      ['distribution cable', customer.distributionCableId, index.cables],
      ['drop cable', customer.dropCableId, index.cables],
    ];
    for (const [what, id, records] of refs) {
      if (id && !records.has(id)) {
        error('customer_missing_ref', `${customer.id}/${what}`, `${customer.name} names ${what} ${id}, which is not on record. Choose an existing one, or clear it.`, [customer.id]);
      }
    }
  }

  // --- One feed and one continuation per core ------------------------------------------------
  for (const [key, sources] of index.sources) {
    if (sources.length < 2) continue;
    const [cableId, core] = splitKey(key);
    error(
      'core_two_sources',
      key,
      `${cap(describeCore(index, cableId, core))} is fed from ${sources.length} places (${sources.map((s) => describeSource(index, s)).join('; ')}). A fiber has one feed on its OLT side.`,
      [cableId],
    );
  }
  for (const [key, sinks] of index.sinks) {
    if (sinks.length < 2) continue;
    // Several customers on one shared ONT (an MDU unit) use one drop fiber: that is one continuation.
    const firstOnt = sinks[0].kind === 'customer' ? sinks[0].customer.ontId : undefined;
    if (firstOnt && sinks.every((s) => s.kind === 'customer' && s.customer.ontId === firstOnt)) continue;
    const [cableId, core] = splitKey(key);
    error(
      'core_two_continuations',
      key,
      `${cap(describeCore(index, cableId, core))} continues to ${sinks.length} places (${sinks.map((s) => describeSink(index, s)).join('; ')}). A fiber goes one way on its customer side.`,
      [cableId],
    );
  }

  // --- Splices ---------------------------------------------------------------------------------
  for (const closure of data.closures) {
    for (const splice of closure.splices) {
      if (!isSpliceActive(splice)) continue;
      const ends: [string, number, string][] = [
        [splice.inputCableId, splice.inputCore, 'from'],
        [splice.outputCableId, splice.outputCore, 'to'],
      ];
      for (const [cableId, core, side] of ends) {
        if (!index.cables.has(cableId)) {
          error('splice_missing_cable', `${closure.id}/${splice.id}/${side}`, `Splice in ${closure.name}: cable ${cableId} is not on record.`, [closure.id]);
        } else if (!coreExists(cableId, core)) {
          error('splice_missing_core', `${closure.id}/${splice.id}/${side}`, `Splice in ${closure.name}: ${index.cables.get(cableId)!.name} has no fiber ${core}.`, [closure.id, cableId]);
        }
      }
      if (splice.inputCableId === splice.outputCableId && splice.inputCore === splice.outputCore) {
        error('splice_self', `${closure.id}/${splice.id}`, `Splice in ${closure.name} joins a fiber to itself.`, [closure.id]);
      }
      if (splice.trayId && !(closure.trays ?? []).some((t) => t.id === splice.trayId)) {
        warning('splice_missing_tray', `${closure.id}/${splice.id}`, `Splice in ${closure.name} names a tray that is not recorded on the closure.`, [closure.id]);
      }
      const a = index.cables.get(splice.inputCableId);
      const b = index.cables.get(splice.outputCableId);
      if (a && b && coreExists(a.id, splice.inputCore) && coreExists(b.id, splice.outputCore)) {
        if (a.colorScheme && a.colorScheme === b.colorScheme) {
          const ia = coreIdentity(a, splice.inputCore, index.schemes);
          const ib = coreIdentity(b, splice.outputCore, index.schemes);
          if (ia.fiberColor && ib.fiberColor && ia.fiberColor.name !== ib.fiberColor.name) {
            warning(
              'splice_color_mismatch',
              `${closure.id}/${splice.id}`,
              `Splice in ${closure.name} joins ${ia.fiberColor.name} to ${ib.fiberColor.name}. Both cables use the same scheme; check it is meant.`,
              [closure.id],
            );
          }
        }
        for (const [cable, core] of [
          [a, splice.inputCore],
          [b, splice.outputCore],
        ] as const) {
          const coreStatus = cable.cores.find((k) => k.coreNumber === core)?.status;
          if (coreStatus === 'Damaged' || coreStatus === 'Faulty' || coreStatus === 'Retired') {
            warning(
              'splice_damaged_core',
              `${closure.id}/${splice.id}/${cable.id}`,
              `Splice in ${closure.name} uses ${describeCore(index, cable.id, core)}, which is marked ${coreStatus === 'Retired' ? 'retired (out of use)' : coreStatus.toLowerCase()}.`,
              [closure.id, cable.id],
            );
          }
        }
        const atClosure = (cableId: string, c: typeof a) =>
          (closure.cableEntries ?? []).some((e) => e.cableId === cableId) ||
          closure.cableAId === cableId ||
          closure.cableBId === cableId ||
          (!!closure.equipmentId && (c.startEquipmentId === closure.equipmentId || c.endEquipmentId === closure.equipmentId));
        for (const [cableId, c] of [
          [a.id, a],
          [b.id, b],
        ] as const) {
          if (!atClosure(cableId, c)) {
            warning('splice_cable_not_at_closure', `${closure.id}/${splice.id}/${cableId}`, `Splice in ${closure.name} uses ${c.name}, which is not recorded at this closure.`, [closure.id, cableId]);
          }
        }
        // Phase 8: direction, only where the closure records which side each cable is on.
        const mismatch = a.id !== b.id ? spliceDirectionMismatch(closure, a.id, b.id) : undefined;
        if (mismatch) {
          warning(
            'splice_direction',
            `${closure.id}/${splice.id}`,
            `Splice in ${closure.name} goes from ${a.name} to ${b.name}, but ${mismatch === 'input' ? `${a.name} is recorded here as going out towards customers` : `${b.name} is recorded here as coming in from the OLT side`}. Check which side is towards the OLT, or fix the cables recorded at the closure.`,
            [closure.id],
          );
        }
      }
      if (splice.spliceLossDb !== undefined && (splice.spliceType ?? 'fusion') === 'fusion' && splice.spliceLossDb > settings.limits.spliceRejectDb) {
        warning('splice_high_loss', `${closure.id}/${splice.id}`, `Splice in ${closure.name} records ${splice.spliceLossDb} dB, above the ${settings.limits.spliceRejectDb} dB redo level.`, [closure.id]);
      }
    }

    // --- Phase 8: fibers ending on a pigtail in this closure --------------------------------------
    const activeTerminations = (closure.terminations ?? []).filter((t) => !t.retiredAt);
    for (const t of activeTerminations) {
      const where = `Pigtail in ${closure.name}`;
      const tCable = index.cables.get(t.cableId);
      if (!tCable) {
        error('termination_missing_cable', `${closure.id}/${t.id}`, `${where}: cable ${t.cableId} is not on record.`, [closure.id]);
        continue;
      }
      if (!coreExists(t.cableId, t.core)) {
        error('termination_missing_core', `${closure.id}/${t.id}`, `${where}: ${tCable.name} has no fiber ${t.core}.`, [closure.id, t.cableId]);
        continue;
      }
      const fiberName = describeCore(index, t.cableId, t.core);
      if (activeTerminations.some((o) => o.id !== t.id && o.cableId === t.cableId && o.core === t.core)) {
        warning('termination_twice', `${closure.id}/${t.cableId}#${t.core}`, `${cap(fiberName)} is recorded on two pigtails in ${closure.name}. A fiber end takes one connector; check that the fiber is cut here and both ends are used.`, [closure.id, t.cableId]);
      }
      const spliced = closure.splices.some(
        (s) => isSpliceActive(s) && ((s.inputCableId === t.cableId && s.inputCore === t.core) || (s.outputCableId === t.cableId && s.outputCore === t.core)),
      );
      if (spliced) {
        warning('termination_and_splice', `${closure.id}/${t.id}`, `${cap(fiberName)} is both spliced and ended on a pigtail in ${closure.name}. That is only right if the fiber is cut here and each end is used once.`, [closure.id, t.cableId]);
      }
      if (t.trayId && !(closure.trays ?? []).some((tr) => tr.id === t.trayId)) {
        warning('termination_missing_tray', `${closure.id}/${t.id}`, `${where} names a tray that is not recorded on the closure.`, [closure.id]);
      }
      const coreStatus = tCable.cores.find((k) => k.coreNumber === t.core)?.status;
      if (coreStatus === 'Damaged' || coreStatus === 'Faulty' || coreStatus === 'Retired') {
        warning('termination_damaged_core', `${closure.id}/${t.id}`, `${where} uses ${fiberName}, which is marked ${coreStatus === 'Retired' ? 'retired (out of use)' : coreStatus.toLowerCase()}.`, [closure.id, t.cableId]);
      }
      const atHere =
        (closure.cableEntries ?? []).some((e) => e.cableId === t.cableId) ||
        closure.cableAId === t.cableId ||
        closure.cableBId === t.cableId ||
        (!!closure.equipmentId && (tCable.startEquipmentId === closure.equipmentId || tCable.endEquipmentId === closure.equipmentId));
      if (!atHere) {
        warning('termination_cable_not_at_closure', `${closure.id}/${t.id}`, `${where} uses ${tCable.name}, which is not recorded at this closure.`, [closure.id, t.cableId]);
      }
    }

    // --- Phase 8: trays, cassettes and positions --------------------------------------------------
    for (const usage of trayUsage(closure)) {
      const label = `${closure.name} ${usage.tray.label}`;
      for (const taken of usage.positionsTaken) {
        error(
          'tray_position_taken',
          `${closure.id}/${usage.tray.id}/${taken.cassette ?? ''}/${taken.position}`,
          `${label}${taken.cassette ? ` cassette ${taken.cassette}` : ''} position ${taken.position} holds ${taken.items.length} splices or pigtails (${taken.items.map((i) => i.label).join('; ')}). One position holds one. Change the position of one of them.`,
          [closure.id],
        );
      }
      const capacity = usage.tray.capacity;
      if (capacity !== undefined && usage.used > capacity) {
        // The count is in the key, so every splice added beyond the capacity is warned about again.
        warning('tray_over_capacity', `${closure.id}/${usage.tray.id}/${usage.used}`, `${label} holds ${usage.used} splices and pigtails, but is recorded with ${capacity} positions. Check the tray capacity, or use another tray.`, [closure.id]);
      }
      for (const item of usage.items) {
        if (capacity !== undefined && item.position !== undefined && item.position > capacity) {
          warning('tray_position_beyond_capacity', `${closure.id}/${item.id}`, `${label}: ${item.label} is at position ${item.position}, but the tray is recorded with ${capacity} positions.`, [closure.id]);
        }
      }
    }
  }

  // --- Splitters -------------------------------------------------------------------------------
  for (const sp of data.splitters) {
    const n = splitterCapacity(sp);
    const numbers = sp.outputPorts.map((p) => p.portNumber);
    const over = numbers.filter((x) => x > n);
    if (over.length > 0) {
      error('splitter_overflow', sp.id, `Splitter ${sp.name} is ${sp.ratio} but has output ${over.join(', ')}. A ${sp.ratio} has ${n} outputs.`, [sp.id]);
    }
    const dup = numbers.find((x, i) => numbers.indexOf(x) !== i);
    if (dup !== undefined) error('splitter_duplicate_port', sp.id, `Splitter ${sp.name} lists output ${dup} twice.`, [sp.id]);
    if (!sp.couplerRatio && sp.insertionLossDb > 0) {
      const ideal = idealSplitterLossDb(sp.ratio as SplitterRatio);
      if (sp.insertionLossDb < ideal - 0.1) {
        error('splitter_loss_below_ideal', sp.id, `Splitter ${sp.name} records ${sp.insertionLossDb} dB, but a ${sp.ratio} cannot lose less than about ${ideal.toFixed(1)} dB.`, [sp.id]);
      }
    }
    const input = sp.inputPort;
    if (input.connectedCableId && input.connectedCore !== undefined && !coreExists(input.connectedCableId, input.connectedCore)) {
      error('splitter_input_missing_core', sp.id, `The input of splitter ${sp.name} names fiber ${input.connectedCore} of ${input.connectedCableId}, which does not exist.`, [sp.id]);
    }
    if (input.connectedCableId && input.connectedSplitterId) {
      error('splitter_input_two_feeds', sp.id, `The input of splitter ${sp.name} is linked both to a cable fiber and to another splitter.`, [sp.id]);
    }
    if (input.connectedSplitterId) {
      const parent = index.splitters.get(input.connectedSplitterId);
      if (!parent) error('splitter_parent_missing', sp.id, `Splitter ${sp.name} is fed by splitter ${input.connectedSplitterId}, which is not on record.`, [sp.id]);
      else if (input.connectedSplitterPort && input.connectedSplitterPort > splitterCapacity(parent)) {
        error('splitter_parent_port', sp.id, `Splitter ${sp.name} is fed by output ${input.connectedSplitterPort} of ${parent.name}, which has ${splitterCapacity(parent)} outputs.`, [sp.id]);
      }
      if (input.connectedSplitterId === sp.id) error('splitter_loop', sp.id, `Splitter ${sp.name} feeds itself.`, [sp.id]);
    }
    for (const port of sp.outputPorts) {
      if (port.connectedDropCableId && port.connectedCore !== undefined && !coreExists(port.connectedDropCableId, port.connectedCore)) {
        error('splitter_output_missing_core', `${sp.id}#${port.portNumber}`, `Output ${port.portNumber} of splitter ${sp.name} names fiber ${port.connectedCore} of ${port.connectedDropCableId}, which does not exist.`, [sp.id]);
      }
    }
    // Cascade inside one box: two splitters on one output.
    for (const port of sp.outputPorts) {
      const children = index.cascadeChildren.get(`${sp.id}#${port.portNumber}`) ?? [];
      const fiberToo = !!port.connectedDropCableId && !!port.connectedCore;
      if (children.length + (fiberToo ? 1 : 0) > 1) {
        error('splitter_output_two', `${sp.id}#${port.portNumber}`, `Output ${port.portNumber} of splitter ${sp.name} is connected to more than one thing.`, [sp.id]);
      }
      // Phase 11: an output marked faulty takes a new fiber or cascade splitter only with a reason.
      // A connection made before the output was marked faulty is not blamed: the fault came after it.
      if (port.status === 'Faulty' && !port.override?.reason?.trim()) {
        const lastFault = [...(port.history ?? [])].reverse().find((h) => h.action === 'MARKED_FAULTY');
        const times = [...(port.connectedDropCableId && port.connectedAt ? [port.connectedAt] : []), ...children.map((c) => c.inputPort.linkedAt).filter((t): t is string => !!t)];
        if (lastFault && times.some((t) => lastFault.at < t)) {
          error(
            'splitter_output_faulty_connected',
            `${sp.id}#${port.portNumber}`,
            `Output ${port.portNumber} of splitter ${sp.name} is marked faulty and was connected with no reason recorded. Use another output, mark it repaired, or say why it is used anyway.`,
            [sp.id],
          );
        }
      }
    }
  }
  // Loops through cascades.
  for (const sp of data.splitters) {
    const seen = new Set<string>([sp.id]);
    let parentId = sp.inputPort.connectedSplitterId;
    for (let guard = 0; parentId && guard < 50; guard += 1) {
      if (seen.has(parentId)) {
        error('splitter_loop', sp.id, `Splitter ${sp.name} feeds back into its own tree.`, [sp.id]);
        break;
      }
      seen.add(parentId);
      parentId = index.splitters.get(parentId)?.inputPort.connectedSplitterId;
    }
  }

  // --- ODF and PON ports -----------------------------------------------------------------------
  for (const eq of data.equipment) {
    for (const panel of eq.odfPanels ?? []) {
      const numbers = panel.ports.map((p) => p.number);
      const dup = numbers.find((x, i) => numbers.indexOf(x) !== i);
      if (dup !== undefined) error('odf_duplicate_port', `${eq.id}/${panel.id}`, `${eq.name} ${panel.label} lists port ${dup} twice.`, [eq.id]);
      for (const port of panel.ports) {
        if (port.feederCableId && !coreExists(port.feederCableId, port.feederCore)) {
          error('odf_missing_core', `${eq.id}/${port.id}`, `${eq.name} ${panel.label} port ${port.number} names fiber ${port.feederCore ?? '?'} of ${port.feederCableId}, which does not exist.`, [eq.id]);
        }
        if (port.patch) {
          const olt = index.equipment.get(port.patch.oltId);
          const pon = olt?.ponPorts?.find((p) => p.id === port.patch!.ponPortId);
          if (!olt || !pon) {
            error('odf_patch_missing_pon', `${eq.id}/${port.id}`, `${eq.name} ${panel.label} port ${port.number} is patched to ${port.patch.oltId} ${port.patch.ponPortId}, which is not on record.`, [eq.id]);
          }
          // Phase 9: an adapter marked faulty takes a new patch only with a reason. A patch made
          // before the port was marked faulty is not blamed: the fault came after it.
          if (port.status === 'damaged' && !port.patch.override?.reason?.trim()) {
            const lastFault = [...(port.history ?? [])].reverse().find((h) => h.action === 'MARKED_FAULTY');
            if (!lastFault || lastFault.at < port.patch.patchedAt) {
              error(
                'odf_patch_faulty_port',
                `${eq.id}/${port.id}`,
                `${eq.name} ${panel.label} port ${port.number} is marked faulty and was patched with no reason recorded. Use another port, mark it repaired, or say why it is patched anyway.`,
                [eq.id],
              );
            }
          }
        }
        // Phase 9: the fiber behind an adapter is in use. Older records (before Phase 9) never marked it.
        if (port.feederCableId && coreExists(port.feederCableId, port.feederCore)) {
          const core = index.cables.get(port.feederCableId)!.cores.find((k) => k.coreNumber === port.feederCore);
          const held = (core?.assignments ?? []).some((a) => !a.releasedAt) || core?.status === 'In Use' || core?.status === 'Reserved' || core?.status === 'Retired';
          if (!held) {
            warning(
              'odf_feeder_not_marked',
              `${eq.id}/${port.id}`,
              `${cap(describeCore(index, port.feederCableId, port.feederCore!))} is behind ${eq.name} ${panel.label} port ${port.number}, but is not marked in use. Save the port's feeder fiber again to mark it.`,
              [eq.id, port.feederCableId],
            );
          }
        }
        // Phase 9: a connector into an adapter of another kind or polish (APC and UPC do not mate).
        const adapter = port.connectorType ?? panel.connectorType;
        for (const [what, plug] of [
          ['patch cord', port.patch?.cordConnectorOdf],
          ['pigtail', port.pigtail?.connectorType],
        ] as const) {
          const clash = connectorClash(adapter, plug);
          if (clash) {
            warning('odf_connector_mismatch', `${eq.id}/${port.id}/${what}`, `${eq.name} ${panel.label} port ${port.number}: the ${what} is ${plug} but the adapter is ${adapter}. ${clash}`, [eq.id]);
          }
        }
      }
    }
    for (const pon of eq.ponPorts ?? []) {
      const patches = index.ponPatches.get(`${eq.id}/${pon.id}`) ?? [];
      if (patches.length > 1) {
        error('pon_two_patches', `${eq.id}/${pon.id}`, `${eq.name} ${pon.id} is patched to ${patches.length} ODF ports (${patches.map((r) => `${r.odf.name} ${r.panel.label} port ${r.port.number}`).join('; ')}). One port takes one patch cord.`, [eq.id]);
      }
      if (patches.length > 0 && pon.feederCore) {
        error('pon_patch_and_direct', `${eq.id}/${pon.id}`, `${eq.name} ${pon.id} is recorded both through an ODF and straight onto a feeder fiber. Keep only one.`, [eq.id]);
      }
      if (pon.feederCore && pon.connectedFeederCableId && !coreExists(pon.connectedFeederCableId, pon.feederCore)) {
        error('pon_missing_core', `${eq.id}/${pon.id}`, `${eq.name} ${pon.id} names fiber ${pon.feederCore} of ${pon.connectedFeederCableId}, which does not exist.`, [eq.id]);
      }
      const mismatch = opticsClassMismatch(pon, eq);
      if (mismatch) error('pon_class_technology', `${eq.id}/${pon.id}`, `${eq.name} ${pon.id}: ${mismatch}`, [eq.id]);
    }
    // Phase 10: the OLT's recorded shelves, slots and cards.
    for (const p of oltChassisProblems(eq)) (p.severity === 'error' ? error : warning)(p.code, `${eq.id}/${p.key}`, p.message, [eq.id]);
  }

  // --- Customers ------------------------------------------------------------------------------
  const onOutput = new Map<string, typeof data.customers>();
  for (const customer of data.customers) {
    if (customer.dropCableId && index.cables.has(customer.dropCableId) && customer.fiberCore && !coreExists(customer.dropCableId, customer.fiberCore)) {
      error('customer_missing_core', customer.id, `${customer.name} is on fiber ${customer.fiberCore} of ${customer.dropCableId}, which does not exist.`, [customer.id]);
    }
    if (customer.status !== 'Disconnected' && customer.splitterId && customer.splitterOutputPort) {
      const key = `${customer.splitterId}#${customer.splitterOutputPort}`;
      onOutput.set(key, [...(onOutput.get(key) ?? []), customer]);
    }
  }
  // One splitter output feeds one ONT. Customers sharing one recorded ONT (an MDU unit) are that one ONT.
  for (const [key, list] of onOutput) {
    if (list.length < 2) continue;
    const ontId = list[0].ontId;
    if (ontId && list.every((c) => c.ontId === ontId)) continue;
    const [splitterId, port] = splitKey(key);
    const sp = index.splitters.get(splitterId);
    error(
      'splitter_output_two_customers',
      key,
      `Output ${port} of splitter ${sp?.name ?? splitterId} is recorded for ${list.length} active customers (${list.map((c) => c.name).join(', ')}). One output feeds one ONT.`,
      [splitterId, ...list.map((c) => c.id)],
    );
  }

  // --- Two OLT ports on one splitter tree (always: a cheap walk of recorded links only) ---------
  for (const [spId, roots] of splitterRoots(data, index)) {
    const sp = index.splitters.get(spId);
    if (roots.length < 2 || sp?.dualInput) continue;
    error(
      'two_pon_one_tree',
      spId,
      `Splitter ${sp?.name ?? spId} is reached from both ${roots[0].label} and ${roots[1].label}. Two OLT ports cannot feed one splitter tree.`,
      [spId, ...new Set(roots.map((r) => r.oltId))],
    );
  }

  // --- Whole PON trees ------------------------------------------------------------------------
  if (options.trees) {
    for (const olt of data.equipment) {
      for (const pon of olt.ponPorts ?? []) {
        const tree = tracePonTree(olt.id, pon.id, data, { settings, index });
        if (!tree) continue;
        for (const p of tree.problems) warning('pon_tree', `${olt.id}/${pon.id}/${p}`, p, [olt.id]);
        if (tree.maxSplitProduct > settings.limits.splitProduct) {
          warning('split_product', `${olt.id}/${pon.id}`, `${olt.name} ${pon.id}: splits multiply to 1:${tree.maxSplitProduct}, above the ${settings.limits.splitProduct} limit in settings.`, [olt.id]);
        }
        for (const leaf of tree.leaves) {
          const v = leaf.path.verdict;
          if (v === 'over_budget' || v === 'too_little_loss') {
            warning(
              'path_budget',
              leaf.customer.id,
              `${leaf.customer.name}: estimated path ${v === 'over_budget' ? 'is over the optical budget' : 'has too little loss (too much light)'} for ${leaf.path.opticsClass}.`,
              [leaf.customer.id],
            );
          }
        }
      }
    }
  }
  return problems;
}

/**
 * Phase 9: why a connector does not fit an adapter, or undefined when it fits or either is not
 * known well enough to say. Reads the kind (SC, LC, FC, ST, MPO, E2000) and polish (APC, UPC, PC)
 * from the text as written, such as "SC/APC". A hybrid adapter written as "SC-LC" is not judged.
 */
export function connectorClash(adapter: string | undefined, plug: string | undefined): string | undefined {
  const read = (text: string | undefined) => {
    const t = (text ?? '').toUpperCase();
    const kinds = ['SC', 'LC', 'FC', 'ST', 'MPO', 'E2000'].filter((k) => new RegExp(`(^|[^A-Z])${k}([^A-Z]|$)`).test(t));
    const polish = /APC/.test(t) ? 'APC' : /UPC/.test(t) ? 'UPC' : /(^|[^A-Z])PC([^A-Z]|$)/.test(t) ? 'PC' : undefined;
    return { kind: kinds.length === 1 ? kinds[0] : undefined, polish };
  };
  if (!adapter?.trim() || !plug?.trim()) return undefined;
  const a = read(adapter);
  const p = read(plug);
  if (a.kind && p.kind && a.kind !== p.kind) return `A ${p.kind} plug does not fit a ${a.kind} adapter. Check what was recorded.`;
  if (a.polish && p.polish && (a.polish === 'APC') !== (p.polish === 'APC')) return 'APC (angled, green) and UPC (flat, blue) ends do not mate: the loss is high and the faces can be damaged. Check the cord.';
  return undefined;
}

const splitKey = (key: string): [string, number] => {
  const i = key.lastIndexOf('#');
  return [key.slice(0, i), Number(key.slice(i + 1))];
};

/**
 * For each splitter, the OLT PON ports whose recorded fibers reach it (patches, splices, splitter
 * outputs and cascades only). Linear in the links walked: no loss or budget is worked out here.
 */
function splitterRoots(data: FiberData, index: FiberIndex): Map<string, { oltId: string; label: string }[]> {
  const roots = new Map<string, { oltId: string; label: string }[]>();
  for (const olt of data.equipment) {
    for (const pon of olt.ponPorts ?? []) {
      const label = `${olt.name} ${pon.id}`;
      const queue: { cableId: string; core: number }[] = [];
      for (const ref of index.ponPatches.get(`${olt.id}/${pon.id}`) ?? []) {
        if (ref.port.feederCableId && ref.port.feederCore) queue.push({ cableId: ref.port.feederCableId, core: ref.port.feederCore });
      }
      if (pon.connectedFeederCableId && pon.feederCore) queue.push({ cableId: pon.connectedFeederCableId, core: pon.feederCore });
      const seenCores = new Set<string>();
      const seenSplitters = new Set<string>();
      const visit = (sp: Splitter) => {
        if (seenSplitters.has(sp.id)) return;
        seenSplitters.add(sp.id);
        roots.set(sp.id, [...(roots.get(sp.id) ?? []), { oltId: olt.id, label }]);
        for (const port of sp.outputPorts) {
          if (port.connectedDropCableId && port.connectedCore) queue.push({ cableId: port.connectedDropCableId, core: port.connectedCore });
          for (const child of index.cascadeChildren.get(`${sp.id}#${port.portNumber}`) ?? []) visit(child);
        }
      };
      for (let guard = 0; queue.length && guard < 5000; guard += 1) {
        const next = queue.shift()!;
        const key = coreKey(next.cableId, next.core);
        if (seenCores.has(key)) continue;
        seenCores.add(key);
        for (const sink of index.sinks.get(key) ?? []) {
          if (sink.kind === 'splice' && isSpliceActive(sink.splice)) queue.push({ cableId: sink.splice.outputCableId, core: sink.splice.outputCore });
          else if (sink.kind === 'splitter') visit(sink.splitter);
        }
      }
    }
  }
  return roots;
}

export interface FiberChangeCheck {
  errors: FiberProblem[];
  warnings: FiberProblem[];
}

/**
 * Problems that a change adds. Problems already in the data before the change are not blamed on it,
 * so older broken records never stop someone fixing something else.
 */
export function newFiberProblems(before: FiberData, after: FiberData, options: FiberCheckOptions = {}): FiberChangeCheck {
  const old = new Set(findFiberProblems(before, options).map((p) => p.key));
  const added = findFiberProblems(after, options).filter((p) => !old.has(p.key));
  return { errors: added.filter((p) => p.severity === 'error'), warnings: added.filter((p) => p.severity === 'warning') };
}

/** One plain sentence for a refusal. */
export function describeFiberProblems(problems: readonly FiberProblem[]): string {
  const [first] = problems;
  if (!first) return '';
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  return `${first.message}${more}`;
}

const FIBER_COLLECTIONS = ['equipment', 'cables', 'splitters', 'closures', 'customers'] as const;

export function changeSetTouchesFiber(changes: ChangeSet): boolean {
  return FIBER_COLLECTIONS.some((name) => (changes.upserts?.[name]?.length ?? 0) > 0 || (changes.deletes?.[name]?.length ?? 0) > 0);
}

/** Errors a change set would add to the stored fiber records. Used by the server before it writes. */
export function checkChangeSetFiber(current: FiberData, changes: ChangeSet, options: FiberCheckOptions = {}): FiberProblem[] {
  const after: Record<string, { id: string }[]> = {};
  for (const name of FIBER_COLLECTIONS) {
    const byId = new Map(((current[name] ?? []) as unknown as { id: string }[]).map((r) => [r.id, r]));
    for (const id of changes.deletes?.[name] ?? []) byId.delete(id);
    for (const record of (changes.upserts?.[name] ?? []) as { id: string }[]) byId.set(record.id, record);
    after[name] = [...byId.values()];
  }
  return newFiberProblems(current, after as unknown as FiberData, options).errors;
}

/** For callers that already hold an index. */
export type { FiberIndex };
