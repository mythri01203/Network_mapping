/** Phase 9: which part of the OLT Rack screen to open next: the PON ports or Sites and racks. */
export type RackScreenTab = 'ports' | 'sites';

let next: RackScreenTab | null = null;

/** Asks the OLT Rack screen to open on Sites and racks the next time it shows. */
export const openSitesAndRacks = () => {
  next = 'sites';
};

/** The tab asked for, once. */
export const takeRequestedTab = (): RackScreenTab | null => {
  const tab = next;
  next = null;
  return tab;
};
