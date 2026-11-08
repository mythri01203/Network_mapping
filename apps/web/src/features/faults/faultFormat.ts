import type { NetworkElementRef } from '@fibergis/shared';

/** Whether a picked element is complete enough to use. */
export const elementReady = (el: NetworkElementRef | null): el is NetworkElementRef =>
  !!el && !!el.id && (el.type !== 'pon_port' || !!el.ponPortId) && (el.type !== 'core' || !!el.fiberNumber);

/** A stored time as date and minutes, or "Not recorded". */
export const when = (iso?: string) => (iso ? iso.replace('T', ' ').slice(0, 16) : 'Not recorded');
