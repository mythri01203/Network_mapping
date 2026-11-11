/**
 * The `fibergis-map-check` rules, run on the server for the Reports screen's data-quality summary
 * and the stored findings (network mapping Phase 15). One copy of the rules: the skill's own script,
 * which only reads the data it is given, plus the shared geometry rules. Both use the operator's
 * own limits from the settings records; the script's defaults stand only for a value no setting has.
 */
import { checkLimitsFrom, collectValidationProblems, type FoundProblem, type NetworkData, type NetworkSnapshot } from '@fibergis/shared';

// @ts-expect-error -- plain JavaScript shared with the fibergis-map-check skill; typed below.
import { checkNetwork as runCheck, DEFAULT_LIMITS as limits } from '../../../../.claude/skills/fibergis-map-check/scripts/check_network.mjs';

export interface MapCheckFinding {
  severity: 'error' | 'warning' | 'note';
  rule: string;
  id: string;
  message: string;
}

export const DEFAULT_LIMITS = limits as Record<string, number>;

export const checkNetwork = (data: unknown, checkLimits: Record<string, number> = DEFAULT_LIMITS): MapCheckFinding[] =>
  runCheck(data, checkLimits) as MapCheckFinding[];

/** The script's limits from the operator's settings records (Phase 15), never only the defaults. */
export const operatorLimits = (data: Pick<NetworkSnapshot, 'settings'>): Record<string, number> => ({ ...DEFAULT_LIMITS, ...checkLimitsFrom(data.settings ?? []).mapCheck });

/** Every problem one run finds on a stored network: the script's and the geometry rules', with the operator's limits. */
export function runMapCheck(data: NetworkSnapshot): FoundProblem[] {
  const limitsNow = checkLimitsFrom(data.settings ?? []);
  const mapCheck = checkNetwork(data, { ...DEFAULT_LIMITS, ...limitsNow.mapCheck });
  return collectValidationProblems(data as unknown as NetworkData, { limits: limitsNow, mapCheck });
}
