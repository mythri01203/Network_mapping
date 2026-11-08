/**
 * The `fibergis-map-check` rules, run on the server for the Reports screen's data-quality summary.
 * One copy of the rules: the skill's own script, which only reads the data it is given.
 */
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
