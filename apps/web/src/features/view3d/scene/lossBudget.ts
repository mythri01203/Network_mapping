import {
  calculateOpticalLossBudget,
  DEFAULT_OPTICAL_SETTINGS,
  type OpticalSettings,
  type OpticsClass,
  opticsClassForTechnology,
  type PonTechnology,
  splitterCapacity,
} from '@fibergis/shared';

import type { CascadeResult, PonTree } from './cascade';
import type { PonLevelSummary, PonSummary, SceneText } from './types';

/**
 * Port counts and the optical budget of one PON tree. Losses come from the app's optical settings
 * (Administration, Optical settings), never from numbers written here. Distance is the drawn length
 * of the cables on the longest recorded path, so it is labelled "drawn".
 */

const ratioN = (ratio: string) => Number(ratio.split(':')[1]) || 0;

/** Split product above which a warning is shown. Both are common ONU limits per PON port. */
export const SPLIT_WARN_LEVELS = [64, 128] as const;

export interface BudgetInputs {
  ratios: string[];
  distanceMeters: number;
  /** Mated connector pairs on the path. */
  connectors: number;
  splices: number;
  opticsClass: OpticsClass;
}

/** The connector pairs a typical path has: OLT patch, ONT, and in/out at every splitter box. */
export const typicalConnectors = (levels: number): number => 2 + levels * 2;

export function budgetFor(
  input: BudgetInputs,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): NonNullable<PonSummary['budget']> {
  const result = calculateOpticalLossBudget(
    {
      totalDistanceMeters: input.distanceMeters,
      wavelengthNm: 1310,
      splitters: input.ratios.map((ratio) => ({ ratio })),
      connectorsCount: input.connectors,
      splicesCount: input.splices,
      opticsClass: input.opticsClass,
    },
    settings,
  );
  const fits = result.totalLossDb <= result.classMaxLossDb;
  const cPlus = settings.classes['GPON C+'];
  const isGpon = input.opticsClass.startsWith('GPON');
  let recommendation: SceneText;
  if (fits)
    recommendation = {
      key: 'msg.fits',
      values: { cls: input.opticsClass, left: result.remainingDb.toFixed(1), max: result.classMaxLossDb },
    };
  else if (isGpon && cPlus && result.totalLossDb <= cPlus.maxLossDb)
    recommendation = { key: 'msg.cplus', values: { cls: input.opticsClass, max: cPlus.maxLossDb } };
  else recommendation = { key: 'msg.over', values: {} };
  return {
    totalLossDb: result.totalLossDb,
    splitterLossDb: result.splitterLossDb,
    fiberLossDb: result.fiberLossDb,
    connectorLossDb: result.connectorLossDb,
    spliceLossDb: result.spliceLossDb,
    distanceMeters: Math.round(input.distanceMeters),
    connectors: input.connectors,
    splices: input.splices,
    opticsClass: input.opticsClass,
    classMaxLossDb: result.classMaxLossDb,
    fits,
    recommendation,
  };
}

export function summarizePon(
  tree: PonTree,
  cascade: CascadeResult,
  settings: OpticalSettings = DEFAULT_OPTICAL_SETTINGS,
): PonSummary {
  const byLevel = new Map<number, PonLevelSummary>();
  for (const id of tree.splitterIds) {
    const sp = cascade.index.splitters.get(id);
    const place = cascade.splitters.get(id);
    if (!sp || !place) continue;
    const entry = byLevel.get(place.level) ?? { level: place.level, ratios: [], boxes: 0, splitterIds: [] };
    if (!entry.ratios.includes(sp.ratio)) entry.ratios.push(sp.ratio);
    entry.boxes += 1;
    entry.splitterIds.push(id);
    byLevel.set(place.level, entry);
  }
  const levels = [...byLevel.values()].sort((a, b) => a.level - b.level);
  const designPorts = levels.length ? levels.reduce((n, l) => n * Math.max(...l.ratios.map(ratioN)), 1) : 0;
  let builtPorts = 0;
  for (const id of tree.splitterIds) {
    const sp = cascade.index.splitters.get(id);
    const place = cascade.splitters.get(id);
    if (sp && place) builtPorts += splitterCapacity(sp) - place.childPorts.size;
  }
  const used = new Set(tree.customerIds).size;
  const warnings: SceneText[] = [];
  for (const limit of [...SPLIT_WARN_LEVELS].reverse()) {
    if (designPorts > limit) {
      warnings.push({ key: 'msg.split', values: { split: designPorts, limit } });
      break;
    }
  }
  if (tree.pon.maxOnu && used > tree.pon.maxOnu)
    warnings.push({ key: 'msg.onu', values: { used, max: tree.pon.maxOnu } });

  let budget: PonSummary['budget'];
  if (levels.length) {
    // Longest recorded path on this PON: most splitters, then most drawn metres.
    let distance = 0;
    let splices = 0;
    for (const cid of tree.customerIds) {
      const path = cascade.paths.get(cid);
      if (!path) continue;
      const metres = path.cableIds.reduce((m, id) => m + (cascade.index.cables.get(id)?.lengthMeters ?? 0), 0);
      if (metres > distance) {
        distance = metres;
        splices = path.splices;
      }
    }
    if (distance === 0)
      distance = tree.feederCableIds.reduce((m, id) => m + (cascade.index.cables.get(id)?.lengthMeters ?? 0), 0);
    const ratios = levels.map((l) => l.ratios.reduce((a, b) => (ratioN(b) > ratioN(a) ? b : a)));
    const opticsClass =
      tree.pon.opticsClass ??
      opticsClassForTechnology((tree.pon.technology ?? tree.olt.technology) as PonTechnology | undefined);
    budget = budgetFor(
      { ratios, distanceMeters: distance, connectors: typicalConnectors(levels.length), splices, opticsClass },
      settings,
    );
    if (!budget.fits)
      warnings.push({
        key: 'msg.budget',
        values: { loss: budget.totalLossDb, cls: budget.opticsClass, max: budget.classMaxLossDb },
      });
  }

  const sources = tree.sources;
  return {
    key: tree.key,
    oltId: tree.oltId,
    ponId: tree.ponId,
    label: tree.label,
    levels,
    designPorts,
    builtPorts,
    used,
    spare: Math.max(0, designPorts - used),
    budget,
    warnings,
    source: sources.has('fiber') && sources.has('record') ? 'mixed' : sources.has('fiber') ? 'fiber' : 'record',
  };
}
