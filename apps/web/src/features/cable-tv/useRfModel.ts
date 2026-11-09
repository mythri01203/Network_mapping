import { useMemo } from 'react';

import {
  buildRfTree,
  checkRfLevels,
  estimateRfLevels,
  findRfProblems,
  indexRf,
  resolveRfSettings,
  type RfData,
} from '@fibergis/shared';

import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';

/** Everything the Cable TV page shows, worked out from the stored records only. */
export function useRfModel() {
  const rfElements = useNetworkStore((s) => s.rfElements);
  const rfLinks = useNetworkStore((s) => s.rfLinks);
  const rfLevels = useNetworkStore((s) => s.rfLevels);
  const cables = useNetworkStore((s) => s.cables);
  const customers = useNetworkStore((s) => s.customers);
  const equipment = useNetworkStore((s) => s.equipment);
  const settingsList = useNetworkStore((s) => s.settings);

  return useMemo(() => {
    const data: RfData = { rfElements, rfLinks, rfLevels, cables, customers, equipment };
    const rf = resolveRfSettings(settingsList);
    const optical = selectOpticalSettings({ settings: settingsList });
    const ix = indexRf(data);
    const tree = buildRfTree(data, ix);
    const estimates = estimateRfLevels(data, rf, optical, ix);
    const checks = checkRfLevels(data, estimates, rf, ix);
    const problems = findRfProblems(data, { rf, optical });
    return { data, rf, optical, ix, tree, estimates, checks, problems };
  }, [rfElements, rfLinks, rfLevels, cables, customers, equipment, settingsList]);
}

export type RfModel = ReturnType<typeof useRfModel>;
