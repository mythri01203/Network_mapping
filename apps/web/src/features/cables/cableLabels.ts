import type { CableInstallationType, CableSheath, FiberMode, FiberStandard } from '@fibergis/shared';

/** Phase 5: plain words for how a cable is installed. Kept apart from its type (what it is for). */
export const INSTALL_LABELS: Record<CableInstallationType, string> = {
  Aerial: 'Aerial (on poles)',
  Underground: 'Underground',
  Duct: 'In a duct',
  'Direct Buried': 'Buried directly',
  Facade: 'On a building wall',
};

export const fiberStandardLabel = (s: FiberStandard) => (s === 'other' ? 'Other' : s);

/** How a cable is made, as the forms edit it. Each blank is "Not recorded". */
export interface BuildValue {
  fiberStandard?: FiberStandard;
  fiberMode?: FiberMode;
  sheath?: CableSheath;
  outerDiameterMm?: number;
  installationType?: CableInstallationType;
}
