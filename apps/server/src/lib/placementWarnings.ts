import { type ChangeSet, newDuplicateRouteWarnings, newPointDuplicateWarnings, type PlacementWarning, type RouteWarning } from '@fibergis/shared';

import type { WriteGuard } from '../db/repository';
import { storesOnlyKnownEquipment } from './plainEdits';

/**
 * Phase 3: the server's "possible duplicate" check for new points. It runs inside the same write as
 * the other guards, so it sees exactly the stored records the change lands on, but it never refuses
 * anything: the warnings are handed back for the route to log and return. A change with no new
 * equipment keeps the plain guard and costs nothing extra.
 *
 * Phase 5: the same for cables. A new or re-routed cable with the same two ends as another, whose
 * line runs along it, is reported as a possible duplicate route. Never refused.
 */
export function withPlacementWarnings(changes: ChangeSet, guard: WriteGuard | undefined): { guard: WriteGuard | undefined; warnings: (PlacementWarning | RouteWarning)[] } {
  const warnings: (PlacementWarning | RouteWarning)[] = [];
  const points = !!changes.upserts?.equipment?.length;
  // Only a cable with both ends and a drawn line can match another; others cost no read.
  const routes = !!changes.upserts?.cables?.some((c) => c.startEquipmentId && c.endEquipmentId && c.coordinates.length >= 2);
  if (!points && !routes) return { guard, warnings };
  return {
    warnings,
    guard: (read) => {
      guard?.(read);
      // Reset first, in case the store ever runs a guard twice for one write.
      warnings.length = 0;
      const settings = read('settings');
      // Phase 24b: the warning looks at new items only; an edit of stored items needs no read of every item.
      if (points && !storesOnlyKnownEquipment(read, changes)) warnings.push(...newPointDuplicateWarnings(read('equipment'), changes, settings));
      if (routes) warnings.push(...newDuplicateRouteWarnings(read('cables'), changes, settings));
    },
  };
}
