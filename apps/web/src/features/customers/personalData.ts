import { type Customer, CUSTOMER_HIDDEN_TEXT, hasRecordedLocation } from '@fibergis/shared';

/**
 * Phase 12: the server leaves out personal data a role does not need. Name, address and mobile come
 * as "Hidden for your role"; a hidden house position comes as 0, 0 with `hiddenFields` saying so,
 * which must never read as "not recorded".
 */
export const isGpsHidden = (c: Pick<Customer, 'hiddenFields'>): boolean => !!c.hiddenFields?.includes('gps');

/** The line under a customer about their house position, or nothing when it is recorded and shown. */
export function housePositionNote(c: Pick<Customer, 'hiddenFields' | 'lat' | 'lng'>): { text: string; hidden: boolean } | undefined {
  if (isGpsHidden(c)) return { text: `House position: ${CUSTOMER_HIDDEN_TEXT}`, hidden: true };
  return hasRecordedLocation(c) ? undefined : { text: 'House location not recorded', hidden: false };
}
