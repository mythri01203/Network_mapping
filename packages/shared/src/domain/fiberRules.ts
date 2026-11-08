import { type ColorScheme, coreIdentity, DEFAULT_COLOR_SCHEMES } from '../fiber/colors';
import type { ChangeSet } from '../model/api';
import type { SplitterRatio } from '../model/enums';
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
      if (active.length > 1) {
        error(
          'core_two_assignments',
          coreKey(cable.id, core.coreNumber),
          `${cap(describeCore(index, cable.id, core.coreNumber))} has ${active.length} active assignments (${active.map((a) => a.use).join('; ')}). One core carries one service.`,
          [cable.id],
        );
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
          if (cable.cores.find((k) => k.coreNumber === core)?.status === 'Damaged') {
            warning('splice_damaged_core', `${closure.id}/${splice.id}/${cable.id}`, `Splice in ${closure.name} uses ${describeCore(index, cable.id, core)}, which is marked damaged.`, [closure.id, cable.id]);
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
      }
      if (splice.spliceLossDb !== undefined && (splice.spliceType ?? 'fusion') === 'fusion' && splice.spliceLossDb > settings.limits.spliceRejectDb) {
        warning('splice_high_loss', `${closure.id}/${splice.id}`, `Splice in ${closure.name} records ${splice.spliceLossDb} dB, above the ${settings.limits.spliceRejectDb} dB redo level.`, [closure.id]);
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
  }

  // --- Customers ------------------------------------------------------------------------------
  for (const customer of data.customers) {
    if (customer.dropCableId && index.cables.has(customer.dropCableId) && customer.fiberCore && !coreExists(customer.dropCableId, customer.fiberCore)) {
      error('customer_missing_core', customer.id, `${customer.name} is on fiber ${customer.fiberCore} of ${customer.dropCableId}, which does not exist.`, [customer.id]);
    }
  }

  // --- Whole PON trees ------------------------------------------------------------------------
  if (options.trees) {
    const rootOf = new Map<string, string>();
    for (const olt of data.equipment) {
      for (const pon of olt.ponPorts ?? []) {
        const tree = tracePonTree(olt.id, pon.id, data, { settings, index });
        if (!tree) continue;
        for (const p of tree.problems) warning('pon_tree', `${olt.id}/${pon.id}/${p}`, p, [olt.id]);
        if (tree.maxSplitProduct > settings.limits.splitProduct) {
          warning('split_product', `${olt.id}/${pon.id}`, `${olt.name} ${pon.id}: splits multiply to 1:${tree.maxSplitProduct}, above the ${settings.limits.splitProduct} limit in settings.`, [olt.id]);
        }
        for (const spId of tree.splitterIds) {
          const other = rootOf.get(spId);
          const here = `${olt.name} ${pon.id}`;
          const sp = index.splitters.get(spId);
          if (other && other !== here && !sp?.dualInput) {
            error('two_pon_one_tree', spId, `Splitter ${sp?.name ?? spId} is reached from both ${other} and ${here}. Two OLT ports cannot feed one splitter tree.`, [spId, olt.id]);
          }
          rootOf.set(spId, here);
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

const splitKey = (key: string): [string, number] => {
  const i = key.lastIndexOf('#');
  return [key.slice(0, i), Number(key.slice(i + 1))];
};

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
